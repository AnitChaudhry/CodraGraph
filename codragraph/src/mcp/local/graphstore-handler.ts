/**
 * MCP dispatch for the Phase 4 versioned-graph tools.
 *
 * Each handler takes the repo's `storagePath` (already resolved by the
 * caller from the optional `repo` MCP param) and returns plain JSON
 * structures. Output is shaped for direct rendering by the agent — short
 * strings, sorted lists, no internal CAS handles in the response.
 */

import path from 'node:path';
import {
  FsCAS,
  createCommit,
  diffSemantic,
  diffSnapshots,
  gc as runGc,
  getJson,
  listBranches,
  parseObjectId,
  readCommit,
  readHead,
  resolveHeadCommit,
  setHead,
  threeWayMerge,
  walkCommits,
  type ObjectId,
  type Snapshot,
  type SnapshotManifest,
  type GraphDiff,
  type SemanticDiff,
} from 'codragraph-graphstore';
import { GRAPHSTORE_SUBDIR } from '../../core/graphstore/index.js';

interface GraphstoreCtx {
  readonly root: string;
  readonly cas: FsCAS;
}

const buildCtx = (storagePath: string): GraphstoreCtx => {
  const root = path.join(storagePath, GRAPHSTORE_SUBDIR);
  return { root, cas: new FsCAS({ root }) };
};

const resolveTarget = async (ctx: GraphstoreCtx, target: string): Promise<ObjectId> => {
  const branches = await listBranches({ root: ctx.root });
  const hit = branches.find((b) => b.name === target);
  if (hit) return hit.head;
  return parseObjectId(target);
};

// ──────────────────────────────────────────────────────────────────────
// graphstore_log
// ──────────────────────────────────────────────────────────────────────

export interface GraphstoreLogParams {
  readonly storagePath: string;
  readonly limit?: number;
  readonly from?: string;
}

export const handleGraphstoreLog = async (params: GraphstoreLogParams) => {
  const ctx = buildCtx(params.storagePath);
  const start =
    params.from !== undefined
      ? await resolveTarget(ctx, params.from)
      : await resolveHeadCommit({ root: ctx.root });
  if (start === null) {
    return { branch: null, head: null, commits: [] };
  }
  const headState = await readHead({ root: ctx.root });

  const commits: Array<{
    id: string;
    short: string;
    snapshot: string;
    parents: string[];
    author: string;
    ts: string;
    message: string;
  }> = [];
  for await (const entry of walkCommits({
    cas: ctx.cas,
    from: start,
    limit: params.limit ?? 50,
  })) {
    commits.push({
      id: entry.id,
      short: entry.id.slice(7, 7 + 12),
      snapshot: entry.commit.snapshot,
      parents: [...entry.commit.parents],
      author: `${entry.commit.author.name} <${entry.commit.author.email}>`,
      ts: entry.commit.ts,
      message: entry.commit.message,
    });
  }
  return {
    branch: headState.kind === 'branch' ? headState.branch : null,
    head: start,
    commits,
  };
};

// ──────────────────────────────────────────────────────────────────────
// graphstore_branches
// ──────────────────────────────────────────────────────────────────────

export interface GraphstoreBranchesParams {
  readonly storagePath: string;
}

export const handleGraphstoreBranches = async (params: GraphstoreBranchesParams) => {
  const ctx = buildCtx(params.storagePath);
  const branches = await listBranches({ root: ctx.root });
  const headState = await readHead({ root: ctx.root });
  const current = headState.kind === 'branch' ? headState.branch : null;
  return {
    current,
    branches: branches.map((b) => ({
      name: b.name,
      head: b.head,
      short: b.head.slice(7, 7 + 12),
      createdAt: b.createdAt,
      isCurrent: b.name === current,
    })),
  };
};

// ──────────────────────────────────────────────────────────────────────
// graphstore_diff
// ──────────────────────────────────────────────────────────────────────

export interface GraphstoreDiffParams {
  readonly storagePath: string;
  readonly from: string;
  readonly to: string;
}

export const handleGraphstoreDiff = async (params: GraphstoreDiffParams) => {
  const ctx = buildCtx(params.storagePath);

  const [fromCommitId, toCommitId] = await Promise.all([
    resolveTarget(ctx, params.from),
    resolveTarget(ctx, params.to),
  ]);
  const [fromCommit, toCommit] = await Promise.all([
    readCommit(ctx.cas, fromCommitId),
    readCommit(ctx.cas, toCommitId),
  ]);

  const diff = await diffSnapshots({
    cas: ctx.cas,
    from: fromCommit.snapshot,
    to: toCommit.snapshot,
  });
  return formatDiff(fromCommitId, toCommitId, fromCommit.message, toCommit.message, diff);
};

