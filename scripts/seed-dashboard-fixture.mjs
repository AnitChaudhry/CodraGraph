#!/usr/bin/env node
/**
 * Seed a minimal `.codragraph/` fixture for dashboard development.
 *
 * The full `codragraph analyze` pipeline depends on tree-sitter native
 * bindings that are flaky on the Windows D: drive copy of this repo
 * (segfaults during ingestion). For dashboard pixel-rendering work, we
 * only need:
 *   - meta.json with stats (so /api/repo + /api/repos return something)
 *   - .codragraph/lbug file (created by `codragraph serve` on first
 *     query; we leave it absent — the dashboard's Overview / History /
 *     Recipes sections don't depend on lbug)
 *   - a real graphstore with two commits + a structural diff between
 *     them (for /api/graphstore/log + /api/graphstore/diff)
 *   - a real FsRecipeStore with a few harness recipes (for /api/recipes)
 *
 * Run:
 *   node scripts/seed-dashboard-fixture.mjs <target-dir>
 *
 * The target dir is registered in `~/.codragraph/registry.json` so
 * `codragraph serve` discovers it on startup.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  FsCAS,
  serializeSnapshot,
  createCommit,
  createBranch,
  setHead,
  writeHeadBranch,
} from '../codragraph-graphstore/dist/index.js';
import { FsRecipeStore } from '../codragraph-harness/dist/moat/recipe-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const targetArg = process.argv[2];
if (!targetArg) {
  console.error('usage: seed-dashboard-fixture.mjs <target-dir>');
  process.exit(1);
}
const targetDir = path.resolve(targetArg);
const storagePath = path.join(targetDir, '.codragraph');
const graphstoreRoot = path.join(storagePath, 'graphstore');
const recipesRoot = path.join(storagePath, 'recipes');

await fs.mkdir(storagePath, { recursive: true });
await fs.mkdir(targetDir, { recursive: true });

console.error(`Seeding fixture at ${storagePath}`);

// ── Synthetic graph rows ──────────────────────────────────────────────
const sourceA = () => ({
  listNodeTables: async () => ['File', 'Function', 'Class'],
  streamNodeTable: async function* (table) {
    if (table === 'File') {
      yield { id: 'file:src/auth.ts', name: 'auth.ts', filePath: 'src/auth.ts' };
      yield { id: 'file:src/db.ts', name: 'db.ts', filePath: 'src/db.ts' };
    } else if (table === 'Function') {
      yield {
        id: 'fn:authenticate',
        name: 'authenticate',
        filePath: 'src/auth.ts',
        isExported: true,
        parameterCount: 2,
        returnType: 'Promise<User>',
        startLine: 12,
        endLine: 28,
        content: 'async fn body v1',
      };
      yield {
        id: 'fn:hash',
        name: 'hash',
        filePath: 'src/auth.ts',
        isExported: false,
        parameterCount: 1,
        returnType: 'string',
        startLine: 30,
        endLine: 35,
        content: 'crypto-based',
      };
      yield {
        id: 'fn:connect',
        name: 'connect',
        filePath: 'src/db.ts',
        isExported: true,
        parameterCount: 1,
        returnType: 'Db',
        startLine: 5,
        endLine: 18,
        content: 'pool init',
      };
    } else if (table === 'Class') {
      yield {
        id: 'cls:User',
        name: 'User',
        filePath: 'src/auth.ts',
        isExported: true,
        startLine: 38,
        endLine: 60,
      };
    }
  },
  streamEdges: async function* () {
    yield { from: 'fn:authenticate', to: 'fn:hash', type: 'CALLS' };
    yield { from: 'fn:authenticate', to: 'cls:User', type: 'USES' };
    yield { from: 'fn:authenticate', to: 'fn:connect', type: 'CALLS' };
  },
});

const sourceB = () => ({
  listNodeTables: async () => ['File', 'Function', 'Class', 'Interface'],
  streamNodeTable: async function* (table) {
    if (table === 'File') {
      yield { id: 'file:src/auth.ts', name: 'auth.ts', filePath: 'src/auth.ts' };
      yield { id: 'file:src/db.ts', name: 'db.ts', filePath: 'src/db.ts' };
      yield { id: 'file:src/session.ts', name: 'session.ts', filePath: 'src/session.ts' };
    } else if (table === 'Function') {
      yield {
        id: 'fn:authenticate',
        name: 'authenticate',
        filePath: 'src/auth.ts',
        isExported: true,
        parameterCount: 3,
        returnType: 'Promise<Session>',
        startLine: 12,
        endLine: 35,
        content: 'async fn body v2 — added scope arg',
      };
      yield {
        id: 'fn:hash',
        name: 'hash',
        filePath: 'src/auth.ts',
        isExported: false,
        parameterCount: 1,
        returnType: 'string',
        startLine: 37,
        endLine: 42,
        content: 'crypto-based',
      };
      yield {
        id: 'fn:connect',
        name: 'connect',
        filePath: 'src/db.ts',
        isExported: true,
        parameterCount: 1,
        returnType: 'Db',
        startLine: 5,
        endLine: 18,
        content: 'pool init',
      };
      yield {
        id: 'fn:createSession',
        name: 'createSession',
        filePath: 'src/session.ts',
        isExported: true,
        parameterCount: 1,
        returnType: 'Session',
        startLine: 8,
        endLine: 16,
        content: 'new code',
      };
    } else if (table === 'Class') {
      yield {
        id: 'cls:User',
        name: 'User',
        filePath: 'src/auth.ts',
        isExported: true,
        startLine: 44,
        endLine: 70,
      };
      yield {
        id: 'cls:Session',
        name: 'Session',
        filePath: 'src/session.ts',
        isExported: true,
        startLine: 18,
        endLine: 30,
      };
    } else if (table === 'Interface') {
      yield {
        id: 'iface:SessionStore',
        name: 'SessionStore',
        filePath: 'src/session.ts',
        isExported: true,
      };
    }
  },
  streamEdges: async function* () {
    yield { from: 'fn:authenticate', to: 'fn:hash', type: 'CALLS' };
    yield { from: 'fn:authenticate', to: 'cls:User', type: 'USES' };
    yield { from: 'fn:authenticate', to: 'fn:connect', type: 'CALLS' };
    yield { from: 'fn:authenticate', to: 'fn:createSession', type: 'CALLS' };
    yield { from: 'fn:createSession', to: 'cls:Session', type: 'USES' };
    yield { from: 'cls:Session', to: 'iface:SessionStore', type: 'IMPLEMENTS' };
  },
});

// ── Build commits ─────────────────────────────────────────────────────
const cas = new FsCAS({ root: graphstoreRoot });
const author = { name: 'codragraph', email: 'noreply@codragraph.local' };

console.error('  · serializing snapshot A');
const snapA = await serializeSnapshot({
  source: sourceA(),
  cas,
  createdAt: '2026-04-27T10:00:00Z',
});
const commitA = await createCommit({
  cas,
  snapshot: snapA.snapshotId,
  parents: [],
  author,
  message: 'analyze 2026-04-27T10:00:00Z',
  ts: '2026-04-27T10:00:00Z',
});

console.error('  · serializing snapshot B');
const snapB = await serializeSnapshot({
  source: sourceB(),
  cas,
  createdAt: '2026-04-29T15:30:00Z',
});
const commitB = await createCommit({
  cas,
  snapshot: snapB.snapshotId,
  parents: [commitA.commitId],
  author,
  message: 'add session module + scope arg to authenticate',
  ts: '2026-04-29T15:30:00Z',
});

console.error('  · creating main branch');
await createBranch({ root: graphstoreRoot, name: 'main', commit: commitA.commitId });
await setHead({ root: graphstoreRoot, branch: 'main', commit: commitB.commitId });
await writeHeadBranch({ root: graphstoreRoot, branch: 'main' });

// ── Seed recipes ──────────────────────────────────────────────────────
console.error('  · seeding recipes');
const recipeStore = new FsRecipeStore({ root: recipesRoot });

await recipeStore.put({
  taskFamily: 'codebase-qa',
  snapshotId: snapB.snapshotId,
  searchedAt: '2026-04-29T16:00:00Z',
  searchSource: 'swarm',
  harness: {
    name: 'graph-aware-rerank',
    version: '0.2.1',
    files: [
      {
        path: 'index.ts',
        content:
          '// graph-aware harness body\nexport default { run: async (task, ctx) => {/*...*/} };',
      },
    ],
  },
  paretoCoords: { accuracy: 0.91, tokens: 4200, latencyMs: 1450 },
  scores: { accuracy: 0.91, tokens: 4200, latencyMs: 1450, taskCount: 30 },
  provenance: { role: 'exploiter', terminatedAt: { iteration: 12, reason: 'paretoPlateau' } },
});

