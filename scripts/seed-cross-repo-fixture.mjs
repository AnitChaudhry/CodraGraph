#!/usr/bin/env node
/**
 * Cross-repo fixture for the dashboard's Projects view.
 *
 * Seeds a "hr-platform" group with two registered repos:
 *   - hr-frontend  (consumes HTTP routes from hr-backend)
 *   - hr-backend   (provides those HTTP routes)
 *
 * Each repo gets the standard graphstore + recipe layout the regular
 * fixture script produces. The group config and a hand-written
 * contracts.json drive the dashboard's contracts panel.
 *
 * Run:
 *   node scripts/seed-cross-repo-fixture.mjs <root-dir> [group-name]
 *
 * Default root: a temp dir under the OS temp folder.
 * Default group name: hr-platform.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  FsCAS,
  serializeSnapshot,
  createCommit,
  createBranch,
  setHead,
  writeHeadBranch,
} from '../packages/graphstore/dist/index.js';

const rootArg = process.argv[2] ?? path.join(os.tmpdir(), 'codragraph-multi');
const groupName = process.argv[3] ?? 'hr-platform';

const root = path.resolve(rootArg);
const codragraphHome = process.env.CODRAGRAPH_HOME ?? path.join(os.homedir(), '.codragraph');
const groupsDir = path.join(codragraphHome, 'groups', groupName);

await fs.mkdir(root, { recursive: true });

console.error(`Seeding cross-repo fixture under ${root} as group "${groupName}"`);

// ── Helper: build one repo with its own graphstore ────────────────────
const seedRepo = async (repoName, sources) => {
  const repoDir = path.join(root, repoName);
  const storagePath = path.join(repoDir, '.codragraph');
  const graphstoreRoot = path.join(storagePath, 'graphstore');
  await fs.mkdir(storagePath, { recursive: true });

  const cas = new FsCAS({ root: graphstoreRoot });
  const author = { name: '@codragraph/cli', email: 'noreply@codragraph.local' };

  let parents = [];
  let lastCommitId = null;
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const snap = await serializeSnapshot({
      source: src.source,
      cas,
      createdAt: src.createdAt,
    });
    const commit = await createCommit({
      cas,
      snapshot: snap.snapshotId,
      parents,
      author,
      message: src.message,
      ts: src.createdAt,
    });
    parents = [commit.commitId];
    lastCommitId = commit.commitId;
    if (i === 0) {
      await createBranch({ root: graphstoreRoot, name: 'main', commit: commit.commitId });
    } else {
      await setHead({ root: graphstoreRoot, branch: 'main', commit: commit.commitId });
    }
  }
  await writeHeadBranch({ root: graphstoreRoot, branch: 'main' });

  const stats = sources[sources.length - 1].stats;
  const meta = {
    repoPath: repoDir,
    lastCommit: '',
    indexedAt: new Date().toISOString(),
    currentBranch: 'main',
    headCommit: lastCommitId,
    stats,
  };
  await fs.writeFile(path.join(storagePath, 'meta.json'), JSON.stringify(meta, null, 2));

  return { name: repoName, path: repoDir, storagePath, meta };
};

// ── Synthetic content: hr-frontend (consumer) ─────────────────────────
const hrFrontendSources = [
  {
    createdAt: '2026-04-25T09:00:00Z',
    message: 'initial frontend index',
    stats: { files: 4, nodes: 9, edges: 8 },
    source: {
      listNodeTables: async () => ['File', 'Function', 'Class'],
      streamNodeTable: async function* (table) {
        if (table === 'File') {
          yield {
            id: 'file:src/CandidateList.tsx',
            name: 'CandidateList.tsx',
            filePath: 'src/CandidateList.tsx',
          };
          yield {
            id: 'file:src/api/candidates.ts',
            name: 'candidates.ts',
            filePath: 'src/api/candidates.ts',
          };
        } else if (table === 'Function') {
          yield {
            id: 'fn:fetchCandidates',
            name: 'fetchCandidates',
            filePath: 'src/api/candidates.ts',
            isExported: true,
            parameterCount: 1,
            returnType: 'Promise<Candidate[]>',
          };
          yield {
            id: 'fn:CandidateList',
            name: 'CandidateList',
            filePath: 'src/CandidateList.tsx',
            isExported: true,
            parameterCount: 1,
            returnType: 'JSX.Element',
          };
        } else if (table === 'Class') {
          yield {
            id: 'cls:Candidate',
            name: 'Candidate',
            filePath: 'src/types.ts',
            isExported: true,
          };
        }
      },
      streamEdges: async function* () {
        yield { from: 'fn:CandidateList', to: 'fn:fetchCandidates', type: 'CALLS' };
        yield { from: 'fn:fetchCandidates', to: 'cls:Candidate', type: 'USES' };
      },
    },
  },
  {
    createdAt: '2026-04-29T11:30:00Z',
    message: 'add interview-flow page',
    stats: { files: 6, nodes: 13, edges: 11 },
    source: {
      listNodeTables: async () => ['File', 'Function', 'Class', 'Interface'],
      streamNodeTable: async function* (table) {
        if (table === 'File') {
          yield {
            id: 'file:src/CandidateList.tsx',
            name: 'CandidateList.tsx',
            filePath: 'src/CandidateList.tsx',
          };
          yield {
            id: 'file:src/InterviewFlow.tsx',
            name: 'InterviewFlow.tsx',
            filePath: 'src/InterviewFlow.tsx',
          };
          yield {
            id: 'file:src/api/candidates.ts',
            name: 'candidates.ts',
            filePath: 'src/api/candidates.ts',
          };
          yield {
            id: 'file:src/api/interviews.ts',
            name: 'interviews.ts',
            filePath: 'src/api/interviews.ts',
          };
        } else if (table === 'Function') {
          yield {
            id: 'fn:fetchCandidates',
            name: 'fetchCandidates',
            filePath: 'src/api/candidates.ts',
            isExported: true,
            parameterCount: 1,
            returnType: 'Promise<Candidate[]>',
          };
          yield {
            id: 'fn:scheduleInterview',
            name: 'scheduleInterview',
            filePath: 'src/api/interviews.ts',
            isExported: true,
            parameterCount: 2,
            returnType: 'Promise<Interview>',
          };
          yield {
            id: 'fn:CandidateList',
            name: 'CandidateList',
            filePath: 'src/CandidateList.tsx',
            isExported: true,
            parameterCount: 1,
            returnType: 'JSX.Element',
          };
          yield {
            id: 'fn:InterviewFlow',
            name: 'InterviewFlow',
            filePath: 'src/InterviewFlow.tsx',
            isExported: true,
            parameterCount: 1,
            returnType: 'JSX.Element',
          };
        } else if (table === 'Class') {
          yield {
            id: 'cls:Candidate',
            name: 'Candidate',
            filePath: 'src/types.ts',
            isExported: true,
          };
          yield {
            id: 'cls:Interview',
            name: 'Interview',
            filePath: 'src/types.ts',
            isExported: true,
          };
        } else if (table === 'Interface') {
          yield {
            id: 'iface:InterviewSlot',
            name: 'InterviewSlot',
            filePath: 'src/types.ts',
            isExported: true,
          };
        }
      },
      streamEdges: async function* () {
        yield { from: 'fn:CandidateList', to: 'fn:fetchCandidates', type: 'CALLS' };
        yield { from: 'fn:fetchCandidates', to: 'cls:Candidate', type: 'USES' };
        yield { from: 'fn:InterviewFlow', to: 'fn:scheduleInterview', type: 'CALLS' };
        yield { from: 'fn:scheduleInterview', to: 'cls:Interview', type: 'USES' };
        yield { from: 'cls:Interview', to: 'iface:InterviewSlot', type: 'USES' };
      },
    },
  },
];

// ── Synthetic content: hr-backend (provider) ──────────────────────────
const hrBackendSources = [
  {
    createdAt: '2026-04-24T14:00:00Z',
    message: 'initial backend index',
    stats: { files: 5, nodes: 11, edges: 9 },
    source: {
      listNodeTables: async () => ['File', 'Function', 'Class', 'Route'],
      streamNodeTable: async function* (table) {
        if (table === 'File') {
          yield {
            id: 'file:src/routes/candidates.ts',
            name: 'candidates.ts',
            filePath: 'src/routes/candidates.ts',
          };
          yield {
            id: 'file:src/routes/interviews.ts',
            name: 'interviews.ts',
            filePath: 'src/routes/interviews.ts',
          };
        } else if (table === 'Function') {
          yield {
            id: 'fn:listCandidates',
            name: 'listCandidates',
            filePath: 'src/routes/candidates.ts',
            isExported: true,
          };
          yield {
            id: 'fn:scheduleInterview',
            name: 'scheduleInterview',
            filePath: 'src/routes/interviews.ts',
            isExported: true,
          };
        } else if (table === 'Class') {
          yield {
            id: 'cls:Candidate',
            name: 'Candidate',
            filePath: 'src/models/Candidate.ts',
            isExported: true,
          };
        } else if (table === 'Route') {
          yield {
            id: 'route:GET /api/candidates',
            name: 'GET /api/candidates',
            filePath: 'src/routes/candidates.ts',
          };
          yield {
            id: 'route:POST /api/interviews',
            name: 'POST /api/interviews',
            filePath: 'src/routes/interviews.ts',
          };
        }
      },
      streamEdges: async function* () {
        yield { from: 'route:GET /api/candidates', to: 'fn:listCandidates', type: 'HANDLES_ROUTE' };
        yield {
          from: 'route:POST /api/interviews',
          to: 'fn:scheduleInterview',
          type: 'HANDLES_ROUTE',
        };
        yield { from: 'fn:listCandidates', to: 'cls:Candidate', type: 'USES' };
      },
    },
  },
  {
    createdAt: '2026-04-29T11:00:00Z',
    message: 'add interview-slot search endpoint',
    stats: { files: 6, nodes: 14, edges: 12 },
    source: {
      listNodeTables: async () => ['File', 'Function', 'Class', 'Interface', 'Route'],
      streamNodeTable: async function* (table) {
        if (table === 'File') {
          yield {
            id: 'file:src/routes/candidates.ts',
            name: 'candidates.ts',
            filePath: 'src/routes/candidates.ts',
          };
          yield {
            id: 'file:src/routes/interviews.ts',
            name: 'interviews.ts',
            filePath: 'src/routes/interviews.ts',
          };
        } else if (table === 'Function') {
          yield {
            id: 'fn:listCandidates',
            name: 'listCandidates',
            filePath: 'src/routes/candidates.ts',
            isExported: true,
          };
          yield {
            id: 'fn:scheduleInterview',
            name: 'scheduleInterview',
            filePath: 'src/routes/interviews.ts',
            isExported: true,
          };
          yield {
            id: 'fn:searchInterviewSlots',
            name: 'searchInterviewSlots',
            filePath: 'src/routes/interviews.ts',
            isExported: true,
          };
        } else if (table === 'Class') {
          yield {
            id: 'cls:Candidate',
            name: 'Candidate',
            filePath: 'src/models/Candidate.ts',
            isExported: true,
          };
          yield {
            id: 'cls:Interview',
            name: 'Interview',
            filePath: 'src/models/Interview.ts',
            isExported: true,
          };
        } else if (table === 'Interface') {
          yield {
            id: 'iface:InterviewSlot',
            name: 'InterviewSlot',
            filePath: 'src/models/InterviewSlot.ts',
            isExported: true,
          };
        } else if (table === 'Route') {
          yield {
            id: 'route:GET /api/candidates',
            name: 'GET /api/candidates',
            filePath: 'src/routes/candidates.ts',
          };
          yield {
            id: 'route:POST /api/interviews',
            name: 'POST /api/interviews',
            filePath: 'src/routes/interviews.ts',
          };
          yield {
            id: 'route:GET /api/interview-slots',
            name: 'GET /api/interview-slots',
            filePath: 'src/routes/interviews.ts',
          };
        }
      },
      streamEdges: async function* () {
        yield { from: 'route:GET /api/candidates', to: 'fn:listCandidates', type: 'HANDLES_ROUTE' };
        yield {
          from: 'route:POST /api/interviews',
          to: 'fn:scheduleInterview',
          type: 'HANDLES_ROUTE',
        };
        yield {
          from: 'route:GET /api/interview-slots',
          to: 'fn:searchInterviewSlots',
          type: 'HANDLES_ROUTE',
        };
        yield { from: 'fn:listCandidates', to: 'cls:Candidate', type: 'USES' };
        yield { from: 'fn:scheduleInterview', to: 'cls:Interview', type: 'USES' };
        yield { from: 'fn:searchInterviewSlots', to: 'iface:InterviewSlot', type: 'USES' };
      },
    },
  },
];

const frontend = await seedRepo('hr-frontend', hrFrontendSources);
console.error(`  · seeded hr-frontend  → HEAD ${frontend.meta.headCommit?.slice(7, 7 + 12)}`);

const backend = await seedRepo('hr-backend', hrBackendSources);
console.error(`  · seeded hr-backend   → HEAD ${backend.meta.headCommit?.slice(7, 7 + 12)}`);

// ── Register both repos in the global registry ───────────────────────
await fs.mkdir(codragraphHome, { recursive: true });
const registryPath = path.join(codragraphHome, 'registry.json');
let registry = [];
try {
  registry = JSON.parse(await fs.readFile(registryPath, 'utf-8'));
  if (!Array.isArray(registry)) registry = [];
} catch {
  /* fresh */
}

