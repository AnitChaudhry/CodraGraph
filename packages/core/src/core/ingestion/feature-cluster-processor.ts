/**
 * Feature Cluster Processor
 *
 * Builds a stable, human-facing feature layer over the raw code graph.
 * Communities are graph-algorithm clusters; FeatureCluster nodes are
 * product/domain clusters such as Settings, AI, Auth, Billing, MCP, or
 * Ingestion. Agents can query this layer first to land directly on the
 * files, symbols, and line ranges that matter for a task.
 */

import type {
  FeatureClusterKind,
  FeatureClusterSignal,
  GraphNode,
  NodeLabel,
  RelationshipType,
} from '@codragraph/shared';
import { KnowledgeGraph } from '../graph/types.js';
import { generateId } from '../../lib/utils.js';

export interface FeatureClusterNode {
  id: string;
  name: string;
  slug: string;
  featureKind: FeatureClusterKind;
  summary: string;
  description: string;
  repo?: string;
  service?: string;
  signals: string[];
  memberCount: number;
  entryPointIds: string[];
  routes: string[];
  tools: string[];
  testCoverageHints: string[];
  lastIndexedCommit?: string;
  confidence: number;
  memberIds: string[];
}

export interface FeatureClusterMembership {
  nodeId: string;
  clusterId: string;
  confidence: number;
  signals: string[];
}

export interface FeatureClusterDependency {
  sourceClusterId: string;
  targetClusterId: string;
  edgeCount: number;
  relationshipTypes: string[];
  confidence: number;
}

export interface FeatureClusterDetectionResult {
  clusters: FeatureClusterNode[];
  memberships: FeatureClusterMembership[];
  dependencies: FeatureClusterDependency[];
  stats: {
    totalClusters: number;
    totalMemberships: number;
    totalDependencies: number;
    nodesProcessed: number;
  };
}

export interface FeatureClusterConfig {
  minMembers: number;
  maxClusters: number;
  repo?: string;
  service?: string;
  lastIndexedCommit?: string;
}

const DEFAULT_CONFIG: FeatureClusterConfig = {
  minMembers: 2,
  maxClusters: 250,
};

const CLUSTERABLE_LABELS = new Set<NodeLabel>([
  'File',
  'Function',
  'Class',
  'Interface',
  'Method',
  'CodeElement',
  'Section',
  'Route',
  'Tool',
  'Process',
  'Struct',
  'Enum',
  'Macro',
  'Typedef',
  'Union',
  'Namespace',
  'Trait',
  'Impl',
  'TypeAlias',
  'Const',
  'Static',
  'Variable',
  'Property',
  'Record',
  'Delegate',
  'Annotation',
  'Constructor',
  'Template',
  'Module',
]);

const DEPENDENCY_REL_TYPES = new Set<RelationshipType>([
  'CALLS',
  'IMPORTS',
  'EXTENDS',
  'IMPLEMENTS',
  'METHOD_OVERRIDES',
  'METHOD_IMPLEMENTS',
  'FETCHES',
  'HANDLES_ROUTE',
  'HANDLES_TOOL',
  'ENTRY_POINT_OF',
  'WRAPS',
  'QUERIES',
]);

const GENERIC_SEGMENTS = new Set([
  'src',
  'source',
  'lib',
  'libs',
  'app',
  'apps',
  'page',
  'pages',
  'component',
  'components',
  'container',
  'containers',
  'hook',
  'hooks',
  'service',
  'services',
  'util',
  'utils',
  'utility',
  'utilities',
  'helper',
  'helpers',
  'shared',
  'common',
  'core',
  'package',
  'packages',
  'module',
  'modules',
  'feature',
  'features',
  'domain',
  'domains',
  'route',
  'routes',
  'api',
  'server',
  'client',
  'web',
  'test',
  'tests',
  'testing',
  '__tests__',
  '__mocks__',
  'fixture',
  'fixtures',
  'type',
  'types',
  'model',
  'models',
  'schema',
  'schemas',
  'index',
  'main',
  'entry',
  'handler',
  'handlers',
  'controller',
  'controllers',
  'provider',
  'providers',
  'adapter',
  'adapters',
  'dist',
  'build',
  'node_modules',
]);

const FEATURE_MARKERS = new Set([
  'features',
  'feature',
  'domains',
  'domain',
  'modules',
  'module',
  'pages',
  'page',
  'app',
  'apps',
  'routes',
  'route',
]);

