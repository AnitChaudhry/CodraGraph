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
  ensureFTSIndex,
  applyFileGraphPatchToCgdb,
  replaceFileScopedGraphInCgdb,
  replaceGlobalGraphLayersInCgdb,
  loadKnowledgeGraphFromCgdb,
  fetchExistingEmbeddingHashes,
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
import { FTS_TABLES, ftsPropertiesFor } from './search/bm25-index.js';
import {
  processCommunities,
  type CommunityDetectionResult,
} from './ingestion/community-processor.js';
import { processProcesses, type ProcessDetectionResult } from './ingestion/process-processor.js';
import {
  processFeatureClusters,
  type FeatureClusterDetectionResult,
} from './ingestion/feature-cluster-processor.js';
import { createKnowledgeGraph } from './graph/graph.js';
import { generateId } from '../lib/utils.js';
import {
  decideEmbeddingRun,
  formatAdaptiveAnalyzePlan,
  resolveAdaptiveAnalyzePlan,
  type AdaptiveAnalyzePlan,
  type AnalyzeProfileOption,
  type CompressionOption,
  type EmbeddingDecision,
  type EmbeddingMode,
} from './adaptive-profile.js';

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
  profile?: AnalyzeProfileOption;
  embeddingMode?: EmbeddingMode;
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
  compress?: CompressionOption;
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
const GLOBAL_LAYER_NODE_LABELS = new Set(['Community', 'Process', 'FeatureCluster']);
const GLOBAL_LAYER_REL_TYPES = new Set([
  'MEMBER_OF',
  'STEP_IN_PROCESS',
  'ENTRY_POINT_OF',
  'FEATURE_MEMBER_OF',
  'FEATURE_DEPENDS_ON',
]);

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

  // Add/delete/rename/copy affect the graph's File/Folder topology even when
  // the path is not source code. Ignore only generated agent context and
  // configured ignored paths; staying conservative here prevents stale file
  // and documentation surfaces after path-only commits.
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

export interface IncrementalFilePatchPlan {
  eligible: boolean;
  reason: string;
  replacePaths: string[];
  currentPaths: string[];
  fileCountDelta: number;
  /**
   * True when a change can affect resolver/global structure broadly
   * (config/ignore/package). The incremental path still avoids deleting the
   * whole DB, but it replaces every file-scoped node from a fresh full scan.
   */
  replaceAllFileScoped: boolean;
  /** Old path -> new path aliases used to reconnect external edges across renames. */
  pathAliases: Record<string, string>;
}

interface GlobalLayerRecomputeResult {
  communityResult: CommunityDetectionResult;
  processResult: ProcessDetectionResult;
  featureClusterResult: FeatureClusterDetectionResult;
  deletedGlobalNodes: number;
  insertedGlobalRels: number;
}

export const isPatchableIncrementalPath = (filePath: string): boolean => {
  const normalized = normalizeGitPath(filePath);
  if (isGeneratedAgentContextPath(normalized) || shouldIgnorePath(normalized)) return false;
  if (getLanguageFromFilename(normalized) !== null) return true;
  return MARKDOWN_EXTENSIONS.has(path.posix.extname(normalized.toLowerCase()));
};

const isTopologyPatchablePath = (filePath: string): boolean => {
  const normalized = normalizeGitPath(filePath);
  return !isGeneratedAgentContextPath(normalized) && !shouldIgnorePath(normalized);
};

const isGlobalGraphInputPath = (filePath: string): boolean => {
  const normalized = normalizeGitPath(filePath);
  const basename = path.posix.basename(normalized);
  const lowerBasename = basename.toLowerCase();
  return (
    IGNORE_CONTROL_FILES.has(lowerBasename) ||
    GRAPH_CONFIG_BASENAMES.has(lowerBasename) ||
    GRAPH_CONFIG_PATTERNS.some((pattern) => pattern.test(basename))
  );
};

