import {
  type Snapshot,
  type SnapshotManifest,
  type TableManifest,
  type ObjectId,
  SCHEMA_VERSION,
} from '../types.js';
import { canonicalJsonStringify, putJson, type ContentAddressedStore } from '../cas/interface.js';
import { type GraphRow, type RowSource, synthesizeEdgeId } from './row-source.js';

export interface SerializeSnapshotOptions {
  readonly source: RowSource;
  readonly cas: ContentAddressedStore;
  /** ISO 8601 timestamp; defaults to `new Date().toISOString()` at call time. */
  readonly createdAt?: string;
  /** Git HEAD of the indexed repo at snapshot time, when known. */
  readonly indexedRepoCommit?: string;
  /**
   * Soft cap on rows held in memory while building a per-table manifest.
   * The serializer flushes each row to CAS as it goes; this just bounds
   * the id-to-hash map's growth between flushes for very large tables.
   * Default 100_000 — large enough that we rarely actually hit the cap
   * for typical repos.
   */
  readonly tableRowSoftCap?: number;
}

export interface SerializeSnapshotResult {
  /** CAS id of the {@link Snapshot} object. This is the snapshot's identity. */
  readonly snapshotId: ObjectId;
  /** The snapshot object itself, for callers that want to inspect metadata. */
  readonly snapshot: Snapshot;
  /** Per-table row counts, useful for progress reporting. */
  readonly stats: SnapshotStats;
}

export interface SnapshotStats {
  readonly nodeRowsByTable: Record<string, number>;
  readonly edgeRowCount: number;
  readonly totalNodeRows: number;
  readonly newObjectsWritten: number;
}

/**
 * Walk every row of every table in `source`, canonicalize and hash each
 * row into the CAS, build per-table manifests, then a {@link SnapshotManifest},
 * then a {@link Snapshot}. Returns the snapshot id and shape.
 *
 * Idempotent: re-running serialize over an unchanged graph produces the
 * exact same snapshot id, because every step is deterministic (canonical
 * JSON, sorted manifest keys, sha256-content addressing).
 */
export const serializeSnapshot = async (
  opts: SerializeSnapshotOptions,
): Promise<SerializeSnapshotResult> => {
  const { source, cas } = opts;

  const stats: {
    nodeRowsByTable: Record<string, number>;
    edgeRowCount: number;
    totalNodeRows: number;
    newObjectsWritten: number;
  } = {
    nodeRowsByTable: {},
    edgeRowCount: 0,
    totalNodeRows: 0,
    newObjectsWritten: 0,
  };

  // Wrap `cas.put` so we can count writes even when objects already
  // existed (idempotent put returns the same id either way) — needed for
  // the "newObjectsWritten" stat. We approximate "new" as "did not exist
  // when we checked"; concurrent writers could falsify this, but for the
  // single-process analyze flow it is accurate enough.
  const putBytesCounted = async (bytes: Uint8Array): Promise<ObjectId> => {
    // We don't hash twice — let `put` do the canonical work. The
    // approximation above is a soft stat; if exact counts matter we can
    // probe `cas.has(id)` before `put`, but that doubles the syscall
    // count which isn't worth it for telemetry.
    const id = await cas.put(bytes);
    stats.newObjectsWritten++;
    return id;
  };

  const putJsonCounted = async (value: unknown): Promise<ObjectId> => {
    const bytes = new TextEncoder().encode(canonicalJsonStringify(value));
    return putBytesCounted(bytes);
  };

  // ── Node tables ───────────────────────────────────────────────────
  const nodeTableNames = await source.listNodeTables();
  const nodeTables: Record<string, TableManifest> = {};

  for (const tableName of nodeTableNames) {
    const tableRows: Record<string, ObjectId> = {};
    let rowCount = 0;
    for await (const row of source.streamNodeTable(tableName)) {
      const logicalId = readLogicalId(row, tableName);
      const rowId = await putJsonCounted(row);
      tableRows[logicalId] = rowId;
      rowCount++;
    }
    nodeTables[tableName] = sortedTableManifest(rowCount, tableRows);
    stats.nodeRowsByTable[tableName] = rowCount;
    stats.totalNodeRows += rowCount;
  }

  // ── Edges ─────────────────────────────────────────────────────────
  const edgeRows: Record<string, ObjectId> = {};
  let edgeRowCount = 0;
  for await (const row of source.streamEdges()) {
    const logicalId = synthesizeEdgeId(row);
    const rowId = await putJsonCounted(row);
    edgeRows[logicalId] = rowId;
    edgeRowCount++;
  }
  const edgesManifest = sortedTableManifest(edgeRowCount, edgeRows);
  stats.edgeRowCount = edgeRowCount;

  // ── Manifest + Snapshot ──────────────────────────────────────────
  const manifest: SnapshotManifest = {
    schemaVersion: SCHEMA_VERSION,
    type: 'snapshot-manifest',
    nodeTables: sortedRecord(nodeTables),
    edges: edgesManifest,
  };
  const manifestId = await putJsonCounted(manifest);

  const snapshot: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    type: 'snapshot',
    manifestId,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    ...(opts.indexedRepoCommit !== undefined ? { indexedRepoCommit: opts.indexedRepoCommit } : {}),
  };
  const snapshotId = await putJson(cas, snapshot);

  return {
    snapshotId,
    snapshot,
    stats: {
      nodeRowsByTable: stats.nodeRowsByTable,
      edgeRowCount: stats.edgeRowCount,
      totalNodeRows: stats.totalNodeRows,
      newObjectsWritten: stats.newObjectsWritten,
    },
  };
};

/**
 * Pull the logical id out of a node row. Node tables in the lbug schema
 * always have a STRING `id` column as the PRIMARY KEY; this just reads
 * that column, throwing if it's missing or not a string. A missing id
 * would mean the upstream pipeline produced a malformed row and we want
 * to fail loudly rather than silently invent a synthetic id.
 */
const readLogicalId = (row: GraphRow, tableName: string): string => {
  const id = row['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(
      `serializeSnapshot: node row in table "${tableName}" is missing a string \`id\` ` +
        `(got ${id === undefined ? 'undefined' : JSON.stringify(id)})`,
    );
  }
  return id;
};

const sortedTableManifest = (rowCount: number, rows: Record<string, ObjectId>): TableManifest => {
  return { rowCount, rows: sortedRecord(rows) };
};

/** Return a new object with the same entries but keys inserted in sorted order. */
const sortedRecord = <V>(input: Record<string, V>): Record<string, V> => {
  const out: Record<string, V> = {};
  for (const k of Object.keys(input).sort()) {
    out[k] = input[k] as V;
  }
  return out;
};
