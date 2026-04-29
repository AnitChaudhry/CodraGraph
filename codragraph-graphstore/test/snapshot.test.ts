import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FsCAS } from '../src/cas/fs-cas.js';
import { serializeSnapshot } from '../src/snapshot/serializer.js';
import { materializeSnapshot } from '../src/snapshot/materializer.js';
import { type GraphRow, type RowSink, type RowSource } from '../src/snapshot/row-source.js';
import { diffSnapshots } from '../src/diff/structural.js';

let tmpRoot: string;
let cas: FsCAS;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'graphstore-snap-'));
  cas = new FsCAS({ root: tmpRoot });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

interface FakeGraph {
  readonly nodes: Record<string, GraphRow[]>;
  readonly edges: GraphRow[];
}

const fakeSource = (graph: FakeGraph): RowSource => ({
  listNodeTables: async () => Object.keys(graph.nodes),
  streamNodeTable: async function* (table: string): AsyncIterable<GraphRow> {
    const rows = graph.nodes[table] ?? [];
    for (const row of rows) yield row;
  },
  streamEdges: async function* (): AsyncIterable<GraphRow> {
    for (const row of graph.edges) yield row;
  },
});

class CollectingSink implements RowSink {
  readonly nodes: Record<string, GraphRow[]> = {};
  readonly edges: GraphRow[] = [];
  finalized = false;
  private current: string | null = null;
  async beginTable(name: string) {
    this.current = name;
    this.nodes[name] = [];
  }
  async writeRows(name: string, rows: readonly GraphRow[]) {
    if (this.current !== name) throw new Error('writeRows called between begin/end');
    this.nodes[name]!.push(...rows);
  }
  async endTable(_name: string) {
    this.current = null;
  }
  async beginEdges() {}
  async writeEdgeRows(rows: readonly GraphRow[]) {
    this.edges.push(...rows);
  }
  async endEdges() {}
  async finalize() {
    this.finalized = true;
  }
}

const sample = (): FakeGraph => ({
  nodes: {
    Function: [
      { id: 'fn:foo', name: 'foo', filePath: 'src/a.ts', isExported: true },
      { id: 'fn:bar', name: 'bar', filePath: 'src/b.ts', isExported: false },
    ],
    Class: [{ id: 'cls:Widget', name: 'Widget', filePath: 'src/w.ts' }],
  },
  edges: [
    { from: 'fn:foo', to: 'fn:bar', type: 'CALLS' },
    { from: 'fn:bar', to: 'cls:Widget', type: 'USES' },
  ],
});

describe('serializeSnapshot', () => {
  it('produces a stable snapshot id for an unchanged graph', async () => {
    const a = await serializeSnapshot({
      source: fakeSource(sample()),
      cas,
      createdAt: '2026-04-29T00:00:00Z',
    });
    const b = await serializeSnapshot({
      source: fakeSource(sample()),
      cas,
      createdAt: '2026-04-29T00:00:00Z',
    });
    expect(b.snapshotId).toBe(a.snapshotId);
  });

  it('captures per-table row counts', async () => {
    const result = await serializeSnapshot({
      source: fakeSource(sample()),
      cas,
    });
    expect(result.stats.totalNodeRows).toBe(3);
    expect(result.stats.edgeRowCount).toBe(2);
    expect(result.stats.nodeRowsByTable['Function']).toBe(2);
    expect(result.stats.nodeRowsByTable['Class']).toBe(1);
  });

  it('rejects rows missing an id', async () => {
    const bad: FakeGraph = {
      nodes: { Function: [{ name: 'no-id' } as GraphRow] },
      edges: [],
    };
    await expect(serializeSnapshot({ source: fakeSource(bad), cas })).rejects.toThrow(
      /missing a string `id`/,
    );
  });
});

describe('materializeSnapshot', () => {
  it('replays every row into the sink', async () => {
    const { snapshotId } = await serializeSnapshot({
      source: fakeSource(sample()),
      cas,
    });
    const sink = new CollectingSink();
    const result = await materializeSnapshot({ cas, snapshotId, sink });
    expect(sink.finalized).toBe(true);
    expect(result.stats.totalNodeRows ?? 0).toBeGreaterThanOrEqual(0);
    expect(sink.nodes['Function']?.length).toBe(2);
    expect(sink.nodes['Class']?.length).toBe(1);
    expect(sink.edges.length).toBe(2);
  });

  it('materializes byte-for-byte via canonical re-serialize', async () => {
    const original = sample();
    const { snapshotId: id1 } = await serializeSnapshot({
      source: fakeSource(original),
      cas,
      createdAt: '2026-04-29T00:00:00Z',
    });

    const sink = new CollectingSink();
    await materializeSnapshot({ cas, snapshotId: id1, sink });

    const replayed: FakeGraph = {
      nodes: sink.nodes,
      edges: sink.edges,
    };
    const { snapshotId: id2 } = await serializeSnapshot({
      source: fakeSource(replayed),
      cas,
      createdAt: '2026-04-29T00:00:00Z',
    });
    expect(id2).toBe(id1);
  });
});

describe('diffSnapshots', () => {
  it('detects added nodes', async () => {
    const before = await serializeSnapshot({ source: fakeSource(sample()), cas });
    const later: FakeGraph = sample();
    later.nodes['Function'] = [
      ...later.nodes['Function']!,
      { id: 'fn:baz', name: 'baz', filePath: 'src/c.ts' },
    ];
    const after = await serializeSnapshot({ source: fakeSource(later), cas });

    const d = await diffSnapshots({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(d.addedNodes['Function']?.length).toBe(1);
    expect(d.removedNodes['Function']).toBeUndefined();
    expect(d.modifiedSymbols).toEqual([]);
  });

  it('detects removed edges', async () => {
    const before = await serializeSnapshot({ source: fakeSource(sample()), cas });
    const later: FakeGraph = sample();
    later.edges = [later.edges[0]!];
    const after = await serializeSnapshot({ source: fakeSource(later), cas });

    const d = await diffSnapshots({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(d.addedEdges.length).toBe(0);
    expect(d.removedEdges.length).toBe(1);
  });

  it('detects modified symbols by content hash change', async () => {
    const before = await serializeSnapshot({ source: fakeSource(sample()), cas });
    const later: FakeGraph = sample();
    later.nodes['Function'] = [
      { id: 'fn:foo', name: 'foo', filePath: 'src/a.ts', isExported: false }, // changed
      later.nodes['Function']![1]!,
    ];
    const after = await serializeSnapshot({ source: fakeSource(later), cas });

    const d = await diffSnapshots({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(d.modifiedSymbols.length).toBe(1);
    expect(d.modifiedSymbols[0]?.id).toBe('fn:foo');
    expect(d.modifiedSymbols[0]?.table).toBe('Function');
  });

  it('returns an empty diff when snapshots are identical', async () => {
    const before = await serializeSnapshot({
      source: fakeSource(sample()),
      cas,
      createdAt: '2026-04-29T00:00:00Z',
    });
    const after = await serializeSnapshot({
      source: fakeSource(sample()),
      cas,
      createdAt: '2026-04-29T00:00:00Z',
    });
    expect(after.snapshotId).toBe(before.snapshotId);

    const d = await diffSnapshots({ cas, from: before.snapshotId, to: after.snapshotId });
    expect(Object.keys(d.addedNodes).length).toBe(0);
    expect(Object.keys(d.removedNodes).length).toBe(0);
    expect(d.addedEdges.length).toBe(0);
    expect(d.removedEdges.length).toBe(0);
    expect(d.modifiedSymbols.length).toBe(0);
  });
});
