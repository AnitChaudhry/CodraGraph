import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FsRecipeStore,
  deriveRecipeId,
  findReusableRecipes,
  assessStaleness,
  type Recipe,
  type RecipeInput,
} from '../src/moat/index.js';

let tmpRoot: string;

const sampleInput = (overrides: Partial<RecipeInput> = {}): RecipeInput => ({
  taskFamily: 'codebase-qa',
  snapshotId: 'sha256:' + 'a'.repeat(64),
  searchedAt: '2026-04-29T00:00:00Z',
  searchSource: 'swarm',
  harness: {
    name: 'graph-aware',
    version: '0.1.0',
    files: [{ path: 'index.ts', content: '// harness body' }],
  },
  paretoCoords: { accuracy: 0.84, tokens: 4500, latencyMs: 1200 },
  scores: { accuracy: 0.84, tokens: 4500, latencyMs: 1200, taskCount: 30 },
  ...overrides,
});

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-moat-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('FsRecipeStore', () => {
  it('put + get round-trips a recipe', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    const stored = await store.put(sampleInput());
    expect(stored.id).toMatch(/^recipe:[0-9a-f]{32}$/);

    const fetched = await store.get(stored.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.harness.name).toBe('graph-aware');
  });

  it('put is idempotent — same content, same id, no duplicate file', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    const a = await store.put(sampleInput());
    const b = await store.put(sampleInput());
    expect(a.id).toBe(b.id);
    const all = await store.list();
    expect(all.length).toBe(1);
  });

  it('findExact filters by snapshotId + taskFamily', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    await store.put(sampleInput());
    await store.put(
      sampleInput({
        taskFamily: 'swe-bench',
        searchedAt: '2026-04-30T00:00:00Z',
      }),
    );
    await store.put(
      sampleInput({
        snapshotId: 'sha256:' + 'b'.repeat(64),
        searchedAt: '2026-05-01T00:00:00Z',
      }),
    );

    const exact = await store.findExact('sha256:' + 'a'.repeat(64), 'codebase-qa');
    expect(exact.length).toBe(1);
    expect(exact[0]?.taskFamily).toBe('codebase-qa');
  });

  it('findExact can include requiredSubgraphSignature in the cache key', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    await store.put(sampleInput({ requiredSubgraphSignature: 'subgraph:auth:v1' }));
    await store.put(
      sampleInput({
        requiredSubgraphSignature: 'subgraph:billing:v1',
        searchedAt: '2026-04-30T00:00:00Z',
      }),
    );

    const exact = await store.findExact(
      'sha256:' + 'a'.repeat(64),
      'codebase-qa',
      'subgraph:auth:v1',
    );
    expect(exact.length).toBe(1);
    expect(exact[0]?.requiredSubgraphSignature).toBe('subgraph:auth:v1');
  });

  it('findByFamily returns recipes across snapshots', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    await store.put(sampleInput());
    await store.put(
      sampleInput({
        snapshotId: 'sha256:' + 'b'.repeat(64),
        searchedAt: '2026-05-01T00:00:00Z',
      }),
    );
    const family = await store.findByFamily('codebase-qa');
    expect(family.length).toBe(2);
    // Newest first.
    expect(family[0]?.searchedAt).toBe('2026-05-01T00:00:00Z');
  });

  it('delete removes a recipe and refreshes the index', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    const stored = await store.put(sampleInput());
    expect(await store.delete(stored.id)).toBe(true);
    expect(await store.get(stored.id)).toBeNull();
    expect(await store.delete(stored.id)).toBe(false); // idempotent
  });

  it('writes a human-readable index.json that reflects current contents', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    const a = await store.put(sampleInput());
    const b = await store.put(
      sampleInput({
        taskFamily: 'swe-bench',
        searchedAt: '2026-05-01T00:00:00Z',
      }),
    );
    const indexRaw = await fs.readFile(store.indexPath(), 'utf-8');
    const index = JSON.parse(indexRaw) as Array<{ id: string; taskFamily: string }>;
    expect(index.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('deriveRecipeId', () => {
  it('is stable across runs for equal canonical content', () => {
    const a = deriveRecipeId(sampleInput() as Omit<Recipe, 'id'>);
    const b = deriveRecipeId(sampleInput() as Omit<Recipe, 'id'>);
    expect(a).toBe(b);
  });

  it('changes when scores change', () => {
    const a = deriveRecipeId(sampleInput() as Omit<Recipe, 'id'>);
    const b = deriveRecipeId(
      sampleInput({
        paretoCoords: { accuracy: 0.99, tokens: 4500, latencyMs: 1200 },
      }) as Omit<Recipe, 'id'>,
    );
    expect(a).not.toBe(b);
  });
});

describe('findReusableRecipes', () => {
  it('returns exact matches and ranked candidates', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    const exactSnap = 'sha256:' + '1'.repeat(64);
    const otherSnap = 'sha256:' + '2'.repeat(64);
    await store.put(
      sampleInput({
        snapshotId: exactSnap,
        paretoCoords: { accuracy: 0.9, tokens: 1000, latencyMs: 500 },
        scores: { accuracy: 0.9, tokens: 1000, latencyMs: 500, taskCount: 30 },
      }),
    );
    await store.put(
      sampleInput({
        snapshotId: otherSnap,
        searchedAt: '2026-04-30T00:00:00Z',
        paretoCoords: { accuracy: 0.85, tokens: 2000, latencyMs: 700 },
        scores: { accuracy: 0.85, tokens: 2000, latencyMs: 700, taskCount: 30 },
      }),
    );
    await store.put(
      sampleInput({
        snapshotId: otherSnap,
        searchedAt: '2026-05-01T00:00:00Z',
        paretoCoords: { accuracy: 0.95, tokens: 5000, latencyMs: 1100 },
        scores: { accuracy: 0.95, tokens: 5000, latencyMs: 1100, taskCount: 30 },
      }),
    );

    const result = await findReusableRecipes({
      store,
      snapshotId: exactSnap,
      taskFamily: 'codebase-qa',
    });
    expect(result.exact.length).toBe(1);
    expect(result.candidates.length).toBe(2);
    // Candidates ranked by accuracy desc, so the 0.95 entry first.
    expect(result.candidates[0]?.recipe.paretoCoords.accuracy).toBe(0.95);
    expect(result.candidates[0]?.staleness.diffComputed).toBe(false);
    expect(result.candidates[0]?.staleness.riskLevel).toBe('unknown');
  });

  it('scopes exact and candidate recipe reuse by required subgraph signature', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    const exactSnap = 'sha256:' + '1'.repeat(64);
    const otherSnap = 'sha256:' + '2'.repeat(64);
    await store.put(
      sampleInput({
        snapshotId: exactSnap,
        requiredSubgraphSignature: 'subgraph:settings:v1',
      }),
    );
    await store.put(
      sampleInput({
        snapshotId: otherSnap,
        searchedAt: '2026-05-01T00:00:00Z',
        requiredSubgraphSignature: 'subgraph:settings:v1',
        paretoCoords: { accuracy: 0.95, tokens: 2000, latencyMs: 500 },
        scores: { accuracy: 0.95, tokens: 2000, latencyMs: 500, taskCount: 30 },
      }),
    );
    await store.put(
      sampleInput({
        snapshotId: otherSnap,
        searchedAt: '2026-05-02T00:00:00Z',
        requiredSubgraphSignature: 'subgraph:billing:v1',
        paretoCoords: { accuracy: 0.99, tokens: 1000, latencyMs: 400 },
        scores: { accuracy: 0.99, tokens: 1000, latencyMs: 400, taskCount: 30 },
      }),
    );

    const result = await findReusableRecipes({
      store,
      snapshotId: exactSnap,
      taskFamily: 'codebase-qa',
      requiredSubgraphSignature: 'subgraph:settings:v1',
    });

    expect(result.exact.length).toBe(1);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.recipe.requiredSubgraphSignature).toBe('subgraph:settings:v1');
  });

  it('classifies staleness when a differ is provided', async () => {
    const store = new FsRecipeStore({ root: tmpRoot });
    const other = 'sha256:' + '9'.repeat(64);
    await store.put(sampleInput({ snapshotId: other }));
    const fakeDiffer = {
      diffSnapshots: async () => ({
        addedNodes: { Function: ['a', 'b', 'c'] },
        removedNodes: {},
        modifiedSymbols: [],
        addedEdges: [],
        removedEdges: [],
      }),
    };
    const result = await findReusableRecipes({
      store,
      snapshotId: 'sha256:' + '0'.repeat(64),
      taskFamily: 'codebase-qa',
      differ: fakeDiffer,
    });
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.staleness.diffComputed).toBe(true);
    expect(result.candidates[0]?.staleness.summary?.addedNodes).toBe(3);
    expect(result.candidates[0]?.staleness.riskLevel).toBe('low');
  });
});

describe('assessStaleness', () => {
  const recipe: Recipe = {
    id: 'recipe:abc',
    ...sampleInput(),
  } as Recipe;

  it('returns unknown when no differ is provided', async () => {
    const out = await assessStaleness({
      currentSnapshotId: 'sha256:' + 'z'.repeat(64),
      recipe,
    });
    expect(out.diffComputed).toBe(false);
    expect(out.riskLevel).toBe('unknown');
  });

  it('classifies risk by total change count', async () => {
    const big = await assessStaleness({
      currentSnapshotId: 'sha256:' + 'z'.repeat(64),
      recipe,
      differ: {
        diffSnapshots: async () => ({
          addedNodes: { Function: Array(120).fill('x') },
          removedNodes: {},
          modifiedSymbols: [],
          addedEdges: [],
          removedEdges: [],
        }),
      },
    });
    expect(big.riskLevel).toBe('high');
  });
});
