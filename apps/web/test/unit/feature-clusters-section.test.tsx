import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '@codragraph/shared';
import { FeatureClustersSection } from '../../src/components/dashboard/FeatureClustersSection';

const mockState = vi.hoisted(() => ({
  graph: null as any,
  setHighlightedNodeIds: vi.fn(),
  setSelectedNode: vi.fn(),
  openChatPanel: vi.fn(),
  sendChatMessage: vi.fn(async () => undefined),
}));

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => mockState,
}));

const graphNode = (
  id: string,
  label: GraphNode['label'],
  properties: GraphNode['properties'],
): GraphNode => ({ id, label, properties });

describe('FeatureClustersSection', () => {
  beforeEach(() => {
    mockState.graph = null;
    mockState.setHighlightedNodeIds.mockClear();
    mockState.setSelectedNode.mockClear();
    mockState.openChatPanel.mockClear();
    mockState.sendChatMessage.mockClear();
  });

  it('renders the empty state when no feature clusters exist', () => {
    mockState.graph = { nodes: [], relationships: [] };

    render(<FeatureClustersSection />);

    expect(screen.getByText('No Feature Clusters Detected')).toBeInTheDocument();
    expect(screen.getByText(/build the feature layer/i)).toBeInTheDocument();
  });

  it('renders feature members and highlights the selected feature context', () => {
    const settings = graphNode('feature:settings', 'FeatureCluster', {
      name: 'Settings',
      slug: 'settings',
      featureKind: 'page',
      memberCount: 2,
      confidence: 0.92,
    });
    const ai = graphNode('feature:ai', 'FeatureCluster', {
      name: 'AI Assistant',
      slug: 'ai-assistant',
      featureKind: 'feature',
      memberCount: 1,
      confidence: 0.81,
    });
    const saveSettings = graphNode('function:saveSettings', 'Function', {
      name: 'saveSettings',
      filePath: 'src/settings/save.ts',
      startLine: 12,
    });
    const settingsPage = graphNode('file:SettingsPage', 'File', {
      name: 'SettingsPage.tsx',
      filePath: 'src/settings/SettingsPage.tsx',
    });

    mockState.graph = {
      nodes: [settings, ai, saveSettings, settingsPage],
      relationships: [
        {
          id: 'rel:save-settings-feature',
          sourceId: saveSettings.id,
          targetId: settings.id,
          type: 'FEATURE_MEMBER_OF',
          properties: {},
        },
        {
          id: 'rel:settings-page-feature',
          sourceId: settingsPage.id,
          targetId: settings.id,
          type: 'FEATURE_MEMBER_OF',
          properties: {},
        },
        {
          id: 'rel:settings-ai',
          sourceId: settings.id,
          targetId: ai.id,
          type: 'FEATURE_DEPENDS_ON',
          properties: {},
        },
      ],
    };

    render(<FeatureClustersSection />);

    expect(screen.getByRole('heading', { name: 'Feature Clusters' })).toBeInTheDocument();
    expect(screen.getByText('saveSettings')).toBeInTheDocument();
    expect(screen.getByText('src/settings/save.ts')).toBeInTheDocument();
    expect(screen.getAllByText('Depends On')).toHaveLength(2);
    expect(screen.getAllByText('AI Assistant')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));

    expect(mockState.setSelectedNode).toHaveBeenCalledWith(settings);
    const highlighted = mockState.setHighlightedNodeIds.mock.calls.at(-1)?.[0] as Set<string>;
    expect([...highlighted].sort()).toEqual(
      [settings.id, ai.id, saveSettings.id, settingsPage.id].sort(),
    );
  });

  it('opens chat with a cluster context prompt', () => {
    const settings = graphNode('feature:settings', 'FeatureCluster', {
      name: 'Settings',
      slug: 'settings',
      featureKind: 'page',
      memberCount: 1,
      confidence: 0.92,
      summary: 'Settings feature cluster.',
    });
    const settingsPage = graphNode('file:SettingsPage', 'File', {
      name: 'SettingsPage.tsx',
      filePath: 'src/settings/SettingsPage.tsx',
    });

    mockState.graph = {
      nodes: [settings, settingsPage],
      relationships: [
        {
          id: 'rel:settings-page-feature',
          sourceId: settingsPage.id,
          targetId: settings.id,
          type: 'FEATURE_MEMBER_OF',
          properties: {},
        },
      ],
    };

    render(<FeatureClustersSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(mockState.openChatPanel).toHaveBeenCalled();
    expect(mockState.sendChatMessage).toHaveBeenCalledWith(
      expect.stringContaining('Settings feature cluster context pack'),
    );
  });
});
