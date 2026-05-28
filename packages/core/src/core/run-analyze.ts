/**
 * Shared Analysis Orchestrator
 *
 * Extracts the core analysis pipeline from the CLI analyze command into a
 * reusable function that can be called from both the CLI and a server-side
 * worker process.
 *
 * IMPORTANT: This module must NEVER call process.exit(). The caller (CLI
 * wrapper or server worker) is responsible for process lifecycle.
 */

import path from 'path';
import fs from 'fs/promises';
import { execFileSync } from 'node:child_process';
import * as fsSync from 'node:fs';
import * as v8 from 'node:v8';
import { getLanguageFromFilename } from '@codragraph/shared';
import { runPipelineFromRepo } from './ingestion/pipeline.js';
import {
  initCgdb,
  loadGraphToCgdb,
  getCgdbStats,
  executeQuery,
  executeWithReusedStatement,
  closeCgdb,
  loadCachedEmbeddings,
} from './cgdb/cgdb-adapter.js';
import {
  getStoragePaths,
  saveMeta,
  loadMeta,
  addToGitignore,
  registerRepo,
  cleanupOldKuzuFiles,
  INDEX_SCHEMA_VERSION,
  type RepoMeta,
} from '../storage/repo-manager.js';
import { getCurrentCommit, getRemoteUrl, hasGitDir, getInferredRepoName } from '../storage/git.js';
import { shouldIgnorePath } from '../config/ignore-service.js';
import { recordAnalysisSnapshot } from './graphstore/index.js';
import type { CachedEmbedding } from './embeddings/types.js';
import type { ContentEncoding } from '@codragraph/graphstore';
import { generateAIContextFiles } from '../cli/ai-context.js';
import { EMBEDDING_TABLE_NAME } from './cgdb/schema.js';
import { STALE_HASH_SENTINEL } from './cgdb/schema.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AnalyzeCallbacks {
  onProgress: (phase: string, percent: number, message: string) => void;
  onLog?: (message: string) => void;
}

export interface AnalyzeOptions {
  /**
   * Force a full re-index of the pipeline. Callers may OR this with
   * other flags that imply re-analysis (e.g. `--skills`), so the value
   * here is the PIPELINE-force signal, NOT the registry-collision
   * bypass. See `allowDuplicateName` below.
   */
  force?: boolean;
  embeddings?: boolean;
  skipGit?: boolean;
  /** Skip AGENTS.md and CLAUDE.md codragraph block updates. */
  skipAgentsMd?: boolean;
  /** Omit volatile symbol/relationship counts from AGENTS.md and CLAUDE.md. */
  noStats?: boolean;
  /**
   * User-provided alias for the registry `name` (#829). When set,
   * forwarded to `registerRepo` so the indexed repo is stored under
   * this alias instead of the path-derived basename.
   */
  registryName?: string;
  /**
   * Bypass the `RegistryNameCollisionError` guard and allow two paths
   * to register under the same `name` (#829). Controlled by the
   * dedicated `--allow-duplicate-name` CLI flag, intentionally
   * independent from `--force` — users who hit the collision guard
   * should be able to accept the duplicate without paying the cost
   * of a pipeline re-index.
   */
  allowDuplicateName?: boolean;
  /**
   * RFC 0001 Phase 2 — opt into per-row content compression. `'none'`
   * (or undefined) writes plain text and the schema-default tag, exactly
   * as pre-Phase-2 indexes do. `'brotli'` and `'zstd'` route every
   * content field through `encodeContent` before it hits the CSV; the
   * read path decodes via the per-row `contentEncoding` tag.
   *
   * Choosing `'zstd'` requires Node ≥ 22.15 on the indexer (the runtime
   * that wrote the rows). Readers on older Node will get a clear
   * forward-compat error rather than silently bad content.
   */
  compress?: ContentEncoding;
}

export interface AnalyzeResult {
  repoName: string;
  repoPath: string;
  stats: {
    files?: number;
    nodes?: number;
    edges?: number;
    communities?: number;
    featureClusters?: number;
    processes?: number;
    embeddings?: number;
  };
  alreadyUpToDate?: boolean;
  /** User-facing explanation for a reused index fast path. */
  reuseReason?: string;
  /** True when the git commit advanced but indexed inputs did not. */
  reusedExistingIndex?: boolean;
  /** The raw pipeline result — only populated when needed by callers (e.g. skill generation). */
  pipelineResult?: any;
}

