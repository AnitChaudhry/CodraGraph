/**
 * Full-Text Search via LadybugDB FTS
 *
 * Uses LadybugDB's built-in full-text search indexes for keyword-based search.
 * Always reads from the database (no cached state to drift).
 *
 * FTS indexes are created lazily on first query (via `ensureFTSIndex`) — see
 * `cgdb-adapter.ts` for the rationale. This keeps `analyze` fast (the
 * ~440 ms × 5 LadybugDB CREATE_FTS_INDEX cost dominates pipeline time on
 * small repos / CI runners) at the cost of paying that overhead on the
 * first `query`/`context` call in a session.
 */

import {
  queryFTS,
  ensureFTSIndex,
  executeQuery as executeCoreQuery,
} from '../cgdb/cgdb-adapter.js';

export interface BM25SearchResult {
  filePath: string;
  score: number;
  rank: number;
  nodeIds?: string[];
}

/**
 * FTS table set served by `searchFTSFromCgdb`. Centralised so that both
 * the CLI/pipeline path and the MCP pool path stay in lockstep.
 *
 * The properties list is computed at FTS-create time via `ftsPropertiesFor`
 * — for repos that were analysed with `--compress brotli|zstd`, the
 * `content` column holds base64-of-encoded-bytes and would tokenise to
 * useless tokens. Those repos get name-only FTS so search at least
 * matches function/class names instead of returning random hits on
 * base64 alphabet. Plain (compress='none' / unset) repos get the full
 * `name + content` index for body-text matches. RFC 0001 Phase 2.5.
 */
const FTS_TABLES: ReadonlyArray<{ table: string; indexName: string }> = [
  { table: 'File', indexName: 'file_fts' },
  { table: 'Function', indexName: 'function_fts' },
  { table: 'Class', indexName: 'class_fts' },
  { table: 'Method', indexName: 'method_fts' },
  { table: 'Interface', indexName: 'interface_fts' },
];

const ftsPropertiesFor = (compress: 'none' | 'brotli' | 'zstd' | undefined): readonly string[] =>
  !compress || compress === 'none' ? ['name', 'content'] : ['name'];

/**
 * Look up `meta.compress` for a repo. The MCP path passes `repoId`
 * (registry-derived); the CLI path passes nothing and we walk up from
 * cwd. Returns `'none'` whenever the lookup fails so the safe default
 * (full FTS index) is used — the failure mode is reduced search
 * quality, never wrong results.
 */
async function getCompressMode(repoId?: string): Promise<'none' | 'brotli' | 'zstd'> {
  try {
    const repoMod = await import('../../storage/repo-manager.js');
    if (repoId) {
      // MCP path: registry name is the source of truth. The MCP
      // backend's `repoId` is `entry.name.toLowerCase()` (or `${name}-${hash}`
      // on collision); match conservatively against both forms.
      const entries = await repoMod.listRegisteredRepos();
      for (const entry of entries) {
        const base = entry.name.toLowerCase();
        if (base === repoId || repoId.startsWith(`${base}-`)) {
          const meta = await repoMod.loadMeta(entry.storagePath);
          return meta?.compress ?? 'none';
        }
      }
      return 'none';
    }
    const repo = await repoMod.findRepo(process.cwd());
    return repo?.meta?.compress ?? 'none';
  } catch {
    return 'none';
  }
}

const FALLBACK_SCAN_LIMIT = 50_000;
const BOOLEAN_QUERY_TOKENS = new Set(['and', 'or', 'not']);
const FALLBACK_FIELD_WEIGHTS: Record<string, number> = {
  name: 4,
  content: 2,
  description: 1,
};

/**
 * Per-process cache for the MCP pool path: tracks which `(repoId, table)`
 * pairs have been ensured. The CLI/pipeline path gets its own cache inside
 * `cgdb-adapter.ts` keyed by table/index, scoped to the singleton connection.
 *
 * IMPORTANT: an entry is added ONLY when the index was confirmed to exist
 * (CREATE_FTS_INDEX succeeded, or failed with `'already exists'`). Other
 * failures (transient lock errors, missing extension, etc.) leave the key
 * unset so the next query retries instead of silently caching the failure.
 *
 * Entries for a given repoId are invalidated when its pool is closed —
 * see the `addPoolCloseListener` registration in `searchFTSFromCgdb`.
 */
