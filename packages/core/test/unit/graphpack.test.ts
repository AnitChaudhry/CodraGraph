import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FsCAS,
  createCommit,
  putJson,
  setHead,
  writeHeadBranch,
  type Snapshot,
  type SnapshotManifest,
} from '@codragraph/graphstore';
import { GRAPHSTORE_SUBDIR } from '../../src/core/graphstore/index.js';
import {
  defaultLockPath,
  getGraphpackStatus,
  publishGraphpack,
  pullGraphpack,
  readGraphpackLock,
} from '../../src/core/graphpack/index.js';
import { saveMeta } from '../../src/storage/repo-manager.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codragraph-graphpack-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('graphpack', () => {
  it('publishes a thin lock and manifest over a graphstore snapshot', async () => {
    const repoPath = path.join(tmpRoot, 'repo');
    const storagePath = path.join(repoPath, '.codragraph');
    await fs.mkdir(path.join(storagePath, GRAPHSTORE_SUBDIR), { recursive: true });
    await saveMeta(storagePath, {
      repoPath,
      lastCommit: 'abc123',
      indexedAt: '2026-06-01T00:00:00.000Z',
      schemaVersion: 4,
      compress: 'brotli',
      stats: { files: 1, nodes: 1, edges: 0 },
    });
    const cas = new FsCAS({ root: path.join(storagePath, GRAPHSTORE_SUBDIR) });
    const manifest: SnapshotManifest = {
      schemaVersion: 1,
      type: 'snapshot-manifest',
      nodeTables: {},
      edges: { rowCount: 0, rows: {} },
    };
    const manifestId = await putJson(cas, manifest);
    const snapshot: Snapshot = {
      schemaVersion: 1,
      type: 'snapshot',
      manifestId,
      createdAt: '2026-06-01T00:00:00.000Z',
      indexedRepoCommit: 'abc123',
    };
    const snapshotId = await putJson(cas, snapshot);
    const commit = await createCommit({
      cas,
      snapshot: snapshotId,
      parents: [],
      author: { name: 'test', email: 'test@example.com' },
      message: 'test graph',
    });
    await setHead({
      root: path.join(storagePath, GRAPHSTORE_SUBDIR),
      branch: 'main',
      commit: commit.commitId,
    });
    await writeHeadBranch({ root: path.join(storagePath, GRAPHSTORE_SUBDIR), branch: 'main' });

    const result = await publishGraphpack({
      repoPath,
      storagePath,
      repoName: 'demo',
      analyzerVersion: 'test',
      target: 'main',
    });
    const lock = await readGraphpackLock(result.lockPath);
    const lockRaw = await fs.readFile(result.lockPath, 'utf-8');

    expect(lock?.kind).toBe('codragraph-index-lock');
    expect(lock?.graphpack.graphstoreSnapshot).toBe(snapshotId);
    expect(lock?.chunks.map((c) => c.kind)).toEqual(['manifest', 'graphstore-cas']);
    expect(lockRaw.length).toBeLessThan(5000);
    await expect(fs.stat(result.manifestPath)).resolves.toBeTruthy();
  });

  it('reports a missing lock as a local/missing graph source without throwing', async () => {
    const repoPath = path.join(tmpRoot, 'repo');
    const storagePath = path.join(repoPath, '.codragraph');
    await fs.mkdir(storagePath, { recursive: true });

    const status = await getGraphpackStatus({ repoPath, storagePath });

    expect(status.lockPresent).toBe(false);
    expect(status.lockPath).toBe(defaultLockPath(repoPath));
    expect(status.source).toBe('missing');
    expect(status.compatibility.ok).toBe(true);
  });

  it('pulls a graphpack artifact into an empty local graphstore and verifies checksums', async () => {
    const fixture = await createGraphpackFixture();
    await fs.writeFile(
      path.join(fixture.storagePath, 'semantic-relationships.json'),
      JSON.stringify({ relationships: [] }),
    );
    const published = await publishGraphpack({
      repoPath: fixture.repoPath,
      storagePath: fixture.storagePath,
      repoName: 'demo',
      analyzerVersion: 'test',
      target: 'main',
    });
    const artifactRoot = path.join(tmpRoot, 'downloaded-artifact');
    await fs.mkdir(artifactRoot, { recursive: true });
    await fs.cp(
      path.join(fixture.storagePath, GRAPHSTORE_SUBDIR),
      path.join(artifactRoot, GRAPHSTORE_SUBDIR),
      {
        recursive: true,
      },
    );
    await fs.cp(
      path.join(fixture.storagePath, 'graphpacks'),
      path.join(artifactRoot, 'graphpacks'),
      {
        recursive: true,
      },
    );
    await fs.copyFile(
      path.join(fixture.storagePath, 'meta.json'),
      path.join(artifactRoot, 'meta.json'),
    );
    await fs.copyFile(
      path.join(fixture.storagePath, 'semantic-relationships.json'),
      path.join(artifactRoot, 'semantic-relationships.json'),
    );
    await fs.rm(path.join(fixture.storagePath, GRAPHSTORE_SUBDIR), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(fixture.storagePath, 'graphpacks'), { recursive: true, force: true });
    await fs.rm(path.join(fixture.storagePath, 'meta.json'), { force: true });
    await fs.rm(path.join(fixture.storagePath, 'semantic-relationships.json'), { force: true });

    const pulled = await pullGraphpack({
      repoPath: fixture.repoPath,
      storagePath: fixture.storagePath,
      artifactDir: artifactRoot,
    });

    expect(pulled.pulled).toBe(true);
    expect(pulled.fallbackRequired).toBe(false);
    expect(pulled.materializable).toBe(true);
    expect(pulled.status.chunks.verified).toBe(published.lock.chunks.length);
    expect(pulled.status.chunks.missing).toEqual([]);
    expect(pulled.status.chunks.mismatched).toEqual([]);
    expect(pulled.status.local.headCommit).toBe(published.lock.graphpack.graphstoreHeadCommit);
    await expect(
      fs.stat(path.join(fixture.storagePath, 'semantic-relationships.json')),
    ).resolves.toBeTruthy();
  });

  it('reports a checksum mismatch when local graphstore content drifts from the lock', async () => {
    const fixture = await createGraphpackFixture();
    await publishGraphpack({
      repoPath: fixture.repoPath,
      storagePath: fixture.storagePath,
      repoName: 'demo',
      analyzerVersion: 'test',
      target: 'main',
    });
    await fs.writeFile(
      path.join(fixture.storagePath, GRAPHSTORE_SUBDIR, 'extra-corrupt-file'),
      'corrupt',
    );

    const status = await getGraphpackStatus({
      repoPath: fixture.repoPath,
      storagePath: fixture.storagePath,
      strict: true,
    });

    expect(status.compatibility.ok).toBe(false);
    expect(status.chunks.mismatched).toContain(GRAPHSTORE_SUBDIR);
  });

  it('requires fallback when the lock exists but artifact chunks are unavailable', async () => {
    const fixture = await createGraphpackFixture();
    await publishGraphpack({
      repoPath: fixture.repoPath,
      storagePath: fixture.storagePath,
      repoName: 'demo',
      analyzerVersion: 'test',
      target: 'main',
    });
    await fs.rm(path.join(fixture.storagePath, GRAPHSTORE_SUBDIR), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(fixture.storagePath, 'graphpacks'), { recursive: true, force: true });

    const pulled = await pullGraphpack({
      repoPath: fixture.repoPath,
      storagePath: fixture.storagePath,
    });

    expect(pulled.pulled).toBe(false);
    expect(pulled.fallbackRequired).toBe(true);
    expect(pulled.materializable).toBe(false);
    expect(pulled.reason).toContain('Missing graphpack chunk');
    expect(pulled.status.chunks.missing).toContain(GRAPHSTORE_SUBDIR);
  });
});

