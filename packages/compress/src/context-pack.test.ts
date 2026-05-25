import { describe, expect, it } from 'vitest';
import { compressContextPack } from './index.js';
import type { Compressor, CompressOptions } from './types.js';

describe('compressContextPack', () => {
  it('serializes a feature context pack and preserves compressor metadata', async () => {
    const compressor: Compressor = {
      name: 'fake',
      async compress(text: string, _options?: CompressOptions) {
        return {
          compressed: `compressed:${text.slice(0, 8)}`,
          originalTokens: 100,
          compressedTokens: 40,
          reduction: 0.6,
        };
      },
      async decompress(text: string) {
        return {
          decompressed: text,
          compressedTokens: 40,
          decompressedTokens: 100,
          expansion: 2.5,
        };
      },
    };
    const inference = {
      name: 'fake',
      async complete() {
        return { content: '', tokens: { input: 0, output: 0, total: 0 } };
      },
    };

    const result = await compressContextPack(
      compressor,
      {
        cluster: {
          id: 'FeatureCluster:settings',
          name: 'Settings',
          slug: 'settings',
          featureKind: 'domain',
          summary: 'Settings feature cluster.',
          description: 'Controls provider settings.',
          signals: ['path:settings'],
          memberCount: 1,
          entryPointIds: [],
          routes: [],
          tools: [],
          testCoverageHints: [],
          confidence: 0.9,
          source: 'heuristic',
        },
        members: [
          {
            id: 'fn:settings',
            name: 'SettingsPanel',
            filePath: 'src/features/settings/SettingsPanel.tsx',
            startLine: 10,
            confidence: 0.9,
            signals: ['path:settings'],
          },
        ],
        dependencies: { incoming: [], outgoing: [] },
      },
      { inference, level: 'balanced', format: 'outline' },
    );

    expect(result.clusterName).toBe('Settings');
    expect(result.contextPackText).toContain('cluster: Settings');
    expect(result.contextPackText).toContain('SettingsPanel');
    expect(result.compressed).toBe('compressed:cluster:');
    expect(result.reduction).toBe(0.6);
  });
});
