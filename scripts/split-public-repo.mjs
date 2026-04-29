#!/usr/bin/env node
/**
 * Split the user-facing subset of the private monorepo into a fresh
 * public-repo working tree. Copies only the files an external
 * contributor needs; leaves marketing / benchmarking / internal docs
 * in the private repo.
 *
 * Run:
 *   node scripts/split-public-repo.mjs <target-dir>
 *
 * Default target: ../codragraph-public next to the monorepo.
 *
 * The target directory is created clean (existing contents removed
 * inside it BEFORE the copy). Re-runs are idempotent.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepo = path.resolve(__dirname, '..');

const targetArg = process.argv[2] ?? path.resolve(monorepo, '..', 'codragraph-public');
const target = path.resolve(targetArg);

if (target === monorepo) {
  console.error('Refusing to overwrite the monorepo itself.');
  process.exit(1);
}

// What we WANT in the public repo. Anything not on this list does not
// get copied. Items can be files OR directories.
const PUBLIC_INCLUDE = [
  // ── Packages ────────────────────────────────────────────────
  'codragraph',
  'codragraph-sdk',
  'codragraph-graphstore',
  'codragraph-harness',
  'codragraph-compress',
  'codragraph-shared',
  'codragraph-web',
  'codragraph-claude-plugin',
  'codragraph-cursor-integration',
  'codragraph-codex-integration',
  'codragraph-org',

  // ── Repo-wide ───────────────────────────────────────────────
  'branding',
  'scripts', // includes migrate-dist-imports + split-public-repo (public-safe). The seed-*-fixture.mjs scripts are dev-only mock-data tools and are excluded by NEVER_PUBLISH_SUBSTRINGS below.
  '.github',
  '.husky',

  // ── Top-level files ─────────────────────────────────────────
  'package.json',
  'package-lock.json',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierignore',
  '.gitignore',
  '.gitattributes',

  // Public docs
  'LICENSE',
  'README.md',
  'INSTALL.md',
  'CHANGELOG.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'AGENTS.md', // contributor-facing AI-assistant guidance
  'llms.txt', // small public LLM-context file

  // Docker dev environment
  'docker-compose.yaml',
  'docker-server.mjs',
  'docker-server.test.mjs',
];

// Belt-and-braces deny list — files anywhere in the tree that must NEVER
// land in the public repo even if they slip past the include list.
// Patterns are literal substrings checked against the relative path.
const NEVER_PUBLISH_SUBSTRINGS = [
  '/marketing/',
  '/Benchmarking/',
  '/eval/',
  '/.sisyphus/',
  '/.claude/',
  '/.cursor/',
  '/.cursorrules',
  '/.windsurfrules',
  '/.claude-plugin/',
  '/.mcp.json',
  '/compound-engineering.local.md',
  '/skills.mdm',
  '/swift-ingestion-gaps.md',
  '/type-resolution-roadmap.md',
  '/type-resolution-system.md',
  '/CLAUDE.md',
  '/DoD.md',
  '/GUARDRAILS.md',
  '/private-ruleset.json',
  // Dev-only mock-data seeders. Their docstrings explicitly say they
  // exist to work around local-env analyze issues for dashboard
  // development. Public users running the real analyze flow don't need
  // them — and publishing demo/mock fixtures conflicts with the
  // "public repo is for users to Use" principle.
  '/seed-dashboard-fixture.mjs',
  '/seed-cross-repo-fixture.mjs',
  '/MIGRATION.md',
  '/RUNBOOK.md',
  '/TESTING.md',
  '/docs/plans/',
  // Build artifacts + machine-local state that should never copy.
  '/node_modules/',
  '/dist/',
  '/.git/',
  '/.codragraph/',
  '/coverage/',
  '/.tsbuildinfo',
  '/playwright-report/',
  '/test-results/',
];

// Track stats.
let copiedFiles = 0;
let copiedDirs = 0;
let skippedDeny = 0;

const isDenied = (relPath) => {
  const norm = '/' + relPath.replace(/\\/g, '/');
  return NEVER_PUBLISH_SUBSTRINGS.some((s) => norm.includes(s));
};

const copyRecursive = async (srcRel) => {
  const src = path.join(monorepo, srcRel);
  let stat;
  try {
    stat = await fs.stat(src);
  } catch {
    console.warn(`  [skip-missing] ${srcRel}`);
    return;
  }
  if (stat.isDirectory()) {
    await copyDir(src, path.join(target, srcRel), srcRel);
  } else {
    if (isDenied(srcRel)) {
      skippedDeny++;
      return;
    }
    await fs.mkdir(path.dirname(path.join(target, srcRel)), { recursive: true });
    await fs.copyFile(src, path.join(target, srcRel));
    copiedFiles++;
  }
};

const copyDir = async (src, dst, relRoot) => {
  if (isDenied(relRoot + '/')) {
    skippedDeny++;
    return;
  }
  await fs.mkdir(dst, { recursive: true });
  copiedDirs++;
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const childSrc = path.join(src, e.name);
    const childRel = path.join(relRoot, e.name);
    if (isDenied('/' + childRel.replace(/\\/g, '/') + (e.isDirectory() ? '/' : ''))) {
      skippedDeny++;
      continue;
    }
    if (e.isDirectory()) {
      await copyDir(childSrc, path.join(dst, e.name), childRel);
    } else if (e.isFile()) {
      await fs.copyFile(childSrc, path.join(dst, e.name));
      copiedFiles++;
    }
  }
};

// ── Wipe + create target ────────────────────────────────────────────
console.error(`Splitting public repo into ${target}`);
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });

// ── Copy each include ───────────────────────────────────────────────
for (const item of PUBLIC_INCLUDE) {
  await copyRecursive(item);
}

console.error(`\n✓ ${copiedFiles} files copied across ${copiedDirs} directories`);
console.error(`  ${skippedDeny} entries skipped by deny-list`);
console.error(`  target: ${target}`);
console.error('\nNext:');
console.error(`  cd ${target}`);
console.error('  git init -b main');
console.error('  git add .');
console.error('  git commit -m "Initial commit: CodraGraph public release"');
console.error('  gh repo create CodraGraph --public --source=. --push');
