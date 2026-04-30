#!/usr/bin/env node
/**
 * Build script that compiles codragraph and inlines codragraph-shared into the dist.
 *
 * Steps:
 *  1. Build codragraph-shared (tsc)
 *  2. Build codragraph-graphstore (tsc) — codragraph imports it; without
 *     a populated dist/ here, step 3 fails to resolve types.
 *  3. Build codragraph (tsc)
 *  4. Copy codragraph-shared/dist → dist/_shared
 *  5. Rewrite bare '@codragraph/shared' specifiers → relative paths
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Workspace directory names — packages live under `packages/<short>` on disk
// and publish as `@codragraph/<short>` on npm.
const SHARED_ROOT = path.resolve(ROOT, '..', 'shared');
const GRAPHSTORE_ROOT = path.resolve(ROOT, '..', 'graphstore');
const DIST = path.join(ROOT, 'dist');
const SHARED_DEST = path.join(DIST, '_shared');

// ── 1. Build @codragraph/shared ──────────────────────────────────────
console.log('[build] compiling @codragraph/shared…');
execSync('npx tsc', { cwd: SHARED_ROOT, stdio: 'inherit' });

// ── 2. Build @codragraph/graphstore ──────────────────────────────────
// core depends on this for snapshot/branch/diff types. On a
// fresh checkout (CI, npm ci) the graphstore dist is empty until we
// build it here, so step 3 would otherwise fail to resolve
// `@codragraph/graphstore` imports. Skip gracefully if the workspace
// is not present (e.g. someone pinned an older monorepo layout).
if (fs.existsSync(GRAPHSTORE_ROOT)) {
  console.log('[build] compiling codragraph-graphstore…');
  execSync('npx tsc', { cwd: GRAPHSTORE_ROOT, stdio: 'inherit' });
}

// ── 3. Build codragraph ──────────────────────────────────────────────
console.log('[build] compiling codragraph…');
execSync('npx tsc', { cwd: ROOT, stdio: 'inherit' });

// ── 3. Copy shared dist ────────────────────────────────────────────
console.log('[build] copying shared module into dist/_shared…');
fs.cpSync(path.join(SHARED_ROOT, 'dist'), SHARED_DEST, { recursive: true });

// ── 4. Rewrite imports ─────────────────────────────────────────────
console.log('[build] rewriting codragraph-shared imports…');
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

// ── 5. Make CLI entry executable ────────────────────────────────────
const cliEntry = path.join(DIST, 'cli', 'index.js');
if (fs.existsSync(cliEntry)) fs.chmodSync(cliEntry, 0o755);

console.log(`[build] done — rewrote ${rewritten} files.`);
