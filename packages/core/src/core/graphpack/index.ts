import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FsCAS,
  getJson,
  readCommit,
  readHead,
  resolveHeadCommit,
  type Snapshot,
  type ObjectId,
} from '@codragraph/graphstore';
import { GRAPHSTORE_SUBDIR } from '../graphstore/index.js';
import { getCurrentCommit, getRemoteUrl } from '../../storage/git.js';
import { INDEX_SCHEMA_VERSION, loadMeta } from '../../storage/repo-manager.js';
import {
  GRAPHPACK_LOCK_KIND,
  GRAPHPACK_LOCK_SCHEMA_VERSION,
  GRAPHPACK_MANIFEST_SCHEMA_VERSION,
  INDEX_LOCK_RELATIVE_PATH,
  type GraphpackBootstrapResult,
  type GraphpackChunk,
  type GraphpackManifest,
  type GraphpackManifestFile,
  type GraphpackPublishOptions,
  type GraphpackPublishResult,
  type GraphpackPullOptions,
  type GraphpackPullResult,
  type GraphpackStatus,
  type GraphpackTarget,
  type GraphpackLock,
} from './types.js';

export * from './types.js';

export const defaultLockPath = (repoPath: string): string =>
  path.join(repoPath, INDEX_LOCK_RELATIVE_PATH);