const FEATURE_KEYWORDS = new Set([
  'ai',
  'agent',
  'agents',
  'auth',
  'billing',
  'chat',
  'dashboard',
  'embedding',
  'embeddings',
  'graph',
  'graphstore',
  'groups',
  'harness',
  'history',
  'ingestion',
  'mcp',
  'pipeline',
  'projects',
  'recipes',
  'search',
  'settings',
  'sync',
  'tools',
  'wiki',
]);

const ACRONYMS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  cli: 'CLI',
  db: 'DB',
  fts: 'FTS',
  grpc: 'gRPC',
  http: 'HTTP',
  llm: 'LLM',
  mcp: 'MCP',
  orm: 'ORM',
  sdk: 'SDK',
  sql: 'SQL',
  ui: 'UI',
  ux: 'UX',
};

interface CandidateSignal extends FeatureClusterSignal {
  slug: string;
}

interface MemberCandidate {
  node: GraphNode;
  slug: string;
  confidence: number;
  signals: string[];
}

interface ClusterAccumulator {
  slug: string;
  signals: Map<string, FeatureClusterSignal>;
  members: MemberCandidate[];
  entryPointIds: Set<string>;
  totalConfidence: number;
  featureKind: FeatureClusterKind;
}

interface DependencyAccumulator {
  sourceClusterId: string;
  targetClusterId: string;
  edgeCount: number;
  relationshipTypes: Set<string>;
  confidenceSum: number;
}

export const processFeatureClusters = async (
  knowledgeGraph: KnowledgeGraph,
  onProgress?: (message: string, progress: number) => void,
  config: Partial<FeatureClusterConfig> = {},
): Promise<FeatureClusterDetectionResult> => {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  onProgress?.('Collecting feature signals...', 0);

  const candidates: MemberCandidate[] = [];
  for (const node of knowledgeGraph.iterNodes()) {
    if (!CLUSTERABLE_LABELS.has(node.label)) continue;
    const signals = collectSignals(node);
    if (signals.length === 0) continue;

    const best = pickBestSignal(signals);
    candidates.push({
      node,
      slug: best.slug,
      confidence: confidenceFromWeight(best.weight),
      signals: signals
        .slice(0, 5)
        .map((s) => `${s.kind}:${s.value}`)
        .filter((s, idx, arr) => arr.indexOf(s) === idx),
    });
  }

  onProgress?.(`Collected feature signals for ${candidates.length} graph nodes...`, 25);

  const clusterMap = new Map<string, ClusterAccumulator>();
  for (const candidate of candidates) {
    let acc = clusterMap.get(candidate.slug);
    if (!acc) {
      acc = {
        slug: candidate.slug,
        signals: new Map(),
        members: [],
        entryPointIds: new Set(),
        totalConfidence: 0,
        featureKind: inferFeatureKind(candidate.node, candidate.slug),
      };
      clusterMap.set(candidate.slug, acc);
    }

    acc.members.push(candidate);
    acc.totalConfidence += candidate.confidence;
    if (isEntryPoint(candidate.node)) {
      acc.entryPointIds.add(candidate.node.id);
    }

    for (const signalText of candidate.signals) {
      const [kind, ...valueParts] = signalText.split(':');
      const value = valueParts.join(':');
      const key = `${kind}:${value}`;
      const existing = acc.signals.get(key);
      if (existing) {
        acc.signals.set(key, { ...existing, weight: existing.weight + 1 });
      } else {
        acc.signals.set(key, {
          kind: kind as FeatureClusterSignal['kind'],
          value,
          weight: 1,
        });
      }
    }
  }

  const selectedAccumulators = [...clusterMap.values()]
    .filter((acc) => acc.members.length >= cfg.minMembers)
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, cfg.maxClusters);

  const selectedSlugs = new Set(selectedAccumulators.map((acc) => acc.slug));
  const clusterIdBySlug = new Map<string, string>();
  for (const acc of selectedAccumulators) {
    clusterIdBySlug.set(acc.slug, generateId('FeatureCluster', acc.slug));
  }

  const memberships: FeatureClusterMembership[] = [];
  const memberToCluster = new Map<string, string>();
  const clusters: FeatureClusterNode[] = [];

  for (const acc of selectedAccumulators) {
    const clusterId = clusterIdBySlug.get(acc.slug)!;
    const sortedSignals = [...acc.signals.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8)
      .map((s) => `${s.kind}:${s.value}`);
    const memberIds = acc.members.map((m) => m.node.id);

    for (const member of acc.members) {
      memberships.push({
        nodeId: member.node.id,
        clusterId,
        confidence: member.confidence,
        signals: member.signals,
      });
      memberToCluster.set(member.node.id, clusterId);
    }

    const name = formatClusterName(acc.slug);
    const routes = collectMemberNames(acc.members, 'Route').slice(0, 25);
    const tools = collectMemberNames(acc.members, 'Tool').slice(0, 25);
    const testMembers = acc.members.filter((m) => isTestNode(m.node));
    const docsMembers = acc.members.filter((m) => isDocsNode(m.node));
    const summaryParts = [
      `${name} feature cluster with ${acc.members.length} indexed member${acc.members.length === 1 ? '' : 's'}`,
    ];
    if (routes.length > 0)
      summaryParts.push(`${routes.length} route${routes.length === 1 ? '' : 's'}`);
    if (tools.length > 0) summaryParts.push(`${tools.length} tool${tools.length === 1 ? '' : 's'}`);
    if (docsMembers.length > 0) {
      summaryParts.push(`${docsMembers.length} doc member${docsMembers.length === 1 ? '' : 's'}`);
    }
    const summary = `${summaryParts.join(', ')}.`;
    const testCoverageHints =
      testMembers.length > 0
        ? [
            `${testMembers.length} test-related member${testMembers.length === 1 ? '' : 's'} detected.`,
            ...testMembers
              .slice(0, 5)
              .map((m) =>
                String(m.node.properties.filePath || m.node.properties.name || m.node.id),
              ),
          ]
        : ['No obvious test members detected in this feature cluster.'];
    const confidence = round(
      Math.min(0.98, acc.totalConfidence / Math.max(acc.members.length, 1)),
      3,
    );

    clusters.push({
      id: clusterId,
      name,
      slug: acc.slug,
      featureKind: acc.featureKind,
      summary,
      description: `${name} feature cluster inferred from code structure, routes, symbols, docs, tests, and process signals.`,
      repo: cfg.repo,
      service: cfg.service,
      signals: sortedSignals,
      memberCount: acc.members.length,
      entryPointIds: [...acc.entryPointIds].slice(0, 25),
      routes,
      tools,
      testCoverageHints,
      lastIndexedCommit: cfg.lastIndexedCommit,
      confidence,
      memberIds,
    });
  }

  onProgress?.(`Created ${clusters.length} feature clusters...`, 65);

  const dependencies = buildDependencies(knowledgeGraph, memberToCluster, selectedSlugs);

  onProgress?.('Feature clustering complete!', 100);

  return {
    clusters,
    memberships,
    dependencies,
    stats: {
      totalClusters: clusters.length,
      totalMemberships: memberships.length,
      totalDependencies: dependencies.length,
      nodesProcessed: candidates.length,
    },
  };
};

