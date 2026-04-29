/**
 * Abstract row I/O — keeps the graphstore package independent of
 * `@ladybugdb/core`. The actual lbug bindings are wired in `codragraph/`
 * via thin adapters that implement these interfaces, so swapping storage
 * engines later (Dolt itself? a remote graph service?) is a one-package
 * change rather than a cross-cutting refactor.
 */

/**
 * A graph row — the canonical shape exchanged with the underlying graph
 * database. Always carries an `id` field (logical primary key) plus
 * arbitrary scalar columns. For edges, an additional `from` / `to` /
 * `type` triple is expected — synthetic `id` is computed by the
 * serializer when the source omits one.
 */
export type GraphRow = Readonly<{
  id?: string;
  [column: string]: unknown;
}>;

/**
 * Abstract source of node and edge rows for a snapshot.
 *
 * Implementations stream rows asynchronously so we never hold the entire
 * graph in memory; each table is iterated independently to allow
 * back-pressured serialization to CAS.
 */
export interface RowSource {
  /** The set of node-table names this source can stream. */
  listNodeTables(): Promise<string[]>;

  /** Stream every row of the named node table. */
  streamNodeTable(tableName: string): AsyncIterable<GraphRow>;

  /** Stream every relationship row from the single edges table. */
  streamEdges(): AsyncIterable<GraphRow>;
}

/**
 * Abstract sink for materialization — receives row batches, stores them
 * however the underlying engine prefers (CSV import, INSERT statements,
 * etc.) and finalizes once the full snapshot has been replayed.
 *
 * Calls happen in this order:
 *   beginTable → writeRows* → endTable        (per node table)
 *   beginEdges → writeEdgeRows* → endEdges    (once)
 *   finalize                                   (once)
 */
export interface RowSink {
  beginTable(tableName: string): Promise<void>;
  writeRows(tableName: string, rows: readonly GraphRow[]): Promise<void>;
  endTable(tableName: string): Promise<void>;

  beginEdges(): Promise<void>;
  writeEdgeRows(rows: readonly GraphRow[]): Promise<void>;
  endEdges(): Promise<void>;

  finalize(): Promise<void>;
}

/**
 * Compute a synthetic id for an edge row. We intentionally do NOT include
 * any non-shape properties in the id — doing so would make the same
 * logical edge with different incidental fields (e.g. parser confidence)
 * look like a brand new edge to the differ. Properties still factor into
 * the row's content hash, so a property change shows up as "modified",
 * not "added/removed".
 */
export const synthesizeEdgeId = (row: GraphRow): string => {
  const from = String(row["from"] ?? "");
  const to = String(row["to"] ?? "");
  const type = String(row["type"] ?? "");
  return `${from}|${type}|${to}`;
};
