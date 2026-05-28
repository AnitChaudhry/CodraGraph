import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileMock = vi.fn((...args: any[]) => {
  const callback = args.at(-1);
  if (typeof callback === 'function') {
    callback(null, '', '');
  }
});

// By default, execFileSync throws (simulating `which codragraph` not found)
// so getMcpEntry() falls back to the npx path.
const execFileSyncMock = vi.fn(() => {
  throw new Error('not found');
});

vi.mock('child_process', () => ({
  execFile: execFileMock,
  execFileSync: execFileSyncMock,
}));

describe('setupClaudeCode', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalUserAgent: string | undefined;
  let originalNpmExecPath: string | undefined;
  let platformDescriptor: PropertyDescriptor | undefined;

  const setPlatform = (value: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', {
      value,
      configurable: true,
    });
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalUserAgent = process.env.npm_config_user_agent;
    originalNpmExecPath = process.env.npm_execpath;
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-claude-setup-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    delete process.env.npm_config_user_agent;
    delete process.env.npm_execpath;

    // Only create ~/.claude â€” no other editor directories so their
    // setup functions skip and don't pollute assertions.
    await fs.mkdir(path.join(tempHome, '.claude'), { recursive: true });

    platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }

    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (originalUserAgent === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = originalUserAgent;
    if (originalNpmExecPath === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = originalNpmExecPath;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('writes win32 MCP entry with cmd wrapper', async () => {
    setPlatform('win32');

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toEqual({
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@codragraph/cli@2.1.4', 'mcp'],
    });
  });

  it('writes non-win32 MCP entry with npx directly', async () => {
    setPlatform('darwin');

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toEqual({
      command: 'npx',
      args: ['-y', '@codragraph/cli@2.1.4', 'mcp'],
    });
  });

  it('skips when ~/.claude directory does not exist', async () => {
    await fs.rm(path.join(tempHome, '.claude'), { recursive: true, force: true });

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    await expect(fs.access(path.join(tempHome, '.claude.json'))).rejects.toThrow();
  });

  it('preserves existing keys in ~/.claude.json', async () => {
    setPlatform('linux');

    await fs.writeFile(
      path.join(tempHome, '.claude.json'),
      JSON.stringify({ existingKey: 'keep-me', mcpServers: { other: { command: 'foo' } } }),
      'utf-8',
    );

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.existingKey).toBe('keep-me');
    expect(config.mcpServers.other).toEqual({ command: 'foo' });
    expect(config.mcpServers.codragraph).toBeDefined();
  });

  it('handles missing ~/.claude.json (creates fresh)', async () => {
    setPlatform('linux');

    // Ensure no pre-existing file
    await fs.rm(path.join(tempHome, '.claude.json'), { force: true });

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toBeDefined();
  });

  it('handles corrupt JSON gracefully', async () => {
    setPlatform('linux');

    await fs.writeFile(
      path.join(tempHome, '.claude.json'),
      '{ this is not valid json !!!',
      'utf-8',
    );

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    // readJsonFile returns null on invalid JSON, so mergeMcpConfig
    // creates a fresh config â€” the file should now be valid.
    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toBeDefined();
  });

  it('uses global binary path when codragraph is on PATH', async () => {
    setPlatform('darwin');
    execFileSyncMock.mockReturnValueOnce('/usr/local/bin/codragraph\n');

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toEqual({
      command: '/usr/local/bin/codragraph',
      args: ['mcp'],
    });
  });

  it('falls back to npx when codragraph is not on PATH', async () => {
    setPlatform('darwin');
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error('not found');
    });

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toEqual({
      command: 'npx',
      args: ['-y', '@codragraph/cli@2.1.4', 'mcp'],
    });
  });

  it('falls back to bunx when setup is invoked through Bun', async () => {
    setPlatform('darwin');
    process.env.npm_config_user_agent = 'bun/1.3.13 npm/? node/v22.0.0 darwin x64';
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error('not found');
    });

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toEqual({
      command: 'bunx',
      args: ['@codragraph/cli@2.1.4', 'mcp'],
    });
  });

  it('on Windows, uses cmd /c codragraph mcp when bin is on PATH (any shim)', async () => {
    setPlatform('win32');
    // `where codragraph` typically returns the extensionless Unix shim before
    // `codragraph.cmd` when both are on PATH (e.g. node_modules/.bin). Node's
    // spawn cannot launch the extensionless shim on Windows. Writing the .cmd
    // path directly is also brittle (depends on which shims are present);
    // letting `cmd /c` resolve via PATHEXT works regardless of installer.
    execFileSyncMock.mockReturnValueOnce(
      [
        'C:\\path\\to\\node_modules\\.bin\\codragraph',
        'C:\\path\\to\\node_modules\\.bin\\codragraph.cmd',
        'C:\\path\\to\\node_modules\\.bin\\codragraph.ps1',
      ].join('\r\n') + '\r\n',
    );

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toEqual({
      command: 'cmd',
      args: ['/c', 'codragraph', 'mcp'],
    });
  });

  it('on Windows, falls back to npx when only the extensionless shim is on PATH', async () => {
    setPlatform('win32');
    // Edge case: a partial install left only the Unix shim. resolveCodragraphBin
    // refuses it; falls through to the cmd /c npx fallback instead.
    execFileSyncMock.mockReturnValueOnce('C:\\path\\to\\node_modules\\.bin\\codragraph\n');

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toEqual({
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@codragraph/cli@2.1.4', 'mcp'],
    });
  });

  it('on Windows, falls back to bunx with cmd wrapper when setup is invoked through Bun', async () => {
    setPlatform('win32');
    process.env.npm_execpath = 'C:\\Users\\dev\\.bun\\bin\\bun.exe';
    execFileSyncMock.mockReturnValueOnce('C:\\path\\to\\node_modules\\.bin\\codragraph\n');

    const { setupCommand } = await import('../../src/cli/setup.js');
    await setupCommand();

    const raw = await fs.readFile(path.join(tempHome, '.claude.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.codragraph).toEqual({
      command: 'cmd',
      args: ['/c', 'bunx', '@codragraph/cli@2.1.4', 'mcp'],
    });
  });
});
