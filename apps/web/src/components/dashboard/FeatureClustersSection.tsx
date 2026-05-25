import * as React from 'react';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Braces,
  Copy,
  FileCode,
  GitBranch,
  Layers,
  Send,
  Target,
} from '@/lib/lucide-icons';
import { useAppState } from '@/hooks/useAppState';
import { NODE_COLORS } from '@/lib/constants';
import type { GraphNode } from '@codragraph/shared';

interface FeatureClusterView {
  node: GraphNode;
  members: GraphNode[];
  outgoing: GraphNode[];
  incoming: GraphNode[];
}

const numberProp = (node: GraphNode, key: string): number => {
  const value = node.properties[key];
  return typeof value === 'number' ? value : 0;
};

const stringProp = (node: GraphNode, key: string): string => {
  const value = node.properties[key];
  return typeof value === 'string' ? value : '';
};

const arrayProp = (node: GraphNode, key: string): unknown[] => {
  const value = node.properties[key];
  return Array.isArray(value) ? value : [];
};

const clusterName = (node: GraphNode): string => {
  return node.properties.name || stringProp(node, 'slug') || node.id;
};

const filePathOf = (node: GraphNode): string => {
  const value = node.properties.filePath;
  return typeof value === 'string' ? value : '';
};

const isTestMember = (node: GraphNode): boolean => {
  const filePath = filePathOf(node).toLowerCase();
  return (
    filePath.includes('/test/') ||
    filePath.includes('/tests/') ||
    filePath.includes('__tests__') ||
    /\.(test|spec)\.[jt]sx?$/.test(filePath)
  );
};

const isDocsMember = (node: GraphNode): boolean => {
  const filePath = filePathOf(node).toLowerCase();
  return node.label === 'Section' || filePath.includes('/docs/') || /\.mdx?$/.test(filePath);
};

