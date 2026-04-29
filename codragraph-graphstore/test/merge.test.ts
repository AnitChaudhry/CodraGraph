import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FsCAS } from '../src/cas/fs-cas.js';
import { createCommit } from '../src/history/commit.js';
import { threeWayMerge } from '../src/merge/three-way.js';
import { serializeSnapshot } from '../src/snapshot/serializer.js';
import { type GraphRow, type RowSource } from '../src/snapshot/row-source.js';
import { makeObjectId, type ObjectId } from '../src/types.js';

let tmpRoot: string;
let cas: FsCAS;
const author = { name: 'test', email: 't@example.com' };

interface FakeGraph {
  readonly nodes: Record<string, GraphRow[]>;
  readonly edges: GraphRow[];
}

const fakeSource = (graph: FakeGraph): RowSource => ({
  listNodeTables: async () => Object.keys(graph.nodes),
  streamNodeTable: async function* (table: string): AsyncIterable<GraphRow> {
    for (const row of graph.nodes[table] ?? []) yield row;
  },
  streamEdges: async function* (): AsyncIterable<GraphRow> {
    for (const row of graph.edges) yield row;
  },
});

const commitFor = async (
  graph: FakeGraph,
  parents: ObjectId[],
  message: string,
  ts: string,
): Promise<ObjectId> => {
  const { snapshotId } = await serializeSnapshot({
    source: fakeSource(graph),
    cas,
    createdAt: ts,
  });
  const { commitId } = await createCommit({
    cas,
    snapshot: snapshotId,
    parents,
    author,
    message,
    ts,
  });
  return commitId;
};

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'graphstore-merge-'));
  cas = new FsCAS({ root: tmpRoot });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('threeWayMerge — linear cases', () => {
  it('already-up-to-date when ours === theirs', async () => {
    const dummy = makeObjectId('a'.repeat(64));
    const r = await threeWayMerge({ cas, ours: dummy, theirs: dummy });
    expect(r.kind).toBe('already-up-to-date');
  });

  it('fast-forward when theirs strictly extends ours', async () => {
    const g1: FakeGraph = { nodes: { Function: [{ id: 'f1', name: 'a' }] }, edges: [] };
    const c1 = await commitFor(g1, [], 'init', '2026-01-01T00:00:00Z');
    const g2: FakeGraph = {
      nodes: {
        Function: [
          { id: 'f1', name: 'a' },
          { id: 'f2', name: 'b' },
        ],
      },
      edges: [],
    };
    const c2 = await commitFor(g2, [c1], 'extend', '2026-01-02T00:00:00Z');
    const r = await threeWayMerge({ cas, ours: c1, theirs: c2 });
    expect(r).toEqual({ kind: 'fast-forward', to: c2 });
  });
});

describe('threeWayMerge — divergent cases', () => {
  it('merges non-overlapping additions cleanly', async () => {
    const base: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'base' }] },
      edges: [],
    };
    const ours: FakeGraph = {
      nodes: {
        Function: [
          { id: 'f1', name: 'base' },
          { id: 'fOurs', name: 'ours' },
        ],
      },
      edges: [],
    };
    const theirs: FakeGraph = {
      nodes: {
        Function: [
          { id: 'f1', name: 'base' },
          { id: 'fTheirs', name: 'theirs' },
        ],
      },
      edges: [],
    };
    const baseCommit = await commitFor(base, [], 'base', '2026-01-01T00:00:00Z');
    const oursCommit = await commitFor(ours, [baseCommit], 'ours', '2026-01-02T00:00:00Z');
    const theirsCommit = await commitFor(theirs, [baseCommit], 'theirs', '2026-01-03T00:00:00Z');

    const r = await threeWayMerge({ cas, ours: oursCommit, theirs: theirsCommit });
    expect(r.kind).toBe('merged');
    if (r.kind !== 'merged') return;
    expect(r.base).toBe(baseCommit);
    expect(r.stats.tables['Function']?.takenFromOurs).toBe(1);
    expect(r.stats.tables['Function']?.takenFromTheirs).toBe(1);
    expect(r.stats.tables['Function']?.unchanged).toBe(1);
  });

  it('conflicts when both sides modify the same row differently', async () => {
    const base: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'base', body: 'x' }] },
      edges: [],
    };
    const ours: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'base', body: 'ours-side' }] },
      edges: [],
    };
    const theirs: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'base', body: 'theirs-side' }] },
      edges: [],
    };
    const baseCommit = await commitFor(base, [], 'base', '2026-01-01T00:00:00Z');
    const oursCommit = await commitFor(ours, [baseCommit], 'ours', '2026-01-02T00:00:00Z');
    const theirsCommit = await commitFor(theirs, [baseCommit], 'theirs', '2026-01-03T00:00:00Z');

    const r = await threeWayMerge({ cas, ours: oursCommit, theirs: theirsCommit });
    expect(r.kind).toBe('conflicts');
    if (r.kind !== 'conflicts') return;
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0]?.id).toBe('f1');
    expect(r.conflicts[0]?.kind).toBe('node:Function');
    expect(r.conflicts[0]?.reason).toBe('modified-on-both-sides');
  });

  it('conflict-classifies modified-vs-deleted', async () => {
    const base: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'base', body: 'x' }] },
      edges: [],
    };
    const ours: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'base', body: 'modified' }] },
      edges: [],
    };
    const theirs: FakeGraph = { nodes: { Function: [] }, edges: [] };
    const baseCommit = await commitFor(base, [], 'base', '2026-01-01T00:00:00Z');
    const oursCommit = await commitFor(ours, [baseCommit], 'modify', '2026-01-02T00:00:00Z');
    const theirsCommit = await commitFor(theirs, [baseCommit], 'delete', '2026-01-03T00:00:00Z');

    const r = await threeWayMerge({ cas, ours: oursCommit, theirs: theirsCommit });
    expect(r.kind).toBe('conflicts');
    if (r.kind !== 'conflicts') return;
    expect(r.conflicts[0]?.reason).toBe('modified-vs-deleted');
  });

  it('takes the only-changed side when the other matches base', async () => {
    const base: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'base' }] },
      edges: [],
    };
    const ours: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'base' }] }, // unchanged
      edges: [],
    };
    const theirs: FakeGraph = {
      nodes: { Function: [{ id: 'f1', name: 'renamed' }] },
      edges: [],
    };
    const baseCommit = await commitFor(base, [], 'base', '2026-01-01T00:00:00Z');
    const oursCommit = await commitFor(ours, [baseCommit], 'ours-noop', '2026-01-02T00:00:00Z');
    const theirsCommit = await commitFor(
      theirs,
      [baseCommit],
      'theirs-rename',
      '2026-01-03T00:00:00Z',
    );

    const r = await threeWayMerge({ cas, ours: oursCommit, theirs: theirsCommit });
    expect(r.kind).toBe('merged');
    if (r.kind !== 'merged') return;
    expect(r.stats.tables['Function']?.takenFromTheirs).toBe(1);
    expect(r.stats.tables['Function']?.takenFromOurs).toBe(0);
  });
});
