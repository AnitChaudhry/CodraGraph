/**
 * Core contracts for the CodraGraph versioned graph store.
 *
 * Mirrors a subset of Dolt / Noms / Git conventions:
 *   - Every persisted object is content-addressed by sha256.
 *   - Snapshots reference a manifest tree; commits reference a snapshot
 *     plus parents; branches are mutable refs pointing at commit ids.
 *   - The hash itself is the identity; equal hashes mean equal content.
 */

/**
 * Branded, sha256-prefixed object id. Format: `sha256:<64-hex>`.
 *
 * Branding prevents accidental confusion with arbitrary strings or with
 * hashes computed by other algorithms. Use {@link makeObjectId} to mint a
 * new id from raw bytes; use {@link parseObjectId} to validate one read
 * from disk.
 */
export type ObjectId = string & { readonly __brand: "codragraph-graphstore.ObjectId" };

/** Pattern an {@link ObjectId} string must match. */
export const OBJECT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Schema version for on-disk objects. Bump when wire format changes. */
export const SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

// ──────────────────────────────────────────────────────────────────────
// Snapshot
// ──────────────────────────────────────────────────────────────────────

/**
 * A Snapshot is the root object describing an immutable graph state.
 *
 * Stored in CAS as a small JSON document; its own hash is the snapshot id
 * returned to callers. The bulky list of row hashes lives in a separate
 * manifest object referenced by {@link Snapshot.manifestId} so future
 * versions can chunk it (Merkle-tree of table chunks) without changing the
 * Snapshot shape.
 */
export interface Snapshot {
  readonly schemaVersion: SchemaVersion;
  readonly type: "snapshot";
  /** CAS id of the {@link SnapshotManifest} object. */
  readonly manifestId: ObjectId;
  /** ISO 8601 timestamp at which the snapshot was serialized. */
  readonly createdAt: string;
  /**
   * Git HEAD of the indexed repo at snapshot time, when known. Stored
   * for blame/time-travel — we want to be able to answer "what did the
   * graph look like at repo commit X?" without re-running analyze.
   */
  readonly indexedRepoCommit?: string;
}

/**
 * Listing of every row in the graph, grouped by table. The rows array
 * is sorted by row hash so that two equal graphs always produce the same
 * manifest hash regardless of insertion order.
 */
export interface SnapshotManifest {
  readonly schemaVersion: SchemaVersion;
  readonly type: "snapshot-manifest";
  /** Node tables keyed by table name (matches `NODE_TABLES` in codragraph-shared). */
  readonly nodeTables: Record<string, TableManifest>;
  /** Single relationships table — `CodeRelation` in the lbug schema. */
  readonly edges: TableManifest;
}

export interface TableManifest {
  readonly rowCount: number;
  /**
   * Map of logical row id → CAS id of the row object. Keyed by logical id
   * (the row's primary key for node tables; a synthetic
   * `${from}|${type}|${to}` string for the relationships table) rather
   * than just a flat list of row hashes — diff needs to detect
   * "same logical row, different content" to surface modified symbols.
   *
   * Canonical JSON serialization sorts object keys, so two equal
   * manifests serialize byte-for-byte identically and content
   * addressing is preserved.
   */
  readonly rows: Record<string, ObjectId>;
}

// ──────────────────────────────────────────────────────────────────────
// Commit
// ──────────────────────────────────────────────────────────────────────

export interface CommitAuthor {
  readonly name: string;
  readonly email: string;
}

/**
 * A Commit binds a Snapshot to history. Hash of a Commit object is its id.
 */
export interface Commit {
  readonly schemaVersion: SchemaVersion;
  readonly type: "commit";
  readonly snapshot: ObjectId;
  /**
   * Parent commit ids. Conventions:
   *   - `[]`              → initial / orphan commit
   *   - `[p]`             → linear successor
   *   - `[a, b]`          → merge commit; first parent is the branch
   *                         being merged into, second is the branch
   *                         being merged from (matches git's convention).
   */
  readonly parents: ObjectId[];
  readonly author: CommitAuthor;
  /** ISO 8601 commit timestamp. */
  readonly ts: string;
  readonly message: string;
}

// ──────────────────────────────────────────────────────────────────────
// Branch
// ──────────────────────────────────────────────────────────────────────

/**
 * A Branch is a mutable named pointer to a commit id. Stored on disk as
 * a single-line file under `<root>/refs/heads/<name>`; this object is the
 * in-memory shape returned by `listBranches()` etc.
 */
export interface Branch {
  readonly name: string;
  readonly head: ObjectId;
  /** ISO 8601 timestamp at which the ref file was created (filesystem mtime). */
  readonly createdAt: string;
}

/** Default branch name created on first analyze. Matches Git/Dolt convention. */
export const DEFAULT_BRANCH = "main" as const;

// ──────────────────────────────────────────────────────────────────────
// Diff
// ──────────────────────────────────────────────────────────────────────

/**
 * Structural diff between two snapshots. Keyed by table so callers can
 * render "Functions: +12, -3" style summaries directly. Each entry is a
 * row hash (the CAS id of the node/edge object) — callers can `cas.get`
 * to retrieve the actual row content when they need to render names.
 */
export interface GraphDiff {
  readonly from: ObjectId;
  readonly to: ObjectId;
  /** Rows present in `to` but not in `from`. Keyed by table name. */
  readonly addedNodes: Record<string, ObjectId[]>;
  /** Rows present in `from` but not in `to`. */
  readonly removedNodes: Record<string, ObjectId[]>;
  /** Edges present in `to` but not in `from`. */
  readonly addedEdges: ObjectId[];
  /** Edges present in `from` but not in `to`. */
  readonly removedEdges: ObjectId[];
  /**
   * Symbols (Function/Class/Method/Interface) whose row hash changed
   * between snapshots. Populated by the structural differ when both
   * sides have a row with the same logical id but different content
   * hash; the semantic differ (Phase 4.5) refines this further.
   */
  readonly modifiedSymbols: ModifiedSymbol[];
}

export interface ModifiedSymbol {
  readonly table: string;
  readonly id: string;
  readonly fromHash: ObjectId;
  readonly toHash: ObjectId;
}

// ──────────────────────────────────────────────────────────────────────
// ObjectId helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Mint an {@link ObjectId} from a raw 64-character hex digest.
 * Throws if the digest is malformed.
 */
export const makeObjectId = (hexDigest: string): ObjectId => {
  if (!/^[0-9a-f]{64}$/.test(hexDigest)) {
    throw new Error(
      `makeObjectId: expected 64 lowercase hex chars, got ${hexDigest.length} chars`,
    );
  }
  return `sha256:${hexDigest}` as ObjectId;
};

/**
 * Parse a string into an {@link ObjectId}, validating the prefix. Used at
 * trust boundaries (reading from disk, accepting CLI input).
 */
export const parseObjectId = (raw: string): ObjectId => {
  if (!OBJECT_ID_PATTERN.test(raw)) {
    throw new Error(
      `parseObjectId: invalid object id ${JSON.stringify(raw)} — expected sha256:<64-hex>`,
    );
  }
  return raw as ObjectId;
};

/** Extract the hex digest from an {@link ObjectId} (without the prefix). */
export const objectIdHex = (id: ObjectId): string => {
  // Slice past `sha256:`
  return id.slice(7);
};
