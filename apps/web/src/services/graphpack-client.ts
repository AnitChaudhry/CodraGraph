import { getBackendUrl } from './backend-client';

export type RemoteCallResult<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

export interface GraphpackStatus {
  lockPresent: boolean;
  source: 'canonical' | 'pr-overlay' | 'local' | 'missing';
  lock?: {
    graphpack: {
      id: string;
      target: 'main' | 'pr';
      graphstoreSnapshot?: string;
      graphstoreHeadCommit?: string;
    };
  };
  compatibility: {
    ok: boolean;
    reasons: string[];
  };
  chunks: {
    expected: number;
    verified: number;
    missing: string[];
    mismatched: string[];
  };
  local: {
    graphstorePresent: boolean;
    headCommit?: string;
  };
}

export interface SemanticRelationshipReport {
  snapshotId?: string;
  extractorVersion: string;
  llmEnabled: boolean;
  relationships: Array<{
    id: string;
    family: string;
    confidence: number;
    provenance: string;
  }>;
  summary: Record<string, number>;
}

const tryFetchJson = async <T>(url: string): Promise<RemoteCallResult<T>> => {
  try {
    const response = await fetch(url);
    if (response.status === 404 || response.status === 501) {
      return { available: false, reason: 'endpoint not available on this server' };
    }
    if (!response.ok) {
      return { available: false, reason: `HTTP ${response.status}` };
    }
    return { available: true, data: (await response.json()) as T };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : 'request failed',
    };
  }
};

export const fetchGraphpackStatus = (repo?: string): Promise<RemoteCallResult<GraphpackStatus>> => {
  const params = repo ? `?repo=${encodeURIComponent(repo)}` : '';
  return tryFetchJson<GraphpackStatus>(`${getBackendUrl()}/api/graphpack/status${params}`);
};

export const fetchSemanticRelationships = (
  repo?: string,
  limit = 200,
): Promise<RemoteCallResult<SemanticRelationshipReport>> => {
  const params = new URLSearchParams();
  if (repo) params.set('repo', repo);
  params.set('limit', String(limit));
  return tryFetchJson<SemanticRelationshipReport>(
    `${getBackendUrl()}/api/semantic/relationships?${params.toString()}`,
  );
};