const ensuredPoolFTS = new Set<string>();

/**
 * Drop all ensured-FTS cache entries for a given repoId.
 *
 * Called from the pool-close listener so that a pool teardown / recreation
 * forces the next `searchFTSFromCgdb` call to re-issue `CREATE_FTS_INDEX`
 * against the fresh connection rather than trust stale ensure-state from a
 * previous pool lifetime.
 *
 * Exported for tests; the listener wiring is internal.
 */
export function invalidateEnsuredFTSForRepo(repoId: string): void {
  const prefix = `${repoId}:`;
  for (const key of ensuredPoolFTS) {
    if (key.startsWith(prefix)) ensuredPoolFTS.delete(key);
  }
}

/**
 * Tracks whether we've already wired the pool-close listener for this
 * process. The pool adapter is dynamically imported, so registration
 * happens lazily on the first MCP-pool-backed FTS query.
 */
let poolCloseListenerRegistered = false;
function registerPoolCloseListenerOnce(
  addPoolCloseListener: (listener: (repoId: string) => void) => void,
): void {
  if (poolCloseListenerRegistered) return;
  poolCloseListenerRegistered = true;
  addPoolCloseListener((repoId) => invalidateEnsuredFTSForRepo(repoId));
}

async function ensureFTSIndexViaExecutor(
  executor: (cypher: string) => Promise<any[]>,
  repoId: string,
  table: string,
  indexName: string,
  properties: readonly string[],
): Promise<void> {
  const key = `${repoId}:${table}:${indexName}`;
  if (ensuredPoolFTS.has(key)) return;
  const propList = properties.map((p) => `'${p}'`).join(', ');
  try {
    await executor(
      `CALL CREATE_FTS_INDEX('${table}', '${indexName}', [${propList}], stemmer := 'porter')`,
    );
    // Index was created successfully — safe to cache.
    ensuredPoolFTS.add(key);
  } catch (e: any) {
    // 'already exists' is the happy path (index persists on disk between
    // process invocations) — cache it. Anything else is treated as a
    // transient failure: surface a one-time warning and leave the key
    // unset so the NEXT query retries rather than silently using a
    // cached failure (which previously disabled BM25 for the whole
    // process for that repo).
    const msg = String(e?.message ?? '');
    if (msg.includes('already exists')) {
      ensuredPoolFTS.add(key);
    } else {
      console.warn(
        `[codragraph] FTS index ensure failed for repo "${repoId}" table "${table}" ` +
          `(index "${indexName}"): ${msg || e}. Will retry on next query.`,
      );
    }
  }
}

/**
 * Execute a single FTS query via a custom executor (for MCP connection pool).
 * Returns the same shape as core queryFTS (from LadybugDB adapter).
 */
async function queryFTSViaExecutor(
  executor: (cypher: string) => Promise<any[]>,
  tableName: string,
  indexName: string,
  query: string,
  limit: number,
): Promise<Array<{ filePath: string; score: number; nodeId: string }>> {
  // Escape single quotes and backslashes to prevent Cypher injection
  const escapedQuery = query.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const cypher = `
    CALL QUERY_FTS_INDEX('${tableName}', '${indexName}', '${escapedQuery}', conjunctive := false)
    RETURN node, score
    ORDER BY score DESC
    LIMIT ${limit}
  `;
  try {
    const rows = await executor(cypher);
    return rows.map((row: any) => {
      const node = row.node || row[0] || {};
      const score = row.score ?? row[1] ?? 0;
      return {
        filePath: node.filePath || '',
        score: typeof score === 'number' ? score : parseFloat(score) || 0,
        nodeId: node.nodeId || node.id || '',
      };
    });
  } catch {
    return [];
  }
}

function searchTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu)
    ?.filter((term) => term.length > 1 && !BOOLEAN_QUERY_TOKENS.has(term));

  return [...new Set(terms ?? [])];
}