export const readGraphpackLock = async (lockPath: string): Promise<GraphpackLock | null> => {
  try {
    const raw = await fs.readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(raw) as GraphpackLock;
    if (parsed.kind !== GRAPHPACK_LOCK_KIND) {
      throw new Error(`Unexpected graphpack lock kind: ${String((parsed as any).kind)}`);
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
};

export const writeGraphpackLock = async (lockPath: string, lock: GraphpackLock): Promise<void> => {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, `${stableJson(lock)}\n`, 'utf-8');
};

export const publishGraphpack = async (
  opts: GraphpackPublishOptions,
): Promise<GraphpackPublishResult> => {
  const graphstoreRoot = path.join(opts.storagePath, GRAPHSTORE_SUBDIR);
  const cas = new FsCAS({ root: graphstoreRoot });
  const headCommit = await resolveHeadCommit({ root: graphstoreRoot });
  if (headCommit === null) {
    throw new Error(
      'graphpack publish requires a graphstore HEAD. Run `codragraph analyze` first.',
    );
  }

  const commit = await readCommit(cas, headCommit);
  await getJson<Snapshot>(cas, commit.snapshot);
  const meta = await loadMeta(opts.storagePath);
  const files = await collectGraphpackFiles(graphstoreRoot);
  const graphstoreDigest = digestManifestFiles(files);
  const id = makeGraphpackId({
    repoName: opts.repoName,
    target: opts.target,
    headCommit,
    snapshot: commit.snapshot,
  });
  const createdAt = new Date().toISOString();
  const artifactDir =
    opts.artifactDir ?? path.join(opts.storagePath, 'graphpacks', graphpackDirectoryName(id));
  const manifestPath = path.join(artifactDir, 'manifest.json');
  const repoInfo = {
    name: opts.repoName,
    gitCommit: getCurrentCommit(opts.repoPath) || meta?.lastCommit,
    remoteUrl: meta?.remoteUrl ?? getRemoteUrl(opts.repoPath),
    pathHint: normalizeSlash(path.relative(process.cwd(), opts.repoPath) || '.'),
  };
  const overlay =
    opts.target === 'pr' || opts.baseSnapshotId || opts.headSnapshotId || opts.pullRequest
      ? {
          ...(opts.baseSnapshotId ? { baseSnapshotId: opts.baseSnapshotId } : {}),
          ...(opts.headSnapshotId ? { headSnapshotId: opts.headSnapshotId } : {}),
          ...(opts.pullRequest ? { pullRequest: opts.pullRequest } : {}),
        }
      : undefined;

  const manifest: GraphpackManifest = {
    kind: 'codragraph-graphpack-manifest',
    schemaVersion: GRAPHPACK_MANIFEST_SCHEMA_VERSION,
    id,
    target: opts.target,
    createdAt,
    repo: repoInfo,
    graphstore: {
      branch: await currentGraphstoreBranch(graphstoreRoot),
      headCommit,
      snapshot: commit.snapshot,
      digest: graphstoreDigest,
      fileCount: files.length,
      bytes: sumBytes(files),
      files,
    },
    semanticLayerVersion: 'semantic-extractor-v1',
    ...(overlay ? { overlay } : {}),
  };

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(manifestPath, `${stableJson(manifest)}\n`, 'utf-8');
  if (meta) {
    await fs.writeFile(path.join(artifactDir, 'meta.json'), `${stableJson(meta)}\n`, 'utf-8');
  }
  const manifestStat = await fs.stat(manifestPath);
  const manifestHash = await sha256File(manifestPath);

  const chunks: GraphpackChunk[] = [
    {
      path: normalizeSlash(path.relative(opts.storagePath, manifestPath)),
      kind: 'manifest',
      sha256: manifestHash,
      bytes: manifestStat.size,
    },
    {
      path: GRAPHSTORE_SUBDIR,
      kind: 'graphstore-cas',
      sha256: graphstoreDigest,
      bytes: manifest.graphstore.bytes,
      fileCount: manifest.graphstore.fileCount,
    },
  ];
  const semanticRelationshipsPath = path.join(opts.storagePath, 'semantic-relationships.json');
  if (await pathExists(semanticRelationshipsPath)) {
    const semanticStat = await fs.stat(semanticRelationshipsPath);
    chunks.push({
      path: 'semantic-relationships.json',
      kind: 'semantic-relationships',
      sha256: await sha256File(semanticRelationshipsPath),
      bytes: semanticStat.size,
    });
  }

  const lock: GraphpackLock = {
    kind: GRAPHPACK_LOCK_KIND,
    schemaVersion: GRAPHPACK_LOCK_SCHEMA_VERSION,
    repo: repoInfo,
    graphpack: {
      id,
      target: opts.target,
      createdAt,
      ...(opts.artifactUrl ? { artifactUrl: opts.artifactUrl } : {}),
      artifactDir: normalizeSlash(path.relative(opts.repoPath, artifactDir)),
      graphstoreBranch: manifest.graphstore.branch,
      graphstoreHeadCommit: headCommit,
      graphstoreSnapshot: commit.snapshot,
    },
    index: {
      schemaVersion: meta?.schemaVersion ?? INDEX_SCHEMA_VERSION,
      analyzerVersion: opts.analyzerVersion,
      compression: meta?.compress ?? 'none',
      semanticLayerVersion: 'semantic-extractor-v1',
      requiredCapabilities: [
        'graphstore-cas:v1',
        'graphpack-lock:v1',
        'semantic-relationships:v1',
        'recipes-subgraph-signature:v1',
      ],
    },
    chunks,
    ...(overlay ? { overlay } : {}),
  };
  const lockPath = opts.lockPath ?? defaultLockPath(opts.repoPath);
  await writeGraphpackLock(lockPath, lock);

  return { lockPath, manifestPath, lock, manifest };
};

export const getGraphpackStatus = async (opts: {
  repoPath: string;
  storagePath: string;
  lockPath?: string;
  strict?: boolean;
}): Promise<GraphpackStatus> => {
  const lockPath = opts.lockPath ?? defaultLockPath(opts.repoPath);
  const lock = await readGraphpackLock(lockPath);
  const graphstoreRoot = path.join(opts.storagePath, GRAPHSTORE_SUBDIR);
  const localHead = await safeResolveHeadCommit(graphstoreRoot);
  const meta = await loadMeta(opts.storagePath);
  const compatibilityReasons: string[] = [];
  const missing: string[] = [];
  const mismatched: string[] = [];
  let verified = 0;

  if (lock) {
    if (lock.schemaVersion !== GRAPHPACK_LOCK_SCHEMA_VERSION) {
      compatibilityReasons.push(
        `lock schema ${lock.schemaVersion} is not supported by this CLI (${GRAPHPACK_LOCK_SCHEMA_VERSION})`,
      );
    }
    if (lock.index.schemaVersion !== undefined && lock.index.schemaVersion > INDEX_SCHEMA_VERSION) {
      compatibilityReasons.push(
        `index schema ${lock.index.schemaVersion} requires a newer analyzer than this CLI (${INDEX_SCHEMA_VERSION})`,
      );
    }
    for (const chunk of lock.chunks) {
      if (chunk.kind === 'graphstore-cas') {
        if (!(await pathExists(graphstoreRoot))) {
          missing.push(chunk.path);
          continue;
        }
        if (opts.strict) {
          const files = await collectGraphpackFiles(graphstoreRoot);
          const digest = digestManifestFiles(files);
          if (digest === chunk.sha256) verified++;
          else mismatched.push(chunk.path);
        } else {
          verified++;
        }
        continue;
      }

      const full = path.join(opts.storagePath, chunk.path);
      if (!(await pathExists(full))) {
        missing.push(chunk.path);
        continue;
      }
      const actual = await sha256File(full);
      if (actual === chunk.sha256) verified++;
      else mismatched.push(chunk.path);
    }

    if (lock.graphpack.graphstoreHeadCommit && localHead) {
      if (lock.graphpack.graphstoreHeadCommit !== localHead) {
        compatibilityReasons.push(
          `local graphstore HEAD ${shortId(localHead)} does not match lock ${shortId(
            lock.graphpack.graphstoreHeadCommit,
          )}`,
        );
      }
    }
  }

  const source: GraphpackStatus['source'] = !lock
    ? localHead
      ? 'local'
      : 'missing'
    : lock.graphpack.target === 'pr'
      ? 'pr-overlay'
      : 'canonical';

  return {
    repoPath: opts.repoPath,
    storagePath: opts.storagePath,
    lockPath,
    lockPresent: lock !== null,
    ...(lock ? { lock } : {}),
    local: {
      graphstorePresent: await pathExists(graphstoreRoot),
      ...(localHead ? { headCommit: localHead } : {}),
      ...(meta?.schemaVersion !== undefined ? { schemaVersion: meta.schemaVersion } : {}),
      ...(meta ? { analyzerVersion: lock?.index.analyzerVersion } : {}),
    },
    compatibility: {
      ok: compatibilityReasons.length === 0 && mismatched.length === 0,
      reasons: compatibilityReasons,
    },
    chunks: {
      expected: lock?.chunks.length ?? 0,
      verified,
      missing,
      mismatched,
    },
    source,
  };
};

export const pullGraphpack = async (opts: GraphpackPullOptions): Promise<GraphpackPullResult> => {
  const statusBefore = await getGraphpackStatus({
    repoPath: opts.repoPath,
    storagePath: opts.storagePath,
    lockPath: opts.lockPath,
  });
  if (!statusBefore.lock) {
    return {
      status: statusBefore,
      pulled: false,
      materializable: false,
      fallbackRequired: true,
      reason: 'No .codragraph/index.lock.json was found.',
    };
  }

  const lock = statusBefore.lock;
  const artifactRoots = artifactRootCandidates({
    repoPath: opts.repoPath,
    storagePath: opts.storagePath,
    lock,
    artifactDir: opts.artifactDir,
  });
  const copied = new Set<string>();
  for (const chunk of lock.chunks) {
    const source = await findChunkSource(chunk, artifactRoots);
    if (!source) continue;
    if (chunk.kind === 'graphstore-cas') {
      const destination = path.join(opts.storagePath, GRAPHSTORE_SUBDIR);
      if (!samePath(source, destination)) {
        await replaceDirectory(source, destination);
        copied.add(chunk.path);
      }
      continue;
    }
    const destination = path.join(opts.storagePath, chunk.path);
    if (samePath(source, destination)) continue;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    copied.add(chunk.path);
  }
  const metaSource = await findArtifactFile('meta.json', artifactRoots);
  if (metaSource && !samePath(metaSource, path.join(opts.storagePath, 'meta.json'))) {
    await fs.mkdir(opts.storagePath, { recursive: true });
    await fs.copyFile(metaSource, path.join(opts.storagePath, 'meta.json'));
    copied.add('meta.json');
  }

  const status = await getGraphpackStatus({
    repoPath: opts.repoPath,
    storagePath: opts.storagePath,
    lockPath: opts.lockPath,
    strict: true,
  });
  const fallbackRequired =
    status.chunks.missing.length > 0 ||
    status.chunks.mismatched.length > 0 ||
    !status.compatibility.ok;
  return {
    status,
    pulled: copied.size > 0,
    materializable:
      !fallbackRequired &&
      status.lock?.graphpack.graphstoreHeadCommit !== undefined &&
      status.local.graphstorePresent,
    fallbackRequired,
    ...(fallbackRequired
      ? {
          reason:
            status.compatibility.reasons[0] ??
            (status.chunks.missing.length > 0
              ? `Missing graphpack chunk: ${status.chunks.missing[0]}`
              : status.chunks.mismatched.length > 0
                ? `Checksum mismatch for graphpack chunk: ${status.chunks.mismatched[0]}`
                : `No graphpack chunks were found in: ${artifactRoots.join(', ')}`),
        }
      : {}),
  };
};

export const bootstrapGraphpack = async (
  opts: GraphpackPullOptions,
): Promise<GraphpackBootstrapResult> => {
  const pulled = await pullGraphpack(opts);
  return {
    ...pulled,
    fallbackCommand: 'codragraph analyze --skip-agents-md --no-setup',
  };
};

const collectGraphpackFiles = async (root: string): Promise<GraphpackManifestFile[]> => {
  const files: GraphpackManifestFile[] = [];
  await walkFiles(root, async (filePath) => {
    const rel = normalizeSlash(path.relative(path.dirname(root), filePath));
    const stat = await fs.stat(filePath);
    files.push({ path: rel, sha256: await sha256File(filePath), bytes: stat.size });
  });
  return files.sort((a, b) => a.path.localeCompare(b.path));
};

const walkFiles = async (
  root: string,
  visit: (filePath: string) => Promise<void>,
): Promise<void> => {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(full, visit);
    else if (entry.isFile()) await visit(full);
  }
};

