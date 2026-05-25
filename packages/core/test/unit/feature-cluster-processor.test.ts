import { describe, expect, it } from 'vitest';
import type { GraphNode, GraphRelationship, NodeLabel, RelationshipType } from '@codragraph/shared';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import { processFeatureClusters } from '../../src/core/ingestion/feature-cluster-processor.js';

const makeNode = (
  id: string,
  label: NodeLabel,
  name: string,
  filePath: string,
  startLine = 1,
): GraphNode => ({
  id,
  label,
  properties: {
    name,
    filePath,
    startLine,
    endLine: startLine + 5,
  },
});

const makeRel = (
  id: string,
  sourceId: string,
  targetId: string,
  type: RelationshipType = 'CALLS',
): GraphRelationship => ({
  id,
  sourceId,
  targetId,
  type,
  confidence: 1,
  reason: 'test',
});

describe('processFeatureClusters', () => {
  it('groups code into human-facing feature clusters from path and symbol signals', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode(
      makeNode(
        'file:settings',
        'File',
        'SettingsPage.tsx',
        'src/features/settings/SettingsPage.tsx',
      ),
    );
    graph.addNode(
      makeNode('fn:settings', 'Function', 'SettingsPage', 'src/features/settings/SettingsPage.tsx'),
    );
    graph.addNode(makeNode('file:ai', 'File', 'AiPanel.tsx', 'src/features/ai/AiPanel.tsx'));
    graph.addNode(makeNode('fn:ai', 'Function', 'AiPanel', 'src/features/ai/AiPanel.tsx'));
    graph.addRelationship(makeRel('rel:settings-ai', 'fn:settings', 'fn:ai'));

    const result = await processFeatureClusters(graph, undefined, { minMembers: 2 });

    const settings = result.clusters.find((cluster) => cluster.slug === 'settings');
    const ai = result.clusters.find((cluster) => cluster.slug === 'ai');

    expect(settings).toBeDefined();
    expect(settings?.name).toBe('Settings');
    expect(settings?.memberCount).toBe(2);
    expect(ai).toBeDefined();
    expect(ai?.name).toBe('AI');
    expect(ai?.memberCount).toBe(2);
    expect(result.memberships.filter((m) => m.clusterId === settings?.id)).toHaveLength(2);
    expect(result.memberships.filter((m) => m.clusterId === ai?.id)).toHaveLength(2);

    expect(result.dependencies).toContainEqual(
      expect.objectContaining({
        sourceClusterId: settings?.id,
        targetClusterId: ai?.id,
        edgeCount: 1,
        relationshipTypes: ['CALLS'],
      }),
    );
  });

  it('ignores singleton areas below the configured member threshold', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode(makeNode('fn:auth', 'Function', 'loginUser', 'src/features/auth/login.ts'));

    const result = await processFeatureClusters(graph, undefined, { minMembers: 2 });

    expect(result.clusters).toEqual([]);
    expect(result.memberships).toEqual([]);
    expect(result.dependencies).toEqual([]);
  });

  it('does not create fallback clusters from generic file names', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode(makeNode('file:index', 'File', '', 'src/index.ts'));
    graph.addNode(makeNode('file:main', 'File', '', 'src/main.ts'));

    const result = await processFeatureClusters(graph, undefined, { minMembers: 1 });

    expect(result.clusters).toEqual([]);
    expect(result.memberships).toEqual([]);
  });

  it('stores repo and commit metadata on detected clusters', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode(
      makeNode(
        'file:settings',
        'File',
        'SettingsPage.tsx',
        'src/features/settings/SettingsPage.tsx',
      ),
    );
    graph.addNode(
      makeNode('fn:settings', 'Function', 'SettingsPage', 'src/features/settings/SettingsPage.tsx'),
    );

    const result = await processFeatureClusters(graph, undefined, {
      minMembers: 2,
      repo: 'codragraph-web',
      service: 'apps/web',
      lastIndexedCommit: 'abc123',
    });

    expect(result.clusters[0]).toMatchObject({
      repo: 'codragraph-web',
      service: 'apps/web',
      lastIndexedCommit: 'abc123',
    });
  });
});