/** Threshold: auto-skip embeddings for repos with more nodes than this */
const EMBEDDING_NODE_LIMIT = 50_000;

const GENERATED_AGENT_CONTEXT_PATHS = new Set(['agents.md', 'claude.md']);
const GENERATED_AGENT_CONTEXT_PREFIXES = [
  '.claude/skills/generated/',
  '.cursor/rules/codragraph-generated/',
];
const IGNORE_CONTROL_FILES = new Set(['.gitignore', '.codragraphignore']);
const GRAPH_CONFIG_BASENAMES = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'go.mod',
  'cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'composer.json',
  'gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'pubspec.yaml',
  'pubspec.yml',
  'mix.exs',
  'rebar.config',
  'cmakelists.txt',
  'makefile',
  'dockerfile',
]);
const GRAPH_CONFIG_PATTERNS = [/^tsconfig\..+\.json$/i, /^jsconfig\..+\.json$/i];
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);

export interface AnalyzeChangedPath {
  /** Git name-status token, e.g. M, A, D, R100. */
  status: string;
  /** Current path for additions/modifications, or deleted path for deletions. */
  path: string;
  /** Previous path for renames/copies. */
  previousPath?: string;
}

export const PHASE_LABELS: Record<string, string> = {
  extracting: 'Scanning files',
  structure: 'Building structure',
  parsing: 'Parsing code',
  imports: 'Resolving imports',
  calls: 'Tracing calls',
  heritage: 'Extracting inheritance',
  communities: 'Detecting communities',
  processes: 'Detecting processes',
  feature_clusters: 'Building feature clusters',
  complete: 'Pipeline complete',
  cgdb: 'Loading into LadybugDB',
  fts: 'Creating search indexes',
  embeddings: 'Generating embeddings',
  done: 'Done',
};

const normalizeGitPath = (filePath: string): string => filePath.replace(/\\/g, '/');

export const parseGitNameStatus = (raw: string): AnalyzeChangedPath[] => {
  const tokens = raw.split('\0').filter(Boolean);
  const changes: AnalyzeChangedPath[] = [];

  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++] ?? '';
    const code = status[0]?.toUpperCase();

    if (code === 'R' || code === 'C') {
      const previousPath = tokens[i++];
      const nextPath = tokens[i++];
      if (previousPath && nextPath) {
        changes.push({
          status,
          path: normalizeGitPath(nextPath),
          previousPath: normalizeGitPath(previousPath),
        });
      }
      continue;
    }

    const changedPath = tokens[i++];
    if (status && changedPath) {
      changes.push({ status, path: normalizeGitPath(changedPath) });
    }
  }

  return changes;
};