function scoreFallbackNode(
  node: Record<string, unknown>,
  query: string,
  properties: readonly string[],
): number {
  const terms = searchTerms(query);
  if (terms.length === 0) return 0;

  const phrase = query.trim().toLowerCase();
  let score = 0;

  for (const property of properties) {
    const raw = node[property];
    if (raw === null || raw === undefined) continue;

    const value = String(raw).toLowerCase();
    if (!value) continue;

    const weight = FALLBACK_FIELD_WEIGHTS[property] ?? 1;
    if (phrase.length > 1 && value.includes(phrase)) {
      score += weight * (terms.length + 1);
    }

    for (const term of terms) {
      if (value.includes(term)) score += weight;
    }
  }

  return score;
}

async function queryFallbackViaExecutor(
  executor: (cypher: string) => Promise<any[]>,
  tableName: string,
  properties: readonly string[],
  query: string,
  limit: number,
): Promise<Array<{ filePath: string; score: number; nodeId: string }>> {
  try {
    const rows = await executor(`
      MATCH (node:${tableName})
      RETURN node
      LIMIT ${FALLBACK_SCAN_LIMIT}
    `);

    return rows
      .map((row: any) => {
        const node = row.node || row[0] || {};
        return {
          filePath: node.filePath || '',
          score: scoreFallbackNode(node, query, properties),
          nodeId: node.nodeId || node.id || '',
        };
      })
      .filter((result) => result.filePath && result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function fallbackSearchAllTables(
  executor: (cypher: string) => Promise<any[]>,
  query: string,
  limit: number,
  // Same compress-aware property selection as the FTS path. Default keeps
  // pre-Phase-2 behaviour (`['name', 'content']`) for callers that don't
  // pass a value.
  properties: readonly string[] = ['name', 'content'],
): Promise<
  [
    Array<{ filePath: string; score: number; nodeId: string }>,
    Array<{ filePath: string; score: number; nodeId: string }>,
    Array<{ filePath: string; score: number; nodeId: string }>,
    Array<{ filePath: string; score: number; nodeId: string }>,
    Array<{ filePath: string; score: number; nodeId: string }>,
  ]
> {
  const results = [];
  for (const { table } of FTS_TABLES) {
    results.push(await queryFallbackViaExecutor(executor, table, properties, query, limit));
  }
  return results as [
    Array<{ filePath: string; score: number; nodeId: string }>,
    Array<{ filePath: string; score: number; nodeId: string }>,
    Array<{ filePath: string; score: number; nodeId: string }>,
    Array<{ filePath: string; score: number; nodeId: string }>,
    Array<{ filePath: string; score: number; nodeId: string }>,
  ];
}

/**
 * Search using LadybugDB's built-in FTS (always fresh, reads from disk)
 *
 * Queries multiple node tables (File, Function, Class, Method) in parallel
 * and merges results by filePath, summing scores for the same file.
 *
 * @param query - Search query string
 * @param limit - Maximum results
 * @param repoId - If provided, queries will be routed via the MCP connection pool
 * @returns Ranked search results from FTS indexes
 */
export const searchFTSFromCgdb = async (
  query: string,
  limit: number = 20,
  repoId?: string,
): Promise<BM25SearchResult[]> => {
  if (!query.trim() || limit <= 0) return [];

  let fileResults: any[],
    functionResults: any[],
    classResults: any[],
    methodResults: any[],
    interfaceResults: any[];

  if (repoId) {
    // Use MCP connection pool via dynamic import
    // IMPORTANT: FTS queries run sequentially to avoid connection contention.
    // The MCP pool supports multiple connections, but FTS is best run serially.
    const poolMod = await import('../cgdb/pool-adapter.js');
    const { executeQuery, addPoolCloseListener } = poolMod;
    // Register the pool-close listener lazily on first use so a teardown of
    // the pool entry (LRU eviction, idle timeout, explicit close) drops the
    // matching `ensuredPoolFTS` entries. Without this, stale ensure-state
    // can outlive the pool that produced it.
    registerPoolCloseListenerOnce(addPoolCloseListener);
    const executor = (cypher: string) => executeQuery(repoId, cypher);

    // Lazy-create FTS indexes on first query for this repo (analyze no longer
    // creates them up-front, so we ensure them here). Cached per-process.
    // RFC 0001 Phase 2.5: drop `content` from FTS properties for repos
    // analysed with --compress brotli|zstd — the column holds encoded
    // bytes and would tokenise to garbage.
    const compress = await getCompressMode(repoId);
    const properties = ftsPropertiesFor(compress);
    for (const { table, indexName } of FTS_TABLES) {
      await ensureFTSIndexViaExecutor(executor, repoId, table, indexName, properties);
    }

    fileResults = await queryFTSViaExecutor(executor, 'File', 'file_fts', query, limit);
    functionResults = await queryFTSViaExecutor(executor, 'Function', 'function_fts', query, limit);
    classResults = await queryFTSViaExecutor(executor, 'Class', 'class_fts', query, limit);
    methodResults = await queryFTSViaExecutor(executor, 'Method', 'method_fts', query, limit);
    interfaceResults = await queryFTSViaExecutor(
      executor,
      'Interface',
      'interface_fts',
      query,
      limit,
    );

    if (
      fileResults.length +
        functionResults.length +
        classResults.length +
        methodResults.length +
        interfaceResults.length ===
      0
    ) {
      [fileResults, functionResults, classResults, methodResults, interfaceResults] =
        await fallbackSearchAllTables(executor, query, limit, properties);
    }
  } else {
    // Use core cgdb adapter (CLI / pipeline context) — also sequential for safety.
    // Lazy-create FTS indexes on first query (analyze no longer does it).
    // RFC 0001 Phase 2.5 — same `compress`-aware property selection as the MCP
    // path; the CLI walks up from cwd to find the repo's meta.json.
    const compress = await getCompressMode();
    const properties = ftsPropertiesFor(compress);
    for (const { table, indexName } of FTS_TABLES) {
      await ensureFTSIndex(table, indexName, [...properties]).catch(() => {});
    }

    fileResults = await queryFTS('File', 'file_fts', query, limit, false).catch(() => []);
    functionResults = await queryFTS('Function', 'function_fts', query, limit, false).catch(
      () => [],
    );
    classResults = await queryFTS('Class', 'class_fts', query, limit, false).catch(() => []);
    methodResults = await queryFTS('Method', 'method_fts', query, limit, false).catch(() => []);
    interfaceResults = await queryFTS('Interface', 'interface_fts', query, limit, false).catch(
      () => [],
    );

    if (
      fileResults.length +
        functionResults.length +
        classResults.length +
        methodResults.length +
        interfaceResults.length ===
      0
    ) {
      [fileResults, functionResults, classResults, methodResults, interfaceResults] =
        await fallbackSearchAllTables(executeCoreQuery, query, limit, properties);
    }
  }

  // Collect all node scores per filePath to track which nodes actually matched
  const fileNodeScores = new Map<string, Array<{ score: number; nodeId: string }>>();

  const addResults = (results: any[]) => {
    for (const r of results) {
      if (!fileNodeScores.has(r.filePath)) fileNodeScores.set(r.filePath, []);
      fileNodeScores.get(r.filePath)!.push({ score: r.score, nodeId: r.nodeId });
    }
  };

  addResults(fileResults);
  addResults(functionResults);
  addResults(classResults);
  addResults(methodResults);
  addResults(interfaceResults);

  // Sum the top-3 highest-scoring nodes per file and collect their nodeIds.
  // Summing all nodes naively inflates scores for files with many mediocre
  // matches (e.g. test files) over files with a single highly-relevant symbol.
  const merged = new Map<string, { filePath: string; score: number; nodeIds: string[] }>();
  for (const [filePath, entries] of fileNodeScores) {
    const top3 = [...entries].sort((a, b) => b.score - a.score).slice(0, 3);
    merged.set(filePath, {
      filePath,
      score: top3.reduce((acc, e) => acc + e.score, 0),
      nodeIds: top3.map((e) => e.nodeId).filter((id) => id),
    });
  }

  // Sort by score descending and add rank
  const sorted = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return sorted.map((r, index) => ({
    filePath: r.filePath,
    score: r.score,
    rank: index + 1,
    nodeIds: r.nodeIds,
  }));
};
