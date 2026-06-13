// Graphpack namespace - shared team graph artifacts and semantic edges.

export type GraphpackTarget = 'main' | 'pr';

export interface GraphpackStatus {
  readonly repoPath: string;
  readonly storagePath: string;
  readonly lockPath: string;
  readonly lockPresent: boolean;
  readonly lock?: GraphpackLock;
  readonly local: {
    readonly graphstorePresent: boolean;
    readonly headCommit?: string;
    readonly schemaVersion?: number;
    readonly analyzerVersion?: string;
  };
  readonly compatibility: {
    readonly ok: boolean;
    readonly reasons: readonly string[];
  };
  readonly chunks: {
    readonly expected: number;
    readonly verified: number;
    readonly missing: readonly string[];
    readonly mismatched: readonly string[];
  };
  readonly source: 'canonical' | 'pr-overlay' | 'local' | 'missing';
}

export interface GraphpackLock {
  readonly kind: 'codragraph-index-lock';
  readonly schemaVersion: 1;
  readonly repo: {
    readonly name: string;
    readonly gitCommit?: string;
    readonly remoteUrl?: string;
    readonly pathHint?: string;
  };
  readonly graphpack: {
    readonly id: string;
    readonly target: GraphpackTarget;
    readonly createdAt: string;
    readonly artifactUrl?: string;
    readonly artifactDir?: string;
    readonly graphstoreBranch?: string;
    readonly graphstoreHeadCommit?: string;
    readonly graphstoreSnapshot?: string;
  };
  readonly index: {
    readonly schemaVersion?: number;
    readonly analyzerVersion: string;
    readonly compression?: 'none' | 'brotli' | 'zstd';
    readonly semanticLayerVersion: string;
    readonly requiredCapabilities: readonly string[];
  };
  readonly chunks: ReadonlyArray<{
    readonly path: string;
    readonly kind: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly fileCount?: number;
  }>;
}

export interface GraphpackPublishInput {
  readonly repo?: string;
  readonly target?: GraphpackTarget;
  readonly artifactDir?: string;
  readonly artifactUrl?: string;
  readonly baseSnapshotId?: string;
  readonly headSnapshotId?: string;
  readonly pullRequest?: string;
  readonly analyzerVersion?: string;
}

export interface GraphpackPullInput {
  readonly artifactDir?: string;
}

export interface GraphpackPullResult {
  readonly status: GraphpackStatus;
  readonly pulled: boolean;
  readonly materializable: boolean;
  readonly fallbackRequired: boolean;
  readonly reason?: string;
}

export type SemanticRelationshipFamily =
  | 'COMPOSES'
  | 'ADAPTS'
  | 'DELEGATES_TO'
  | 'WRAPS'
  | 'CONFIGURES'
  | 'FACTORY_CREATES'
  | 'ORCHESTRATES'
  | 'PROXIES_TO'
  | 'MAPS_TO';

export interface SemanticRelationship {
  readonly id: string;
  readonly family: SemanticRelationshipFamily;
  readonly sourceId: string;
  readonly sourceName?: string;
  readonly targetId: string;
  readonly targetName?: string;
  readonly confidence: number;
  readonly provenance: 'extracted' | 'inferred' | 'LLM_INFERRED' | 'human-confirmed';
  readonly extractorVersion: string;
  readonly evidence: {
    readonly filePath?: string;
    readonly startLine?: number;
    readonly endLine?: number;
    readonly rawEdgeType: string;
    readonly rawEdgeConfidence?: number;
    readonly reason: string;
  };
}

export interface SemanticRelationshipReport {
  readonly snapshotId?: string;
  readonly extractorVersion: string;
  readonly llmEnabled: boolean;
  readonly relationships: readonly SemanticRelationship[];
  readonly summary: Record<SemanticRelationshipFamily, number>;
}

export interface GraphpackHttpClientOptions {
  readonly baseUrl?: string;
  readonly repo?: string;
  readonly fetch?: FetchLike;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class GraphpackHttpClient {
  private readonly baseUrl: string;
  private readonly repo?: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: GraphpackHttpClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:4747').replace(/\/$/, '');
    this.repo = opts.repo;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  status(opts: { strict?: boolean } = {}): Promise<GraphpackStatus> {
    const params = new URLSearchParams();
    if (this.repo) params.set('repo', this.repo);
    if (opts.strict) params.set('strict', 'true');
    return this.request(`/api/graphpack/status?${params.toString()}`);
  }

  lock(): Promise<GraphpackLock> {
    const params = new URLSearchParams();
    if (this.repo) params.set('repo', this.repo);
    return this.request(`/api/graphpack/lock?${params.toString()}`);
  }

  publish(input: GraphpackPublishInput = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (this.repo) params.set('repo', this.repo);
    return this.request(`/api/graphpack/publish?${params.toString()}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  pull(input: GraphpackPullInput = {}): Promise<GraphpackPullResult> {
    const params = new URLSearchParams();
    if (this.repo) params.set('repo', this.repo);
    return this.request(`/api/graphpack/pull?${params.toString()}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  semanticRelationships(
    opts: { limit?: number; llm?: boolean } = {},
  ): Promise<SemanticRelationshipReport> {
    const params = new URLSearchParams();
    if (this.repo) params.set('repo', this.repo);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.llm) params.set('llm', 'true');
    return this.request(`/api/semantic/relationships?${params.toString()}`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* response was not JSON */
      }
      throw new Error(message);
    }
    return (await response.json()) as T;
  }
}

export const createGraphpackHttpClient = (
  opts: GraphpackHttpClientOptions = {},
): GraphpackHttpClient => new GraphpackHttpClient(opts);