const formatDiff = (
  fromId: ObjectId,
  toId: ObjectId,
  fromMsg: string,
  toMsg: string,
  diff: GraphDiff,
) => {
  const summary = {
    addedNodes: countByTable(diff.addedNodes),
    removedNodes: countByTable(diff.removedNodes),
    addedEdges: diff.addedEdges.length,
    removedEdges: diff.removedEdges.length,
    modifiedSymbols: diff.modifiedSymbols.length,
  };
  return {
    from: { id: fromId, short: fromId.slice(7, 7 + 12), message: fromMsg },
    to: { id: toId, short: toId.slice(7, 7 + 12), message: toMsg },
    summary,
    modifiedSymbols: diff.modifiedSymbols.slice(0, 50),
  };
};

const countByTable = (byTable: Record<string, ObjectId[]>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [t, ids] of Object.entries(byTable)) {
    if (ids.length > 0) out[t] = ids.length;
  }
  return out;
};

// ──────────────────────────────────────────────────────────────────────
// graphstore_blame_symbol
// ──────────────────────────────────────────────────────────────────────

export interface GraphstoreBlameParams {
  readonly storagePath: string;
  readonly symbolId: string;
  readonly table?: string;
  readonly limit?: number;
}

export const handleGraphstoreBlameSymbol = async (params: GraphstoreBlameParams) => {
  const ctx = buildCtx(params.storagePath);
  const head = await resolveHeadCommit({ root: ctx.root });
  if (head === null) {
    return { symbolId: params.symbolId, history: [] };
  }
  const limit = params.limit ?? 20;

  // Collect history newest → oldest, with each commit's symbol hash.
  const history: Array<{
    commitId: ObjectId;
    short: string;
    ts: string;
    message: string;
    table: string | null;
    rowHash: ObjectId | null;
  }> = [];
  for await (const entry of walkCommits({ cas: ctx.cas, from: head })) {
    const snapshot = await getJson<Snapshot>(ctx.cas, entry.commit.snapshot);
    const manifest = await getJson<SnapshotManifest>(ctx.cas, parseObjectId(snapshot.manifestId));
    const found = locateSymbol(manifest, params.symbolId, params.table);
    history.push({
      commitId: entry.id,
      short: entry.id.slice(7, 7 + 12),
      ts: entry.commit.ts,
      message: entry.commit.message,
      table: found?.table ?? null,
      rowHash: found?.hash ?? null,
    });
  }

  // Compress: keep only commits where the row hash transitioned.
  const transitions = compressBlameTransitions(history).slice(0, limit);
  return { symbolId: params.symbolId, history: transitions };
};

// ──────────────────────────────────────────────────────────────────────
// graphstore_diff (semantic mode)
// ──────────────────────────────────────────────────────────────────────

export interface GraphstoreSemanticDiffParams {
  readonly storagePath: string;
  readonly from: string;
  readonly to: string;
}

export const handleGraphstoreSemanticDiff = async (params: GraphstoreSemanticDiffParams) => {
  const ctx = buildCtx(params.storagePath);
  const [fromCommitId, toCommitId] = await Promise.all([
    resolveTarget(ctx, params.from),
    resolveTarget(ctx, params.to),
  ]);
  const [fromCommit, toCommit] = await Promise.all([
    readCommit(ctx.cas, fromCommitId),
    readCommit(ctx.cas, toCommitId),
  ]);
  const d: SemanticDiff = await diffSemantic({
    cas: ctx.cas,
    from: fromCommit.snapshot,
    to: toCommit.snapshot,
  });
  return {
    from: { id: fromCommitId, short: fromCommitId.slice(7, 7 + 12), message: fromCommit.message },
    to: { id: toCommitId, short: toCommitId.slice(7, 7 + 12), message: toCommit.message },
    summary: {
      addedAPIs: d.addedAPIs.length,
      removedAPIs: d.removedAPIs.length,
      addedProcesses: d.addedProcesses.length,
      removedProcesses: d.removedProcesses.length,
      classifiedModifications: d.classifiedModifications.length,
    },
    addedAPIs: d.addedAPIs,
    removedAPIs: d.removedAPIs,
    addedProcesses: d.addedProcesses,
    removedProcesses: d.removedProcesses,
    classifiedModifications: d.classifiedModifications.slice(0, 50),
  };
};