await recipeStore.put({
  taskFamily: 'codebase-qa',
  snapshotId: snapB.snapshotId,
  searchedAt: '2026-04-29T16:05:00Z',
  searchSource: 'swarm',
  harness: {
    name: 'few-shot-cypher',
    version: '0.1.4',
    files: [
      {
        path: 'index.ts',
        content: '// few-shot variant\nexport default { run: async (task, ctx) => {/*...*/} };',
      },
    ],
  },
  paretoCoords: { accuracy: 0.84, tokens: 2800, latencyMs: 950 },
  scores: { accuracy: 0.84, tokens: 2800, latencyMs: 950, taskCount: 30 },
  provenance: { role: 'explorer' },
});

await recipeStore.put({
  taskFamily: 'swe-bench-issue-fix',
  snapshotId: snapA.snapshotId,
  searchedAt: '2026-04-27T11:00:00Z',
  searchSource: 'swarm',
  harness: {
    name: 'process-walker',
    version: '0.1.0',
    files: [
      {
        path: 'index.ts',
        content: '// walks processes\nexport default { run: async (task, ctx) => {/*...*/} };',
      },
    ],
  },
  paretoCoords: { accuracy: 0.62, tokens: 6800, latencyMs: 2100 },
  scores: { accuracy: 0.62, tokens: 6800, latencyMs: 2100, taskCount: 12 },
});

