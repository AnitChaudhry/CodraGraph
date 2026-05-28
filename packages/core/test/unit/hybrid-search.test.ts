/**
 * P1 Unit Tests: Hybrid Search (mergeWithRRF)
 *
 * Tests: mergeWithRRF from hybrid-search.ts
 * - BM25-only merge
 * - Semantic-only merge
 * - Combined ranking
 * - Limit parameter
 * - Empty inputs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeWithRRF, hybridSearch } from '../../src/core/search/hybrid-search.js';
import type { BM25SearchResult } from '../../src/core/search/bm25-index.js';
import type { SemanticSearchResult } from '../../src/core/embeddings/types.js';

const { searchFTSFromCgdbMock } = vi.hoisted(() => ({
  searchFTSFromCgdbMock: vi.fn(),
}));

vi.mock('../../src/core/search/bm25-index.js', () => ({
  searchFTSFromCgdb: searchFTSFromCgdbMock,
}));

let bm25Rank = 0;
function makeBM25(filePath: string, score: number): BM25SearchResult {
  return { filePath, score, rank: ++bm25Rank };
}

function makeSemantic(filePath: string, distance: number): SemanticSearchResult {
  return {
    filePath,
    distance,
    nodeId: `node:${filePath}`,
    name: filePath
      .split('/')
      .pop()!
      .replace(/\.\w+$/, ''),
    label: 'Function',
    startLine: 1,
    endLine: 10,
  };
}

beforeEach(() => {
  bm25Rank = 0;
  searchFTSFromCgdbMock.mockReset();
});

describe('mergeWithRRF', () => {
  it('handles empty inputs', () => {
    const result = mergeWithRRF([], []);
    expect(result).toHaveLength(0);
  });

  it('handles BM25-only results', () => {
    const bm25: BM25SearchResult[] = [makeBM25('src/a.ts', 10), makeBM25('src/b.ts', 5)];
    const result = mergeWithRRF(bm25, []);
    expect(result).toHaveLength(2);
    expect(result[0].filePath).toBe('src/a.ts');
    expect(result[0].sources).toEqual(['bm25']);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });

  it('handles semantic-only results', () => {
    const semantic: SemanticSearchResult[] = [
      makeSemantic('src/a.ts', 0.1),
      makeSemantic('src/b.ts', 0.2),
    ];
    const result = mergeWithRRF([], semantic);
    expect(result).toHaveLength(2);
    expect(result[0].filePath).toBe('src/a.ts');
    expect(result[0].sources).toEqual(['semantic']);
  });

  it('combined: shared results get higher score', () => {
    const bm25: BM25SearchResult[] = [
      makeBM25('src/shared.ts', 10),
      makeBM25('src/bm25-only.ts', 5),
    ];
    const semantic: SemanticSearchResult[] = [
      makeSemantic('src/shared.ts', 0.1),
      makeSemantic('src/semantic-only.ts', 0.2),
    ];

    const result = mergeWithRRF(bm25, semantic);
    // Shared result should be ranked first (higher combined RRF score)
    expect(result[0].filePath).toBe('src/shared.ts');
    expect(result[0].sources).toContain('bm25');
    expect(result[0].sources).toContain('semantic');
    // Its score should be higher than any single-source result
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('respects limit parameter', () => {
    const bm25: BM25SearchResult[] = Array.from({ length: 20 }, (_, i) =>
      makeBM25(`src/${i}.ts`, 100 - i),
    );
    const result = mergeWithRRF(bm25, [], 5);
    expect(result).toHaveLength(5);
  });

  it('default limit is 10', () => {
    const bm25: BM25SearchResult[] = Array.from({ length: 20 }, (_, i) =>
      makeBM25(`src/${i}.ts`, 100 - i),
    );
    const result = mergeWithRRF(bm25, []);
    expect(result).toHaveLength(10);
  });

  it('assigns ranks starting from 1', () => {
    const bm25: BM25SearchResult[] = [
      makeBM25('src/a.ts', 10),
      makeBM25('src/b.ts', 5),
      makeBM25('src/c.ts', 1),
    ];
    const result = mergeWithRRF(bm25, []);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('preserves semantic metadata on shared results', () => {
    const bm25: BM25SearchResult[] = [makeBM25('src/a.ts', 10)];
    const semantic: SemanticSearchResult[] = [makeSemantic('src/a.ts', 0.1)];

    const result = mergeWithRRF(bm25, semantic);
    expect(result[0].nodeId).toBe('node:src/a.ts');
    expect(result[0].name).toBe('a');
    expect(result[0].label).toBe('Function');
  });

  it('stores original scores for debugging', () => {
    const bm25: BM25SearchResult[] = [makeBM25('src/a.ts', 15)];
    const semantic: SemanticSearchResult[] = [makeSemantic('src/a.ts', 0.3)];

    const result = mergeWithRRF(bm25, semantic);
    expect(result[0].bm25Score).toBe(15);
    expect(result[0].semanticScore).toBeCloseTo(0.7); // 1 - distance
  });
});

describe('hybridSearch', () => {
  it('starts BM25 and semantic embedding work before waiting for either result', async () => {
    const started: string[] = [];
    let resolveBM25!: (results: BM25SearchResult[]) => void;
    const semanticDbStarted = false;

    searchFTSFromCgdbMock.mockImplementation(() => {
      started.push('bm25');
      return new Promise<BM25SearchResult[]>((resolve) => {
        resolveBM25 = resolve;
      });
    });

    const executeQuery = vi.fn(async () => []);
    const semanticSearch = vi.fn(() => {
      started.push('semantic');
      return Promise.resolve([makeSemantic('src/shared.ts', 0.1)]);
    });

    const resultsPromise = hybridSearch('auth flow', 5, executeQuery, semanticSearch);

    expect(started).toEqual(['bm25', 'semantic']);
    expect(searchFTSFromCgdbMock).toHaveBeenCalledWith('auth flow', 5);
    expect(semanticSearch).toHaveBeenCalledWith(expect.any(Function), 'auth flow', 5);

    resolveBM25([makeBM25('src/shared.ts', 10)]);

    const results = await resultsPromise;

    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('src/shared.ts');
    expect(results[0].sources).toEqual(['bm25', 'semantic']);
    expect(semanticDbStarted).toBe(false);
  });

  it('gates semantic DB calls until BM25 has finished on the shared connection', async () => {
    let resolveBM25!: (results: BM25SearchResult[]) => void;
    let semanticDbStarted = false;

    searchFTSFromCgdbMock.mockImplementation(
      () =>
        new Promise<BM25SearchResult[]>((resolve) => {
          resolveBM25 = resolve;
        }),
    );

    const executeQuery = vi.fn(async () => {
      semanticDbStarted = true;
      return [];
    });
    const semanticSearch = vi.fn(
      async (semanticExecuteQuery: (cypher: string) => Promise<any[]>) => {
        const pendingDb = semanticExecuteQuery('MATCH (n) RETURN n');
        await Promise.resolve();
        expect(semanticDbStarted).toBe(false);
        resolveBM25([makeBM25('src/bm25.ts', 10)]);
        await pendingDb;
        return [makeSemantic('src/semantic.ts', 0.2)];
      },
    );

    const results = await hybridSearch('auth flow', 5, executeQuery, semanticSearch);

    expect(semanticDbStarted).toBe(true);
    expect(executeQuery).toHaveBeenCalledWith('MATCH (n) RETURN n');
    expect(results.map((r) => r.filePath)).toEqual(['src/bm25.ts', 'src/semantic.ts']);
  });
});
