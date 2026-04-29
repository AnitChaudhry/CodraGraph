import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CandidateStore } from '../src/filesystem.js';

describe('CandidateStore', () => {
  let storePath: string;
  let store: CandidateStore;

  beforeEach(async () => {
    storePath = await fs.mkdtemp(path.join(os.tmpdir(), 'codragraph-harness-test-'));
    store = new CandidateStore(storePath);
    await store.init();
  });

  it('assigns sequential ids in insertion order', async () => {
    const a = await store.addCandidate({
      name: 'zero-shot',
      version: '1.0.0',
      origin: { kind: 'seed' },
      files: [{ path: 'index.ts', content: 'export const harness = {};' }],
    });
    const b = await store.addCandidate({
      name: 'few-shot',
      version: '1.0.0',
      origin: { kind: 'seed' },
      files: [{ path: 'index.ts', content: 'export const harness = {};' }],
    });
    expect(a).toBe('000_zero-shot');
    expect(b).toBe('001_few-shot');
  });

  it('sanitizes unsafe chars in candidate names', async () => {
    const id = await store.addCandidate({
      name: 'graph/aware v2!',
      version: '1.0.0',
      origin: { kind: 'seed' },
      files: [{ path: 'index.ts', content: 'export const harness = {};' }],
    });
    expect(id).toBe('000_graph-aware-v2-');
  });

  it('round-trips source files including nested paths', async () => {
    const id = await store.addCandidate({
      name: 'nested',
      version: '1.0.0',
      origin: { kind: 'seed' },
      files: [
        { path: 'index.ts', content: "import './lib/util';" },
        { path: 'lib/util.ts', content: 'export const u = 1;' },
      ],
    });
    const read = await store.readSource(id);
    expect(read).toHaveLength(2);
    const paths = read.map((f) => f.path).sort();
    expect(paths).toEqual(['index.ts', 'lib/util.ts']);
  });

  it('persists and reads metadata + score', async () => {
    const id = await store.addCandidate({
      name: 'scored',
      version: '1.0.0',
      origin: {
        kind: 'proposer',
        proposer: 'claude-code',
        iteration: 3,
        parents: ['000_zero-shot'],
      },
      files: [{ path: 'index.ts', content: 'x' }],
    });
    await store.addScore(id, { accuracy: 0.85, tokens: 1234, latencyMs: 567, taskCount: 30 });

    const meta = await store.readMetadata(id);
    expect(meta.id).toBe(id);
    expect(meta.origin).toMatchObject({ kind: 'proposer', iteration: 3 });

    const score = await store.readScore(id);
    expect(score?.accuracy).toBe(0.85);
  });

  it('returns null for missing score', async () => {
    const id = await store.addCandidate({
      name: 'unscored',
      version: '1.0.0',
      origin: { kind: 'seed' },
      files: [{ path: 'index.ts', content: 'x' }],
    });
    expect(await store.readScore(id)).toBeNull();
  });

  it('listCandidates returns insertion order with hasScore flag', async () => {
    const a = await store.addCandidate({
      name: 'a',
      version: '1.0.0',
      origin: { kind: 'seed' },
      files: [{ path: 'i.ts', content: 'x' }],
    });
    await store.addCandidate({
      name: 'b',
      version: '1.0.0',
      origin: { kind: 'seed' },
      files: [{ path: 'i.ts', content: 'x' }],
    });
    await store.addScore(a, { accuracy: 1, tokens: 10, latencyMs: 100, taskCount: 1 });
    const list = await store.listCandidates();
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(a);
    expect(list[0]?.hasScore).toBe(true);
    expect(list[1]?.hasScore).toBe(false);
  });

  it('listCandidates returns empty array on missing root', async () => {
    const empty = new CandidateStore(path.join(storePath, 'does-not-exist'));
    expect(await empty.listCandidates()).toEqual([]);
  });

  it('traces persisted per task', async () => {
    const id = await store.addCandidate({
      name: 'traced',
      version: '1.0.0',
      origin: { kind: 'seed' },
      files: [{ path: 'i.ts', content: 'x' }],
    });
    await store.addTrace(id, {
      taskId: 'qa-001',
      steps: [
        { name: 'graph.query', payload: { q: 'test' }, t: 0 },
        { name: 'inference.complete', payload: { tokens: 50 }, t: 100 },
      ],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    const traces = await store.readTraces(id);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.taskId).toBe('qa-001');
    expect(traces[0]?.steps).toHaveLength(2);
  });
});
