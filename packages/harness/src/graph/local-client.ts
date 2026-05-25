// In-process GraphClient — wraps codragraph's LocalBackend directly.
//
// Phase 1 default: harness runs in the same Node process as codragraph, so
// there's no need for an HTTP hop. LocalBackend.callTool(method, params)
// returns rich structured data that we adapt to the GraphClient interface's
// simpler shape.
//
// HttpGraphClient is the out-of-process path for a running `codragraph serve`
// instance. Keep this client for local harnesses that want direct access to
// LocalBackend without an HTTP hop.

import type { LocalBackend } from '@codragraph/cli/mcp/local/local-backend';
import type {
  GraphClient,
  GraphClusterImpactInput,
  GraphClusterImpactResult,
  GraphContextInput,
  GraphContextResult,
  GraphFeatureClustersInput,
  GraphFeatureClustersResult,
  GraphFeatureClusterSummary,
  GraphFeatureContextInput,
  GraphFeatureContextResult,
  GraphImpactInput,
  GraphImpactResult,
  GraphQueryInput,
  GraphQueryResult,
} from '../types.js';

export interface LocalGraphClientOptions {
  /** A LocalBackend instance — wire it from codragraph's exported factory. */
  backend: LocalBackend;
  /** Default repo to pass through if not specified per-call. */
  defaultRepo?: string;
}

interface ProcessSymbolRaw {
  name?: string;
  filePath?: string;
  file_path?: string;
}
interface QueryResultRaw {
  process_symbols?: ProcessSymbolRaw[];
  definitions?: ProcessSymbolRaw[];
  error?: string;
}
interface ContextResultRaw {
  symbol?: { name?: string; filePath?: string; file_path?: string };
  incoming?: Record<string, Array<{ name: string; filePath?: string }>>;
  outgoing?: Record<string, Array<{ name: string; filePath?: string }>>;
  processes?: Array<{ name: string }>;
  error?: string;
}
interface ImpactResultRaw {
  target?: { name?: string };
  byDepth?: Record<
    string,
    Array<{ name: string; filePath?: string; type?: string; relationType?: string }>
  >;
  impactedCount?: number;
  error?: string;
}
interface FeatureClusterRaw {
  id?: string;
  name?: string;
  slug?: string;
  featureKind?: string;
  summary?: string;
  description?: string;
  repo?: string;
  service?: string;
  signals?: string[];
  memberCount?: number;
  entryPointIds?: string[];
  routes?: string[];
  tools?: string[];
  testCoverageHints?: string[];
  lastIndexedCommit?: string;
  confidence?: number;
}
interface FeatureClustersRaw {
  clusters?: FeatureClusterRaw[];
  error?: string;
}
interface FeatureMemberRaw {
  id?: string;
  name?: string;
  type?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  role?: string;
  confidence?: number;
}
interface FeatureContextRaw {
  cluster?: FeatureClusterRaw;
  members?: FeatureMemberRaw[];
  dependencies?: {
    incoming?: FeatureClusterRaw[];
    outgoing?: FeatureClusterRaw[];
  };
  entryPoints?: FeatureMemberRaw[];
  routes?: FeatureMemberRaw[];
  tools?: FeatureMemberRaw[];
  processes?: Array<{
    id?: string;
    label?: string;
    heuristicLabel?: string;
    processType?: string;
    stepCount?: number;
  }>;
  tests?: FeatureMemberRaw[];
  docs?: FeatureMemberRaw[];
  safeEditSurface?: {
    files?: string[];
    symbols?: string[];
    warnings?: string[];
  };
  error?: string;
}
interface FeatureImpactRaw {
  cluster?: FeatureClusterRaw;
  direction?: 'upstream' | 'downstream' | 'both';
  impactedClusters?: FeatureClusterRaw[];
  impactSummary?: {
    affectedMembers?: number;
    dependencyCount?: number;
    incomingDependencies?: number;
    outgoingDependencies?: number;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  };
  safeEditSurface?: FeatureContextRaw['safeEditSurface'];
  contextPack?: FeatureContextRaw;
  error?: string;
}

export class LocalGraphClient implements GraphClient {
  constructor(private readonly options: LocalGraphClientOptions) {}

