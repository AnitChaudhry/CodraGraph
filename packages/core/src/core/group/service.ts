/**
 * Group orchestration shared by MCP (LocalBackend) and CLI.
 * DB access is injected via GroupToolPort so this module stays free of LocalBackend private API.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { checkStaleness } from '../git-staleness.js';
import { GroupNotFoundError, loadGroupConfig } from './config-parser.js';
import {
  fileMatchesServicePrefix,
  normalizeServicePrefix,
  repoInSubgroup,
} from './group-path-utils.js';
import {
  getDefaultCodragraphDir,
  getGroupDir,
  listGroups,
  readContractRegistry,
} from './storage.js';
import { syncGroup } from './sync.js';
import type {
  ContractRegistry,
  CrossLink,
  CrossLinkEndpoint,
  GroupConfig,
  GroupContextResult,
  StoredContract,
} from './types.js';

export interface GroupRepoHandle {
  id: string;
  name: string;
  repoPath: string;
  storagePath: string;
  indexedAt?: string;
  lastCommit?: string;
}

export interface GroupToolPort {
  resolveRepo(repoParam?: string): Promise<GroupRepoHandle>;
  impact(
    repo: GroupRepoHandle,
    params: {
      target: string;
      direction: 'upstream' | 'downstream';
      maxDepth?: number;
      relationTypes?: string[];
      includeTests?: boolean;
      minConfidence?: number;
    },
  ): Promise<unknown>;
  query(
    repo: GroupRepoHandle,
    params: {
      query: string;
      task_context?: string;
      goal?: string;
      limit?: number;
      max_symbols?: number;
      include_content?: boolean;
    },
  ): Promise<unknown>;
  impactByUid(
    repoId: string,
    uid: string,
    direction: string,
    opts: {
      maxDepth: number;
      relationTypes: string[];
      minConfidence: number;
      includeTests: boolean;
    },
  ): Promise<unknown | null>;
  context(
    repo: GroupRepoHandle,
    params: {
      name?: string;
      uid?: string;
      file_path?: string;
      include_content?: boolean;
    },
  ): Promise<unknown>;
  featureClusters?(
    repo: GroupRepoHandle,
    params: {
      query?: string;
      limit?: number;
    },
  ): Promise<unknown>;
  featureContext?(
    repo: GroupRepoHandle,
    params: {
      name: string;
      limit?: number;
    },
  ): Promise<unknown>;
  featureImpact?(
    repo: GroupRepoHandle,
    params: {
      name: string;
      direction?: 'upstream' | 'downstream' | 'both';
      limit?: number;
    },
  ): Promise<unknown>;
}

function isStoredContract(raw: unknown): raw is StoredContract {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.contractId === 'string' &&
    typeof o.type === 'string' &&
    typeof o.repo === 'string' &&
    typeof o.role === 'string' &&
    (o.role === 'provider' || o.role === 'consumer') &&
    typeof o.symbolUid === 'string' &&
    typeof o.symbolName === 'string' &&
    typeof o.confidence === 'number' &&
    o.meta !== undefined &&
    typeof o.meta === 'object' &&
    o.meta !== null &&
    o.symbolRef !== undefined &&
    typeof o.symbolRef === 'object' &&
    o.symbolRef !== null &&
    typeof (o.symbolRef as Record<string, unknown>).filePath === 'string' &&
    typeof (o.symbolRef as Record<string, unknown>).name === 'string'
  );
}

function filterQueryByServicePrefix(
  queryResult: {
    processes?: Array<Record<string, unknown>>;
    process_symbols?: Array<Record<string, unknown>>;
  },
  servicePrefix: string,
): { processes: Array<Record<string, unknown>>; process_symbols: Array<Record<string, unknown>> } {
  const symbols = (queryResult.process_symbols || []).filter((s) =>
    fileMatchesServicePrefix(
      typeof s.filePath === 'string' ? s.filePath : undefined,
      servicePrefix,
    ),
  );
  const allowed = new Set(
    symbols.map((s) => String((s as { process_id?: string }).process_id ?? '')).filter(Boolean),
  );
  const processes = (queryResult.processes || []).filter((p) => allowed.has(String(p.id)));
  return { processes, process_symbols: symbols };
}

type FeatureClusterRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  slug?: string;
  repoPath?: string;
  registryName?: string;
  memberCount?: number;
  entryPointIds?: string[];
  routes?: string[];
  tools?: string[];
};

interface CrossRepoClusterLink {
  sourceRepo: string;
  sourceService?: string;
  sourceClusterId?: string;
  sourceClusterName?: string;
  targetRepo: string;
  targetService?: string;
  targetClusterId?: string;
  targetClusterName?: string;
  contractName?: string;
  relationship: 'shared-contract' | 'depends-on';
  confidence: number;
  evidence: string[];
}

function normalizeClusterToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function featureClusterKey(cluster: FeatureClusterRecord): string {
  return normalizeClusterToken(cluster.slug || cluster.name || cluster.id || 'unknown');
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null && item !== undefined)
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(/,(?=(?:[^']*'[^']*')*[^']*$)/)
    .map((item) =>
      item
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/\\,/g, ','),
    )
    .filter(Boolean);
}

function clusterOwnsEndpoint(cluster: FeatureClusterRecord, endpoint: CrossLinkEndpoint): boolean {
  const entryPointIds = normalizeStringList(cluster.entryPointIds);
  if (entryPointIds.includes(endpoint.symbolUid)) return true;

  const key = featureClusterKey(cluster);
  if (!key || key === 'unknown') return false;
  const filePath = normalizeClusterToken(endpoint.symbolRef.filePath);
  const symbolName = normalizeClusterToken(endpoint.symbolRef.name);
  return filePath.includes(key) || symbolName.includes(key);
}

function resolveEndpointCluster(
  endpoint: CrossLinkEndpoint,
  clusters: FeatureClusterRecord[],
): FeatureClusterRecord | undefined {
  const sameRepo = clusters.filter((cluster) => cluster.repoPath === endpoint.repo);
  return sameRepo.find((cluster) => clusterOwnsEndpoint(cluster, endpoint));
}

function buildCrossRepoClusterLinks(
  registry: ContractRegistry | null,
  clusters: FeatureClusterRecord[],
): CrossRepoClusterLink[] {
  if (!registry) return [];
  const links: CrossRepoClusterLink[] = [];
  for (const link of registry.crossLinks) {
    const sourceCluster = resolveEndpointCluster(link.from, clusters);
    const targetCluster = resolveEndpointCluster(link.to, clusters);
    if (!sourceCluster || !targetCluster) continue;
    links.push({
      sourceRepo: link.from.repo,
      sourceService: link.from.service,
      sourceClusterId: sourceCluster.id,
      sourceClusterName: String(sourceCluster.name || sourceCluster.slug || sourceCluster.id || ''),
      targetRepo: link.to.repo,
      targetService: link.to.service,
      targetClusterId: targetCluster.id,
      targetClusterName: String(targetCluster.name || targetCluster.slug || targetCluster.id || ''),
      contractName: link.contractId,
      relationship: 'shared-contract',
      confidence: link.confidence,
      evidence: [
        `${link.type}:${link.contractId}`,
        `${link.from.symbolRef.filePath} -> ${link.to.symbolRef.filePath}`,
        `match:${link.matchType}`,
      ],
    });
  }
  return links;
}

function aggregateCrossRepoFeatureClusters(
  clusters: FeatureClusterRecord[],
  links: CrossRepoClusterLink[],
): Array<Record<string, unknown>> {
  const byKey = new Map<string, FeatureClusterRecord[]>();
  for (const cluster of clusters) {
    const key = featureClusterKey(cluster);
    const list = byKey.get(key) ?? [];
    list.push(cluster);
    byKey.set(key, list);
  }

  return [...byKey.entries()]
    .map(([key, group]) => {
      const clusterIds = new Set(group.map((cluster) => String(cluster.id || '')).filter(Boolean));
      const crossRepoLinks = links.filter(
        (link) =>
          (link.sourceClusterId && clusterIds.has(link.sourceClusterId)) ||
          (link.targetClusterId && clusterIds.has(link.targetClusterId)),
      );
      const routes = new Set<string>();
      const tools = new Set<string>();
      for (const cluster of group) {
        normalizeStringList(cluster.routes).forEach((route) => routes.add(route));
        normalizeStringList(cluster.tools).forEach((tool) => tools.add(tool));
      }
      return {
        key,
        name: String(group[0]?.name || group[0]?.slug || key),
        repos: group.map((cluster) => ({
          repoPath: cluster.repoPath,
          registryName: cluster.registryName,
          cluster,
        })),
        repoCount: new Set(group.map((cluster) => cluster.repoPath)).size,
        memberCount: group.reduce((sum, cluster) => sum + Number(cluster.memberCount ?? 0), 0),
        routes: [...routes].sort(),
        tools: [...tools].sort(),
        crossRepoLinks,
      };
    })
    .sort((a, b) => Number(b.memberCount) - Number(a.memberCount));
}

function isCrossLink(raw: unknown): raw is CrossLink {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  const from = o.from as Record<string, unknown> | undefined;
  const to = o.to as Record<string, unknown> | undefined;
  if (!from || !to) return false;
  if (typeof from.repo !== 'string' || typeof to.repo !== 'string') return false;
  return typeof o.contractId === 'string' && typeof o.type === 'string';
}

async function loadContractRegistryResilient(
  groupDir: string,
): Promise<
  { ok: true; registry: ContractRegistry; skippedCorrupt: number } | { ok: false; error: string }
> {
  const filePath = path.join(groupDir, 'contracts.json');
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: `No contracts.json for this group. Run group_sync first.` };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'contracts.json is not valid JSON' };
  }

  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return { ok: false, error: 'contracts.json has an invalid root object' };
  }

  const base = root as Record<string, unknown>;
  const contractsRaw = base.contracts;
  const crossRaw = base.crossLinks;
  let skippedCorrupt = 0;

  const contracts: StoredContract[] = [];
  if (Array.isArray(contractsRaw)) {
    for (const row of contractsRaw) {
      try {
        if (isStoredContract(row)) {
          contracts.push(row);
        } else {
          skippedCorrupt++;
          console.warn('[group] skipping corrupt contract row in contracts.json');
        }
      } catch {
        skippedCorrupt++;
        console.warn('[group] skipping corrupt contract row in contracts.json');
      }
    }
  }

  const crossLinks: CrossLink[] = [];
  if (Array.isArray(crossRaw)) {
    for (const row of crossRaw) {
      try {
        if (isCrossLink(row)) {
          crossLinks.push(row);
        } else {
          skippedCorrupt++;
          console.warn('[group] skipping corrupt crossLinks row in contracts.json');
        }
      } catch {
        skippedCorrupt++;
        console.warn('[group] skipping corrupt crossLinks row in contracts.json');
      }
    }
  }

  const registry: ContractRegistry = {
    version: typeof base.version === 'number' ? base.version : 0,
    generatedAt: typeof base.generatedAt === 'string' ? base.generatedAt : '',
    repoSnapshots:
      base.repoSnapshots && typeof base.repoSnapshots === 'object' && base.repoSnapshots !== null
        ? (base.repoSnapshots as Record<string, { indexedAt: string; lastCommit: string }>)
        : {},
    missingRepos: Array.isArray(base.missingRepos) ? (base.missingRepos as string[]) : [],
    contracts,
    crossLinks,
  };

  return { ok: true, registry, skippedCorrupt };
}

export class GroupService {
  constructor(private readonly port: GroupToolPort) {}

  async groupList(params: Record<string, unknown>): Promise<unknown> {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!name) {
      const groups = await listGroups();
      return { groups };
    }
    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    let config: GroupConfig;
    try {
      config = await loadGroupConfig(groupDir);
    } catch (err) {
      if (err instanceof GroupNotFoundError)
        return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
      throw err;
    }
    return {
      name: config.name,
      description: config.description,
      repos: config.repos,
      links: config.links,
    };
  }

  async groupSync(params: Record<string, unknown>): Promise<unknown> {
    const name = String(params.name ?? '').trim();
    if (!name) return { error: 'name is required' };
    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    let config: GroupConfig;
    try {
      config = await loadGroupConfig(groupDir);
    } catch (err) {
      if (err instanceof GroupNotFoundError)
        return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
      throw err;
    }
    const result = await syncGroup(config, {
      groupDir,
      exactOnly: Boolean(params.exactOnly),
      skipEmbeddings: Boolean(params.skipEmbeddings),
      allowStale: Boolean(params.allowStale),
      verbose: Boolean(params.verbose),
    });
    return {
      contracts: result.contracts.length,
      crossLinks: result.crossLinks.length,
      unmatched: result.unmatched.length,
      missingRepos: result.missingRepos,
    };
  }

  async groupContracts(params: Record<string, unknown>): Promise<unknown> {
    const name = String(params.name ?? '').trim();
    if (!name) return { error: 'name is required' };
    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    const loaded = await loadContractRegistryResilient(groupDir);
    if (loaded.ok === false) {
      if (loaded.error.includes('No contracts.json')) {
        return { error: `No contracts.json for group "${name}". Run group_sync first.` };
      }
      return { error: loaded.error };
    }
    const { registry, skippedCorrupt } = loaded;
    let contracts = registry.contracts;
    if (params.type) contracts = contracts.filter((c) => c.type === params.type);
    if (params.repo) contracts = contracts.filter((c) => c.repo === params.repo);
    if (params.unmatchedOnly) {
      const matchedIds = new Set(
        registry.crossLinks.flatMap((l) => [
          `${l.from.repo}::${l.contractId}`,
          `${l.to.repo}::${l.contractId}`,
        ]),
      );
      contracts = contracts.filter((c) => !matchedIds.has(`${c.repo}::${c.contractId}`));
    }
    const out: Record<string, unknown> = { contracts, crossLinks: registry.crossLinks };
    if (skippedCorrupt > 0) out.skippedCorrupt = skippedCorrupt;
    return out;
  }

  async groupImpact(params: Record<string, unknown>): Promise<unknown> {
    const { runGroupImpact } = await import('./cross-impact.js');
    return runGroupImpact({ port: this.port, codragraphDir: getDefaultCodragraphDir() }, params);
  }

  async groupContext(params: Record<string, unknown>): Promise<GroupContextResult> {
    const name = String(params.name ?? '').trim();
    const target = typeof params.target === 'string' ? params.target.trim() : '';
    const uid = typeof params.uid === 'string' ? params.uid.trim() : undefined;
    const file_path = typeof params.file_path === 'string' ? params.file_path : undefined;
    const include_content = Boolean(params.include_content);
    if (
      params.service !== undefined &&
      params.service !== null &&
      String(params.service).trim() === ''
    ) {
      return { group: name || '', error: 'service must not be an empty string', results: [] };
    }
    const servicePrefix = normalizeServicePrefix(params.service);
    const subgroup = typeof params.subgroup === 'string' ? params.subgroup : undefined;
    const subgroupExact = params.subgroupExact === true;

    if (!name) {
      return { group: '', error: 'name is required', results: [] };
    }
    if (!uid && !target) {
      return { group: name, error: 'target or uid is required', results: [] };
    }

    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    let config: GroupConfig;
    try {
      config = await loadGroupConfig(groupDir);
    } catch (e) {
      if (e instanceof GroupNotFoundError)
        return {
          group: name,
          target: target || uid,
          service: servicePrefix,
          error: `Group "${name}" not found. Run group_list to see configured groups.`,
          results: [],
        };
      return {
        group: name,
        target: target || uid,
        service: servicePrefix,
        error: e instanceof Error ? e.message : String(e),
        results: [],
      };
    }

    const memberEntries = Object.entries(config.repos).filter(([repoPath]) =>
      repoInSubgroup(repoPath, subgroup, subgroupExact),
    );

    const results: GroupContextResult['results'] = await Promise.all(
      memberEntries.map(async ([repoPath, registryName]) => {
        try {
          const repoObj = await this.port.resolveRepo(registryName);
          const payload = await this.port.context(repoObj, {
            name: target || undefined,
            uid,
            file_path,
            include_content,
          });

          if (servicePrefix) {
            const st = (payload as { status?: string })?.status;
            const sym = (payload as { symbol?: { filePath?: string } })?.symbol;
            if (st === 'found' && !fileMatchesServicePrefix(sym?.filePath, servicePrefix)) {
              return { repoPath, registryName, payload: {} };
            }
          }

          return { repoPath, registryName, payload };
        } catch (e) {
          return {
            repoPath,
            registryName,
            payload: { error: e instanceof Error ? e.message : String(e) },
          };
        }
      }),
    );

    return {
      group: name,
      target: target || uid,
      service: servicePrefix,
      results,
    };
  }

  async groupQuery(params: Record<string, unknown>): Promise<unknown> {
    const name = String(params.name ?? '').trim();
    const queryText = String(params.query ?? '').trim();
    if (!name || !queryText) return { error: 'name and query are required' };
    if (
      params.service !== undefined &&
      params.service !== null &&
      String(params.service).trim() === ''
    ) {
      return { error: 'service must not be an empty string' };
    }
    const servicePrefix = normalizeServicePrefix(params.service);

    const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 5;
    const subgroup = typeof params.subgroup === 'string' ? params.subgroup : undefined;
    const subgroupExact = params.subgroupExact === true;
    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    let config: GroupConfig;
    try {
      config = await loadGroupConfig(groupDir);
    } catch (err) {
      if (err instanceof GroupNotFoundError)
        return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
      throw err;
    }

    const memberEntries = Object.entries(config.repos).filter(([repoPath]) =>
      repoInSubgroup(repoPath, subgroup, subgroupExact),
    );

    const perRepo = await Promise.all(
      memberEntries.map(async ([repoPath, registryName]) => {
        try {
          const repoObj = await this.port.resolveRepo(registryName);
          const queryResult = (await this.port.query(repoObj, {
            query: queryText,
            limit,
            max_symbols: 10,
            include_content: false,
          })) as {
            processes?: Array<Record<string, unknown>>;
            process_symbols?: Array<Record<string, unknown>>;
          };
          const processes = servicePrefix
            ? filterQueryByServicePrefix(queryResult, servicePrefix).processes
            : queryResult.processes || [];
          const scored = processes.map((p, idx) => ({
            ...p,
            _rrf_score: 1 / (idx + 1 + 60),
            _repo: repoPath,
          }));
          return { repo: repoPath, score: 0, processes: scored as unknown[] };
        } catch {
          return { repo: repoPath, score: 0, processes: [] as unknown[] };
        }
      }),
    );

    const allProcesses = perRepo.flatMap((r) => r.processes as Array<Record<string, unknown>>);
    allProcesses.sort((a, b) => (b._rrf_score as number) - (a._rrf_score as number));
    const topN = allProcesses.slice(0, limit);

    return {
      group: name,
      query: queryText,
      results: topN,
      per_repo: perRepo.map((r) => ({ repo: r.repo, count: r.processes.length })),
    };
  }

  async groupFeatureClusters(params: Record<string, unknown>): Promise<unknown> {
    const name = String(params.name ?? '').trim();
    if (!name) return { error: 'name is required' };
    const featureClusters = this.port.featureClusters;
    if (!featureClusters) return { error: 'feature cluster query is unavailable' };
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 100;
    const subgroup = typeof params.subgroup === 'string' ? params.subgroup : undefined;
    const subgroupExact = params.subgroupExact === true;
    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    let config: GroupConfig;
    try {
      config = await loadGroupConfig(groupDir);
    } catch (err) {
      if (err instanceof GroupNotFoundError)
        return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
      throw err;
    }

    const memberEntries = Object.entries(config.repos).filter(([repoPath]) =>
      repoInSubgroup(repoPath, subgroup, subgroupExact),
    );
    const registryResult = await loadContractRegistryResilient(groupDir);
    const registry = registryResult.ok ? registryResult.registry : null;
    const perRepo = await Promise.all(
      memberEntries.map(async ([repoPath, registryName]) => {
        try {
          const repoObj = await this.port.resolveRepo(registryName);
          const payload = (await featureClusters(repoObj, {
            query,
            limit,
          })) as { clusters?: Array<Record<string, unknown>>; error?: string };
          const clusters = (payload.clusters ?? []).map((cluster) => ({
            ...cluster,
            repoPath,
            registryName,
          }));
          return { repo: repoPath, registryName, clusters };
        } catch (e) {
          return {
            repo: repoPath,
            registryName,
            clusters: [],
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
    const clusters = perRepo
      .flatMap((entry) => entry.clusters)
      .sort((a, b) => Number(b.memberCount ?? 0) - Number(a.memberCount ?? 0))
      .slice(0, limit);
    const allClusters = perRepo.flatMap((entry) => entry.clusters);
    const crossRepoLinks = buildCrossRepoClusterLinks(registry, allClusters);
    const crossRepoClusters = aggregateCrossRepoFeatureClusters(allClusters, crossRepoLinks);

    return {
      group: name,
      query,
      clusters,
      cross_repo_clusters: crossRepoClusters,
      cross_repo_links: crossRepoLinks,
      ...(registryResult.ok === true && registryResult.skippedCorrupt > 0
        ? { skippedCorruptContracts: registryResult.skippedCorrupt }
        : {}),
      per_repo: perRepo.map((entry) => ({
        repo: entry.repo,
        registryName: entry.registryName,
        count: entry.clusters.length,
        ...(entry.error ? { error: entry.error } : {}),
      })),
    };
  }

  async groupFeatureContext(params: Record<string, unknown>): Promise<unknown> {
    const name = String(params.name ?? '').trim();
    const clusterName = String(params.cluster ?? params.target ?? params.feature ?? '').trim();
    if (!name || !clusterName) return { error: 'name and cluster are required' };
    const featureContext = this.port.featureContext;
    if (!featureContext) return { error: 'feature cluster context is unavailable' };
    const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 100;
    const subgroup = typeof params.subgroup === 'string' ? params.subgroup : undefined;
    const subgroupExact = params.subgroupExact === true;
    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    let config: GroupConfig;
    try {
      config = await loadGroupConfig(groupDir);
    } catch (err) {
      if (err instanceof GroupNotFoundError)
        return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
      throw err;
    }

    const memberEntries = Object.entries(config.repos).filter(([repoPath]) =>
      repoInSubgroup(repoPath, subgroup, subgroupExact),
    );
    const registryResult = await loadContractRegistryResilient(groupDir);
    const registry = registryResult.ok ? registryResult.registry : null;
    const results = await Promise.all(
      memberEntries.map(async ([repoPath, registryName]) => {
        try {
          const repoObj = await this.port.resolveRepo(registryName);
          const payload = await featureContext(repoObj, {
            name: clusterName,
            limit,
          });
          return { repoPath, registryName, payload };
        } catch (e) {
          return {
            repoPath,
            registryName,
            payload: { error: e instanceof Error ? e.message : String(e) },
          };
        }
      }),
    );
    const contexts = results.filter((result) => !(result.payload as { error?: string })?.error);
    const memberIdsByRepo = new Map<string, Set<string>>();
    for (const result of contexts) {
      const payload = result.payload as { members?: Array<{ id?: string }> };
      memberIdsByRepo.set(
        result.repoPath,
        new Set((payload.members ?? []).map((member) => String(member.id || '')).filter(Boolean)),
      );
    }
    const crossRepoLinks = (registry?.crossLinks ?? [])
      .filter((link) => {
        const fromIds = memberIdsByRepo.get(link.from.repo);
        const toIds = memberIdsByRepo.get(link.to.repo);
        return fromIds?.has(link.from.symbolUid) || toIds?.has(link.to.symbolUid);
      })
      .map((link) => ({
        sourceRepo: link.from.repo,
        sourceService: link.from.service,
        targetRepo: link.to.repo,
        targetService: link.to.service,
        contractName: link.contractId,
        relationship: 'shared-contract' as const,
        confidence: link.confidence,
        evidence: [
          `${link.type}:${link.contractId}`,
          `${link.from.symbolRef.filePath} -> ${link.to.symbolRef.filePath}`,
          `match:${link.matchType}`,
        ],
      }));

    return {
      group: name,
      cluster: clusterName,
      results: contexts,
      cross_repo_links: crossRepoLinks,
      ...(registryResult.ok === true && registryResult.skippedCorrupt > 0
        ? { skippedCorruptContracts: registryResult.skippedCorrupt }
        : {}),
      errors: results
        .filter((result) => (result.payload as { error?: string })?.error)
        .map((result) => ({
          repoPath: result.repoPath,
          registryName: result.registryName,
          error: (result.payload as { error?: string }).error,
        })),
    };
  }

  async groupFeatureImpact(params: Record<string, unknown>): Promise<unknown> {
    const name = String(params.name ?? '').trim();
    const clusterName = String(params.cluster ?? params.target ?? params.feature ?? '').trim();
    if (!name || !clusterName) return { error: 'name and cluster are required' };
    const featureImpact = this.port.featureImpact;
    if (!featureImpact) return { error: 'feature cluster impact is unavailable' };
    const direction =
      params.direction === 'downstream' || params.direction === 'both'
        ? params.direction
        : 'upstream';
    const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 100;
    const subgroup = typeof params.subgroup === 'string' ? params.subgroup : undefined;
    const subgroupExact = params.subgroupExact === true;
    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    let config: GroupConfig;
    try {
      config = await loadGroupConfig(groupDir);
    } catch (err) {
      if (err instanceof GroupNotFoundError)
        return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
      throw err;
    }

    const memberEntries = Object.entries(config.repos).filter(([repoPath]) =>
      repoInSubgroup(repoPath, subgroup, subgroupExact),
    );
    const registryResult = await loadContractRegistryResilient(groupDir);
    const registry = registryResult.ok ? registryResult.registry : null;
    const results = await Promise.all(
      memberEntries.map(async ([repoPath, registryName]) => {
        try {
          const repoObj = await this.port.resolveRepo(registryName);
          const payload = await featureImpact(repoObj, {
            name: clusterName,
            direction,
            limit,
          });
          return { repoPath, registryName, payload };
        } catch (e) {
          return {
            repoPath,
            registryName,
            payload: { error: e instanceof Error ? e.message : String(e) },
          };
        }
      }),
    );
    const successfulResults = results.filter(
      (result) => !(result.payload as { error?: string })?.error,
    );
    const memberIdsByRepo = new Map<string, Set<string>>();
    for (const result of successfulResults) {
      const payload = result.payload as {
        contextPack?: { members?: Array<{ id?: string }> };
      };
      memberIdsByRepo.set(
        result.repoPath,
        new Set(
          (payload.contextPack?.members ?? [])
            .map((member) => String(member.id || ''))
            .filter(Boolean),
        ),
      );
    }
    const crossRepoLinks = (registry?.crossLinks ?? [])
      .filter((link) => {
        const fromIds = memberIdsByRepo.get(link.from.repo);
        const toIds = memberIdsByRepo.get(link.to.repo);
        return fromIds?.has(link.from.symbolUid) || toIds?.has(link.to.symbolUid);
      })
      .map((link) => ({
        sourceRepo: link.from.repo,
        sourceService: link.from.service,
        targetRepo: link.to.repo,
        targetService: link.to.service,
        contractName: link.contractId,
        relationship: 'shared-contract' as const,
        confidence: link.confidence,
        evidence: [
          `${link.type}:${link.contractId}`,
          `${link.from.symbolRef.filePath} -> ${link.to.symbolRef.filePath}`,
          `match:${link.matchType}`,
        ],
      }));

    return {
      group: name,
      cluster: clusterName,
      direction,
      results: successfulResults,
      cross_repo_links: crossRepoLinks,
      summary: {
        repos: successfulResults.length,
        crossRepoLinks: crossRepoLinks.length,
      },
      ...(registryResult.ok === true && registryResult.skippedCorrupt > 0
        ? { skippedCorruptContracts: registryResult.skippedCorrupt }
        : {}),
      errors: results
        .filter((result) => (result.payload as { error?: string })?.error)
        .map((result) => ({
          repoPath: result.repoPath,
          registryName: result.registryName,
          error: (result.payload as { error?: string }).error,
        })),
    };
  }

  async groupStatus(params: Record<string, unknown>): Promise<unknown> {
    const name = String(params.name ?? '').trim();
    if (!name) return { error: 'name is required' };
    const groupDir = getGroupDir(getDefaultCodragraphDir(), name);
    let config: GroupConfig;
    try {
      config = await loadGroupConfig(groupDir);
    } catch (err) {
      if (err instanceof GroupNotFoundError)
        return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
      throw err;
    }
    const registry = await readContractRegistry(groupDir);

    const repoStatuses: Record<
      string,
      {
        indexStale: boolean;
        contractsStale: boolean;
        missing: boolean;
        commitsBehind?: number;
      }
    > = {};

    for (const [repoPath, registryName] of Object.entries(config.repos)) {
      try {
        const repoObj = await this.port.resolveRepo(registryName);
        const metaPath = path.join(repoObj.storagePath, 'meta.json');
        const metaRaw = await fsp.readFile(metaPath, 'utf-8').catch(() => '{}');
        const meta = JSON.parse(metaRaw) as { lastCommit?: string; indexedAt?: string };

        const staleness = meta.lastCommit
          ? checkStaleness(repoObj.repoPath, meta.lastCommit)
          : { isStale: true, commitsBehind: -1 };

        const snapshot = registry?.repoSnapshots[repoPath];
        const contractsStale =
          snapshot && meta.indexedAt ? snapshot.indexedAt !== meta.indexedAt : !snapshot;

        repoStatuses[repoPath] = {
          indexStale: staleness.isStale,
          contractsStale: Boolean(contractsStale),
          missing: false,
          commitsBehind: staleness.commitsBehind,
        };
      } catch {
        repoStatuses[repoPath] = { indexStale: false, contractsStale: false, missing: true };
      }
    }

    return {
      group: name,
      lastSync: registry?.generatedAt || null,
      missingRepos: registry?.missingRepos || [],
      repos: repoStatuses,
    };
  }
}
