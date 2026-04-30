/**
 * Phase 4 × Phase 3 moat client — wrappers over the harness recipe
 * endpoints. Same defensive shape as graphstore-client: callers see
 * `{available: true, data}` or `{available: false, reason}` so the
 * dashboard renders empty states cleanly when the server hasn't yet
 * exposed the endpoint.
 *
 * Mirrors `handleHarnessRecipesList` / `handleHarnessRecipesLookup`
 * from codragraph-harness/src/mcp/handler.ts.
 */

import { getBackendUrl } from './backend-client';

export interface RecipeSummary {
  id: string;
  taskFamily: string;
  snapshotId: string;
  searchedAt: string;
  accuracy: number;
  tokens: number;
  latencyMs: number;
  harnessName: string;
}

export interface RecipesListResult {
  recipeStoreRoot: string;
  recipes: RecipeSummary[];
}

export interface RecipeStaleness {
  diffComputed: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  summary?: {
    addedNodes: number;
    removedNodes: number;
    modifiedSymbols: number;
    addedEdges: number;
    removedEdges: number;
  };
}

export interface RecipesLookupResult {
  recipeStoreRoot: string;
  exact: RecipeSummary[];
  candidates: Array<RecipeSummary & { staleness: RecipeStaleness }>;
}

export type RecipesCallResult<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

const tryFetchJson = async <T>(url: string): Promise<RecipesCallResult<T>> => {
  try {
    const response = await fetch(url);
    if (response.status === 404 || response.status === 501) {
      return { available: false, reason: 'endpoint not available on this server' };
    }
    if (!response.ok) {
      return { available: false, reason: `server returned ${response.status}` };
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

export const fetchRecipesList = async (
  repo?: string,
  opts: { taskFamily?: string; snapshotId?: string; limit?: number } = {},
): Promise<RecipesCallResult<RecipesListResult>> => {
  const params = new URLSearchParams();
  if (repo) params.set('repo', repo);
  if (opts.taskFamily) params.set('task_family', opts.taskFamily);
  if (opts.snapshotId) params.set('snapshot_id', opts.snapshotId);
  if (opts.limit) params.set('limit', String(opts.limit));
  const url = `${getBackendUrl()}/api/recipes${params.toString() ? `?${params.toString()}` : ''}`;
  return tryFetchJson<RecipesListResult>(url);
};

export const fetchRecipesLookup = async (
  taskFamily: string,
  snapshotId: string,
  repo?: string,
): Promise<RecipesCallResult<RecipesLookupResult>> => {
  const params = new URLSearchParams({
    task_family: taskFamily,
    snapshot_id: snapshotId,
  });
  if (repo) params.set('repo', repo);
  return tryFetchJson<RecipesLookupResult>(
    `${getBackendUrl()}/api/recipes/lookup?${params.toString()}`,
  );
};
