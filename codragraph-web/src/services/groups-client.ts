/**
 * Cross-repo group client. Wraps the codragraph server's `/api/groups/*`
 * routes so the dashboard's Projects section can render multi-repo
 * context: which repos a group bundles, what cross-repo contracts they
 * declare, which sibling repos are stale.
 *
 * Mirrors the existing group_list / group_contracts MCP shapes from
 * codragraph/src/core/group/service.ts so swapping between MCP-over-HTTP
 * and these REST routes is a one-line change later.
 */

import { getBackendUrl } from './backend-client';

export interface GroupListResult {
  groups: string[];
}

export interface GroupManifestLink {
  from: string;
  to: string;
  type: 'http' | 'grpc' | 'topic' | 'lib' | 'custom';
  contract: string;
  role: 'provider' | 'consumer';
}

export interface GroupDetails {
  name: string;
  description: string;
  /** Map of group-path → registered repo name (e.g. "hr/frontend": "hr-frontend"). */
  repos: Record<string, string>;
  links: GroupManifestLink[];
}

export interface ContractRow {
  contractId: string;
  type: GroupManifestLink['type'];
  role: GroupManifestLink['role'];
  symbolUid: string;
  symbolRef: { filePath: string; name: string };
  symbolName: string;
  confidence: number;
  meta: Record<string, unknown>;
  repo: string;
  service?: string;
}

export interface CrossLinkRow {
  from: { repo: string; symbolUid: string; symbolRef: { filePath: string; name: string } };
  to: { repo: string; symbolUid: string; symbolRef: { filePath: string; name: string } };
  type: GroupManifestLink['type'];
  contractId: string;
  matchType: 'exact' | 'manifest' | 'wildcard' | 'bm25' | 'embedding';
  confidence: number;
}

export interface GroupContractsResult {
  contracts: ContractRow[];
  crossLinks: CrossLinkRow[];
}

export interface GroupsForRepoResult {
  repo: string;
  groups: Array<{ group: string; groupPath: string }>;
}

export type GroupsCallResult<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

const tryFetchJson = async <T>(url: string): Promise<GroupsCallResult<T>> => {
  try {
    const response = await fetch(url);
    if (response.status === 404 || response.status === 501) {
      return { available: false, reason: 'endpoint not available on this server' };
    }
    if (!response.ok) {
      return { available: false, reason: `server returned ${response.status}` };
    }
    return { available: true, data: (await response.json()) as T };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : 'network error',
    };
  }
};

export const fetchGroupsList = (): Promise<GroupsCallResult<GroupListResult>> =>
  tryFetchJson<GroupListResult>(`${getBackendUrl()}/api/groups`);

export const fetchGroupDetails = (
  name: string,
): Promise<GroupsCallResult<GroupDetails>> =>
  tryFetchJson<GroupDetails>(
    `${getBackendUrl()}/api/groups/${encodeURIComponent(name)}`,
  );

export const fetchGroupContracts = (
  name: string,
  filter: { type?: string; repo?: string; unmatchedOnly?: boolean } = {},
): Promise<GroupsCallResult<GroupContractsResult>> => {
  const params = new URLSearchParams();
  if (filter.type) params.set('type', filter.type);
  if (filter.repo) params.set('repo', filter.repo);
  if (filter.unmatchedOnly) params.set('unmatchedOnly', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  return tryFetchJson<GroupContractsResult>(
    `${getBackendUrl()}/api/groups/${encodeURIComponent(name)}/contracts${qs}`,
  );
};

export const fetchGroupsForRepo = (
  repo: string,
): Promise<GroupsCallResult<GroupsForRepoResult>> =>
  tryFetchJson<GroupsForRepoResult>(
    `${getBackendUrl()}/api/groups/for-repo?repo=${encodeURIComponent(repo)}`,
  );
