/**
 * Phase 4 graphstore client — typed wrappers over the codragraph
 * server's versioned-graph endpoints. Each call degrades gracefully
 * when the endpoint is missing (older server, or the endpoint isn't
 * wired yet) so the dashboard can render empty states without
 * exploding.
 *
 * The shape mirrors the MCP tools' return values from
 * `codragraph/src/mcp/local/graphstore-handler.ts` so callers can swap
 * between MCP-over-HTTP and the REST endpoints as the backend evolves.
 */

import { getBackendUrl } from './backend-client';

export interface GraphstoreCommit {
  id: string;
  short: string;
  snapshot: string;
  parents: string[];
  author: string;
  ts: string;
  message: string;
}

export interface GraphstoreLogResult {
  branch: string | null;
  head: string | null;
  commits: GraphstoreCommit[];
}

export interface GraphstoreBranch {
  name: string;
  head: string;
  short: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface GraphstoreBranchesResult {
  current: string | null;
  branches: GraphstoreBranch[];
}

export interface GraphstoreDiffSummary {
  addedNodes: Record<string, number>;
  removedNodes: Record<string, number>;
  addedEdges: number;
  removedEdges: number;
  modifiedSymbols: number;
}

export interface GraphstoreDiffResult {
  from: { id: string; short: string; message: string };
  to: { id: string; short: string; message: string };
  summary: GraphstoreDiffSummary;
  modifiedSymbols: Array<{
    table: string;
    id: string;
    fromHash: string;
    toHash: string;
  }>;
}

export interface SymbolRef {
  table: string;
  id: string;
  name?: string;
  filePath?: string;
  isExported?: boolean;
}

export interface ClassifiedModification {
  table: string;
  id: string;
  name?: string;
  filePath?: string;
  fromHash: string;
  toHash: string;
  changes: Array<'signature' | 'visibility' | 'body' | 'location' | 'metadata'>;
  visibilityFlip?: { from: boolean; to: boolean };
  signatureChange?: {
    nameChanged?: { from: string; to: string };
    parameterCountChanged?: { from: number; to: number };
    returnTypeChanged?: { from: string; to: string };
  };
}

export interface GraphstoreSemanticDiffResult extends GraphstoreDiffResult {
  semanticVersion: 'stub' | 'semantic-v1';
  addedAPIs: SymbolRef[];
  removedAPIs: SymbolRef[];
  addedProcesses: SymbolRef[];
  removedProcesses: SymbolRef[];
  classifiedModifications: ClassifiedModification[];
}

/**
 * Result envelope for the dashboard. `available` is true when the
 * endpoint succeeded; false when the server returned 404/501 or wasn't
 * reachable. Callers render the data when available, an empty state +
 * disabled hint when not.
 */
export type GraphstoreCallResult<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

const repoParam = (repo: string | undefined): string =>
  repo ? `?repo=${encodeURIComponent(repo)}` : '';

const tryFetchJson = async <T>(
  url: string,
  init?: RequestInit,
): Promise<GraphstoreCallResult<T>> => {
  try {
    const response = await fetch(url, init);
    if (response.status === 404 || response.status === 501) {
      return { available: false, reason: 'endpoint not available on this server' };
    }
    if (!response.ok) {
      return {
        available: false,
        reason: `server returned ${response.status}`,
      };
    }
    const data = (await response.json()) as T;
    return { available: true, data };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : 'network error',
    };
  }
};

export const fetchGraphstoreLog = async (
  repo?: string,
  opts: { limit?: number; from?: string } = {},
): Promise<GraphstoreCallResult<GraphstoreLogResult>> => {
  const params = new URLSearchParams();
  if (repo) params.set('repo', repo);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.from) params.set('from', opts.from);
  const url = `${getBackendUrl()}/api/graphstore/log${params.toString() ? `?${params.toString()}` : ''}`;
  return tryFetchJson<GraphstoreLogResult>(url);
};

export const fetchGraphstoreBranches = async (
  repo?: string,
): Promise<GraphstoreCallResult<GraphstoreBranchesResult>> => {
  return tryFetchJson<GraphstoreBranchesResult>(
    `${getBackendUrl()}/api/graphstore/branches${repoParam(repo)}`,
  );
};

export const fetchGraphstoreDiff = async (
  from: string,
  to: string,
  repo?: string,
): Promise<GraphstoreCallResult<GraphstoreDiffResult>> => {
  const params = new URLSearchParams({ from, to });
  if (repo) params.set('repo', repo);
  return tryFetchJson<GraphstoreDiffResult>(
    `${getBackendUrl()}/api/graphstore/diff?${params.toString()}`,
  );
};

/**
 * Higher-fidelity diff that the dashboard renders as the "what broke
 * / what fixed" panel — surfaces removed exported APIs (potential
 * breakage), added exported APIs (potential fixes / new contracts),
 * Process additions/removals (behavioural changes), and
 * change-classified modifications (signature / visibility / body /
 * location / metadata).
 */
export const fetchGraphstoreSemanticDiff = async (
  from: string,
  to: string,
  repo?: string,
): Promise<GraphstoreCallResult<GraphstoreSemanticDiffResult>> => {
  const params = new URLSearchParams({ from, to });
  if (repo) params.set('repo', repo);
  return tryFetchJson<GraphstoreSemanticDiffResult>(
    `${getBackendUrl()}/api/graphstore/semantic-diff?${params.toString()}`,
  );
};
