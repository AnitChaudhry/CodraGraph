#!/usr/bin/env node
/**
 * Migrate `codragraph-X/dist/path/file.js` deep imports to bare
 * subpath specifiers (`codragraph-X/path/file`). This makes the
 * source forward-compatible with the npm-published shape of each
 * package (whose package.json `exports` map handles the dist
 * resolution internally).
 *
 * Touches:
 *   *.ts, *.tsx, *.mjs, *.js (excluding node_modules + dist + .git)
 *
 * Idempotent — safe to re-run.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.codragraph',
  'coverage',
  'playwright-report',
]);
const TARGET_EXTS = new Set(['.ts', '.tsx', '.mjs', '.js', '.cjs']);

const PACKAGES = [
  'codragraph',
  'codragraph-harness',
  'codragraph-graphstore',
  'codragraph-compress',
  'codragraph-sdk',
  'codragraph-shared',
];

// One regex per package — captures the path inside `dist/` (excluding
// the `.js` extension that we drop from the spec).
const REWRITE = PACKAGES.map((pkg) => ({
  pkg,
  // Matches "<pkg>/dist/<path>.js" — the trailing .js is dropped from
  // the bare-specifier form.
  pattern: new RegExp(
    `(['"\`])${pkg.replace(/-/g, '\\-')}\\/dist\\/((?:[\\w@.\\-]+\\/)*[\\w@.\\-]+)\\.js\\1`,
    'g',
  ),
  replace: (_match, quote, inner) => `${quote}${pkg}/${inner}${quote}`,
}));

let totalReplacements = 0;
const filesChanged = [];

const walk = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(path.join(dir, e.name));
      continue;
    }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name);
    if (!TARGET_EXTS.has(ext)) continue;
    const full = path.join(dir, e.name);
    let content;
    try {
      content = await fs.readFile(full, 'utf-8');
    } catch {
      continue;
    }
    let next = content;
    let fileHits = 0;
    for (const { pattern, replace } of REWRITE) {
      const before = next;
      next = next.replace(pattern, replace);
      if (next !== before) {
        fileHits += (before.match(pattern) ?? []).length;
      }
    }
    if (next !== content) {
      await fs.writeFile(full, next);
      totalReplacements += fileHits;
      filesChanged.push({ path: path.relative(root, full), hits: fileHits });
    }
  }
};

await walk(root);

console.log(`\nMigrated ${totalReplacements} import(s) across ${filesChanged.length} file(s):`);
for (const f of filesChanged) {
  console.log(`  ${String(f.hits).padStart(3)}  ${f.path}`);
}
console.log('\nDone. Run `tsc --noEmit` per package to verify exports map resolution.');
