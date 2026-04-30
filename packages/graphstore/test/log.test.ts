import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FsCAS } from '../src/cas/fs-cas.js';
import { createCommit } from '../src/history/commit.js';
import { walkCommits, findLowestCommonAncestor } from '../src/history/log.js';
import { makeObjectId, type ObjectId } from '../src/types.js';

let tmpRoot: string;
let cas: FsCAS;
const dummySnapshot = makeObjectId('c'.repeat(64));
const author = { name: 'test', email: 't@example.com' };

const commit = async (parents: ObjectId[], message: string, ts: string) => {
  const { commitId } = await createCommit({
    cas,
    snapshot: dummySnapshot,
    parents,
    author,
    message,
    ts,
  });
  return commitId;
};

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'graphstore-log-'));
  cas = new FsCAS({ root: tmpRoot });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('walkCommits', () => {
  it('yields a linear history newest-first', async () => {
    const c1 = await commit([], 'init', '2026-01-01T00:00:00Z');
    const c2 = await commit([c1], 'two', '2026-01-02T00:00:00Z');
    const c3 = await commit([c2], 'three', '2026-01-03T00:00:00Z');

    const seen: string[] = [];
    for await (const entry of walkCommits({ cas, from: c3 })) {
      seen.push(entry.commit.message);
    }
    expect(seen).toEqual(['three', 'two', 'init']);
  });

  it('respects the limit option', async () => {
    const c1 = await commit([], 'init', '2026-01-01T00:00:00Z');
    const c2 = await commit([c1], 'two', '2026-01-02T00:00:00Z');
    const c3 = await commit([c2], 'three', '2026-01-03T00:00:00Z');

    const seen: string[] = [];
    for await (const entry of walkCommits({ cas, from: c3, limit: 2 })) {
      seen.push(entry.commit.message);
    }
    expect(seen).toEqual(['three', 'two']);
  });

  it('dedupes a re-converging history (merge)', async () => {
    const root = await commit([], 'init', '2026-01-01T00:00:00Z');
    const left = await commit([root], 'L', '2026-01-02T00:00:00Z');
    const right = await commit([root], 'R', '2026-01-03T00:00:00Z');
    const merge = await commit([left, right], 'merge', '2026-01-04T00:00:00Z');

    const seen = new Set<string>();
    for await (const entry of walkCommits({ cas, from: merge })) {
      seen.add(entry.commit.message);
    }
    expect(seen).toEqual(new Set(['merge', 'L', 'R', 'init']));
  });
});

describe('findLowestCommonAncestor', () => {
  it('returns null for orphan branches with no shared ancestor', async () => {
    const a = await commit([], 'a-root', '2026-01-01T00:00:00Z');
    const b = await commit([], 'b-root', '2026-01-02T00:00:00Z');
    expect(await findLowestCommonAncestor(cas, a, b)).toBeNull();
  });

  it('returns the ancestor for a divergent history', async () => {
    const root = await commit([], 'root', '2026-01-01T00:00:00Z');
    const left = await commit([root], 'L1', '2026-01-02T00:00:00Z');
    const right = await commit([root], 'R1', '2026-01-03T00:00:00Z');
    expect(await findLowestCommonAncestor(cas, left, right)).toBe(root);
  });

  it('returns the older when one is an ancestor of the other', async () => {
    const c1 = await commit([], 'init', '2026-01-01T00:00:00Z');
    const c2 = await commit([c1], 'two', '2026-01-02T00:00:00Z');
    expect(await findLowestCommonAncestor(cas, c1, c2)).toBe(c1);
    expect(await findLowestCommonAncestor(cas, c2, c1)).toBe(c1);
  });

  it('handles identical inputs', async () => {
    const c = await commit([], 'only', '2026-01-01T00:00:00Z');
    expect(await findLowestCommonAncestor(cas, c, c)).toBe(c);
  });
});
