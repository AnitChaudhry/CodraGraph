import {
  type ObjectId,
  type Snapshot,
  type SnapshotManifest,
  type TableManifest,
  parseObjectId,
  SCHEMA_VERSION,
} from "../types.js";
import {
  type ContentAddressedStore,
  getJson,
  putJson,
} from "../cas/interface.js";
import { findLowestCommonAncestor } from "../history/log.js";
import { readCommit } from "../history/commit.js";

export interface ThreeWayMergeOptions {
  readonly cas: ContentAddressedStore;
  /** Branch being merged into — first parent of the resulting commit. */
  readonly ours: ObjectId;
  /** Branch being merged from — second parent. */
  readonly theirs: ObjectId;
}

/**
 * Outcome of a three-way merge attempt.
 *
 *   - `already-up-to-date`  → `ours` already contains `theirs`.
 *   - `fast-forward`        → `theirs` strictly extends `ours`; just move
 *                             the ref. No new snapshot created.
 *   - `merged`              → divergent histories merged cleanly. A new
 *                             snapshot was written; callers create the
 *                             merge commit (with parents = [ours, theirs]).
 *   - `conflicts`           → divergent histories with at least one row
 *                             changed differently on both sides. No new
 *                             snapshot is written; the conflicts list is
 *                             returned for the caller to surface.
 */
export type ThreeWayMergeResult =
  | { readonly kind: "already-up-to-date" }
  | { readonly kind: "fast-forward"; readonly to: ObjectId }
  | {
      readonly kind: "merged";
      readonly base: ObjectId;
      readonly snapshotId: ObjectId;
      readonly stats: MergeStats;
    }
  | {
      readonly kind: "conflicts";
      readonly base: ObjectId | null;
      readonly conflicts: MergeConflict[];
    };

export interface MergeStats {
  readonly tables: Record<
    string,
    { takenFromOurs: number; takenFromTheirs: number; unchanged: number; deleted: number }
  >;
  readonly edges: { takenFromOurs: number; takenFromTheirs: number; unchanged: number; deleted: number };
}

export interface MergeConflict {
  /** "node:<TableName>" or "edge". */
  readonly kind: string;
  /** Logical row id (PK for nodes, `${from}|${type}|${to}` for edges). */
  readonly id: string;
  /** Row hash in the LCA snapshot, or null if absent in base. */
  readonly base: ObjectId | null;
  /** Row hash on `ours` side, or null if deleted/absent. */
  readonly ours: ObjectId | null;
  /** Row hash on `theirs` side, or null if deleted/absent. */
  readonly theirs: ObjectId | null;
  /** Short reason category for the UI to render. */
  readonly reason: ConflictReason;
}

export type ConflictReason =
  | "modified-on-both-sides"
  | "modified-vs-deleted"
  | "added-on-both-sides-with-different-content";

/**
 * Three-way merge of two commit ids using their lowest common ancestor.
 *
 * Linear cases (already-up-to-date, fast-forward) are answered without
 * touching CAS objects beyond the commit/log walk.
 *
 * Divergent cases compute per-row resolutions in a single pass over the
 * union of (base, ours, theirs) row ids, batch the resolved row hashes
 * back into a fresh manifest, write the manifest + a Snapshot to CAS,
 * and return the new snapshot id. Conflicts short-circuit the write —
 * we never produce a half-merged snapshot.
 */
export const threeWayMerge = async (
  opts: ThreeWayMergeOptions,
): Promise<ThreeWayMergeResult> => {
  if (opts.ours === opts.theirs) {
    return { kind: "already-up-to-date" };
  }

  const base = await findLowestCommonAncestor(opts.cas, opts.ours, opts.theirs);
  if (base === opts.ours) {
    return { kind: "fast-forward", to: opts.theirs };
  }
  if (base === opts.theirs) {
    return { kind: "already-up-to-date" };
  }
  if (base === null) {
    // Orphan branches — no LCA. Phase 4 refuses to invent a merge here;
    // every row would look added-on-both-sides. Surface as conflicts so
    // the caller can decide.
    return { kind: "conflicts", base: null, conflicts: [] };
  }

  // Resolve commit → snapshot → manifest for all three points.
  const [oursManifest, theirsManifest, baseManifest] = await Promise.all([
    loadManifestFromCommit(opts.cas, opts.ours),
    loadManifestFromCommit(opts.cas, opts.theirs),
    loadManifestFromCommit(opts.cas, base),
  ]);

  const conflicts: MergeConflict[] = [];
  const mergedNodeTables: Record<string, TableManifest> = {};
  const stats: {
    tables: Record<
      string,
      { takenFromOurs: number; takenFromTheirs: number; unchanged: number; deleted: number }
    >;
    edges: { takenFromOurs: number; takenFromTheirs: number; unchanged: number; deleted: number };
  } = {
    tables: {},
    edges: { takenFromOurs: 0, takenFromTheirs: 0, unchanged: 0, deleted: 0 },
  };

  // ── Node tables ───────────────────────────────────────────────────
  const allTableNames = new Set<string>([
    ...Object.keys(baseManifest.nodeTables),
    ...Object.keys(oursManifest.nodeTables),
    ...Object.keys(theirsManifest.nodeTables),
  ]);
  for (const tableName of allTableNames) {
    const baseTable = baseManifest.nodeTables[tableName] ?? EMPTY_TABLE;
    const oursTable = oursManifest.nodeTables[tableName] ?? EMPTY_TABLE;
    const theirsTable = theirsManifest.nodeTables[tableName] ?? EMPTY_TABLE;
    const tableConflicts: MergeConflict[] = [];
    const merged = mergeTable(
      `node:${tableName}`,
      baseTable,
      oursTable,
      theirsTable,
      tableConflicts,
    );
    conflicts.push(...tableConflicts);
    stats.tables[tableName] = merged.stats;
    if (Object.keys(merged.rows).length > 0 || merged.stats.deleted > 0) {
      mergedNodeTables[tableName] = {
        rowCount: Object.keys(merged.rows).length,
        rows: merged.rows,
      };
    }
  }

  // ── Edges ─────────────────────────────────────────────────────────
  const edgeConflicts: MergeConflict[] = [];
  const mergedEdges = mergeTable(
    "edge",
    baseManifest.edges,
    oursManifest.edges,
    theirsManifest.edges,
    edgeConflicts,
  );
  conflicts.push(...edgeConflicts);
  stats.edges = mergedEdges.stats;

  if (conflicts.length > 0) {
    return { kind: "conflicts", base, conflicts };
  }

  // Write the merged manifest + snapshot. createdAt is set to "now" so
  // re-running the same merge produces a fresh snapshot id (the row
  // contents may be identical, but distinct merges should be
  // distinguishable in history).
  const mergedManifest: SnapshotManifest = {
    schemaVersion: SCHEMA_VERSION,
    type: "snapshot-manifest",
    nodeTables: sortedRecord(mergedNodeTables),
    edges: { rowCount: Object.keys(mergedEdges.rows).length, rows: mergedEdges.rows },
  };
  const manifestId = await putJson(opts.cas, mergedManifest);

  const snapshot: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    type: "snapshot",
    manifestId,
    createdAt: new Date().toISOString(),
  };
  const snapshotId = await putJson(opts.cas, snapshot);

  return {
    kind: "merged",
    base,
    snapshotId,
    stats: { tables: stats.tables, edges: stats.edges },
  };
};

