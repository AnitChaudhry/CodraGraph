import {
  type GraphDiff,
  type ModifiedSymbol,
  type ObjectId,
  type Snapshot,
  type SnapshotManifest,
  type TableManifest,
  parseObjectId,
} from "../types.js";
import { type ContentAddressedStore, getJson } from "../cas/interface.js";

export interface DiffSnapshotsOptions {
  readonly cas: ContentAddressedStore;
  readonly from: ObjectId;
  readonly to: ObjectId;
  /**
   * Tables whose modified rows should populate `modifiedSymbols`.
   * Defaults to the canonical "symbol-shaped" tables in the lbug schema:
   * Function, Method, Class, Interface. Pass `["*"]` to surface
   * modifications for every table.
   */
  readonly modifiedSymbolTables?: readonly string[];
}

const DEFAULT_SYMBOL_TABLES: readonly string[] = [
  "Function",
  "Method",
  "Class",
  "Interface",
];

/**
 * Compute the structural diff between two snapshots — added/removed
 * nodes per table, added/removed edges, and (optionally) the set of
 * symbols whose row hash changed in-place.
 *
 * "Modified" detection is intentionally hash-based: if the canonical
 * JSON of a symbol row differs between snapshots, we surface it.
 * Semantic interpretation (signature changed vs body changed vs just
 * line numbers shifting) is deferred to {@link diffSemantic}.
 */
export const diffSnapshots = async (
  opts: DiffSnapshotsOptions,
): Promise<GraphDiff> => {
  const { cas, from, to } = opts;
  const symbolTables = new Set(opts.modifiedSymbolTables ?? DEFAULT_SYMBOL_TABLES);
  const matchAllSymbolTables = symbolTables.has("*");

  const fromManifest = await readManifest(cas, from);
  const toManifest = await readManifest(cas, to);

  const addedNodes: Record<string, ObjectId[]> = {};
  const removedNodes: Record<string, ObjectId[]> = {};
  const modifiedSymbols: ModifiedSymbol[] = [];

  // Union of table names — both snapshots may have introduced new tables.
  const tableNames = new Set<string>([
    ...Object.keys(fromManifest.nodeTables),
    ...Object.keys(toManifest.nodeTables),
  ]);

  for (const table of tableNames) {
    const fromTable = fromManifest.nodeTables[table] ?? EMPTY_TABLE;
    const toTable = toManifest.nodeTables[table] ?? EMPTY_TABLE;
    const { added, removed, modified } = diffTable(fromTable, toTable);
    if (added.length > 0) addedNodes[table] = added;
    if (removed.length > 0) removedNodes[table] = removed;
    if (modified.length > 0 && (matchAllSymbolTables || symbolTables.has(table))) {
      for (const m of modified) {
        modifiedSymbols.push({
          table,
          id: m.id,
          fromHash: m.fromHash,
          toHash: m.toHash,
        });
      }
    }
  }

  const edgeDelta = diffTable(fromManifest.edges, toManifest.edges);

  return {
    from,
    to,
    addedNodes,
    removedNodes,
    addedEdges: edgeDelta.added,
    removedEdges: edgeDelta.removed,
    modifiedSymbols,
  };
};

interface TableDelta {
  readonly added: ObjectId[];
  readonly removed: ObjectId[];
  readonly modified: { id: string; fromHash: ObjectId; toHash: ObjectId }[];
}

const diffTable = (from: TableManifest, to: TableManifest): TableDelta => {
  const added: ObjectId[] = [];
  const removed: ObjectId[] = [];
  const modified: { id: string; fromHash: ObjectId; toHash: ObjectId }[] = [];

  for (const id of Object.keys(to.rows)) {
    const toHash = to.rows[id];
    if (!toHash) continue;
    const fromHash = from.rows[id];
    if (fromHash === undefined) {
      added.push(toHash);
    } else if (fromHash !== toHash) {
      modified.push({ id, fromHash, toHash });
    }
  }
  for (const id of Object.keys(from.rows)) {
    if (!(id in to.rows)) {
      const fromHash = from.rows[id];
      if (fromHash) removed.push(fromHash);
    }
  }
  return { added, removed, modified };
};

const readManifest = async (
  cas: ContentAddressedStore,
  snapshotId: ObjectId,
): Promise<SnapshotManifest> => {
  const snapshot = await getJson<Snapshot>(cas, snapshotId);
  if (snapshot.type !== "snapshot") {
    throw new Error(
      `diffSnapshots: ${snapshotId} is not a snapshot ` +
        `(type=${JSON.stringify((snapshot as { type?: unknown }).type)})`,
    );
  }
  const manifest = await getJson<SnapshotManifest>(
    cas,
    parseObjectId(snapshot.manifestId),
  );
  if (manifest.type !== "snapshot-manifest") {
    throw new Error(
      `diffSnapshots: manifest at ${snapshot.manifestId} has wrong type`,
    );
  }
  return manifest;
};

const EMPTY_TABLE: TableManifest = { rowCount: 0, rows: {} };
