import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  getWebDashboardInfo,
  mountWebDashboard,
  normalizeWebDashboardMode,
  resolveBundledWebAppPath,
} from '../../src/server/web-dashboard.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const makeWebDist = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codragraph-web-'));
  tmpDirs.push(dir);
  await fs.writeFile(path.join(dir, 'index.html'), '<div id="root"></div>');
  return dir;
};

describe('web dashboard helpers', () => {
  it('normalizes supported dashboard modes', () => {
    expect(normalizeWebDashboardMode(undefined)).toBe('local');
    expect(normalizeWebDashboardMode('local')).toBe('local');
    expect(normalizeWebDashboardMode('hosted')).toBe('hosted');
    expect(normalizeWebDashboardMode('off')).toBe('off');
  });

  it('rejects unsupported dashboard modes', () => {
    expect(() => normalizeWebDashboardMode('remote')).toThrow(
      'Invalid web dashboard mode "remote"',
    );
  });

  it('resolves the first candidate with an index.html file', async () => {
    const missing = path.join(os.tmpdir(), `missing-${Date.now()}`);
    const webDist = await makeWebDist();

    expect(resolveBundledWebAppPath([missing, webDist])).toBe(webDist);
  });

  it('mounts the local dashboard without touching API routes', async () => {
    const webDist = await makeWebDist();
    const app = {
      use: vi.fn(),
      get: vi.fn(),
    } as any;

    const mount = mountWebDashboard(app, { mode: 'local', webAppPath: webDist });

    expect(mount).toMatchObject({ mode: 'local', served: true, localPath: webDist });
    expect(app.use).toHaveBeenCalledTimes(1);
    expect(app.get).toHaveBeenCalledWith(/^\/(?!api(?:\/|$)).*/, expect.any(Function));
  });

  it('keeps hosted mode API-only and reports the hosted URL', () => {
    const app = {
      use: vi.fn(),
      get: vi.fn(),
    } as any;

    const mount = mountWebDashboard(app, { mode: 'hosted' });
    const info = getWebDashboardInfo(mount, 'http://localhost:4747');

    expect(mount.served).toBe(false);
    expect(app.use).not.toHaveBeenCalled();
    expect(app.get).not.toHaveBeenCalled();
    expect(info).toMatchObject({
      mode: 'hosted',
      localUrl: null,
      hostedUrl: 'https://codragraph.vercel.app',
      apiBaseUrl: 'http://localhost:4747',
    });
  });
});