export const FeatureClustersSection = (): React.JSX.Element => {
  const { graph, setHighlightedNodeIds, setSelectedNode, openChatPanel, sendChatMessage } =
    useAppState();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graph?.nodes ?? []) map.set(node.id, node);
    return map;
  }, [graph]);

  const clusters = useMemo<FeatureClusterView[]>(() => {
    if (!graph) return [];
    const byCluster = new Map<string, FeatureClusterView>();

    for (const node of graph.nodes) {
      if (node.label !== 'FeatureCluster') continue;
      byCluster.set(node.id, { node, members: [], outgoing: [], incoming: [] });
    }

    for (const rel of graph.relationships) {
      if (rel.type === 'FEATURE_MEMBER_OF') {
        const cluster = byCluster.get(rel.targetId);
        const member = nodeById.get(rel.sourceId);
        if (cluster && member) cluster.members.push(member);
      }
      if (rel.type === 'FEATURE_DEPENDS_ON') {
        const source = byCluster.get(rel.sourceId);
        const target = nodeById.get(rel.targetId);
        if (source && target) source.outgoing.push(target);

        const targetCluster = byCluster.get(rel.targetId);
        const sourceNode = nodeById.get(rel.sourceId);
        if (targetCluster && sourceNode) targetCluster.incoming.push(sourceNode);
      }
    }

    return [...byCluster.values()].sort(
      (a, b) => numberProp(b.node, 'memberCount') - numberProp(a.node, 'memberCount'),
    );
  }, [graph, nodeById]);

  const active = clusters.find((cluster) => cluster.node.id === activeId) ?? clusters[0] ?? null;

  const focusCluster = (cluster: FeatureClusterView): void => {
    setActiveId(cluster.node.id);
    setSelectedNode(cluster.node);
    setHighlightedNodeIds(
      new Set([
        cluster.node.id,
        ...cluster.members.map((member) => member.id),
        ...cluster.outgoing.map((dep) => dep.id),
        ...cluster.incoming.map((dep) => dep.id),
      ]),
    );
  };

  const askAboutCluster = (cluster: FeatureClusterView): void => {
    openChatPanel();
    void sendChatMessage(
      `Use the ${clusterName(cluster.node)} feature cluster context pack. Explain the purpose, key files, entry points, tests, dependencies, and safest refactor path.`,
    );
  };

  const copyRefactorContext = async (cluster: FeatureClusterView): Promise<void> => {
    const context = buildRefactorContext(cluster);
    try {
      await navigator.clipboard?.writeText(context);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (!graph || clusters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <Layers className="mx-auto mb-3 h-7 w-7 text-text-muted" />
          <h2 className="text-base font-medium text-text-primary">No Feature Clusters Detected</h2>
          <p className="mt-1 max-w-md text-sm text-text-muted">
            Run analyze to build the feature layer for this repository.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border-subtle px-5 py-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-cyan-300" />
          <h2 className="text-lg font-semibold text-text-primary">Feature Clusters</h2>
          <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200">
            {clusters.length}
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(260px,360px)_1fr]">
        <aside className="max-h-64 min-h-0 overflow-y-auto border-b border-border-subtle lg:max-h-none lg:border-r lg:border-b-0">
          {clusters.map((cluster) => {
            const selected = active?.node.id === cluster.node.id;
            return (
              <button
                key={cluster.node.id}
                type="button"
                onClick={() => focusCluster(cluster)}
                className={`flex w-full items-center gap-3 border-b border-border-subtle px-4 py-3 text-left transition-colors hover:bg-hover ${
                  selected ? 'bg-cyan-500/10' : ''
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: NODE_COLORS.FeatureCluster }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">
                    {clusterName(cluster.node)}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {numberProp(cluster.node, 'memberCount') || cluster.members.length} members
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="min-h-0 overflow-y-auto px-5 py-4">
          {active && (
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-semibold text-text-primary">
                        {clusterName(active.node)}
                      </h3>
                      <span className="rounded bg-surface px-2 py-0.5 text-xs text-text-muted">
                        {stringProp(active.node, 'featureKind') || 'feature'}
                      </span>
                      <span className="rounded bg-surface px-2 py-0.5 text-xs text-text-muted">
                        {Math.round(numberProp(active.node, 'confidence') * 100)}%
                      </span>
                    </div>
                    {(stringProp(active.node, 'summary') ||
                      stringProp(active.node, 'description')) && (
                      <p className="mt-2 max-w-3xl text-sm text-text-secondary">
                        {stringProp(active.node, 'summary') ||
                          stringProp(active.node, 'description')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => askAboutCluster(active)}
                      className="inline-flex items-center gap-2 rounded border border-border-subtle px-3 py-2 text-sm text-text-primary hover:bg-hover"
                    >
                      <Send className="h-4 w-4" />
                      Ask
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyRefactorContext(active)}
                      className="inline-flex items-center gap-2 rounded border border-border-subtle px-3 py-2 text-sm text-text-primary hover:bg-hover"
                    >
                      <Copy className="h-4 w-4" />
                      {copied ? 'Copied' : 'Refactor Context'}
                    </button>
                  </div>
                </div>
              </div>

              <ClusterMap cluster={active} />
              <ClusterContextSummary cluster={active} />

              <div className="grid gap-3 lg:grid-cols-2">
                <DependencyList title="Depends On" icon="out" items={active.outgoing} />
                <DependencyList title="Used By" icon="in" items={active.incoming} />
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Target className="h-4 w-4 text-text-muted" />
                  <h4 className="text-sm font-medium text-text-primary">Members</h4>
                </div>
                <div className="overflow-hidden rounded border border-border-subtle">
                  {active.members.slice(0, 80).map((member) => (
                    <MemberRow key={member.id} node={member} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const DependencyList = ({
  title,
  icon,
  items,
}: {
  title: string;
  icon: 'in' | 'out';
  items: GraphNode[];
}): React.JSX.Element => (
  <div className="rounded border border-border-subtle">
    <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
      {icon === 'out' ? (
        <ArrowRight className="h-4 w-4 text-text-muted" />
      ) : (
        <Target className="h-4 w-4 text-text-muted" />
      )}
      <h4 className="text-sm font-medium text-text-primary">{title}</h4>
      <span className="ml-auto text-xs text-text-muted">{items.length}</span>
    </div>
    <div className="max-h-36 overflow-y-auto">
      {items.length === 0 ? (
        <div className="px-3 py-3 text-sm text-text-muted">None</div>
      ) : (
        items.slice(0, 20).map((item) => (
          <div key={item.id} className="border-b border-border-subtle px-3 py-2 last:border-b-0">
            <span className="block truncate text-sm text-text-secondary">{clusterName(item)}</span>
          </div>
        ))
      )}
    </div>
  </div>
);

const ClusterMap = ({ cluster }: { cluster: FeatureClusterView }): React.JSX.Element => {
  const crossRepoLinks = arrayProp(cluster.node, 'crossRepoLinks');
  return (
    <div className="rounded border border-border-subtle px-3 py-3">
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-text-muted" />
        <h4 className="text-sm font-medium text-text-primary">Cluster Map</h4>
        <span className="ml-auto text-xs text-text-muted">
          {cluster.incoming.length + cluster.outgoing.length + crossRepoLinks.length} links
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <MiniClusterColumn title="Used By" items={cluster.incoming} />
        <div className="flex min-w-36 items-center justify-center rounded border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-center text-sm font-medium text-cyan-100">
          {clusterName(cluster.node)}
        </div>
        <MiniClusterColumn title="Depends On" items={cluster.outgoing} />
      </div>
      {crossRepoLinks.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border-subtle pt-3">
          {crossRepoLinks.slice(0, 6).map((link, index) => (
            <div key={index} className="truncate text-xs text-text-secondary">
              {String((link as Record<string, unknown>).sourceRepo || '')}
              {' -> '}
              {String((link as Record<string, unknown>).targetRepo || '')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MiniClusterColumn = ({
  title,
  items,
}: {
  title: string;
  items: GraphNode[];
}): React.JSX.Element => (
  <div className="min-w-0">
    <div className="mb-2 text-xs font-medium text-text-muted uppercase">{title}</div>
    <div className="space-y-1">
      {items.length === 0 ? (
        <div className="rounded border border-border-subtle px-2 py-2 text-xs text-text-muted">
          None
        </div>
      ) : (
        items.slice(0, 5).map((item) => (
          <div
            key={item.id}
            className="truncate rounded border border-border-subtle px-2 py-2 text-xs text-text-secondary"
          >
            {clusterName(item)}
          </div>
        ))
      )}
    </div>
  </div>
);

const ClusterContextSummary = ({ cluster }: { cluster: FeatureClusterView }): React.JSX.Element => {
  const routes = cluster.members.filter((member) => member.label === 'Route');
  const tools = cluster.members.filter((member) => member.label === 'Tool');
  const tests = cluster.members.filter(isTestMember);
  const docs = cluster.members.filter(isDocsMember);
  const entryPointIds = new Set(arrayProp(cluster.node, 'entryPointIds').map(String));
  const entryPoints = cluster.members.filter(
    (member) => entryPointIds.has(member.id) || member.label === 'Route' || member.label === 'Tool',
  );
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <ContextStat label="Entry Points" value={entryPoints.length} />
      <ContextStat
        label="Routes"
        value={routes.length || arrayProp(cluster.node, 'routes').length}
      />
      <ContextStat label="Tools" value={tools.length || arrayProp(cluster.node, 'tools').length} />
      <ContextStat label="Tests" value={tests.length} />
      <ContextStat label="Docs" value={docs.length} />
    </div>
  );
};

const ContextStat = ({ label, value }: { label: string; value: number }): React.JSX.Element => (
  <div className="rounded border border-border-subtle px-3 py-2">
    <div className="text-xs text-text-muted">{label}</div>
    <div className="mt-1 text-lg font-semibold text-text-primary">{value}</div>
  </div>
);

const MemberRow = ({ node }: { node: GraphNode }): React.JSX.Element => {
  const isFile = node.label === 'File';
  const Icon = isFile ? FileCode : Braces;
  const startLine =
    typeof node.properties.startLine === 'number' && node.properties.startLine > 0
      ? node.properties.startLine
      : null;

  return (
    <div className="grid grid-cols-1 items-center gap-1 border-b border-border-subtle px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(160px,1.2fr)_90px_minmax(180px,2fr)_80px] sm:gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-text-muted" />
        <span className="truncate text-sm text-text-primary">{node.properties.name}</span>
      </div>
      <span className="text-xs text-text-muted">{node.label}</span>
      <span className="truncate font-mono text-xs text-text-muted">{node.properties.filePath}</span>
      <span className="text-right font-mono text-xs text-text-muted">
        {startLine ? `L${startLine}` : ''}
      </span>
    </div>
  );
};

function buildRefactorContext(cluster: FeatureClusterView): string {
  const lines: string[] = [];
  lines.push(`Feature cluster: ${clusterName(cluster.node)}`);
  lines.push(`Kind: ${stringProp(cluster.node, 'featureKind') || 'feature'}`);
  const summary = stringProp(cluster.node, 'summary') || stringProp(cluster.node, 'description');
  if (summary) lines.push(`Purpose: ${summary}`);
  lines.push('');
  lines.push('Relevant files and symbols:');
  for (const member of cluster.members.slice(0, 80)) {
    const filePath = filePathOf(member);
    const startLine =
      typeof member.properties.startLine === 'number' ? `:${member.properties.startLine}` : '';
    lines.push(`- ${member.label} ${member.properties.name} ${filePath}${startLine}`.trim());
  }
  lines.push('');
  lines.push(
    `Depends on: ${cluster.outgoing.map((node) => clusterName(node)).join(', ') || 'None'}`,
  );
  lines.push(`Used by: ${cluster.incoming.map((node) => clusterName(node)).join(', ') || 'None'}`);
  return lines.join('\n');
}