const sha256File = async (filePath: string): Promise<string> => {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
};

const digestManifestFiles = (files: readonly GraphpackManifestFile[]): string => {
  const canonical = stableJson(
    files.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })),
  );
  return crypto.createHash('sha256').update(canonical).digest('hex');
};

const stableJson = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) {
          sorted[k] = (v as Record<string, unknown>)[k];
        }
        return sorted;
      }
      return v;
    },
    2,
  );

const sumBytes = (files: readonly GraphpackManifestFile[]): number =>
  files.reduce((sum, f) => sum + f.bytes, 0);

const makeGraphpackId = (input: {
  repoName: string;
  target: GraphpackTarget;
  headCommit: ObjectId;
  snapshot: ObjectId;
}): string => {
  const digest = crypto
    .createHash('sha256')
    .update(`${input.repoName}\n${input.target}\n${input.headCommit}\n${input.snapshot}`)
    .digest('hex');
  return `gpk_${input.target}_${digest.slice(0, 20)}`;
};

const graphpackDirectoryName = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_');

const currentGraphstoreBranch = async (root: string): Promise<string | undefined> => {
  try {
    const head = await readHead({ root });
    return head.kind === 'branch' ? head.branch : undefined;
  } catch {
    return undefined;
  }
};

const safeResolveHeadCommit = async (root: string): Promise<ObjectId | undefined> => {
  try {
    return (await resolveHeadCommit({ root })) ?? undefined;
  } catch {
    return undefined;
  }
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const resolveArtifactDir = (repoPath: string, lock: GraphpackLock): string | undefined => {
  if (lock.graphpack.artifactDir) {
    return path.resolve(repoPath, lock.graphpack.artifactDir);
  }
  if (lock.graphpack.artifactUrl?.startsWith('file://')) {
    return new URL(lock.graphpack.artifactUrl).pathname;
  }
  return undefined;
};

const artifactRootCandidates = (input: {
  repoPath: string;
  storagePath: string;
  lock: GraphpackLock;
  artifactDir?: string;
}): string[] => {
  const candidates: string[] = [];
  const addRootAndParents = (value: string | undefined) => {
    if (!value) return;
    const resolved = path.resolve(value);
    candidates.push(resolved);
    candidates.push(path.join(resolved, '.codragraph'));
    let cursor = resolved;
    for (let i = 0; i < 3; i++) {
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      candidates.push(parent);
      cursor = parent;
    }
  };

  addRootAndParents(input.artifactDir);
  addRootAndParents(resolveArtifactDir(input.repoPath, input.lock));
  candidates.push(input.storagePath);
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
};

const findChunkSource = async (
  chunk: GraphpackChunk,
  roots: readonly string[],
): Promise<string | undefined> => {
  for (const root of roots) {
    const candidates =
      chunk.kind === 'graphstore-cas'
        ? [
            path.join(root, chunk.path),
            path.join(root, GRAPHSTORE_SUBDIR),
            path.basename(root) === GRAPHSTORE_SUBDIR ? root : undefined,
          ]
        : [
            path.join(root, chunk.path),
            path.join(root, path.basename(chunk.path)),
            chunk.kind === 'manifest' ? path.join(root, 'manifest.json') : undefined,
          ];
    for (const candidate of candidates) {
      if (candidate && (await pathExists(candidate))) return candidate;
    }
  }
  return undefined;
};

const findArtifactFile = async (
  relativePath: string,
  roots: readonly string[],
): Promise<string | undefined> => {
  for (const root of roots) {
    const candidate = path.join(root, relativePath);
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
};

const replaceDirectory = async (from: string, to: string): Promise<void> => {
  await fs.rm(to, { recursive: true, force: true });
  await copyDirectory(from, to);
};

const copyDirectory = async (from: string, to: string): Promise<void> => {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDirectory(src, dst);
    else if (entry.isFile()) await fs.copyFile(src, dst);
  }
};

const samePath = (a: string, b: string): boolean => path.resolve(a) === path.resolve(b);

const normalizeSlash = (value: string): string => value.replace(/\\/g, '/');

const shortId = (id: string): string =>
  id.startsWith('sha256:') ? id.slice(7, 19) : id.slice(0, 12);