const upsert = (repo) => {
  const entry = {
    name: repo.name,
    path: repo.path,
    storagePath: repo.storagePath,
    indexedAt: repo.meta.indexedAt,
    lastCommit: '',
    currentBranch: repo.meta.currentBranch,
    headCommit: repo.meta.headCommit,
    stats: repo.meta.stats,
  };
  const idx = registry.findIndex(
    (e) => path.resolve(e.path).toLowerCase() === path.resolve(repo.path).toLowerCase(),
  );
  if (idx >= 0) registry[idx] = entry;
  else registry.push(entry);
};
upsert(frontend);
upsert(backend);
await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));

// ── Group config + contract registry ─────────────────────────────────
await fs.mkdir(groupsDir, { recursive: true });

const groupConfig = {
  version: 1,
  name: groupName,
  description: 'HR platform — frontend consumes backend HTTP routes for candidates and interviews.',
  repos: {
    'hr/frontend': 'hr-frontend',
    'hr/backend': 'hr-backend',
  },
  links: [
    {
      from: 'hr/frontend',
      to: 'hr/backend',
      type: 'http',
      contract: 'GET /api/candidates',
      role: 'consumer',
    },
    {
      from: 'hr/frontend',
      to: 'hr/backend',
      type: 'http',
      contract: 'POST /api/interviews',
      role: 'consumer',
    },
  ],
  packages: {},
  detect: {
    http: true,
    grpc: false,
    topics: false,
    shared_libs: false,
    embedding_fallback: false,
  },
  matching: {
    bm25_threshold: 0.5,
    embedding_threshold: 0.7,
    max_candidates_per_step: 10,
  },
};

