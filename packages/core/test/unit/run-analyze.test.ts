import { beforeAll, describe, it, expect } from 'vitest';

let mod: typeof import('../../src/core/run-analyze.js');

beforeAll(async () => {
  mod = await import('../../src/core/run-analyze.js');
}, 60_000);

describe('run-analyze module', () => {
  it('exports runFullAnalysis as a function', () => {
    expect(typeof mod.runFullAnalysis).toBe('function');
  });

  it('exports PHASE_LABELS', () => {
    expect(mod.PHASE_LABELS).toBeDefined();
    expect(mod.PHASE_LABELS.parsing).toBe('Parsing code');
  });

  it('parses git name-status output including renames', () => {
    expect(mod.parseGitNameStatus('M\0src/index.ts\0R100\0old.ts\0new.ts\0')).toEqual([
      { status: 'M', path: 'src/index.ts' },
      { status: 'R100', path: 'new.ts', previousPath: 'old.ts' },
    ]);
  });

  it('classifies changed paths that require a graph rebuild', () => {
    expect(mod.isGraphContentPath('src/cli/index.ts')).toBe(true);
    expect(mod.isGraphContentPath('docs/AI_AGENT_CLI_GUIDE.md')).toBe(true);
    expect(mod.isGraphContentPath('package.json')).toBe(true);
    expect(mod.isGraphContentPath('.gitignore')).toBe(true);
    expect(mod.isGraphContentPath('AGENTS.md')).toBe(false);
    expect(mod.isGraphContentPath('package-lock.json')).toBe(false);
    expect(mod.isGraphContentPath('branding/logo.png')).toBe(false);

    expect(
      mod.getGraphRelevantChangedPaths([
        { status: 'M', path: 'package-lock.json' },
        { status: 'M', path: 'AGENTS.md' },
        { status: 'M', path: 'src/core/run-analyze.ts' },
        { status: 'A', path: 'notes/architecture.txt' },
      ]),
    ).toEqual([
      { status: 'M', path: 'src/core/run-analyze.ts' },
      { status: 'A', path: 'notes/architecture.txt' },
    ]);
  });

  it('forces rebuild when analyze options request missing index layers', () => {
    expect(
      mod.getAnalyzeConfigRebuildReason(
        { compress: 'none', stats: { embeddings: 0 } },
        {
          embeddings: true,
        },
      ),
    ).toContain('embeddings');

    expect(
      mod.getAnalyzeConfigRebuildReason(
        { compress: 'none', stats: { embeddings: 12 } },
        {
          compress: 'brotli',
        },
      ),
    ).toContain('compression');

    expect(
      mod.getAnalyzeConfigRebuildReason(
        { compress: 'brotli', stats: { embeddings: 12 } },
        {
          compress: 'brotli',
          embeddings: true,
        },
      ),
    ).toBeNull();
  });
});