// ──────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────

interface MergedTable {
  readonly rows: Record<string, ObjectId>;
  readonly stats: {
    takenFromOurs: number;
    takenFromTheirs: number;
    unchanged: number;
    deleted: number;
  };
}

const mergeTable = (
  conflictKind: string,
  base: TableManifest,
  ours: TableManifest,
  theirs: TableManifest,
  conflicts: MergeConflict[],
): MergedTable => {
  const merged: Record<string, ObjectId> = {};
  const stats = { takenFromOurs: 0, takenFromTheirs: 0, unchanged: 0, deleted: 0 };

  const allIds = new Set<string>([
    ...Object.keys(base.rows),
    ...Object.keys(ours.rows),
    ...Object.keys(theirs.rows),
  ]);

  for (const id of allIds) {
    const b = base.rows[id] ?? null;
    const o = ours.rows[id] ?? null;
    const t = theirs.rows[id] ?? null;

    // Standard three-way merge truth table over hash equality:
    //   eq(o, t)            → take either
    //   eq(o, b)            → ours unchanged → take theirs (theirs is the diff)
    //   eq(t, b)            → theirs unchanged → take ours
    //   else                → both diverged → conflict
    if (o === t) {
      // Both sides agree (including both deleted). Note: b could be
      // anything; doesn't matter — they agree.
      if (o !== null) {
        merged[id] = o;
        stats.unchanged++;
      } else {
        // o === t === null → row deleted from both sides.
        stats.deleted++;
      }
      continue;
    }

    if (o === b) {
      // ours unchanged from base; the diff is on theirs.
      if (t !== null) {
        merged[id] = t;
        stats.takenFromTheirs++;
      } else {
        // theirs deleted; ours kept the base value untouched.
        stats.deleted++;
      }
      continue;
    }

    if (t === b) {
      // theirs unchanged from base; the diff is on ours.
      if (o !== null) {
        merged[id] = o;
        stats.takenFromOurs++;
      } else {
        stats.deleted++;
      }
      continue;
    }

    // Both sides diverged from base AND disagree with each other. Surface
    // a precise reason so the conflict UI can render a useful message.
    const reason: ConflictReason =
      b === null
        ? "added-on-both-sides-with-different-content"
        : o === null || t === null
          ? "modified-vs-deleted"
          : "modified-on-both-sides";

    conflicts.push({
      kind: conflictKind,
      id,
      base: b,
      ours: o,
      theirs: t,
      reason,
    });
  }

  return { rows: sortedRecord(merged), stats };
};

const loadManifestFromCommit = async (
  cas: ContentAddressedStore,
  commitId: ObjectId,
): Promise<SnapshotManifest> => {
  const commit = await readCommit(cas, commitId);
  const snapshot = await getJson<Snapshot>(cas, commit.snapshot);
  if (snapshot.type !== "snapshot") {
    throw new Error(`threeWayMerge: ${commit.snapshot} is not a snapshot`);
  }
  const manifest = await getJson<SnapshotManifest>(
    cas,
    parseObjectId(snapshot.manifestId),
  );
  if (manifest.type !== "snapshot-manifest") {
    throw new Error(
      `threeWayMerge: manifest at ${snapshot.manifestId} has wrong type`,
    );
  }
  return manifest;
};

const sortedRecord = <V>(input: Record<string, V>): Record<string, V> => {
  const out: Record<string, V> = {};
  for (const k of Object.keys(input).sort()) {
    out[k] = input[k] as V;
  }
  return out;
};

const EMPTY_TABLE: TableManifest = { rowCount: 0, rows: {} };
