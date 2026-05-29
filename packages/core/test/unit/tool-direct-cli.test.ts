import { beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();
const callToolMock = vi.fn();
const writeSyncMock = vi.fn();
const findRepoMock = vi.fn();

vi.mock('../../src/mcp/local/local-backend.js', () => ({
  LocalBackend: class {
    init = initMock;
    callTool = callToolMock;
  },
}));

vi.mock('node:fs', () => ({
  writeSync: writeSyncMock,
}));

vi.mock('../../src/storage/repo-manager.js', () => ({
  findRepo: findRepoMock,
}));

describe('direct CLI tool commands', () => {
  beforeEach(() => {
    vi.resetModules();
    initMock.mockReset();
    callToolMock.mockReset();
    writeSyncMock.mockReset();
    findRepoMock.mockReset();
    initMock.mockResolvedValue(true);
    findRepoMock.mockResolvedValue({ repoPath: 'D:\\repo' });
    process.exitCode = undefined;
  });

  it('dispatches detect_changes with CLI-shaped arguments', async () => {
    callToolMock.mockResolvedValue({
      summary: {
        changed_files: 1,
        changed_count: 2,
        affected_count: 1,
        risk_level: 'low',
      },
    });
    const { detectChangesCommand } = await import('../../src/cli/tool.js');

    await detectChangesCommand({
      scope: 'compare',
      baseRef: 'main',
      repo: '@codragraph/cli',
    });

    expect(callToolMock).toHaveBeenCalledWith('detect_changes', {
      scope: 'compare',
      base_ref: 'main',
      repo: '@codragraph/cli',
    });
    expect(findRepoMock).not.toHaveBeenCalled();
    expect(writeSyncMock).toHaveBeenCalledWith(1, expect.stringContaining('Risk level: low'));
  });

  it('defaults query to the indexed repo under cwd instead of any single registry repo', async () => {
    callToolMock.mockResolvedValue({ results: [] });
    const { queryCommand } = await import('../../src/cli/tool.js');

    await queryCommand('auth flow', {});

    expect(callToolMock).toHaveBeenCalledWith('query', {
      query: 'auth flow',
      task_context: undefined,
      goal: undefined,
      limit: undefined,
      include_content: false,
      repo: 'D:\\repo',
    });
  });

  it('refuses query from an unindexed cwd instead of falling back to another repo', async () => {
    findRepoMock.mockResolvedValue(null);
    const { queryCommand } = await import('../../src/cli/tool.js');

    await queryCommand('auth flow', {});

    expect(callToolMock).not.toHaveBeenCalled();
    expect(writeSyncMock).toHaveBeenCalledWith(
      1,
      expect.stringContaining('Current repository is not indexed'),
    );
    expect(process.exitCode).toBe(1);
  });

  it('defaults detect_changes to the indexed repo under cwd instead of any single registry repo', async () => {
    callToolMock.mockResolvedValue({
      summary: {
        changed_files: 1,
        changed_count: 1,
        affected_count: 0,
        risk_level: 'low',
      },
    });
    const { detectChangesCommand } = await import('../../src/cli/tool.js');

    await detectChangesCommand({});

    expect(callToolMock).toHaveBeenCalledWith('detect_changes', {
      scope: 'unstaged',
      base_ref: undefined,
      repo: 'D:\\repo',
    });
  });

  it('refuses detect_changes from an unindexed cwd instead of falling back to another repo', async () => {
    findRepoMock.mockResolvedValue(null);
    const { detectChangesCommand } = await import('../../src/cli/tool.js');

    await detectChangesCommand({});

    expect(callToolMock).not.toHaveBeenCalled();
    expect(writeSyncMock).toHaveBeenCalledWith(
      1,
      expect.stringContaining('Current repository is not indexed'),
    );
    expect(process.exitCode).toBe(1);
  });

  it('prints "No changes detected." when changed_count is 0', async () => {
    callToolMock.mockResolvedValue({
      summary: { changed_files: 0, changed_count: 0, affected_count: 0, risk_level: 'low' },
    });
    const { detectChangesCommand } = await import('../../src/cli/tool.js');

    await detectChangesCommand({});

    expect(writeSyncMock).toHaveBeenCalledWith(1, expect.stringContaining('No changes detected.'));
  });

  it('prints error message when result contains an error', async () => {
    callToolMock.mockResolvedValue({ error: 'index is stale' });
    const { detectChangesCommand } = await import('../../src/cli/tool.js');

    await detectChangesCommand({});

    expect(writeSyncMock).toHaveBeenCalledWith(1, expect.stringContaining('Error: index is stale'));
  });

  it('truncates changed_symbols list beyond 15 and shows overflow count', async () => {
    const symbols = Array.from({ length: 17 }, (_, i) => ({
      type: 'function',
      name: `fn${i}`,
      filePath: `src/file${i}.ts`,
    }));
    callToolMock.mockResolvedValue({
      summary: { changed_files: 17, changed_count: 17, affected_count: 0, risk_level: 'low' },
      changed_symbols: symbols,
    });
    const { detectChangesCommand } = await import('../../src/cli/tool.js');

    await detectChangesCommand({});

    const output: string = writeSyncMock.mock.calls[0][1];
    expect(output).toContain('function fn14 → src/file14.ts');
    expect(output).not.toContain('fn15');
    expect(output).toContain('... and 2 more');
  });

  it('truncates affected_processes list beyond 10', async () => {
    const processes = Array.from({ length: 12 }, (_, i) => ({
      name: `proc${i}`,
      step_count: 3,
      changed_steps: [{ symbol: `sym${i}` }],
    }));
    callToolMock.mockResolvedValue({
      summary: { changed_files: 1, changed_count: 1, affected_count: 12, risk_level: 'low' },
      affected_processes: processes,
    });
    const { detectChangesCommand } = await import('../../src/cli/tool.js');

    await detectChangesCommand({});

    const output: string = writeSyncMock.mock.calls[0][1];
    expect(output).toContain('proc9');
    expect(output).not.toContain('proc10');
  });
});