export const buildIncrementalFilePatchPlan = (
  changes: readonly AnalyzeChangedPath[],
  _options: { limit?: number } = {},
): IncrementalFilePatchPlan => {
  if (changes.length === 0) {
    return {
      eligible: false,
      reason: 'no indexed graph input changes',
      replacePaths: [],
      currentPaths: [],
      fileCountDelta: 0,
      replaceAllFileScoped: false,
      pathAliases: {},
    };
  }

  const replacePaths = new Set<string>();
  const currentPaths = new Set<string>();
  const pathAliases: Record<string, string> = {};
  let fileCountDelta = 0;
  let replaceAllFileScoped = false;
  const reasons = new Set<string>();

  for (const change of changes) {
    const statusCode = change.status[0]?.toUpperCase();
    const paths =
      statusCode === 'C'
        ? [change.path]
        : [change.path, change.previousPath].filter((p): p is string => Boolean(p));

    if (paths.some(isGlobalGraphInputPath)) {
      replaceAllFileScoped = true;
      reasons.add('global config/input changed');
      continue;
    }

    const contentPatchable = paths.every(isPatchableIncrementalPath);
    const topologyPatchable = paths.every(isTopologyPatchablePath);
    if (!contentPatchable && !topologyPatchable) {
      return {
        eligible: false,
        reason: `change ${change.status} ${formatChangeForLog(change)} touches a global or unsupported graph input`,
        replacePaths: [],
        currentPaths: [],
        fileCountDelta: 0,
        replaceAllFileScoped: false,
        pathAliases: {},
      };
    }

    if (statusCode === 'D') {
      replacePaths.add(change.path);
      fileCountDelta -= 1;
      continue;
    }
    if (statusCode === 'R') {
      if (change.previousPath) {
        replacePaths.add(change.previousPath);
        pathAliases[change.previousPath] = change.path;
      }
      replacePaths.add(change.path);
      currentPaths.add(change.path);
      reasons.add('rename remapped');
      continue;
    }
    if (statusCode === 'M' || statusCode === 'A' || statusCode === 'T' || statusCode === 'C') {
      replacePaths.add(change.path);
      currentPaths.add(change.path);
      if (statusCode === 'A' || statusCode === 'C') {
        fileCountDelta += 1;
      }
      if (!contentPatchable) {
        reasons.add('topology-only file change');
      }
      continue;
    }
    replaceAllFileScoped = true;
    reasons.add(`unsupported git status ${change.status}`);
  }

  const strategy = replaceAllFileScoped
    ? 'all file-scoped graph rows will be refreshed'
    : `${replacePaths.size} file path(s) will be patched`;
  if (changes.length > 20) reasons.add(`${changes.length} graph input changes`);
  return {
    eligible: true,
    reason: [...reasons, strategy].filter(Boolean).join('; '),
    replacePaths: [...replacePaths].sort(),
    currentPaths: [...currentPaths].sort(),
    fileCountDelta,
    replaceAllFileScoped,
    pathAliases,
  };
};

