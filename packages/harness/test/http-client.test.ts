import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpGraphClient } from '../src/graph/http-client.js';

describe('HttpGraphClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('queries feature clusters through the serve HTTP API', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        requests.push(String(url));
        return jsonResponse({
          clusters: [
            {
              id: 'FeatureCluster:settings',
              name: 'Settings',
              slug: 'settings',
              memberCount: 12,
              signals: ['path:settings'],
            },
          ],
        });
      }),
    );

    const client = new HttpGraphClient({ baseURL: 'http://localhost:4747/' });
    const result = await client.featureClusters({
      repo: 'codragraph-web',
      limit: 5,
      query: 'settings',
    });

    expect(requests).toEqual([
      'http://localhost:4747/api/feature-clusters?repo=codragraph-web&limit=5&query=settings',
    ]);
    expect(result.clusters).toEqual([
      expect.objectContaining({
        id: 'FeatureCluster:settings',
        name: 'Settings',
        slug: 'settings',
        memberCount: 12,
        signals: ['path:settings'],
      }),
    ]);
  });

  it('uses CODRAGRAPH_URL when baseURL is omitted', async () => {
    const requests: string[] = [];
    vi.stubEnv('CODRAGRAPH_URL', 'http://codragraph.local:4747/');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        requests.push(String(url));
        return jsonResponse({ clusters: [] });
      }),
    );

    const client = new HttpGraphClient();
    await client.featureClusters();

    expect(requests).toEqual(['http://codragraph.local:4747/api/feature-clusters']);
  });

  it('maps feature context packs from HTTP responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          cluster: { id: 'FeatureCluster:ai', name: 'AI', slug: 'ai' },
          members: [
            {
              id: 'Function:chat',
              name: 'chat',
              type: 'Function',
              filePath: 'src/ai/chat.ts',
              startLine: 10,
            },
          ],
          dependencies: {
            incoming: [{ id: 'FeatureCluster:settings', name: 'Settings' }],
            outgoing: [],
          },
          safeEditSurface: {
            files: ['src/ai/chat.ts'],
            symbols: ['chat'],
            warnings: [],
          },
        }),
      ),
    );

    const client = new HttpGraphClient({ baseURL: 'http://localhost:4747' });
    const result = await client.contextPack({ name: 'AI', repo: 'demo', limit: 25 });

    expect(result.cluster.name).toBe('AI');
    expect(result.members[0]).toEqual(
      expect.objectContaining({
        name: 'chat',
        file: 'src/ai/chat.ts',
        startLine: 10,
      }),
    );
    expect(result.dependencies.incoming[0]?.name).toBe('Settings');
    expect(result.safeEditSurface?.files).toEqual(['src/ai/chat.ts']);
  });

  it('queries feature cluster impact through the HTTP API', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        requests.push(String(url));
        return jsonResponse({
          cluster: { id: 'FeatureCluster:settings', name: 'Settings', slug: 'settings' },
          direction: 'both',
          impactedClusters: [{ id: 'FeatureCluster:ai', name: 'AI', slug: 'ai' }],
          impactSummary: {
            affectedMembers: 8,
            dependencyCount: 2,
            incomingDependencies: 1,
            outgoingDependencies: 1,
            riskLevel: 'MEDIUM',
          },
        });
      }),
    );

    const client = new HttpGraphClient({ baseURL: 'http://localhost:4747' });
    const result = await client.clusterImpact({
      name: 'Settings',
      repo: 'demo',
      direction: 'both',
      limit: 10,
    });

    expect(requests).toEqual([
      'http://localhost:4747/api/feature-impact?repo=demo&name=Settings&direction=both&limit=10',
    ]);
    expect(result.impactSummary.riskLevel).toBe('MEDIUM');
    expect(result.impactedClusters[0]?.name).toBe('AI');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