const yamlBody = `version: ${groupConfig.version}
name: ${groupConfig.name}
description: ${JSON.stringify(groupConfig.description)}
repos:
  hr/frontend: hr-frontend
  hr/backend: hr-backend
links:
  - from: hr/frontend
    to: hr/backend
    type: http
    contract: "GET /api/candidates"
    role: consumer
  - from: hr/frontend
    to: hr/backend
    type: http
    contract: "POST /api/interviews"
    role: consumer
packages: {}
detect:
  http: true
  grpc: false
  topics: false
  shared_libs: false
  embedding_fallback: false
matching:
  bm25_threshold: 0.5
  embedding_threshold: 0.7
  max_candidates_per_step: 10
`;
await fs.writeFile(path.join(groupsDir, 'group.yaml'), yamlBody);

const contractRegistry = {
  version: 1,
  generatedAt: new Date().toISOString(),
  repoSnapshots: {
    'hr/frontend': { indexedAt: frontend.meta.indexedAt, lastCommit: '' },
    'hr/backend': { indexedAt: backend.meta.indexedAt, lastCommit: '' },
  },
  missingRepos: [],
  contracts: [
    {
      contractId: 'GET /api/candidates',
      type: 'http',
      role: 'provider',
      symbolUid: 'fn:listCandidates',
      symbolRef: { filePath: 'src/routes/candidates.ts', name: 'listCandidates' },
      symbolName: 'listCandidates',
      confidence: 1.0,
      meta: { method: 'GET', path: '/api/candidates' },
      repo: 'hr/backend',
    },
    {
      contractId: 'POST /api/interviews',
      type: 'http',
      role: 'provider',
      symbolUid: 'fn:scheduleInterview',
      symbolRef: { filePath: 'src/routes/interviews.ts', name: 'scheduleInterview' },
      symbolName: 'scheduleInterview',
      confidence: 1.0,
      meta: { method: 'POST', path: '/api/interviews' },
      repo: 'hr/backend',
    },
    {
      contractId: 'GET /api/interview-slots',
      type: 'http',
      role: 'provider',
      symbolUid: 'fn:searchInterviewSlots',
      symbolRef: { filePath: 'src/routes/interviews.ts', name: 'searchInterviewSlots' },
      symbolName: 'searchInterviewSlots',
      confidence: 1.0,
      meta: { method: 'GET', path: '/api/interview-slots' },
      repo: 'hr/backend',
    },
    {
      contractId: 'GET /api/candidates',
      type: 'http',
      role: 'consumer',
      symbolUid: 'fn:fetchCandidates',
      symbolRef: { filePath: 'src/api/candidates.ts', name: 'fetchCandidates' },
      symbolName: 'fetchCandidates',
      confidence: 1.0,
      meta: { method: 'GET', path: '/api/candidates' },
      repo: 'hr/frontend',
    },
    {
      contractId: 'POST /api/interviews',
      type: 'http',
      role: 'consumer',
      symbolUid: 'fn:scheduleInterview',
      symbolRef: { filePath: 'src/api/interviews.ts', name: 'scheduleInterview' },
      symbolName: 'scheduleInterview',
      confidence: 1.0,
      meta: { method: 'POST', path: '/api/interviews' },
      repo: 'hr/frontend',
    },
  ],
  crossLinks: [
    {
      from: {
        repo: 'hr/frontend',
        symbolUid: 'fn:fetchCandidates',
        symbolRef: { filePath: 'src/api/candidates.ts', name: 'fetchCandidates' },
      },
      to: {
        repo: 'hr/backend',
        symbolUid: 'fn:listCandidates',
        symbolRef: { filePath: 'src/routes/candidates.ts', name: 'listCandidates' },
      },
      type: 'http',
      contractId: 'GET /api/candidates',
      matchType: 'manifest',
      confidence: 1.0,
    },
    {
      from: {
        repo: 'hr/frontend',
        symbolUid: 'fn:scheduleInterview',
        symbolRef: { filePath: 'src/api/interviews.ts', name: 'scheduleInterview' },
      },
      to: {
        repo: 'hr/backend',
        symbolUid: 'fn:scheduleInterview',
        symbolRef: { filePath: 'src/routes/interviews.ts', name: 'scheduleInterview' },
      },
      type: 'http',
      contractId: 'POST /api/interviews',
      matchType: 'manifest',
      confidence: 1.0,
    },
  ],
};
await fs.writeFile(
  path.join(groupsDir, 'contracts.json'),
  JSON.stringify(contractRegistry, null, 2),
);

console.error(`✓ Cross-repo fixture seeded`);
console.error(`  group: ${groupName}`);
console.error(`  repos: hr-frontend, hr-backend`);
console.error(`  cross-links: 2 (frontend → backend, http)`);
console.error(`  group config: ${path.join(groupsDir, 'group.yaml')}`);
console.error(`  contracts:    ${path.join(groupsDir, 'contracts.json')}`);