const createGraphpackFixture = async (): Promise<{
  repoPath: string;
  storagePath: string;
  snapshotId: string;
}> => {
  const repoPath = path.join(tmpRoot, `repo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const storagePath = path.join(repoPath, '.codragraph');
  await fs.mkdir(path.join(storagePath, GRAPHSTORE_SUBDIR), { recursive: true });
  await saveMeta(storagePath, {
    repoPath,
    lastCommit: 'abc123',
    indexedAt: '2026-06-01T00:00:00.000Z',
    schemaVersion: 4,
    compress: 'brotli',
    stats: { files: 1, nodes: 1, edges: 0 },
  });
  const cas = new FsCAS({ root: path.join(storagePath, GRAPHSTORE_SUBDIR) });
  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    type: 'snapshot-manifest',
    nodeTables: {},
    edges: { rowCount: 0, rows: {} },
  };
  const manifestId = await putJson(cas, manifest);
  const snapshot: Snapshot = {
    schemaVersion: 1,
    type: 'snapshot',
    manifestId,
    createdAt: '2026-06-01T00:00:00.000Z',
    indexedRepoCommit: 'abc123',
  };
  const snapshotId = await putJson(cas, snapshot);
  const commit = await createCommit({
    cas,
    snapshot: snapshotId,
    parents: [],
    author: { name: 'test', email: 'test@example.com' },
    message: 'test graph',
  });
  await setHead({
    root: path.join(storagePath, GRAPHSTORE_SUBDIR),
    branch: 'main',
    commit: commit.commitId,
  });
  await writeHeadBranch({ root: path.join(storagePath, GRAPHSTORE_SUBDIR), branch: 'main' });
  return { repoPath, storagePath, snapshotId };
};
