/**
 * Adapter exposing a live LadybugDB instance as a `codragraph-graphstore`
 * `RowSource`. Used by the analyze pipeline (Phase 4) to snapshot the
 * loaded graph into the content-addressed store.
 *
 * Best-effort by design: any table that errors at query time is skipped
 * (with the failure surfaced through the optional `onSkip` callback) so
 * the surrounding analyze flow never breaks because the versioning hook
 * misbehaves.
 */

import type { GraphRow, RowSource } from "codragraph-graphstore";
import { NODE_TABLES, REL_TABLE_NAME, type NodeTableName } from "codragraph-shared";
import { executeQuery } from "../lbug/lbug-adapter.js";

export interface LbugRowSourceOptions {
  /** Filter the node tables enumerated by `listNodeTables` — defaults to every NODE_TABLE. */
  readonly nodeTables?: readonly NodeTableName[];
  /** Called with `(table, error)` when a table query fails — defaults to a no-op. */
  readonly onSkip?: (tableName: string, error: unknown) => void;
}

export const createLbugRowSource = (
  opts: LbugRowSourceOptions = {},
): RowSource => {
  const onSkip = opts.onSkip ?? (() => {});
  const tables: readonly NodeTableName[] = opts.nodeTables ?? NODE_TABLES;

  const listNodeTables = async (): Promise<string[]> => {
    return [...tables];
  };

  const streamNodeTable = async function* (
    tableName: string,
  ): AsyncIterable<GraphRow> {
    let rows: unknown[];
    try {
      // `MATCH (n:T) RETURN n` returns one row per node. The node value
      // is reachable as either `row.n` (named-column form) or `row[0]`
      // (positional form) depending on the LadybugDB result-shape mode;
      // we accept both, mirroring the resilient pattern used by
      // `core/search/bm25-index.ts` for FTS results. Tables that do not
      // exist on disk for a given repo throw here — we treat that as
      // "no rows" via the onSkip callback rather than a hard failure.
      rows = await executeQuery(`MATCH (n:${tableName}) RETURN n`);
    } catch (err) {
      onSkip(tableName, err);
      return;
    }
    let yielded = 0;
    for (const raw of rows) {
      const node = unwrapNode(raw);
      if (!node) continue;
      yield normalizeNodeRow(node);
      yielded++;
    }
    // If the query reported rows but none unwrapped, surface that as a
    // skip so the analyze log makes the silent-empty failure mode
    // visible instead of producing a 0-row snapshot for the table.
    if (rows.length > 0 && yielded === 0) {
      onSkip(
        tableName,
        new Error(
          `lbug-row-source: query returned ${rows.length} row(s) for "${tableName}" but none had an unwrappable node — ` +
            `result shape changed? expected row.n or row[0] to be the node`,
        ),
      );
    }
  };

  const streamEdges = async function* (): AsyncIterable<GraphRow> {
    let rows: unknown[];
    try {
      // Project `from`/`to`/`type` as scalar columns and the full rel as
      // `rel`. Scalars give us a deterministic edge id even if the rel
      // payload's shape changes; `rel` carries any extra properties for
      // hashing.
      rows = await executeQuery(
        `MATCH (a)-[r:${REL_TABLE_NAME}]->(b) RETURN a.id AS \`from\`, b.id AS \`to\`, r.type AS type, r AS rel`,
      );
    } catch (err) {
      onSkip(REL_TABLE_NAME, err);
      return;
    }
    let yielded = 0;
    for (const raw of rows) {
      const r = raw as Record<string, unknown> | null | undefined;
      const from = pickField(r, "from", 0);
      const to = pickField(r, "to", 1);
      const type = pickField(r, "type", 2);
      const rel = pickField(r, "rel", 3);
      if (typeof from !== "string" || typeof to !== "string") continue;
      yield normalizeEdgeRow({ from, to, type, rel: isPlainObject(rel) ? rel : null });
      yielded++;
    }
    if (rows.length > 0 && yielded === 0) {
      onSkip(
        REL_TABLE_NAME,
        new Error(
          `lbug-row-source: edges query returned ${rows.length} row(s) but none had a string from/to — ` +
            `result shape changed?`,
        ),
      );
    }
  };

  return { listNodeTables, streamNodeTable, streamEdges };
};

/**
 * Pull the node out of an executeQuery result row, accepting either the
 * named-column form (`row.n`) or the positional form (`row[0]`). Returns
 * null when the row is missing or the node value isn't an object — the
 * caller treats that as "skip and surface".
 */
const unwrapNode = (raw: unknown): Record<string, unknown> | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidate = r["n"] ?? r[0];
  return isPlainObject(candidate) ? candidate : null;
};

/** Read a field from an executeQuery row, falling back to the positional index. */
const pickField = (
  row: Record<string, unknown> | null | undefined,
  named: string,
  positional: number,
): unknown => {
  if (!row) return undefined;
  return row[named] ?? row[positional];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Sanitize a node row for canonical hashing:
 *   - Drop LadybugDB-specific internal fields (`_id`, `_label`) that are
 *     not content-bearing — including them would make the hash sensitive
 *     to internal storage offsets and break dedup across snapshots.
 *   - Sort keys deterministically (canonical JSON in the serializer
 *     already does this, but doing it once here keeps the row payload
 *     stable when we ever swap engines).
 */
const normalizeNodeRow = (node: Record<string, unknown>): GraphRow => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "_id" || key === "_label") continue;
    out[key] = node[key];
  }
  return out;
};

const normalizeEdgeRow = (r: {
  from?: unknown;
  to?: unknown;
  type?: unknown;
  rel?: Record<string, unknown> | null;
}): GraphRow => {
  const props: Record<string, unknown> = {};
  if (r.rel && typeof r.rel === "object") {
    for (const key of Object.keys(r.rel).sort()) {
      // Skip the synthetic from/to/type that show up under `rel` too —
      // we already project them as top-level columns and don't want
      // duplication in the canonical row.
      if (key === "from" || key === "to" || key === "type") continue;
      if (key.startsWith("_")) continue;
      props[key] = r.rel[key];
    }
  }
  return {
    from: String(r.from),
    to: String(r.to),
    type: typeof r.type === "string" ? r.type : String(r.type ?? ""),
    ...props,
  };
};