// ──────────────────────────────────────────────────────────────────────
// graphstore_merge
// ──────────────────────────────────────────────────────────────────────

export interface GraphstoreMergeParams {
  readonly storagePath: string;
  /** Branch or commit id to merge in. */
  readonly source: string;
  /** Branch to merge into (the "ours" side). Defaults to current branch. */
  readonly into?: string;
  /** Override the default merge commit message. */
  readonly message?: string;
  /**
   * When true, return the conflict report instead of an error.
   * (Conflicts are returned regardless; this just controls whether
   * a non-conflict success/no-op path is also rendered as a "report".)
   */
  readonly dryRun?: boolean;
}

export const handleGraphstoreMerge = async (params: GraphstoreMergeParams) => {
  const ctx = buildCtx(params.storagePath);
  const headState = await readHead({ root: ctx.root });
  const branch = params.into ?? (headState.kind === 'branch' ? headState.branch : null);
  if (!branch) {
    return {
      kind: 'error',
      message: 'merge requires either --into <branch> or a non-detached HEAD on the target repo',
    };
  }
  const ours = (await listBranches({ root: ctx.root })).find((b) => b.name === branch)?.head;
  if (!ours) {
    return { kind: 'error', message: `target branch "${branch}" not found` };
  }
  const theirs = await resolveTarget(ctx, params.source);

  const result = await threeWayMerge({ cas: ctx.cas, ours, theirs });
  switch (result.kind) {
    case 'already-up-to-date':
      return { kind: 'already-up-to-date', branch };
    case 'fast-forward':
      if (!params.dryRun) {
        await setHead({ root: ctx.root, branch, commit: result.to });
      }
      return { kind: 'fast-forward', branch, to: result.to, dryRun: params.dryRun ?? false };
    case 'conflicts':
      return {
        kind: 'conflicts',
        branch,
        base: result.base,
        conflicts: result.conflicts.slice(0, 100),
        totalConflicts: result.conflicts.length,
      };
    case 'merged': {
      if (params.dryRun) {
        return {
          kind: 'merged',
          dryRun: true,
          branch,
          base: result.base,
          snapshotId: result.snapshotId,
          stats: result.stats,
        };
      }
      const message = params.message ?? `Merge ${params.source} into ${branch}`;
      const commit = await createCommit({
        cas: ctx.cas,
        snapshot: result.snapshotId,
        parents: [ours, theirs],
        author: { name: 'codragraph', email: 'noreply@codragraph.local' },
        message,
      });
      await setHead({ root: ctx.root, branch, commit: commit.commitId });
      return {
        kind: 'merged',
        dryRun: false,
        branch,
        base: result.base,
        commitId: commit.commitId,
        snapshotId: result.snapshotId,
        stats: result.stats,
      };
    }
  }
};

// ──────────────────────────────────────────────────────────────────────
// graphstore_gc
// ──────────────────────────────────────────────────────────────────────

export interface GraphstoreGcParams {
  readonly storagePath: string;
  readonly dryRun?: boolean;
}

export const handleGraphstoreGc = async (params: GraphstoreGcParams) => {
  const ctx = buildCtx(params.storagePath);
  const result = await runGc({
    cas: ctx.cas,
    graphstoreRoot: ctx.root,
    dryRun: params.dryRun,
  });
  return {
    dryRun: result.dryRun,
    reachable: result.reachable,
    swept: result.swept.length,
    bytesFreed: result.bytesFreed,
    sample: result.swept.slice(0, 25),
  };
};

const locateSymbol = (
  manifest: SnapshotManifest,
  symbolId: string,
  tableHint?: string,
): { table: string; hash: ObjectId } | null => {
  if (tableHint !== undefined) {
    const t = manifest.nodeTables[tableHint];
    const h = t?.rows[symbolId];
    return h ? { table: tableHint, hash: h } : null;
  }
  for (const [table, t] of Object.entries(manifest.nodeTables)) {
    const h = t.rows[symbolId];
    if (h) return { table, hash: h };
  }
  return null;
};

const compressBlameTransitions = <T extends { rowHash: ObjectId | null }>(history: T[]): T[] => {
  const out: T[] = [];
  let lastHash: ObjectId | null = null;
  for (let i = 0; i < history.length; i++) {
    const e = history[i];
    if (e === undefined) continue;
    if (i === 0 || e.rowHash !== lastHash) out.push(e);
    lastHash = e.rowHash;
  }
  return out;
};
