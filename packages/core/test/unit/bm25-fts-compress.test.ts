/**
 * RFC 0001 Phase 2.5 — BM25/FTS index drops `content` from its property
 * list when the repo's `meta.compress` is `'brotli'` or `'zstd'`.
 *
 * Without this fix, FTS over `--compress` repos would tokenise base64
 * (the on-the-wire form of compressed bytes) and silently return
 * useless hits inside function bodies. With it, FTS falls back to
 * symbol-name matches — search is narrower but never wrong.
 *
 * The contract is that FTS create-time `properties` is:
 *   meta.compress === 'none' | undefined  →  ['name', 'content']
 *   meta.compress === 'brotli' | 'zstd'   →  ['name']
 *
 * This test mocks `repo-manager` and the cgdb adapter so the assertion
 * is on what `ensureFTSIndex` is asked to create — no real cgdb needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchFTSFromCgdb } from '../../src/core/search/bm25-index.js';

const ensureFTSCalls: Array<{
  table: string;
  indexName: string;
  properties: readonly string[];
}> = [];

vi.mock('../../src/core/cgdb/cgdb-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/cgdb/cgdb-adapter.js')>();
  return {
    ...actual,
    queryFTS: vi.fn().mockResolvedValue([]),
    ensureFTSIndex: vi
      .fn()
      .mockImplementation(async (table: string, indexName: string, props: readonly string[]) => {
        ensureFTSCalls.push({ table, indexName, properties: [...props] });
      }),
    executeQuery: vi.fn().mockResolvedValue([]),
  };
});

const mockedMeta: { compress?: 'none' | 'brotli' | 'zstd' } = {};

vi.mock('../../src/storage/repo-manager.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/storage/repo-manager.js')>();
  return {
    ...actual,
    // CLI path (no repoId) walks up from cwd via `findRepo`. We hand back
    // a synthetic repo whose meta carries whatever the test wants.
    findRepo: vi.fn().mockImplementation(async () => ({
      repoPath: '/synthetic',
      storagePath: '/synthetic/.codragraph',
      cgdbPath: '/synthetic/.codragraph/cgdb',
      metaPath: '/synthetic/.codragraph/meta.json',
      meta: {
        repoPath: '/synthetic',
        lastCommit: 'deadbeef',
        indexedAt: '2026-04-30T00:00:00.000Z',
        ...mockedMeta,
      },
    })),
  };
});

describe('RFC 0001 Phase 2.5 — FTS properties depend on meta.compress', () => {
  beforeEach(() => {
    ensureFTSCalls.length = 0;
    delete mockedMeta.compress;
  });

  it("uses ['name', 'content'] when meta.compress is 'none'", async () => {
    mockedMeta.compress = 'none';
    await searchFTSFromCgdb('hello');
    expect(ensureFTSCalls.length).toBe(5);
    for (const call of ensureFTSCalls) {
      expect(call.properties).toEqual(['name', 'content']);
    }
  });

  it("uses ['name', 'content'] when meta.compress is undefined (legacy / 1.7.x)", async () => {
    // Default — compress field absent. Backwards-compatible path.
    await searchFTSFromCgdb('hello');
    expect(ensureFTSCalls.length).toBe(5);
    for (const call of ensureFTSCalls) {
      expect(call.properties).toEqual(['name', 'content']);
    }
  });

  it("uses ['name'] when meta.compress is 'brotli'", async () => {
    mockedMeta.compress = 'brotli';
    await searchFTSFromCgdb('hello');
    expect(ensureFTSCalls.length).toBe(5);
    for (const call of ensureFTSCalls) {
      expect(call.properties).toEqual(['name']);
    }
  });

  it("uses ['name'] when meta.compress is 'zstd'", async () => {
    mockedMeta.compress = 'zstd';
    await searchFTSFromCgdb('hello');
    expect(ensureFTSCalls.length).toBe(5);
    for (const call of ensureFTSCalls) {
      expect(call.properties).toEqual(['name']);
    }
  });

  it('covers all five FTS-bearing tables exactly once', async () => {
    mockedMeta.compress = 'brotli';
    await searchFTSFromCgdb('hello');
    const tables = ensureFTSCalls.map((c) => c.table).sort();
    expect(tables).toEqual(['Class', 'File', 'Function', 'Interface', 'Method']);
  });
});