const collectSignals = (node: GraphNode): CandidateSignal[] => {
  const signals: CandidateSignal[] = [];
  const filePath = normalizePath(node.properties.filePath || '');
  const name = String(node.properties.name || '');

  if (node.label === 'Route') {
    signals.push(...routeSignals(name));
  }
  if (node.label === 'Tool') {
    signals.push(...nameSignals(name, 'tool', 1.2));
  }
  if (node.label === 'Process') {
    signals.push(...nameSignals(name, 'process', 0.9));
  }
  if (isTestNode(node)) {
    const testSlug = fallbackSlugFromPath(filePath) || normalizeSlug(name);
    if (isMeaningfulSlug(testSlug)) {
      signals.push({ kind: 'test', value: testSlug, slug: testSlug, weight: 1.1 });
    }
  }
  if (isDocsNode(node)) {
    const docsSlug = fallbackSlugFromPath(filePath) || normalizeSlug(name);
    if (isMeaningfulSlug(docsSlug)) {
      signals.push({ kind: 'docs', value: docsSlug, slug: docsSlug, weight: 1.0 });
    }
  }

  signals.push(...pathSignals(filePath));
  signals.push(...packageBoundarySignals(filePath));
  signals.push(...nameSignals(name, 'symbol', 0.45));

  if (signals.length === 0 && filePath) {
    const fallback = fallbackSlugFromPath(filePath);
    if (fallback) {
      signals.push({
        kind: 'path',
        value: fallback,
        slug: fallback,
        weight: 0.5,
      });
    }
  }

  return dedupeSignals(signals);
};