  async query(input: GraphQueryInput): Promise<GraphQueryResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool('query', {
      query: input.query,
      limit: input.limit,
      repo,
    })) as QueryResultRaw;
    if (raw.error) throw new Error(`codragraph query: ${raw.error}`);

    const symbols = (raw.process_symbols ?? []).concat(raw.definitions ?? []);
    const seen = new Set<string>();
    const results: GraphQueryResult['results'] = [];
    let rank = 0;
    for (const sym of symbols) {
      if (!sym.name) continue;
      if (seen.has(sym.name)) continue;
      seen.add(sym.name);
      results.push({
        name: sym.name,
        score: 1 / ++rank,
        file: sym.filePath ?? sym.file_path,
      });
      if (input.limit && results.length >= input.limit) break;
    }
    return { results };
  }

  async context(input: GraphContextInput): Promise<GraphContextResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool('context', {
      name: input.name,
      repo,
    })) as ContextResultRaw;
    if (raw.error) throw new Error(`codragraph context: ${raw.error}`);

    const callers: Array<{ name: string; file?: string }> = [];
    for (const refs of Object.values(raw.incoming ?? {})) {
      for (const r of refs) callers.push({ name: r.name, file: r.filePath });
    }
    const callees: Array<{ name: string; file?: string }> = [];
    for (const refs of Object.values(raw.outgoing ?? {})) {
      for (const r of refs) callees.push({ name: r.name, file: r.filePath });
    }

    return {
      name: raw.symbol?.name ?? input.name,
      file: raw.symbol?.filePath ?? raw.symbol?.file_path,
      callers,
      callees,
      processes: (raw.processes ?? []).map((p) => p.name),
    };
  }

  async impact(input: GraphImpactInput): Promise<GraphImpactResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool('impact', {
      target: input.target,
      direction: input.direction ?? 'upstream',
      repo,
    })) as ImpactResultRaw;
    if (raw.error) throw new Error(`codragraph impact: ${raw.error}`);

    const affected: GraphImpactResult['affected'] = [];
    for (const [depthStr, items] of Object.entries(raw.byDepth ?? {})) {
      const depth = parseInt(depthStr, 10);
      for (const it of items) {
        affected.push({ name: it.name, depth, file: it.filePath });
      }
    }
    return {
      target: raw.target?.name ?? input.target,
      affected,
      riskLevel: deriveRiskLevel(raw.impactedCount ?? affected.length),
    };
  }

  async featureClusters(
    input: GraphFeatureClustersInput = {},
  ): Promise<GraphFeatureClustersResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool('feature_clusters', {
      repo,
      limit: input.limit,
      query: input.query,
    })) as FeatureClustersRaw;
    if (raw.error) throw new Error(`codragraph feature_clusters: ${raw.error}`);

    return {
      clusters: (raw.clusters ?? []).filter((cluster) => cluster.name).map(mapFeatureCluster),
    };
  }

  clusters(input: GraphFeatureClustersInput = {}): Promise<GraphFeatureClustersResult> {
    return this.featureClusters(input);
  }

  async featureContext(input: GraphFeatureContextInput): Promise<GraphFeatureContextResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool('feature_context', {
      name: input.name,
      repo,
      limit: input.limit,
    })) as FeatureContextRaw;
    if (raw.error) throw new Error(`codragraph feature_context: ${raw.error}`);
    if (!raw.cluster?.name) throw new Error(`codragraph feature_context: missing cluster`);

    return {
      cluster: {
        ...mapFeatureCluster(raw.cluster),
      },
      members: (raw.members ?? []).map((member) => ({
        id: member.id,
        name: member.name,
        type: member.type,
        file: member.filePath,
        startLine: member.startLine,
        endLine: member.endLine,
        role: member.role,
        confidence: member.confidence,
      })),
      dependencies: {
        incoming: mapFeatureDependency(raw.dependencies?.incoming ?? []),
        outgoing: mapFeatureDependency(raw.dependencies?.outgoing ?? []),
      },
      entryPoints: mapFeatureMembers(raw.entryPoints ?? []),
      routes: mapFeatureMembers(raw.routes ?? []),
      tools: mapFeatureMembers(raw.tools ?? []),
      processes: (raw.processes ?? []).map((process) => ({
        id: process.id,
        name: process.heuristicLabel || process.label || process.id || 'process',
        type: process.processType,
        stepCount: process.stepCount,
      })),
      tests: mapFeatureMembers(raw.tests ?? []),
      docs: mapFeatureMembers(raw.docs ?? []),
      safeEditSurface: raw.safeEditSurface
        ? {
            files: raw.safeEditSurface.files ?? [],
            symbols: raw.safeEditSurface.symbols ?? [],
            warnings: raw.safeEditSurface.warnings ?? [],
          }
        : undefined,
    };
  }

  contextPack(input: GraphFeatureContextInput): Promise<GraphFeatureContextResult> {
    return this.featureContext(input);
  }

  async clusterImpact(input: GraphClusterImpactInput): Promise<GraphClusterImpactResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool('cluster_impact', {
      name: input.name,
      direction: input.direction ?? 'upstream',
      repo,
      limit: input.limit,
    })) as FeatureImpactRaw;
    if (raw.error) throw new Error(`codragraph cluster_impact: ${raw.error}`);
    if (!raw.cluster?.name) throw new Error(`codragraph cluster_impact: missing cluster`);

    return {
      cluster: mapFeatureCluster(raw.cluster),
      direction: raw.direction ?? input.direction ?? 'upstream',
      impactedClusters: (raw.impactedClusters ?? [])
        .filter((cluster) => cluster.name)
        .map(mapFeatureCluster),
      impactSummary: {
        affectedMembers: raw.impactSummary?.affectedMembers ?? 0,
        dependencyCount: raw.impactSummary?.dependencyCount ?? 0,
        incomingDependencies: raw.impactSummary?.incomingDependencies ?? 0,
        outgoingDependencies: raw.impactSummary?.outgoingDependencies ?? 0,
        riskLevel: raw.impactSummary?.riskLevel ?? 'LOW',
      },
      safeEditSurface: raw.safeEditSurface
        ? {
            files: raw.safeEditSurface.files ?? [],
            symbols: raw.safeEditSurface.symbols ?? [],
            warnings: raw.safeEditSurface.warnings ?? [],
          }
        : undefined,
      contextPack: raw.contextPack?.cluster?.name
        ? {
            cluster: mapFeatureCluster(raw.contextPack.cluster),
            members: mapFeatureMembers(raw.contextPack.members ?? []),
            dependencies: {
              incoming: mapFeatureDependency(raw.contextPack.dependencies?.incoming ?? []),
              outgoing: mapFeatureDependency(raw.contextPack.dependencies?.outgoing ?? []),
            },
            entryPoints: mapFeatureMembers(raw.contextPack.entryPoints ?? []),
            routes: mapFeatureMembers(raw.contextPack.routes ?? []),
            tools: mapFeatureMembers(raw.contextPack.tools ?? []),
            processes: (raw.contextPack.processes ?? []).map((process) => ({
              id: process.id,
              name: process.heuristicLabel || process.label || process.id || 'process',
              type: process.processType,
              stepCount: process.stepCount,
            })),
            tests: mapFeatureMembers(raw.contextPack.tests ?? []),
            docs: mapFeatureMembers(raw.contextPack.docs ?? []),
            safeEditSurface: raw.contextPack.safeEditSurface
              ? {
                  files: raw.contextPack.safeEditSurface.files ?? [],
                  symbols: raw.contextPack.safeEditSurface.symbols ?? [],
                  warnings: raw.contextPack.safeEditSurface.warnings ?? [],
                }
              : undefined,
          }
        : undefined,
    };
  }
}

function deriveRiskLevel(count: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (count >= 50) return 'CRITICAL';
  if (count >= 20) return 'HIGH';
  if (count >= 5) return 'MEDIUM';
  return 'LOW';
}

function mapFeatureDependency(clusters: FeatureClusterRaw[]): GraphFeatureClusterSummary[] {
  return clusters.filter((cluster) => cluster.name).map(mapFeatureCluster);
}

function mapFeatureCluster(cluster: FeatureClusterRaw): GraphFeatureClusterSummary {
  return {
    id: cluster.id,
    name: cluster.name!,
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
  };
}

function mapFeatureMembers(members: FeatureMemberRaw[]) {
  return members.map((member) => ({
    id: member.id,
    name: member.name,
    type: member.type,
    file: member.filePath,
    startLine: member.startLine,
    endLine: member.endLine,
    role: member.role,
    confidence: member.confidence,
  }));
}
