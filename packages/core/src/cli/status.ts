/**
 * Status Command
 *
 * Shows the indexing status of the current repository.
 */

import fs from 'fs/promises';
import path from 'path';
import { findRepo, getStoragePaths, hasKuzuIndex, type RepoMeta } from '../storage/repo-manager.js';
import { getCurrentCommit, isGitRepo, getGitRoot } from '../storage/git.js';

export const LARGE_INDEX_WARNING_BYTES = 500 * 1024 * 1024;

export interface IndexStorageSummary {
  path: string;
  bytes: number;
  fileCount: number;
  unreadableEntries: number;
}

const STORAGE_SCAN_BATCH_SIZE = 64;

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${Math.round(value)} ${units[unitIndex]}`;
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

export const summarizeIndexStorage = async (
  storagePath: string,
): Promise<IndexStorageSummary | null> => {
  let rootStat;
  try {
    rootStat = await fs.lstat(storagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { path: storagePath, bytes: 0, fileCount: 0, unreadableEntries: 1 };
  }

  if (!rootStat.isDirectory()) {
    return { path: storagePath, bytes: rootStat.size, fileCount: 1, unreadableEntries: 0 };
  }

  const stack = [storagePath];
  let bytes = 0;
  let fileCount = 0;
  let unreadableEntries = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      unreadableEntries += 1;
      continue;
    }

    for (let i = 0; i < entries.length; i += STORAGE_SCAN_BATCH_SIZE) {
      const batch = entries.slice(i, i + STORAGE_SCAN_BATCH_SIZE);
      const stats = await Promise.all(
        batch.map(async (entry) => {
          const entryPath = path.join(current, entry.name);
          try {
            return { entryPath, stat: await fs.lstat(entryPath) };
          } catch {
            return { entryPath, stat: null };
          }
        }),
      );

      for (const { entryPath, stat } of stats) {
        if (!stat) {
          unreadableEntries += 1;
          continue;
        }

        if (stat.isDirectory()) {
          stack.push(entryPath);
          continue;
        }

        bytes += stat.size;
        fileCount += 1;
      }
    }
  }

  return { path: storagePath, bytes, fileCount, unreadableEntries };
};

export const formatIndexStatusLines = (
  summary: IndexStorageSummary | null,
  meta: Pick<RepoMeta, 'stats' | 'compress' | 'adaptiveProfile'>,
  options: { largeIndexWarningBytes?: number } = {},
): string[] => {
  const lines: string[] = [];
  const threshold = options.largeIndexWarningBytes ?? LARGE_INDEX_WARNING_BYTES;

  if (summary) {
    const fileLabel = summary.fileCount === 1 ? 'file' : 'files';
    lines.push(
      `Index size: ${formatBytes(summary.bytes)} (${summary.fileCount.toLocaleString('en-US')} ${fileLabel} under .codragraph)`,
    );

    if (summary.unreadableEntries > 0) {
      const entryLabel = summary.unreadableEntries === 1 ? 'entry' : 'entries';
      lines.push(
        `Index size note: ${summary.unreadableEntries.toLocaleString('en-US')} ${entryLabel} could not be read.`,
      );
    }

    if (summary.bytes >= threshold) {
      lines.push(
        `Storage warning: .codragraph is ${formatBytes(summary.bytes)} (>= ${formatBytes(threshold)}). Consider codragraph analyze --compress brotli (or zstd on Node >=22.15) and only use --embeddings when vectors are needed.`,
      );
    }
  }

  const embeddings = meta.stats?.embeddings;
  lines.push(
    `Embeddings: ${typeof embeddings === 'number' ? embeddings.toLocaleString('en-US') : 'unknown'}`,
  );
  lines.push(`Compression: ${meta.compress ?? 'none'}`);
  if (meta.adaptiveProfile?.resolved) {
    const profile = meta.adaptiveProfile;
    const workerText =
      typeof profile.workerPoolSize === 'number' ? `, workers ${profile.workerPoolSize}` : '';
    const embeddingText = profile.embeddingDecision
      ? `, embeddings ${profile.embeddingDecision}`
      : '';
    lines.push(`Adaptive profile: ${profile.resolved}${workerText}${embeddingText}`);
  }

  return lines;
};

export const statusCommand = async () => {
  const cwd = process.cwd();

  if (!isGitRepo(cwd)) {
    console.log('Not a git repository.');
    return;
  }

  const repo = await findRepo(cwd);
  if (!repo) {
    // Check if there's a stale KuzuDB index that needs migration
    const repoRoot = getGitRoot(cwd) ?? cwd;
    const { storagePath } = getStoragePaths(repoRoot);
    const storageSummary = await summarizeIndexStorage(storagePath);
    if (await hasKuzuIndex(storagePath)) {
      console.log('Repository has a stale KuzuDB index from a previous version.');
      console.log('Run: codragraph analyze   (rebuilds the index with LadybugDB)');
    } else {
      console.log('Repository not indexed.');
      console.log('Run: codragraph analyze');
    }
    if (storageSummary) {
      for (const line of formatIndexStatusLines(storageSummary, {})) console.log(line);
    }
    return;
  }

  const currentCommit = getCurrentCommit(repo.repoPath);
  const isUpToDate = currentCommit === repo.meta.lastCommit;
  const storageSummary = await summarizeIndexStorage(repo.storagePath);

  console.log(`Repository: ${repo.repoPath}`);
  console.log(`Indexed: ${new Date(repo.meta.indexedAt).toLocaleString()}`);
  console.log(`Indexed commit: ${repo.meta.lastCommit?.slice(0, 7)}`);
  console.log(`Current commit: ${currentCommit?.slice(0, 7)}`);
  for (const line of formatIndexStatusLines(storageSummary, repo.meta)) console.log(line);
  console.log(`Status: ${isUpToDate ? '✅ up-to-date' : '⚠️ stale (re-run codragraph analyze)'}`);
};
