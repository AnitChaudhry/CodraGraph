// HTTP-based GraphClient for `codragraph serve`.
//
// LocalGraphClient remains the lowest-latency in-process option, but SDK and
// harness consumers also need a real out-of-process path. This client uses the
// stable REST endpoints exposed by the CLI server for search, symbol context,
// symbol impact, and feature-cluster workflows.

import type {
  GraphClient,
  GraphClusterImpactInput,
  GraphClusterImpactResult,
  GraphContextInput,
  GraphContextResult,
  GraphFeatureClustersInput,
  GraphFeatureClustersResult,
  GraphFeatureContextInput,
  GraphFeatureContextResult,
  GraphImpactInput,
  GraphImpactResult,
  GraphQueryInput,
  GraphQueryResult,
} from '../types.js';

export interface HttpGraphClientOptions {
  baseURL?: string;
  timeoutMs?: number;
}

interface SearchResultRaw {
  id?: string;
  nodeId?: string;
  name?: string;
  label?: string;
  filePath?: string;
  file?: string;
  snippet?: string;
  content?: string;
  score?: number;
}

interface SearchRaw {
  results?: SearchResultRaw[];
  error?: string;
}

interface ContextRaw {
  symbol?: { name?: string; filePath?: string; file_path?: string };
  incoming?: Record<string, Array<{ name: string; filePath?: string }>>;
  outgoing?: Record<string, Array<{ name: string; filePath?: string }>>;
  processes?: Array<{ name?: string; heuristicLabel?: string; label?: string }>;
  error?: string;
}

interface ImpactRaw {
  target?: { name?: string };
  byDepth?: Record<string, Array<{ name: string; filePath?: string }>>;
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

interface FeatureMemberRaw {
  id?: string;
  name?: string;
  type?: string;
  filePath?: string;
  file?: string;
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

interface FeatureClustersRaw {
  clusters?: FeatureClusterRaw[];
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

export class HttpGraphClient implements GraphClient {
  private readonly baseURL: string;
  private readonly timeoutMs: number;

  constructor(options: HttpGraphClientOptions = {}) {
    this.baseURL = (
      options.baseURL ??
      process.env.CODRAGRAPH_URL ??
      'http://127.0.0.1:4747'
    ).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async query(input: GraphQueryInput): Promise<GraphQueryResult> {
    const raw = await this.requestJson<SearchRaw>('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: input.query,
        limit: input.limit,
        repo: input.repo,
      }),
    });
    if (raw.error) throw new Error(`codragraph search: ${raw.error}`);

    return {
      results: (raw.results ?? [])
        .map((result, index) => ({
          name: String(result.name || result.label || result.nodeId || result.id || '').trim(),
          score: typeof result.score === 'number' ? result.score : 1 / (index + 1),
          file: result.filePath ?? result.file,
          snippet: result.snippet ?? result.content,
        }))
        .filter((result) => result.name)
        .slice(0, input.limit ?? 100),
    };
  }

  async context(input: GraphContextInput): Promise<GraphContextResult> {
    const raw = await this.requestJson<ContextRaw>('/api/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name, repo: input.repo }),
    });
    if (raw.error) throw new Error(`codragraph context: ${raw.error}`);

    const callers: Array<{ name: string; file?: string }> = [];
    for (const refs of Object.values(raw.incoming ?? {})) {
      for (const ref of refs) callers.push({ name: ref.name, file: ref.filePath });
    }
    const callees: Array<{ name: string; file?: string }> = [];
    for (const refs of Object.values(raw.outgoing ?? {})) {
      for (const ref of refs) callees.push({ name: ref.name, file: ref.filePath });
    }

    return {
      name: raw.symbol?.name ?? input.name,
      file: raw.symbol?.filePath ?? raw.symbol?.file_path,
      callers,
      callees,
      processes: (raw.processes ?? [])
        .map((process) => process.name || process.heuristicLabel || process.label)
        .filter((name): name is string => Boolean(name)),
    };
  }

