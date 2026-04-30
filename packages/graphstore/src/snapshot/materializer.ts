import { type Snapshot, type SnapshotManifest, type ObjectId, parseObjectId } from '../types.js';
import { type ContentAddressedStore, getJson } from '../cas/interface.js';
import { type GraphRow, type RowSink } from './row-source.js';

export interface MaterializeSnapshotOptions {
  readonly cas: ContentAddressedStore;
  readonly snapshotId: ObjectId;
  readonly sink: RowSink;
  /**
   * Number of rows to buffer per `sink.writeRows` call. Larger batches
   * mean fewer round trips to the underlying engine; smaller batches
   * keep memory usage bounded for very wide rows. Default 1000.
   */
  readonly batchSize?: number;
}

/**
 * Read a snapshot from CAS and replay every row into `sink`.
 *
 * The sink is responsible for whatever bulk-loading dance the underlying
 * engine prefers (LadybugDB likes CSV + COPY, a remote service might
 * want streaming inserts). The graphstore package only emits ordered
 * row batches.
 */
export const materializeSnapshot = async (
  opts: MaterializeSnapshotOptions,
): Promise<MaterializeSnapshotResult> => {
  const { cas, sink } = opts;
  const batchSize = opts.batchSize ?? 1000;

  const snapshot = await getJson<Snapshot>(cas, opts.snapshotId);
  if (snapshot.type !== 'snapshot') {
    throw new Error(
      `materializeSnapshot: object ${opts.snapshotId} is not a snapshot ` +
        `(type=${JSON.stringify((snapshot as { type?: unknown }).type)})`,
    );
  }
  const manifestId = parseObjectId(snapshot.manifestId);
  const manifest = await getJson<SnapshotManifest>(cas, manifestId);
  if (manifest.type !== 'snapshot-manifest') {
    throw new Error(`materializeSnapshot: object ${manifestId} is not a snapshot-manifest`);
  }

  const stats: { nodeRowsByTable: Record<string, number>; edgeRowCount: number } = {
    nodeRowsByTable: {},
    edgeRowCount: 0,
  };

  // ── Node tables ───────────────────────────────────────────────────
  for (const tableName of Object.keys(manifest.nodeTables).sort()) {
    const tableManifest = manifest.nodeTables[tableName];
    if (!tableManifest) continue;

    await sink.beginTable(tableName);
    let buffer: GraphRow[] = [];
    let count = 0;
    for (const id of Object.keys(tableManifest.rows).sort()) {
      const rowId = tableManifest.rows[id];
      if (!rowId) continue;
      const row = await getJson<GraphRow>(cas, parseObjectId(rowId));
      buffer.push(row);
      count++;
      if (buffer.length >= batchSize) {
        await sink.writeRows(tableName, buffer);
        buffer = [];
      }
    }
    if (buffer.length > 0) await sink.writeRows(tableName, buffer);
    await sink.endTable(tableName);
    stats.nodeRowsByTable[tableName] = count;
  }

  // ── Edges ─────────────────────────────────────────────────────────
  await sink.beginEdges();
  {
    let buffer: GraphRow[] = [];
    let count = 0;
    for (const id of Object.keys(manifest.edges.rows).sort()) {
      const rowId = manifest.edges.rows[id];
      if (!rowId) continue;
      const row = await getJson<GraphRow>(cas, parseObjectId(rowId));
      buffer.push(row);
      count++;
      if (buffer.length >= batchSize) {
        await sink.writeEdgeRows(buffer);
        buffer = [];
      }
    }
    if (buffer.length > 0) await sink.writeEdgeRows(buffer);
    stats.edgeRowCount = count;
  }
  await sink.endEdges();

  await sink.finalize();

  return {
    snapshot,
    manifest,
    stats: {
      nodeRowsByTable: stats.nodeRowsByTable,
      edgeRowCount: stats.edgeRowCount,
    },
  };
};

export interface MaterializeSnapshotResult {
  readonly snapshot: Snapshot;
  readonly manifest: SnapshotManifest;
  readonly stats: {
    readonly nodeRowsByTable: Record<string, number>;
    readonly edgeRowCount: number;
  };
}
