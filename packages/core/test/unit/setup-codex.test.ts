import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CLI_PACKAGE_SPEC } from '../helpers/cli-package-spec.js';

const execFileMock = vi.fn((...args: any[]) => {
  const callback = args.at(-1);
  if (typeof callback === 'function') {
    callback(null, '', '');
  }
});

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

describe('setupCommand codex execution', () => {
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
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-codex-setup-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    delete process.env.npm_config_user_agent;
    delete process.env.npm_execpath;

    await fs.mkdir(path.join(tempHome, '.codex'), { recursive: true });

    platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    setPlatform('win32');
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

  it('invokes codex.cmd on Windows so .cmd shims resolve via execFile', async () => {
    const { setupCommand } = await import('../../src/cli/setup.js');

    await setupCommand();

    expect(execFileMock).toHaveBeenCalledWith(
      'codex.cmd',
      ['mcp', 'add', 'codragraph', '--', 'cmd', '/c', 'npx', '-y', CLI_PACKAGE_SPEC, 'mcp'],
      expect.any(Function),
    );
  });

  it('invokes codex (no .cmd) on non-Windows and does not write fallback config', async () => {
    setPlatform('darwin');

    const { setupCommand } = await import('../../src/cli/setup.js');

    await setupCommand();

    expect(execFileMock).toHaveBeenCalledWith(
      'codex',
      ['mcp', 'add', 'codragraph', '--', 'npx', '-y', CLI_PACKAGE_SPEC, 'mcp'],
      expect.any(Function),
    );

    await expect(fs.access(path.join(tempHome, '.codex', 'config.toml'))).rejects.toThrow();
  });

  it('passes bunx fallback to codex when setup is invoked through Bun', async () => {
    setPlatform('darwin');
    process.env.npm_config_user_agent = 'bun/1.3.13 npm/? node/v22.0.0 darwin x64';

    const { setupCommand } = await import('../../src/cli/setup.js');

    await setupCommand();

    expect(execFileMock).toHaveBeenCalledWith(
      'codex',
      ['mcp', 'add', 'codragraph', '--', 'bunx', CLI_PACKAGE_SPEC, 'mcp'],
      expect.any(Function),
    );
  });

  it('skips Codex setup entirely when ~/.codex is missing', async () => {
    await fs.rm(path.join(tempHome, '.codex'), { recursive: true, force: true });

    const { setupCommand } = await import('../../src/cli/setup.js');

    await setupCommand();

    expect(execFileMock).not.toHaveBeenCalled();
    await expect(fs.access(path.join(tempHome, '.agents', 'skills'))).rejects.toThrow();
  });
});
