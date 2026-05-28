import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOSTED_WEB_APP_URL = process.env.CODRAGRAPH_WEB_URL || 'https://codragraph.vercel.app';

export type WebDashboardMode = 'local' | 'hosted' | 'off';

export interface WebDashboardMountOptions {
  mode?: WebDashboardMode;
  webAppPath?: string;
}

export interface WebDashboardMount {
  mode: WebDashboardMode;
  served: boolean;
  hostedUrl: string;
  localPath?: string;
  reason?: string;
}

export interface WebDashboardInfo {
  mode: WebDashboardMode;
  served: boolean;
  localUrl: string | null;
  hostedUrl: string;
  apiBaseUrl: string;
  reason?: string;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const normalizeWebDashboardMode = (raw: string | undefined): WebDashboardMode => {
  const value = (raw ?? 'local').trim().toLowerCase();
  if (value === 'local' || value === 'hosted' || value === 'off') return value;
  throw new Error(`Invalid web dashboard mode "${raw}". Use one of: local, hosted, off.`);
};

export const getBundledWebAppCandidates = (): string[] => [
  // Published package: packages/core/dist/server/*.js -> packages/core/dist/web
  path.resolve(moduleDir, '..', 'web'),
  // Monorepo/dev fallback after running `npm --prefix apps/web run build`.
  path.resolve(moduleDir, '..', '..', '..', '..', 'apps', 'web', 'dist'),
];

export const hasWebDashboardIndex = (candidate: string): boolean => {
  try {
    return fs.statSync(path.join(candidate, 'index.html')).isFile();
  } catch {
    return false;
  }
};

export const resolveBundledWebAppPath = (
  candidates: readonly string[] = getBundledWebAppCandidates(),
): string | null => {
  for (const candidate of candidates) {
    if (hasWebDashboardIndex(candidate)) return candidate;
  }
  return null;
};

export const mountWebDashboard = (
  app: Express,
  options: WebDashboardMountOptions = {},
): WebDashboardMount => {
  const mode = options.mode ?? 'local';

  if (mode !== 'local') {
    return { mode, served: false, hostedUrl: HOSTED_WEB_APP_URL };
  }

  const webAppPath = options.webAppPath ?? resolveBundledWebAppPath();
  if (!webAppPath || !hasWebDashboardIndex(webAppPath)) {
    return {
      mode,
      served: false,
      hostedUrl: HOSTED_WEB_APP_URL,
      reason: 'Bundled web dashboard not found. Rebuild the package or use --web hosted.',
    };
  }

  app.use(express.static(webAppPath, { index: false }));
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(webAppPath, 'index.html'));
  });

  return { mode, served: true, hostedUrl: HOSTED_WEB_APP_URL, localPath: webAppPath };
};

export const getWebDashboardInfo = (
  mount: WebDashboardMount,
  apiBaseUrl: string,
): WebDashboardInfo => ({
  mode: mount.mode,
  served: mount.served,
  localUrl: mount.served ? apiBaseUrl : null,
  hostedUrl: mount.hostedUrl,
  apiBaseUrl,
  reason: mount.reason,
});
