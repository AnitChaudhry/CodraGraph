import { describe, expect, it, vi, beforeEach } from 'vitest';

const { cgdbMocks } = vi.hoisted(() => ({
  cgdbMocks: {
    executeQuery: vi.fn(),
  },
}));

vi.mock('../../src/core/cgdb/cgdb-adapter.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ...cgdbMocks };
});

import { createCgdbRowSource } from '../../src/core/graphstore/cgdb-row-source.js';

const collect = async (iterable: AsyncIterable<unknown>): Promise<unknown[]> => {
  const rows: unknown[] = [];
  for await (const row of iterable) rows.push(row);
  return rows;
};

describe('createCgdbRowSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('quotes reserved node table labels when streaming nodes', async () => {
    cgdbMocks.executeQuery.mockResolvedValue([
      { n: { id: 'union:test', name: 'ExampleUnion', _id: 1, _label: 'Union' } },
    ]);

    const source = createCgdbRowSource();
    const rows = await collect(source.streamNodeTable('Union'));

    expect(cgdbMocks.executeQuery).toHaveBeenCalledWith('MATCH (n:`Union`) RETURN n');
    expect(rows).toEqual([{ id: 'union:test', name: 'ExampleUnion' }]);
  });

  it('escapes backticks in generated node table labels', async () => {
    cgdbMocks.executeQuery.mockResolvedValue([]);

    const source = createCgdbRowSource();
    const rows = await collect(source.streamNodeTable('Odd`Label'));

    expect(cgdbMocks.executeQuery).toHaveBeenCalledWith('MATCH (n:`Odd``Label`) RETURN n');
    expect(rows).toEqual([]);
  });

  it('quotes relationship table names when streaming edges', async () => {
    cgdbMocks.executeQuery.mockResolvedValue([]);

    const source = createCgdbRowSource();
    const rows = await collect(source.streamEdges());

    expect(cgdbMocks.executeQuery).toHaveBeenCalledWith(
      'MATCH (a)-[r:`CodeRelation`]->(b) RETURN a.id AS `from`, b.id AS `to`, r.type AS type, r AS rel',
    );
    expect(rows).toEqual([]);
  });
});