export const listChangedPathsBetweenCommits = (
  repoPath: string,
  fromRef: string,
  toRef: string,
): AnalyzeChangedPath[] | null => {
  if (!fromRef || !toRef || fromRef === toRef) return [];

  try {
    const stdout = execFileSync('git', ['diff', '--name-status', '-z', `${fromRef}..${toRef}`], {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseGitNameStatus(stdout);
  } catch {
    return null;
  }
};

export const isGeneratedAgentContextPath = (filePath: string): boolean => {
  const normalized = normalizeGitPath(filePath).toLowerCase();
  const basename = path.posix.basename(normalized);
  return (
    GENERATED_AGENT_CONTEXT_PATHS.has(basename) ||
    GENERATED_AGENT_CONTEXT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
};

export const isGraphContentPath = (filePath: string): boolean => {
  const normalized = normalizeGitPath(filePath);
  const basename = path.posix.basename(normalized);
  const lowerBasename = basename.toLowerCase();

  if (isGeneratedAgentContextPath(normalized)) return false;
  if (IGNORE_CONTROL_FILES.has(lowerBasename)) return true;
  if (shouldIgnorePath(normalized)) return false;
  if (getLanguageFromFilename(normalized) !== null) return true;

  const ext = path.posix.extname(lowerBasename);
  if (MARKDOWN_EXTENSIONS.has(ext)) return true;
  if (GRAPH_CONFIG_BASENAMES.has(lowerBasename)) return true;
  return GRAPH_CONFIG_PATTERNS.some((pattern) => pattern.test(basename));
};

export const changedPathAffectsGraph = (change: AnalyzeChangedPath): boolean => {
  const statusCode = change.status[0]?.toUpperCase();
  const paths = [change.path, change.previousPath].filter((p): p is string => Boolean(p));

  if (paths.some(isGraphContentPath)) return true;

  // Add/delete/rename/copy can change File/Folder structure even when content
  // is not parsed. Ignored or generated-agent paths are outside the index.
  if (statusCode === 'A' || statusCode === 'D' || statusCode === 'R' || statusCode === 'C') {
    return paths.some((p) => !isGeneratedAgentContextPath(p) && !shouldIgnorePath(p));
  }

  // Modified non-code/non-doc files keep the same path and are not read by the
  // graph pipeline, so the existing graph can be reused.
  if (statusCode === 'M' || statusCode === 'T') return false;

  // Unknown git status: rebuild rather than risk stale graph state.
  return true;
};

export const getGraphRelevantChangedPaths = (
  changes: readonly AnalyzeChangedPath[],
): AnalyzeChangedPath[] => changes.filter(changedPathAffectsGraph);

export const getAnalyzeConfigRebuildReason = (
  existingMeta: Pick<RepoMeta, 'compress' | 'stats'>,
  options: Pick<AnalyzeOptions, 'compress' | 'embeddings'>,
): string | null => {
  const existingCompress = existingMeta.compress ?? 'none';
  if (options.compress && options.compress !== existingCompress) {
    return `requested compression changed from ${existingCompress} to ${options.compress}`;
  }

  if (options.embeddings && (existingMeta.stats?.embeddings ?? 0) === 0) {
    return 'embeddings were requested but the existing index has no vectors';
  }

  return null;
};

const formatChangeForLog = (change: AnalyzeChangedPath): string =>
  change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path;

const buildReusedMeta = (
  existingMeta: RepoMeta,
  repoPath: string,
  currentCommit: string,
): RepoMeta => ({
  ...existingMeta,
  repoPath,
  lastCommit: currentCommit,
  indexedAt: new Date().toISOString(),
  schemaVersion: INDEX_SCHEMA_VERSION,
  remoteUrl: hasGitDir(repoPath) ? getRemoteUrl(repoPath) : existingMeta.remoteUrl,
});

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full CodraGraph analysis pipeline.
 *
 * This is the shared core extracted from the CLI `analyze` command. It
 * handles: pipeline execution, LadybugDB loading, FTS indexing, embedding
 * generation, metadata persistence, and AI context file generation.
 *
 * The function communicates progress and log messages exclusively through
 * the {@link AnalyzeCallbacks} interface — it never writes to stdout/stderr
 * directly and never calls `process.exit()`.
 */
export async function runFullAnalysis(
  repoPath: string,
  options: AnalyzeOptions,
  callbacks: AnalyzeCallbacks,
): Promise<AnalyzeResult> {
  const log = (msg: string) => callbacks.onLog?.(msg);

  // RFC 0002 Phase 1 — optional heap-profile instrumentation. Set
  // CODRAGRAPH_HEAP_PROFILE=1 (or run `codragraph profile-heap`) to write a
  // v8 heap snapshot at every phase boundary, plus a `profile-summary.jsonl`
  // log of `process.memoryUsage()` at the same boundaries. Snapshots land in
  // `<repo>/.codragraph/heap-profiles/`. Open snapshots in Chrome DevTools
  // (Memory → Load) to find which constructors dominate retained set; the
  // JSONL is the cheap RSS / heapUsed timeline. Off by default — snapshot
  // writes pause the event loop ~2-5s and consume ~100-500MB of disk each.
  const heapProfileEnabled = process.env.CODRAGRAPH_HEAP_PROFILE === '1';
  let heapProfileDir = '';
  let heapProfileSummaryPath = '';
  let lastProfilePhase = '';
  if (heapProfileEnabled) {
    heapProfileDir = path.join(repoPath, '.codragraph', 'heap-profiles');
    heapProfileSummaryPath = path.join(heapProfileDir, 'profile-summary.jsonl');
    try {
      fsSync.mkdirSync(heapProfileDir, { recursive: true });
      // Truncate any prior summary so a single run produces a clean log.
      // We append crash-safely on each phase boundary below.
      fsSync.writeFileSync(heapProfileSummaryPath, '');
    } catch {
      /* permission issue — best-effort */
    }
  }

  const progress = (phase: string, percent: number, message: string) => {
    callbacks.onProgress(phase, percent, message);

    // Only snapshot on phase transitions, not every tick. Phase strings come
    // from runPipelineFromRepo / loadGraphToCgdb and are stable.
    if (heapProfileEnabled && phase && phase !== lastProfilePhase) {
      lastProfilePhase = phase;
      const ts = Date.now();
      const safe = phase.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);
      const file = path.join(heapProfileDir, `${ts}-${safe}.heapsnapshot`);
      // Capture the cheap memoryUsage timeline FIRST — even if writeHeapSnapshot
      // crashes (out of disk, permissions), we still have the RSS curve which
      // is the more useful artifact for the heap-pressure RFC.
      try {
        const mu = process.memoryUsage();
        const entry = JSON.stringify({
          ts,
          phase,
          percent,
          rss: mu.rss,
          heapUsed: mu.heapUsed,
          heapTotal: mu.heapTotal,
          external: mu.external,
          arrayBuffers: mu.arrayBuffers,
          snapshotFile: path.basename(file),
        });
        fsSync.appendFileSync(heapProfileSummaryPath, entry + '\n');
      } catch (err) {
        log(`heap-profile: summary append failed (${(err as Error).message})`);
      }
      try {
        v8.writeHeapSnapshot(file);
        log(`heap-profile: wrote ${file}`);
      } catch (err) {
        log(`heap-profile: write failed (${(err as Error).message})`);
      }
    }
  };

  const { storagePath, cgdbPath } = getStoragePaths(repoPath);

  // Clean up stale KuzuDB files from before the LadybugDB migration.
  const kuzuResult = await cleanupOldKuzuFiles(storagePath);
  if (kuzuResult.found && kuzuResult.needsReindex) {
    log('Migrating from KuzuDB to LadybugDB — rebuilding index...');
  }

  const repoHasGit = hasGitDir(repoPath);
  const currentCommit = repoHasGit ? getCurrentCommit(repoPath) : '';
  const existingMeta = await loadMeta(storagePath);

  // ── Early-return: already up to date ──────────────────────────────
  // Schema-version mismatch forces a full re-analyze regardless of commit
  // equality: existing 1.7.x indexes have no `schemaVersion` field at all,
  // and current readers expect contentEncoding plus rich FeatureCluster
  // context-pack columns. LadybugDB ALTER on existing tables is not validated
  // end-to-end yet, so the supported migration path is re-analyze via a fresh
  // CREATE NODE TABLE.
  const schemaUpToDate =
    !!existingMeta && (existingMeta.schemaVersion ?? 0) >= INDEX_SCHEMA_VERSION;
  const existingCgdbPresent = existingMeta ? await pathExists(cgdbPath) : false;
  const storageRebuildReason =
    existingMeta && schemaUpToDate && !existingCgdbPresent
      ? 'graph database files are missing'
      : null;
  const configRebuildReason =
    storageRebuildReason ??
    (existingMeta && schemaUpToDate && !options.force
      ? getAnalyzeConfigRebuildReason(existingMeta, options)
      : null);
  if (
    existingMeta &&
    schemaUpToDate &&
    !options.force &&
    !configRebuildReason &&
    existingMeta.lastCommit === currentCommit
  ) {
    // Non-git folders have currentCommit = '' — always rebuild since we can't detect changes
    if (currentCommit !== '') {
      return {
        repoName: options.registryName ?? getInferredRepoName(repoPath) ?? path.basename(repoPath),
        repoPath,
        stats: existingMeta.stats ?? {},
        alreadyUpToDate: true,
      };
    }
  }
  if (existingMeta && schemaUpToDate && !options.force && configRebuildReason) {
    log(`Re-analyzing: ${configRebuildReason}.`);
  }
  if (
    existingMeta &&
    schemaUpToDate &&
    !options.force &&
    !configRebuildReason &&
    currentCommit !== '' &&
    existingMeta.lastCommit !== currentCommit
  ) {
    const changedPaths = listChangedPathsBetweenCommits(
      repoPath,
      existingMeta.lastCommit,
      currentCommit,
    );

    if (changedPaths) {
      const graphRelevantChanges = getGraphRelevantChangedPaths(changedPaths);
      if (graphRelevantChanges.length === 0) {
        const reusedMeta = buildReusedMeta(existingMeta, repoPath, currentCommit);
        await saveMeta(storagePath, reusedMeta);
        const projectName = await registerRepo(repoPath, reusedMeta, {
          name: options.registryName,
          allowDuplicateName: options.allowDuplicateName,
        });
        if (hasGitDir(repoPath)) {
          await addToGitignore(repoPath);
        }

        const reuseReason =
          `Smart analyze reused the existing graph; ${changedPaths.length} changed ` +
          `file(s) did not affect indexed code, docs, config, or file structure.`;
        log(reuseReason);
        progress('done', 100, 'Existing graph reused');
        return {
          repoName: projectName,
          repoPath,
          stats: reusedMeta.stats ?? {},
          alreadyUpToDate: true,
          reusedExistingIndex: true,
          reuseReason,
        };
      }

      const preview = graphRelevantChanges.slice(0, 5).map(formatChangeForLog).join(', ');
      const suffix = graphRelevantChanges.length > 5 ? ', ...' : '';
      log(
        `Smart analyze: ${graphRelevantChanges.length} indexed change(s) require rebuild` +
          (preview ? ` (${preview}${suffix})` : '') +
          '.',
      );
    } else {
      log('Smart analyze: could not inspect git diff; rebuilding.');
    }
  }
  if (existingMeta && !schemaUpToDate) {
    log(
      `Index schema version ${existingMeta.schemaVersion ?? '<missing>'} is older than ` +
        `${INDEX_SCHEMA_VERSION} (FeatureCluster context-pack schema). ` +
        `Re-analyzing.`,
    );
  }

  // ── Cache embeddings from existing index before rebuild ────────────
  let cachedEmbeddingNodeIds = new Set<string>();
  let cachedEmbeddings: CachedEmbedding[] = [];

  if (options.embeddings && existingMeta && !options.force) {
    try {
      progress('embeddings', 0, 'Caching embeddings...');
      await initCgdb(cgdbPath);
      const cached = await loadCachedEmbeddings();
      cachedEmbeddingNodeIds = cached.embeddingNodeIds;
      cachedEmbeddings = cached.embeddings;
      await closeCgdb();
    } catch {
      try {
        await closeCgdb();
      } catch {
        /* swallow */
      }
    }
  }

  // ── Phase 1: Full Pipeline (0–60%) ────────────────────────────────
  const repoNameForFeatureClusters =
    options.registryName ?? getInferredRepoName(repoPath) ?? path.basename(repoPath);
  const pipelineResult = await runPipelineFromRepo(
    repoPath,
    (p) => {
      const phaseLabel = PHASE_LABELS[p.phase] || p.phase;
      const scaled = Math.round(p.percent * 0.6);
      progress(p.phase, scaled, phaseLabel);
    },
    {
      featureClusterRepo: repoNameForFeatureClusters,
      lastIndexedCommit: currentCommit || undefined,
    },
  );

  // ── Phase 2: LadybugDB (60–85%) ──────────────────────────────────
  progress('cgdb', 60, 'Loading into LadybugDB...');

  await closeCgdb();
  const cgdbFiles = [cgdbPath, `${cgdbPath}.wal`, `${cgdbPath}.lock`];
  for (const f of cgdbFiles) {
    try {
      await fs.rm(f, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }

  await initCgdb(cgdbPath);
  try {
    // All work after initCgdb is wrapped in try/finally to ensure closeCgdb()
    // is called even if an error occurs — the module-level singleton DB handle
    // must be released to avoid blocking subsequent invocations.

    let cgdbMsgCount = 0;
    await loadGraphToCgdb(
      pipelineResult.graph,
      pipelineResult.repoPath,
      storagePath,
      (msg) => {
        cgdbMsgCount++;
        const pct = Math.min(84, 60 + Math.round((cgdbMsgCount / (cgdbMsgCount + 10)) * 24));
        progress('cgdb', pct, msg);
      },
      // RFC 0001 Phase 2: when --compress is set, every content row goes
      // through encodeContent before hitting the CSV. Default 'none' is
      // a true passthrough, so the on-disk layout is byte-identical to
      // pre-Phase-2 indexes when no compression flag is passed.
      { compress: options.compress },
    );

    // ── Phase 2.5: Versioned-graph snapshot (best-effort) ────────────
    // Phase 4 hook: snapshot the freshly-loaded graph into the
    // content-addressed `.codragraph/graphstore/`. Failures here do NOT
    // break analyze — the user keeps a working LadybugDB index either
    // way, they just don't get a versioning record for this run.
    let graphstoreCurrentBranch: string | undefined;
    let graphstoreHeadCommit: string | undefined;
    try {
      const snapshotResult = await recordAnalysisSnapshot({
        storagePath,
        indexedRepoCommit: currentCommit || undefined,
        onSkipTable: (tableName, err) => {
          log(
            `graphstore: skipped table "${tableName}": ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      });
      if (snapshotResult) {
        graphstoreCurrentBranch = snapshotResult.branch;
        graphstoreHeadCommit = snapshotResult.commitId;
        log(
          `graphstore: snapshot ${snapshotResult.snapshotId.slice(0, 19)}…  ` +
            `commit ${snapshotResult.commitId.slice(0, 19)}…  ` +
            `branch ${snapshotResult.branch}`,
        );
      }
    } catch (err) {
      log(
        `graphstore: snapshot failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── Phase 3: FTS (85–90%) ─────────────────────────────────────────
    // FTS indexes are created lazily on first `query`/`context` call instead
    // of eagerly here. On small repos / CI runners the LadybugDB
    // CREATE_FTS_INDEX cost is ~440 ms × 5 (≈2 s) regardless of table size,
    // which dominated `analyze` runtime and pushed Windows CI past its
    // 30 s test budget. Lazy creation is implemented in
    // `core/search/bm25-index.ts` via `ensureFTSIndex`.

    // ── Phase 3.5: Re-insert cached embeddings ────────────────────────
    if (cachedEmbeddings.length > 0) {
      const cachedDims = cachedEmbeddings[0].embedding.length;
      const { EMBEDDING_DIMS } = await import('./cgdb/schema.js');
      if (cachedDims !== EMBEDDING_DIMS) {
        // Dimensions changed (e.g. switched embedding model) — discard cache and re-embed all
        log(
          `Embedding dimensions changed (${cachedDims}d -> ${EMBEDDING_DIMS}d), discarding cache`,
        );
        cachedEmbeddings = [];
        cachedEmbeddingNodeIds = new Set();
      } else {
        progress('embeddings', 88, `Restoring ${cachedEmbeddings.length} cached embeddings...`);
        const { batchInsertEmbeddings: batchInsert } =
          await import('./embeddings/embedding-pipeline.js');
        const EMBED_BATCH = 200;
        for (let i = 0; i < cachedEmbeddings.length; i += EMBED_BATCH) {
          const batch = cachedEmbeddings.slice(i, i + EMBED_BATCH);

          try {
            await batchInsert(executeWithReusedStatement, batch);
          } catch {
            /* some may fail if node was removed, that's fine */
          }
        }
      }
    }

    // ── Phase 4: Embeddings (90–98%) ──────────────────────────────────
    const stats = await getCgdbStats();
    let embeddingSkipped = true;

    if (options.embeddings) {
      if (stats.nodes <= EMBEDDING_NODE_LIMIT) {
        embeddingSkipped = false;
      }
    }

    if (!embeddingSkipped) {
      const { isHttpMode } = await import('./embeddings/http-client.js');
      const httpMode = isHttpMode();
      progress(
        'embeddings',
        90,
        httpMode ? 'Connecting to embedding endpoint...' : 'Loading embedding model...',
      );
      const { runEmbeddingPipeline } = await import('./embeddings/embedding-pipeline.js');
      // Build a Map<nodeId, contentHash> from cached embeddings for incremental mode
      let existingEmbeddings: Map<string, string> | undefined;
      if (cachedEmbeddingNodeIds.size > 0) {
        existingEmbeddings = new Map<string, string>();
        for (const e of cachedEmbeddings) {
          existingEmbeddings.set(e.nodeId, e.contentHash ?? STALE_HASH_SENTINEL);
        }
      }

      const { readServerMapping } = await import('./embeddings/server-mapping.js');
      const projectName = path.basename(repoPath);
      const serverName = await readServerMapping(projectName);
      await runEmbeddingPipeline(
        executeQuery,
        executeWithReusedStatement,
        (p) => {
          const scaled = 90 + Math.round((p.percent / 100) * 8);
          const label =
            p.phase === 'loading-model'
              ? httpMode
                ? 'Connecting to embedding endpoint...'
                : 'Loading embedding model...'
              : `Embedding ${p.nodesProcessed || 0}/${p.totalNodes || '?'}`;
          progress('embeddings', scaled, label);
        },
        {},
        cachedEmbeddingNodeIds.size > 0 ? cachedEmbeddingNodeIds : undefined,
        { repoName: projectName, serverName },
        existingEmbeddings,
      );
    }

    // ── Phase 5: Finalize (98–100%) ───────────────────────────────────
    progress('done', 98, 'Saving metadata...');

    // Count embeddings in the index (cached + newly generated)
    let embeddingCount = 0;
    try {
      const embResult = await executeQuery(
        `MATCH (e:${EMBEDDING_TABLE_NAME}) RETURN count(e) AS cnt`,
      );
      embeddingCount = embResult?.[0]?.cnt ?? 0;
    } catch {
      /* table may not exist if embeddings never ran */
    }

    const meta = {
      repoPath,
      lastCommit: currentCommit,
      indexedAt: new Date().toISOString(),
      schemaVersion: INDEX_SCHEMA_VERSION,
      compress: options.compress ?? 'none',
      // Captured here (not at registration) so it travels with the
      // on-disk meta.json — sibling-clone fingerprinting works for
      // out-of-tree consumers (group-status, future tooling) without
      // a second git shellout. `undefined` when the repo has no
      // origin remote, which is fine: paths-only repos behave as
      // before.
      remoteUrl: hasGitDir(repoPath) ? getRemoteUrl(repoPath) : undefined,
      // Phase 4: written when the best-effort graphstore snapshot
      // succeeded; absent otherwise so older meta consumers that don't
      // know about these fields keep working.
      currentBranch: graphstoreCurrentBranch,
      headCommit: graphstoreHeadCommit,
      stats: {
        files: pipelineResult.totalFileCount,
        nodes: stats.nodes,
        edges: stats.edges,
        communities: pipelineResult.communityResult?.stats.totalCommunities,
        featureClusters: pipelineResult.featureClusterResult?.stats.totalClusters,
        processes: pipelineResult.processResult?.stats.totalProcesses,
        embeddings: embeddingCount,
      },
    };
    await saveMeta(storagePath, meta);
    // Forward the --name alias and the registry-collision bypass bit.
    // `allowDuplicateName` is its own concern — independent from the
    // pipeline `force` above. The CLI maps it from
    // `--allow-duplicate-name` only; `--force` and `--skills` both
    // trigger pipeline re-run but never bypass the registry guard.
    // The returned name is the one actually written to the registry
    // (after applying the precedence chain in registerRepo) — reuse it
    // so AGENTS.md / skill files reference the same name MCP clients
    // will look up (#979).
    const projectName = await registerRepo(repoPath, meta, {
      name: options.registryName,
      allowDuplicateName: options.allowDuplicateName,
    });

    // Only attempt to update .gitignore when a .git directory is present.
    if (hasGitDir(repoPath)) {
      await addToGitignore(repoPath);
    }

    // ── Generate AI context files (best-effort) ───────────────────────
    let aggregatedClusterCount = 0;
    if (pipelineResult.communityResult?.communities) {
      const groups = new Map<string, number>();
      for (const c of pipelineResult.communityResult.communities) {
        const label = c.heuristicLabel || c.label || 'Unknown';
        groups.set(label, (groups.get(label) || 0) + c.symbolCount);
      }
      aggregatedClusterCount = Array.from(groups.values()).filter((count) => count >= 5).length;
    }

    try {
      await generateAIContextFiles(
        repoPath,
        storagePath,
        projectName,
        {
          files: pipelineResult.totalFileCount,
          nodes: stats.nodes,
          edges: stats.edges,
          communities: pipelineResult.communityResult?.stats.totalCommunities,
          clusters:
            pipelineResult.featureClusterResult?.stats.totalClusters ?? aggregatedClusterCount,
          processes: pipelineResult.processResult?.stats.totalProcesses,
        },
        undefined,
        { skipAgentsMd: options.skipAgentsMd, noStats: options.noStats },
      );
    } catch {
      // Best-effort — don't fail the entire analysis for context file issues
    }

    // ── Close LadybugDB ──────────────────────────────────────────────
    await closeCgdb();

    progress('done', 100, 'Done');

    return {
      repoName: projectName,
      repoPath,
      stats: meta.stats,
      pipelineResult,
    };
  } catch (err) {
    // Ensure LadybugDB is closed even on error
    try {
      await closeCgdb();
    } catch {
      /* swallow */
    }
    throw err;
  }
}
