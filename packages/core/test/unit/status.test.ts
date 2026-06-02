import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  formatBytes,
  formatIndexStatusLines,
  LARGE_INDEX_WARNING_BYTES,
  summarizeIndexStorage,
} from '../../src/cli/status.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('status storage helpers', () => {
  it('formats bytes with binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(500 * 1024 * 1024)).toBe('500.0 MB');
  });

  it('formats index size, embeddings, compression, and large-index warning', () => {
    const lines = formatIndexStatusLines(
      {
        path: '/repo/.codragraph',
        bytes: LARGE_INDEX_WARNING_BYTES,
        fileCount: 3,
        unreadableEntries: 0,
      },
      {
        stats: { embeddings: 1234 },
        compress: 'zstd',
        adaptiveProfile: {
          resolved: 'power',
          workerPoolSize: 6,
          embeddingDecision: 'enabled',
        },
      },
    );

    expect(lines).toContain('Index size: 500.0 MB (3 files under .codragraph)');
    expect(lines).toContain('Embeddings: 1,234');
    expect(lines).toContain('Compression: zstd');
    expect(lines).toContain('Adaptive profile: power, workers 6, embeddings enabled');
    expect(lines.join('\n')).toContain('Storage warning: .codragraph is 500.0 MB');
    expect(lines.join('\n')).toContain('--compress brotli');
    expect(lines.join('\n')).toContain('zstd on Node >=22.15');
    expect(lines.join('\n')).toContain('--embeddings');
  });

  it('omits the large-index warning below the configured threshold', () => {
    const lines = formatIndexStatusLines(
      {
        path: '/repo/.codragraph',
        bytes: 1024,
        fileCount: 1,
        unreadableEntries: 0,
      },
      { stats: { embeddings: 0 }, compress: 'none' },
      { largeIndexWarningBytes: 2048 },
    );

    expect(lines).toContain('Index size: 1.0 KB (1 file under .codragraph)');
    expect(lines).toContain('Embeddings: 0');
    expect(lines).toContain('Compression: none');
    expect(lines.join('\n')).not.toContain('Storage warning');
  });

  it('sums files only under the .codragraph directory', async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codragraph-status-'));
    tmpDirs.push(repoDir);

    const storagePath = path.join(repoDir, '.codragraph');
    await fs.mkdir(path.join(storagePath, 'cgdb'), { recursive: true });
    await fs.writeFile(path.join(storagePath, 'meta.json'), '{}');
    await fs.writeFile(path.join(storagePath, 'cgdb', 'data.bin'), '12345');
    await fs.writeFile(path.join(repoDir, 'source.ts'), 'this file is outside the index');

    const summary = await summarizeIndexStorage(storagePath);

    expect(summary).toEqual({
      path: storagePath,
      bytes: 7,
      fileCount: 2,
      unreadableEntries: 0,
    });
  });
});