export const getAnalyzeConfigRebuildReason = (
  existingMeta: Pick<RepoMeta, 'compress' | 'searchIndexes' | 'stats'>,
  options: { compress?: ContentEncoding; embeddings?: boolean },
): string | null => {
  const existingCompress = existingMeta.compress ?? 'none';
  if (options.compress && options.compress !== existingCompress) {
    return `requested compression changed from ${existingCompress} to ${options.compress}`;
  }

  if (existingMeta.searchIndexes?.fts !== true) {
    return 'search indexes are missing';
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

const metaStatsForAIContext = (stats: RepoMeta['stats'] = {}) => ({
  files: stats.files,
  nodes: stats.nodes,
  edges: stats.edges,
  communities: stats.communities,
  clusters: stats.featureClusters,
  processes: stats.processes,
});

const buildAdaptiveProfileMeta = (
  adaptivePlan: AdaptiveAnalyzePlan,
  embeddingDecision: EmbeddingDecision,
): NonNullable<RepoMeta['adaptiveProfile']> => ({
  requested: adaptivePlan.requestedProfile,
  resolved: adaptivePlan.profile,
  platform: adaptivePlan.machine.platform,
  arch: adaptivePlan.machine.arch,
  cpuCount: adaptivePlan.machine.availableParallelism,
  totalMemoryBytes: adaptivePlan.machine.totalMemoryBytes,
  heapLimitBytes: adaptivePlan.machine.heapLimitBytes,
  compression: adaptivePlan.compress,
  embeddingMode: adaptivePlan.embeddingMode,
  embeddingNodeLimit: adaptivePlan.embeddingNodeLimit,
  embeddingDecision: embeddingDecision.enabled ? 'enabled' : 'skipped',
  embeddingReason: embeddingDecision.reason,
  workerPoolSize: adaptivePlan.workerPoolSize,
  workerSubBatchSize: adaptivePlan.workerSubBatchSize,
});

const countEmbeddings = async (): Promise<number> => {
  try {
    const embResult = await executeQuery(
      `MATCH (e:${EMBEDDING_TABLE_NAME}) RETURN count(e) AS cnt`,
    );
    return Number(embResult?.[0]?.cnt ?? embResult?.[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const addCommunityLayerToGraph = (
  graph: ReturnType<typeof createKnowledgeGraph>,
  communityResult: CommunityDetectionResult,
) => {
  communityResult.communities.forEach((comm) => {
    graph.addNode({
      id: comm.id,
      label: 'Community',
      properties: {
        name: comm.label,
        filePath: '',
        heuristicLabel: comm.heuristicLabel,
        cohesion: comm.cohesion,
        symbolCount: comm.symbolCount,
      },
    });
  });

  communityResult.memberships.forEach((membership) => {
    graph.addRelationship({
      id: `${membership.nodeId}_member_of_${membership.communityId}`,
      type: 'MEMBER_OF',
      sourceId: membership.nodeId,
      targetId: membership.communityId,
      confidence: 1.0,
      reason: 'leiden-algorithm',
    });
  });
};

const addProcessLayerToGraph = (
  graph: ReturnType<typeof createKnowledgeGraph>,
  processResult: ProcessDetectionResult,
) => {
  processResult.processes.forEach((proc) => {
    graph.addNode({
      id: proc.id,
      label: 'Process',
      properties: {
        name: proc.label,
        filePath: '',
        heuristicLabel: proc.heuristicLabel,
        processType: proc.processType,
        stepCount: proc.stepCount,
        communities: proc.communities,
        entryPointId: proc.entryPointId,
        terminalId: proc.terminalId,
      },
    });
  });

  processResult.steps.forEach((step) => {
    graph.addRelationship({
      id: `${step.nodeId}_step_${step.step}_${step.processId}`,
      type: 'STEP_IN_PROCESS',
      sourceId: step.nodeId,
      targetId: step.processId,
      confidence: 1.0,
      reason: 'trace-detection',
      step: step.step,
    });
  });
};

const addRouteToolProcessLinks = (
  graph: ReturnType<typeof createKnowledgeGraph>,
  processResult: ProcessDetectionResult,
) => {
  const routesByFile = new Map<string, string[]>();
  const toolsByFile = new Map<string, string[]>();
  for (const node of graph.iterNodes()) {
    const filePath =
      typeof node.properties?.filePath === 'string' ? node.properties.filePath : undefined;
    const name = typeof node.properties?.name === 'string' ? node.properties.name : undefined;
    if (!filePath || !name) continue;
    if (node.label === 'Route') {
      let routes = routesByFile.get(filePath);
      if (!routes) {
        routes = [];
        routesByFile.set(filePath, routes);
      }
      routes.push(name);
    } else if (node.label === 'Tool') {
      let tools = toolsByFile.get(filePath);
      if (!tools) {
        tools = [];
        toolsByFile.set(filePath, tools);
      }
      tools.push(name);
    }
  }

  if (routesByFile.size === 0 && toolsByFile.size === 0) return;
  for (const proc of processResult.processes) {
    if (!proc.entryPointId) continue;
    const entryNode = graph.getNode(proc.entryPointId);
    const entryFile =
      typeof entryNode?.properties?.filePath === 'string' ? entryNode.properties.filePath : '';
    if (!entryFile) continue;

    for (const routeURL of routesByFile.get(entryFile) ?? []) {
      const routeNodeId = generateId('Route', routeURL);
      graph.addRelationship({
        id: generateId('ENTRY_POINT_OF', `${routeNodeId}->${proc.id}`),
        sourceId: routeNodeId,
        targetId: proc.id,
        type: 'ENTRY_POINT_OF',
        confidence: 0.85,
        reason: 'route-handler-entry-point',
      });
    }
    for (const toolName of toolsByFile.get(entryFile) ?? []) {
      const toolNodeId = generateId('Tool', toolName);
      graph.addRelationship({
        id: generateId('ENTRY_POINT_OF', `${toolNodeId}->${proc.id}`),
        sourceId: toolNodeId,
        targetId: proc.id,
        type: 'ENTRY_POINT_OF',
        confidence: 0.85,
        reason: 'tool-handler-entry-point',
      });
    }
  }
};

const addFeatureClusterLayerToGraph = (
  graph: ReturnType<typeof createKnowledgeGraph>,
  featureClusterResult: FeatureClusterDetectionResult,
) => {
  featureClusterResult.clusters.forEach((cluster) => {
    graph.addNode({
      id: cluster.id,
      label: 'FeatureCluster',
      properties: {
        name: cluster.name,
        filePath: '',
        slug: cluster.slug,
        featureKind: cluster.featureKind,
        summary: cluster.summary,
        description: cluster.description,
        repo: cluster.repo,
        service: cluster.service,
        signals: cluster.signals,
        memberCount: cluster.memberCount,
        entryPointIds: cluster.entryPointIds,
        routes: cluster.routes,
        tools: cluster.tools,
        testCoverageHints: cluster.testCoverageHints,
        lastIndexedCommit: cluster.lastIndexedCommit,
        confidence: cluster.confidence,
        source: 'heuristic',
      },
    });
  });

  featureClusterResult.memberships.forEach((membership) => {
    graph.addRelationship({
      id: generateId('FEATURE_MEMBER_OF', `${membership.nodeId}->${membership.clusterId}`),
      sourceId: membership.nodeId,
      targetId: membership.clusterId,
      type: 'FEATURE_MEMBER_OF',
      confidence: membership.confidence,
      reason: membership.signals.join('|'),
    });
  });

  featureClusterResult.dependencies.forEach((dependency) => {
    graph.addRelationship({
      id: generateId(
        'FEATURE_DEPENDS_ON',
        `${dependency.sourceClusterId}->${dependency.targetClusterId}`,
      ),
      sourceId: dependency.sourceClusterId,
      targetId: dependency.targetClusterId,
      type: 'FEATURE_DEPENDS_ON',
      confidence: dependency.confidence,
      reason: `member-dependency|edges:${dependency.edgeCount}|types:${dependency.relationshipTypes.join(',')}`,
    });
  });
};

const extractGlobalLayerGraph = (graph: ReturnType<typeof createKnowledgeGraph>) => {
  const globalGraph = createKnowledgeGraph();
  const globalNodeIds = new Set<string>();
  for (const node of graph.iterNodes()) {
    if (GLOBAL_LAYER_NODE_LABELS.has(node.label)) {
      globalNodeIds.add(node.id);
      globalGraph.addNode(node);
    }
  }
  for (const rel of graph.iterRelationships()) {
    if (
      GLOBAL_LAYER_REL_TYPES.has(rel.type) ||
      globalNodeIds.has(rel.sourceId) ||
      globalNodeIds.has(rel.targetId)
    ) {
      globalGraph.addRelationship(rel);
    }
  }
  return globalGraph;
};

const scaleAnalyzerProgress = (start: number, span: number, progress: number): number => {
  const normalized = Math.max(0, Math.min(100, progress)) / 100;
  return Math.round(start + normalized * span);
};

const recomputeGlobalGraphLayers = async (input: {
  repoPath: string;
  storagePath: string;
  currentCommit: string;
  repoNameForFeatureClusters: string;
  compress: ContentEncoding;
  progress: AnalyzeCallbacks['onProgress'];
}): Promise<GlobalLayerRecomputeResult> => {
  const { repoPath, storagePath, currentCommit, repoNameForFeatureClusters, compress, progress } =
    input;

  progress('communities', 82, 'Loading patched graph for global recompute...');
  const graph = await loadKnowledgeGraphFromCgdb({ includeGlobal: false });

  const communityResult = await processCommunities(graph, (message, phaseProgress) => {
    progress('communities', scaleAnalyzerProgress(83, 2, phaseProgress), message);
  });
  addCommunityLayerToGraph(graph, communityResult);

  let symbolCount = 0;
  graph.forEachNode((n) => {
    if (n.label !== 'File') symbolCount++;
  });
  const dynamicMaxProcesses = Math.max(20, Math.min(300, Math.round(symbolCount / 10)));
  const processResult = await processProcesses(
    graph,
    communityResult.memberships,
    (message, phaseProgress) => {
      progress('processes', scaleAnalyzerProgress(85, 2, phaseProgress), message);
    },
    { maxProcesses: dynamicMaxProcesses, minSteps: 3 },
  );
  addProcessLayerToGraph(graph, processResult);
  addRouteToolProcessLinks(graph, processResult);

  const featureClusterResult = await processFeatureClusters(
    graph,
    (message, phaseProgress) => {
      progress('feature_clusters', scaleAnalyzerProgress(87, 1, phaseProgress), message);
    },
    {
      repo: repoNameForFeatureClusters,
      lastIndexedCommit: currentCommit || undefined,
    },
  );
  addFeatureClusterLayerToGraph(graph, featureClusterResult);

  progress('cgdb', 88, 'Replacing global graph layers...');
  const globalGraph = extractGlobalLayerGraph(graph);
  const replaceResult = await replaceGlobalGraphLayersInCgdb(
    globalGraph,
    repoPath,
    storagePath,
    undefined,
    { compress },
  );

  return {
    communityResult,
    processResult,
    featureClusterResult,
    deletedGlobalNodes: replaceResult.deletedGlobalNodes,
    insertedGlobalRels: replaceResult.insertedRels,
  };
};

const runIncrementalFilePatchAnalysis = async (input: {
  repoPath: string;
  storagePath: string;
  cgdbPath: string;
  currentCommit: string;
  existingMeta: RepoMeta;
  adaptivePlan: AdaptiveAnalyzePlan;
  patchPlan: IncrementalFilePatchPlan;
  options: AnalyzeOptions;
  progress: AnalyzeCallbacks['onProgress'];
  log: (message: string) => void;
}): Promise<AnalyzeResult> => {
  const {
    repoPath,
    storagePath,
    cgdbPath,
    currentCommit,
    existingMeta,
    adaptivePlan,
    patchPlan,
    options,
    progress,
    log,
  } = input;
  const repoNameForFeatureClusters =
    options.registryName ?? getInferredRepoName(repoPath) ?? path.basename(repoPath);

  progress(
    'extracting',
    5,
    patchPlan.replaceAllFileScoped
      ? 'Incremental full graph scan for global input change'
      : `Incremental scan: ${patchPlan.currentPaths.length} current file(s)`,
  );
  const pipelineResult = await runPipelineFromRepo(
    repoPath,
    (p) => {
      const phaseLabel = PHASE_LABELS[p.phase] || p.phase;
      const scaled = Math.min(59, 5 + Math.round((p.percent / 100) * 54));
      progress(p.phase, scaled, phaseLabel);
    },
    {
      skipGraphPhases: true,
      featureClusterRepo: repoNameForFeatureClusters,
      lastIndexedCommit: currentCommit || undefined,
      workerPoolSize: adaptivePlan.workerPoolSize,
      workerSubBatchSize: adaptivePlan.workerSubBatchSize,
      focusPaths: patchPlan.replaceAllFileScoped ? undefined : patchPlan.currentPaths,
    },
  );

  progress(
    'cgdb',
    60,
    patchPlan.replaceAllFileScoped
      ? 'Replacing file-scoped graph rows...'
      : `Patching ${patchPlan.replacePaths.length} file path(s)...`,
  );
  await initCgdb(cgdbPath);
  try {
    let cgdbMsgCount = 0;
    const fileGraphProgress = (msg: string) => {
      cgdbMsgCount++;
      const pct = Math.min(82, 60 + Math.round((cgdbMsgCount / (cgdbMsgCount + 8)) * 22));
      progress('cgdb', pct, msg);
    };
    if (patchPlan.replaceAllFileScoped) {
      const replacementResult = await replaceFileScopedGraphInCgdb(
        pipelineResult.graph,
        repoPath,
        storagePath,
        fileGraphProgress,
        { compress: adaptivePlan.compress },
      );
      log(
        `Smart analyze: refreshed all file-scoped graph rows, deleted ${replacementResult.deletedNodes} node(s), ` +
          `inserted ${replacementResult.insertedRels} edge(s).`,
      );
    } else {
      const patchResult = await applyFileGraphPatchToCgdb(
        pipelineResult.graph,
        repoPath,
        storagePath,
        patchPlan.replacePaths,
        fileGraphProgress,
        { compress: adaptivePlan.compress, pathAliases: patchPlan.pathAliases },
      );
      log(
        `Smart analyze: incrementally patched ${patchResult.replacedFiles} path(s), ` +
          `deleted ${patchResult.deletedNodeIds} stale node(s), inserted ${patchResult.insertedRels} edge(s), ` +
          `restored ${patchResult.restoredRels} preserved edge(s), pruned ${patchResult.prunedFolders} folder(s).`,
      );
    }

    const globalResult = await recomputeGlobalGraphLayers({
      repoPath,
      storagePath,
      currentCommit,
      repoNameForFeatureClusters,
      compress: adaptivePlan.compress,
      progress,
    });
    log(
      `Smart analyze: recomputed global layers (${globalResult.communityResult.stats.totalCommunities} communities, ` +
        `${globalResult.processResult.stats.totalProcesses} processes, ` +
        `${globalResult.featureClusterResult.stats.totalClusters} feature clusters).`,
    );

    progress('fts', 89, 'Refreshing search indexes...');
    const ftsProperties = [...ftsPropertiesFor(adaptivePlan.compress)];
    for (const { table, indexName } of FTS_TABLES) {
      await ensureFTSIndex(table, indexName, ftsProperties);
    }

    const stats = await getCgdbStats();
    const embeddingDecision = decideEmbeddingRun(adaptivePlan, {
      nodes: stats.nodes,
      embeddings: existingMeta.stats?.embeddings ?? 0,
    });
    log(
      embeddingDecision.enabled
        ? `Embeddings enabled: ${embeddingDecision.reason}.`
        : `Embeddings skipped: ${embeddingDecision.reason}.`,
    );

    if (embeddingDecision.enabled) {
      const { isHttpMode } = await import('./embeddings/http-client.js');
      const httpMode = isHttpMode();
      progress(
        'embeddings',
        90,
        httpMode ? 'Connecting to embedding endpoint...' : 'Loading embedding model...',
      );
      const { runEmbeddingPipeline } = await import('./embeddings/embedding-pipeline.js');
      const existingEmbeddings = await fetchExistingEmbeddingHashes(executeQuery);
      const { readServerMapping } = await import('./embeddings/server-mapping.js');
      const projectName = path.basename(repoPath);
      const serverName = await readServerMapping(projectName);
      await runEmbeddingPipeline(
        executeQuery,
        executeWithReusedStatement,
        (p) => {
          const scaled = 90 + Math.round((p.percent / 100) * 7);
          const label =
            p.phase === 'loading-model'
              ? httpMode
                ? 'Connecting to embedding endpoint...'
                : 'Loading embedding model...'
              : `Embedding ${p.nodesProcessed || 0}/${p.totalNodes || '?'}`;
          progress('embeddings', scaled, label);
        },
        {},
        undefined,
        { repoName: projectName, serverName },
        existingEmbeddings,
      );
    }

    progress('done', 97, 'Recording graph snapshot...');
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
          `graphstore: snapshot ${snapshotResult.snapshotId.slice(0, 19)}...  ` +
            `commit ${snapshotResult.commitId.slice(0, 19)}...  ` +
            `branch ${snapshotResult.branch}`,
        );
      }
    } catch (err) {
      log(
        `graphstore: snapshot failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    progress('done', 98, 'Saving metadata...');
    const embeddingCount = await countEmbeddings();
    const previousFileCount = existingMeta.stats?.files ?? 0;
    const fileCount = Math.max(0, previousFileCount + patchPlan.fileCountDelta);
    const meta: RepoMeta = {
      repoPath,
      lastCommit: currentCommit,
      indexedAt: new Date().toISOString(),
      schemaVersion: INDEX_SCHEMA_VERSION,
      compress: adaptivePlan.compress,
      searchIndexes: { fts: true },
      adaptiveProfile: buildAdaptiveProfileMeta(adaptivePlan, embeddingDecision),
      remoteUrl: hasGitDir(repoPath) ? getRemoteUrl(repoPath) : undefined,
      currentBranch: graphstoreCurrentBranch,
      headCommit: graphstoreHeadCommit,
      stats: {
        files: patchPlan.replaceAllFileScoped ? pipelineResult.totalFileCount : fileCount,
        nodes: stats.nodes,
        edges: stats.edges,
        communities: globalResult.communityResult.stats.totalCommunities,
        featureClusters: globalResult.featureClusterResult.stats.totalClusters,
        processes: globalResult.processResult.stats.totalProcesses,
        embeddings: embeddingCount,
      },
    };
    await saveMeta(storagePath, meta);

    const projectName = await registerRepo(repoPath, meta, {
      name: options.registryName,
      allowDuplicateName: options.allowDuplicateName,
    });

    if (hasGitDir(repoPath)) {
      await addToGitignore(repoPath);
    }

    try {
      await generateAIContextFiles(
        repoPath,
        storagePath,
        projectName,
        metaStatsForAIContext(meta.stats),
        undefined,
        { skipAgentsMd: options.skipAgentsMd, noStats: options.noStats },
      );
    } catch {
      // Best-effort only.
    }

    await closeCgdb();
    progress('done', 100, 'Done');

    return {
      repoName: projectName,
      repoPath,
      stats: meta.stats ?? {},
      pipelineResult,
    };
  } catch (err) {
    try {
      await closeCgdb();
    } catch {
      /* swallow */
    }
    throw err;
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
  const adaptivePlan = resolveAdaptiveAnalyzePlan({
    profile: options.profile,
    embeddingMode: options.embeddingMode,
    embeddings: options.embeddings,
    compress: options.compress,
    existingMeta,
  });
  const existingEmbeddingDecision = decideEmbeddingRun(adaptivePlan, existingMeta?.stats);
  log(formatAdaptiveAnalyzePlan(adaptivePlan));

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
      ? getAnalyzeConfigRebuildReason(existingMeta, {
          compress: adaptivePlan.compress,
          embeddings: existingEmbeddingDecision.enabled,
        })
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
      const repoName =
        options.registryName ?? getInferredRepoName(repoPath) ?? path.basename(repoPath);
      try {
        await generateAIContextFiles(
          repoPath,
          storagePath,
          repoName,
          metaStatsForAIContext(existingMeta.stats),
          undefined,
          { skipAgentsMd: options.skipAgentsMd, noStats: options.noStats },
        );
      } catch {
        // Best-effort only.
      }
      return {
        repoName,
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
        try {
          await generateAIContextFiles(
            repoPath,
            storagePath,
            projectName,
            metaStatsForAIContext(reusedMeta.stats),
            undefined,
            { skipAgentsMd: options.skipAgentsMd, noStats: options.noStats },
          );
        } catch {
          // Best-effort only.
        }

        const reuseReason =
          `Smart analyze reused the existing graph; ${changedPaths.length} changed ` +
          `file(s) did not affect indexed graph inputs.`;
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
        `Smart analyze: ${graphRelevantChanges.length} indexed graph input change(s) require rebuild` +
          (preview ? ` (${preview}${suffix})` : '') +
          '.',
      );

      const patchPlan = buildIncrementalFilePatchPlan(graphRelevantChanges);
      if (patchPlan.eligible) {
        log(`Smart analyze: ${patchPlan.reason}.`);
        try {
          return await runIncrementalFilePatchAnalysis({
            repoPath,
            storagePath,
            cgdbPath,
            currentCommit,
            existingMeta,
            adaptivePlan,
            patchPlan,
            options,
            progress,
            log,
          });
        } catch (err) {
          log(
            `Smart analyze: incremental patch failed (${err instanceof Error ? err.message : String(err)}); rebuilding.`,
          );
          try {
            await closeCgdb();
          } catch {
            /* swallow */
          }
        }
      } else {
        log(`Smart analyze: incremental patch unavailable: ${patchPlan.reason}; rebuilding.`);
      }
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

  if (existingEmbeddingDecision.enabled && existingMeta && !options.force) {
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
      workerPoolSize: adaptivePlan.workerPoolSize,
      workerSubBatchSize: adaptivePlan.workerSubBatchSize,
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
      { compress: adaptivePlan.compress },
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
    // Build persisted keyword indexes while the analyzer still owns a writable
    // LadybugDB handle. MCP/local query paths intentionally open read-only so
    // they can coexist with editors and servers; if FTS is not warmed here,
    // the first agent `query` degrades to a bounded table scan.
    progress('fts', 85, 'Creating search indexes...');
    const ftsProperties = [...ftsPropertiesFor(adaptivePlan.compress)];
    for (const { table, indexName } of FTS_TABLES) {
      await ensureFTSIndex(table, indexName, ftsProperties);
    }

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
    const embeddingDecision = decideEmbeddingRun(adaptivePlan, {
      nodes: stats.nodes,
      embeddings: existingMeta?.stats?.embeddings ?? cachedEmbeddings.length,
    });
    const embeddingSkipped = !embeddingDecision.enabled;
    log(
      embeddingDecision.enabled
        ? `Embeddings enabled: ${embeddingDecision.reason}.`
        : `Embeddings skipped: ${embeddingDecision.reason}.`,
    );

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
    let embeddingCount = await countEmbeddings();
    const meta: RepoMeta = {
      repoPath,
      lastCommit: currentCommit,
      indexedAt: new Date().toISOString(),
      schemaVersion: INDEX_SCHEMA_VERSION,
      compress: adaptivePlan.compress,
      searchIndexes: { fts: true },
      adaptiveProfile: buildAdaptiveProfileMeta(adaptivePlan, embeddingDecision),
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