// ── Write meta.json ───────────────────────────────────────────────────
const meta = {
  repoPath: targetDir,
  lastCommit: '',
  indexedAt: new Date().toISOString(),
  currentBranch: 'main',
  headCommit: commitB.commitId,
  stats: { files: 3, nodes: 7, edges: 6, communities: 1, processes: 2, embeddings: 0 },
};
await fs.writeFile(path.join(storagePath, 'meta.json'), JSON.stringify(meta, null, 2));

// ── Register in global registry ───────────────────────────────────────
const codragraphHome = process.env.CODRAGRAPH_HOME ?? path.join(os.homedir(), '.codragraph');
await fs.mkdir(codragraphHome, { recursive: true });
const registryPath = path.join(codragraphHome, 'registry.json');
let registry = [];
try {
  const raw = await fs.readFile(registryPath, 'utf-8');
  registry = JSON.parse(raw);
  if (!Array.isArray(registry)) registry = [];
} catch {
  /* fresh registry */
}
const existingIdx = registry.findIndex(
  (e) => path.resolve(e.path).toLowerCase() === path.resolve(targetDir).toLowerCase(),
);
const entry = {
  name: path.basename(targetDir),
  path: targetDir,
  storagePath,
  indexedAt: meta.indexedAt,
  lastCommit: '',
  currentBranch: meta.currentBranch,
  headCommit: meta.headCommit,
  stats: meta.stats,
};
if (existingIdx >= 0) registry[existingIdx] = entry;
else registry.push(entry);
await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));

console.error(`✓ Seeded fixture for "${entry.name}"`);
console.error(`  graphstore: HEAD=${commitB.commitId.slice(7, 7 + 12)} on main`);
console.error(`  recipes: 3 across 2 task families`);
console.error(`  registry: ${registryPath}`);
