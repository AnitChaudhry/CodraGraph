#!/usr/bin/env node
/**
 * Build script that compiles @codragraph/cli and inlines @codragraph/shared
 * into the published dist.
 *
 * Steps:
 *  1. Build @codragraph/shared (tsc)
 *  2. Build @codragraph/graphstore (tsc) — @codragraph/cli imports it; without
 *     a populated dist/ here, step 3 fails to resolve types.
 *  3. Build @codragraph/cli (tsc)
 *  4. Copy packages/shared/dist → dist/_shared
 *  5. Rewrite bare '@codragraph/shared' specifiers → relative paths
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const MONOREPO_ROOT = path.resolve(ROOT, '..', '..');
// Workspace directory names — packages live under `packages/<short>` on disk
// and publish as `@codragraph/<short>` on npm.
const SHARED_ROOT = path.resolve(ROOT, '..', 'shared');
const GRAPHSTORE_ROOT = path.resolve(ROOT, '..', 'graphstore');
const WEB_ROOT = path.resolve(MONOREPO_ROOT, 'apps', 'web');
const DIST = path.join(ROOT, 'dist');
const SHARED_DEST = path.join(DIST, '_shared');
const WEB_DEST = path.join(DIST, 'web');
const TSC_BIN = require.resolve('typescript/bin/tsc');

function runTsc(cwd) {
  execFileSync(process.execPath, [TSC_BIN], { cwd, stdio: 'inherit' });
}

function isRunningUnderBun() {
  const userAgent = (process.env.npm_config_user_agent || '').toLowerCase();
  const execBase = path.basename(process.env.npm_execpath || '').toLowerCase();
  return userAgent.startsWith('bun/') || execBase === 'bun' || execBase === 'bun.exe';
}

function runPackageScript(cwd, script) {
  const useBun = isRunningUnderBun();
  const command = useBun ? 'bun' : process.platform === 'win32' ? 'cmd' : 'npm';
  const args = useBun
    ? ['run', script]
    : process.platform === 'win32'
      ? ['/c', 'npm', 'run', script]
      : ['run', script];
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function getWebBuildSkipReason() {
  if (process.env.CODRAGRAPH_SKIP_WEB_BUILD === '1') {
    return 'CODRAGRAPH_SKIP_WEB_BUILD=1';
  }
  if (
    process.env.npm_lifecycle_event === 'prepare' &&
    fs.existsSync(path.join(WEB_DEST, 'index.html'))
  ) {
    return 'dist/web already exists from the preceding pack build';
  }
  return null;
}

// ── 1. Build @codragraph/shared ──────────────────────────────────────
console.log('[build] compiling @codragraph/shared…');
runTsc(SHARED_ROOT);

// ── 2. Build @codragraph/graphstore ──────────────────────────────────
// core depends on this for snapshot/branch/diff types. On a
// fresh checkout (CI, npm ci) the graphstore dist is empty until we
// build it here, so step 3 would otherwise fail to resolve
// `@codragraph/graphstore` imports. Skip gracefully if the workspace
// is not present (e.g. someone pinned an older monorepo layout).
if (fs.existsSync(GRAPHSTORE_ROOT)) {
  console.log('[build] compiling @codragraph/graphstore…');
  runTsc(GRAPHSTORE_ROOT);
}

// ── 3. Build @codragraph/cli ─────────────────────────────────────────
console.log('[build] compiling @codragraph/cli…');
runTsc(ROOT);

// ── 4. Copy shared dist ────────────────────────────────────────────
console.log('[build] copying shared module into dist/_shared…');
fs.cpSync(path.join(SHARED_ROOT, 'dist'), SHARED_DEST, { recursive: true });

// ── 5. Rewrite imports ─────────────────────────────────────────────
console.log('[build] rewriting @codragraph/shared imports…');
let rewritten = 0;

function rewriteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes('@codragraph/shared')) return;

  const relDir = path.relative(path.dirname(filePath), SHARED_DEST);
  // Always use posix separators and point to the package index
  const relImport = relDir.split(path.sep).join('/') + '/index.js';

  const updated = content
    .replace(/from\s+['"]@codragraph\/shared['"]/g, `from '${relImport}'`)
    .replace(/import\(\s*['"]@codragraph\/shared['"]\s*\)/g, `import('${relImport}')`);

  if (updated !== content) {
    fs.writeFileSync(filePath, updated);
    rewritten++;
  }
}

function walk(dir, extensions, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, cb);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      cb(full);
    }
  }
}

walk(DIST, ['.js', '.d.ts'], rewriteFile);

// ── 6. Make CLI entry executable ────────────────────────────────────
const cliEntry = path.join(DIST, 'cli', 'index.js');
if (fs.existsSync(cliEntry)) fs.chmodSync(cliEntry, 0o755);

// ── 7. Bundle the web dashboard ─────────────────────────────────────
// The npm package ships static web assets under dist/web. It never includes
// apps/web/node_modules; npm only packs files included by packages/core/files.
const webPackageJson = path.join(WEB_ROOT, 'package.json');
if (fs.existsSync(webPackageJson)) {
  const skipReason = getWebBuildSkipReason();
  if (skipReason) {
    console.log(`[build] skipping bundled web dashboard (${skipReason}).`);
  } else {
    console.log('[build] compiling bundled web dashboard…');
    runPackageScript(WEB_ROOT, 'build');
    fs.rmSync(WEB_DEST, { recursive: true, force: true });
    fs.cpSync(path.join(WEB_ROOT, 'dist'), WEB_DEST, { recursive: true });
  }
} else {
  console.log('[build] apps/web not found — skipping bundled web dashboard.');
}

console.log(`[build] done — rewrote ${rewritten} files.`);