  async impact(input: GraphImpactInput): Promise<GraphImpactResult> {
    const raw = await this.requestJson<ImpactRaw>('/api/impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: input.target,
        direction: input.direction ?? 'upstream',
        maxDepth: input.maxDepth,
        repo: input.repo,
      }),
    });
    if (raw.error) throw new Error(`codragraph impact: ${raw.error}`);

    const affected: GraphImpactResult['affected'] = [];
    for (const [depthText, refs] of Object.entries(raw.byDepth ?? {})) {
      const depth = Number.parseInt(depthText, 10);
      for (const ref of refs) {
        affected.push({ name: ref.name, depth, file: ref.filePath });
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
    const raw = await this.requestJson<FeatureClustersRaw>(
      `/api/feature-clusters${queryString({
        repo: input.repo,
        limit: input.limit,
        query: input.query,
      })}`,
    );
    if (raw.error) throw new Error(`codragraph feature_clusters: ${raw.error}`);
    return { clusters: (raw.clusters ?? []).filter((cluster) => cluster.name).map(mapCluster) };
  }

  async featureContext(input: GraphFeatureContextInput): Promise<GraphFeatureContextResult> {
    const raw = await this.requestJson<FeatureContextRaw>(
      `/api/feature-cluster${queryString({
        repo: input.repo,
        name: input.name,
        limit: input.limit,
      })}`,
    );
    if (raw.error) throw new Error(`codragraph feature_context: ${raw.error}`);
    return mapFeatureContext(input.name, raw);
  }

  clusters(input: GraphFeatureClustersInput = {}): Promise<GraphFeatureClustersResult> {
    return this.featureClusters(input);
  }

  contextPack(input: GraphFeatureContextInput): Promise<GraphFeatureContextResult> {
    return this.featureContext(input);
  }

  async clusterImpact(input: GraphClusterImpactInput): Promise<GraphClusterImpactResult> {
    const raw = await this.requestJson<FeatureImpactRaw>(
      `/api/feature-impact${queryString({
        repo: input.repo,
        name: input.name,
        direction: input.direction ?? 'upstream',
        limit: input.limit,
      })}`,
    );
    if (raw.error) throw new Error(`codragraph cluster_impact: ${raw.error}`);
    if (!raw.cluster?.name) throw new Error(`codragraph cluster_impact: missing cluster`);

    return {
      cluster: mapCluster(raw.cluster),
      direction: raw.direction ?? input.direction ?? 'upstream',
      impactedClusters: (raw.impactedClusters ?? [])
        .filter((cluster) => cluster.name)
        .map(mapCluster),
      impactSummary: {
        affectedMembers: raw.impactSummary?.affectedMembers ?? 0,
        dependencyCount: raw.impactSummary?.dependencyCount ?? 0,
        incomingDependencies: raw.impactSummary?.incomingDependencies ?? 0,
        outgoingDependencies: raw.impactSummary?.outgoingDependencies ?? 0,
        riskLevel: raw.impactSummary?.riskLevel ?? 'LOW',
      },
      safeEditSurface: mapSafeEditSurface(raw.safeEditSurface),
      contextPack: raw.contextPack ? mapFeatureContext(input.name, raw.contextPack) : undefined,
    };
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseURL}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const body = (await readResponseBody(response)) as T & { error?: string };
      if (!response.ok) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`CodraGraph HTTP request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) return { error: text };
    throw new Error(`CodraGraph HTTP response was not JSON: ${text.slice(0, 120)}`);
  }
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function mapFeatureContext(name: string, raw: FeatureContextRaw): GraphFeatureContextResult {
  if (!raw.cluster?.name) throw new Error(`codragraph feature_context: missing cluster ${name}`);
  return {
    cluster: mapCluster(raw.cluster),
    members: mapMembers(raw.members),
    dependencies: {
      incoming: (raw.dependencies?.incoming ?? [])
        .filter((cluster) => cluster.name)
        .map(mapCluster),
      outgoing: (raw.dependencies?.outgoing ?? [])
        .filter((cluster) => cluster.name)
        .map(mapCluster),
    },
    entryPoints: mapMembers(raw.entryPoints),
    routes: mapMembers(raw.routes),
    tools: mapMembers(raw.tools),
    processes: (raw.processes ?? []).map((process) => ({
      id: process.id,
      name: process.heuristicLabel || process.label || process.id || 'process',
      type: process.processType,
      stepCount: process.stepCount,
    })),
    tests: mapMembers(raw.tests),
    docs: mapMembers(raw.docs),
    safeEditSurface: mapSafeEditSurface(raw.safeEditSurface),
  };
}

function mapCluster(cluster: FeatureClusterRaw) {
  return {
    id: cluster.id,
    name: cluster.name || cluster.slug || cluster.id || 'cluster',
    slug: cluster.slug,
    featureKind: cluster.featureKind,
    summary: cluster.summary,
    description: cluster.description,
    repo: cluster.repo,
    service: cluster.service,
    signals: cluster.signals ?? [],
    memberCount: cluster.memberCount,
    entryPointIds: cluster.entryPointIds ?? [],
    routes: cluster.routes ?? [],
    tools: cluster.tools ?? [],
    testCoverageHints: cluster.testCoverageHints ?? [],
    lastIndexedCommit: cluster.lastIndexedCommit,
    confidence: cluster.confidence,
  };
}

function mapMembers(members: FeatureMemberRaw[] = []) {
  return members.map((member) => ({
    id: member.id,
    name: member.name,
    type: member.type,
    file: member.filePath ?? member.file,
    startLine: member.startLine,
    endLine: member.endLine,
    role: member.role,
    confidence: member.confidence,
  }));
}

function mapSafeEditSurface(surface: FeatureContextRaw['safeEditSurface'] | undefined) {
  return surface
    ? {
        files: surface.files ?? [],
        symbols: surface.symbols ?? [],
        warnings: surface.warnings ?? [],
      }
    : undefined;
}

function deriveRiskLevel(count: number): GraphImpactResult['riskLevel'] {
  if (count >= 50) return 'CRITICAL';
  if (count >= 20) return 'HIGH';
  if (count >= 5) return 'MEDIUM';
  return 'LOW';
}