const pathSignals = (filePath: string): CandidateSignal[] => {
  if (!filePath) return [];
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length === 0) return [];

  const signals: CandidateSignal[] = [];
  const dirParts = parts.slice(0, -1);
  for (let i = 0; i < dirParts.length; i++) {
    const slug = normalizeSlug(dirParts[i]);
    if (!isMeaningfulSlug(slug)) continue;

    const previous = i > 0 ? normalizeSlug(dirParts[i - 1]) : '';
    const markerBoost = FEATURE_MARKERS.has(previous) ? 1.2 : 0;
    const keywordBoost = FEATURE_KEYWORDS.has(slug) ? 0.8 : 0;
    signals.push({
      kind: 'path',
      value: slug,
      slug,
      weight: 2.0 + markerBoost + keywordBoost + i / Math.max(dirParts.length, 1),
    });
  }

  const fileName = parts[parts.length - 1] || '';
  const stem = fileName.replace(/\.[^.]+$/, '');
  for (const token of splitIdentifier(stem)) {
    const slug = normalizeSlug(token);
    if (!isMeaningfulSlug(slug)) continue;
    signals.push({
      kind: 'path',
      value: slug,
      slug,
      weight: FEATURE_KEYWORDS.has(slug) ? 1.6 : 0.75,
    });
  }

  return signals;
};

const packageBoundarySignals = (filePath: string): CandidateSignal[] => {
  if (!filePath) return [];
  const parts = filePath.split('/').filter(Boolean);
  const signals: CandidateSignal[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const marker = normalizeSlug(parts[i]);
    if (marker !== 'packages' && marker !== 'apps' && marker !== 'services') continue;
    const slug = normalizeSlug(parts[i + 1] || '');
    if (!isMeaningfulSlug(slug)) continue;
    signals.push({
      kind: 'package',
      value: `${marker}/${slug}`,
      slug,
      weight: 0.65,
    });
  }
  return signals;
};

const nameSignals = (
  name: string,
  kind: FeatureClusterSignal['kind'],
  baseWeight: number,
): CandidateSignal[] => {
  if (!name) return [];
  return splitIdentifier(name)
    .map((token) => normalizeSlug(token))
    .filter(isMeaningfulSlug)
    .map((slug) => ({
      kind,
      value: slug,
      slug,
      weight: baseWeight + (FEATURE_KEYWORDS.has(slug) ? 0.8 : 0),
    }));
};

const routeSignals = (routeName: string): CandidateSignal[] => {
  const routeParts = routeName
    .split(/[/?#]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !p.startsWith(':') && !p.startsWith('['));
  const firstMeaningful = routeParts
    .map((p) => normalizeSlug(p))
    .find((slug) => isMeaningfulSlug(slug));
  if (!firstMeaningful) return [];
  return [
    {
      kind: 'route',
      value: firstMeaningful,
      slug: firstMeaningful,
      weight: 4.5,
    },
  ];
};

const pickBestSignal = (signals: CandidateSignal[]): CandidateSignal => {
  const scored = new Map<string, CandidateSignal>();
  for (const signal of signals) {
    const existing = scored.get(signal.slug);
    if (!existing) {
      scored.set(signal.slug, signal);
    } else {
      scored.set(signal.slug, {
        ...existing,
        weight: existing.weight + signal.weight,
      });
    }
  }
  return [...scored.values()].sort((a, b) => b.weight - a.weight)[0]!;
};

const buildDependencies = (
  graph: KnowledgeGraph,
  memberToCluster: Map<string, string>,
  selectedSlugs: Set<string>,
): FeatureClusterDependency[] => {
  const byPair = new Map<string, DependencyAccumulator>();

  for (const rel of graph.iterRelationships()) {
    if (!DEPENDENCY_REL_TYPES.has(rel.type)) continue;

    const sourceClusterId = memberToCluster.get(rel.sourceId);
    const targetClusterId = memberToCluster.get(rel.targetId);
    if (!sourceClusterId || !targetClusterId || sourceClusterId === targetClusterId) continue;

    const sourceSlug = sourceClusterId.split(':').slice(1).join(':');
    const targetSlug = targetClusterId.split(':').slice(1).join(':');
    if (!selectedSlugs.has(sourceSlug) || !selectedSlugs.has(targetSlug)) continue;

    const key = `${sourceClusterId}->${targetClusterId}`;
    let acc = byPair.get(key);
    if (!acc) {
      acc = {
        sourceClusterId,
        targetClusterId,
        edgeCount: 0,
        relationshipTypes: new Set(),
        confidenceSum: 0,
      };
      byPair.set(key, acc);
    }
    acc.edgeCount++;
    acc.relationshipTypes.add(rel.type);
    acc.confidenceSum += rel.confidence ?? 1;
  }

  return [...byPair.values()]
    .map((acc) => ({
      sourceClusterId: acc.sourceClusterId,
      targetClusterId: acc.targetClusterId,
      edgeCount: acc.edgeCount,
      relationshipTypes: [...acc.relationshipTypes].sort(),
      confidence: round(acc.confidenceSum / Math.max(acc.edgeCount, 1), 3),
    }))
    .sort((a, b) => b.edgeCount - a.edgeCount);
};

const isEntryPoint = (node: GraphNode): boolean => {
  if (node.label === 'Route' || node.label === 'Tool') return true;
  if (node.properties.isExported) return true;
  const name = String(node.properties.name || '');
  return /^(handle|on|use|run|execute|create|update|delete|get|post|put|patch|main)/i.test(name);
};

const isTestNode = (node: GraphNode): boolean => {
  const filePath = normalizePath(node.properties.filePath || '');
  return (
    filePath.includes('/test/') ||
    filePath.includes('/tests/') ||
    filePath.includes('__tests__') ||
    filePath.includes('__mocks__') ||
    /\.(test|spec)\.[jt]sx?$/.test(filePath)
  );
};

const isDocsNode = (node: GraphNode): boolean => {
  const filePath = normalizePath(node.properties.filePath || '');
  return node.label === 'Section' || filePath.includes('/docs/') || /\.mdx?$/.test(filePath);
};

const collectMemberNames = (members: MemberCandidate[], label: NodeLabel): string[] => {
  const names = new Set<string>();
  for (const member of members) {
    if (member.node.label !== label) continue;
    const name = String(member.node.properties.name || member.node.id);
    if (name) names.add(name);
  }
  return [...names].sort();
};

const inferFeatureKind = (node: GraphNode, slug: string): FeatureClusterKind => {
  const pathValue = normalizePath(node.properties.filePath || '');
  if (node.label === 'Route' || pathValue.includes('/routes/') || pathValue.includes('/api/')) {
    return 'api';
  }
  if (node.label === 'Tool' || slug === 'cli' || slug === 'mcp') return 'tooling';
  if (pathValue.includes('/pages/') || pathValue.includes('/app/')) return 'page';
  if (
    pathValue.includes('/test/') ||
    pathValue.includes('/tests/') ||
    pathValue.includes('__tests__')
  ) {
    return 'test';
  }
  if (pathValue.includes('/docs/') || pathValue.endsWith('.md')) return 'docs';
  if (['config', 'build', 'ci', 'deploy', 'infra'].includes(slug)) return 'infrastructure';
  if (['schema', 'model', 'data', 'database', 'sql', 'orm'].includes(slug)) return 'data';
  if (['auth', 'billing', 'settings', 'projects', 'recipes', 'dashboard'].includes(slug)) {
    return 'domain';
  }
  return 'feature';
};

const confidenceFromWeight = (weight: number): number => {
  return round(Math.min(0.98, 0.5 + Math.min(weight, 5) / 10), 3);
};

const normalizePath = (filePath: string): string => filePath.replace(/\\/g, '/').toLowerCase();

const normalizeSlug = (value: string): string => {
  const clean = value
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean;
};

const isMeaningfulSlug = (slug: string): boolean => {
  return slug.length >= 2 && !GENERIC_SEGMENTS.has(slug) && !/^\d+$/.test(slug);
};

const splitIdentifier = (value: string): string[] => {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const fallbackSlugFromPath = (filePath: string): string | null => {
  const parts = filePath.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const slug = normalizeSlug(parts[i]);
    if (isMeaningfulSlug(slug)) return slug;
  }
  return null;
};

const dedupeSignals = (signals: CandidateSignal[]): CandidateSignal[] => {
  const byKey = new Map<string, CandidateSignal>();
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.slug}`;
    const existing = byKey.get(key);
    if (!existing || existing.weight < signal.weight) {
      byKey.set(key, signal);
    }
  }
  return [...byKey.values()].sort((a, b) => b.weight - a.weight);
};

const formatClusterName = (slug: string): string => {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => ACRONYMS[part] || part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
