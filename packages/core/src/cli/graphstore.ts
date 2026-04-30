/**
 * CLI commands for the Phase 4 versioned graph store.
 *
 * Read-only surface so far: `codragraph log`, `codragraph branch list`,
 * `codragraph diff <from> <to>`. The mutating commands (`commit`,
 * `branch <name>`, `checkout`) are scoped for Phase 4.5 — `commit` and
 * branch creation already happen implicitly inside `codragraph analyze`,
 * so the read-only commands are enough to inspect what landed.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  FsCAS,
  createBranch,
  createCommit,
  DEFAULT_BRANCH,
  deleteBranch,
  diffSemantic,
  diffSnapshots,
  gc as runGc,
  getJson,
  listBranches,
  materializeSnapshot,
  parseObjectId,
  readCommit,
  readHead,
  resolveHeadCommit,
  setHead,
  threeWayMerge,
  walkCommits,
  writeHeadBranch,
  writeHeadDetached,
  type ObjectId,
  type RowSink,
  type GraphRow,
  type Snapshot,
  type SnapshotManifest,
} from '@codragraph/graphstore';
import { findRepo, loadMeta, saveMeta } from '../storage/repo-manager.js';
import { GRAPHSTORE_SUBDIR } from '../core/graphstore/index.js';
import { initCgdb, closeCgdb } from '../core/cgdb/cgdb-adapter.js';
import { recordAnalysisSnapshot } from '../core/graphstore/index.js';
import { getCurrentCommit, hasGitDir } from '../storage/git.js';

interface ResolvedRoot {
  readonly repoPath: string;
  readonly graphstoreRoot: string;
  readonly cas: FsCAS;
}

const resolveGraphstore = async (cwd: string): Promise<ResolvedRoot> => {
  const repo = await findRepo(cwd);
  if (!repo) {
    throw new Error(
      `No CodraGraph index found at or above ${cwd}. Run \`codragraph analyze\` first.`,
    );
  }
  const graphstoreRoot = path.join(repo.storagePath, GRAPHSTORE_SUBDIR);
  return {
    repoPath: repo.repoPath,
    graphstoreRoot,
    cas: new FsCAS({ root: graphstoreRoot }),
  };
};

/**
 * Resolve a user-supplied target (branch name or commit id) into a commit id.
 * Path: branch ref first, fall back to literal commit id parsing.
 */
const resolveCommitTarget = async (ctx: ResolvedRoot, target: string): Promise<ObjectId> => {
  // Branch ref?
  const branches = await listBranches({ root: ctx.graphstoreRoot });
  const match = branches.find((b) => b.name === target);
  if (match) return match.head;
  // Otherwise treat as a literal commit id.
  return parseObjectId(target);
};

// ──────────────────────────────────────────────────────────────────────
// codragraph log
// ──────────────────────────────────────────────────────────────────────

export const logCommand = async (opts: { limit?: string } = {}) => {
  const ctx = await resolveGraphstore(process.cwd());
  const head = await resolveHeadCommit({ root: ctx.graphstoreRoot });
  if (head === null) {
    console.error('No commits yet. Run `codragraph analyze` to create the first snapshot.');
    process.exitCode = 1;
    return;
  }
  const limit = opts.limit !== undefined ? Number.parseInt(opts.limit, 10) : 50;

  const headState = await readHead({ root: ctx.graphstoreRoot });
  if (headState.kind === 'branch') {
    process.stdout.write(`On branch ${headState.branch}\n`);
  } else if (headState.kind === 'detached') {
    process.stdout.write(`HEAD detached at ${headState.commit.slice(0, 19)}\n`);
  }

  for await (const entry of walkCommits({ cas: ctx.cas, from: head, limit })) {
    const shortId = entry.id.slice(7, 7 + 12);
    process.stdout.write(
      `${shortId}  ${entry.commit.ts}  ${entry.commit.author.name}  ${entry.commit.message}\n`,
    );
  }
};

// ──────────────────────────────────────────────────────────────────────
// codragraph branch [list]
// ──────────────────────────────────────────────────────────────────────

export const branchListCommand = async () => {
  const ctx = await resolveGraphstore(process.cwd());
  const branches = await listBranches({ root: ctx.graphstoreRoot });
  if (branches.length === 0) {
    console.error('No branches yet. Run `codragraph analyze` to create the first snapshot.');
    return;
  }
  const headState = await readHead({ root: ctx.graphstoreRoot });
  const currentBranch = headState.kind === 'branch' ? headState.branch : null;
  for (const branch of branches) {
    const marker = branch.name === currentBranch ? '*' : ' ';
    process.stdout.write(`${marker} ${branch.name}  ${branch.head.slice(7, 7 + 12)}\n`);
  }
};

// ──────────────────────────────────────────────────────────────────────
// codragraph diff <from> <to>
// ──────────────────────────────────────────────────────────────────────

export const diffCommand = async (from: string, to: string, opts: { json?: boolean } = {}) => {
  const ctx = await resolveGraphstore(process.cwd());

  const fromCommitId = await resolveCommitTarget(ctx, from);
  const toCommitId = await resolveCommitTarget(ctx, to);
  const fromCommit = await readCommit(ctx.cas, fromCommitId);
  const toCommit = await readCommit(ctx.cas, toCommitId);

  const diff = await diffSnapshots({
    cas: ctx.cas,
    from: fromCommit.snapshot,
    to: toCommit.snapshot,
  });

  // --json: emit a machine-readable payload for downstream consumers
  // (GitHub Action comment formatter, IDE plugins, etc). Keep human and
  // JSON paths separate — never sneak JSON into the human path's stdout.
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          from: { commit: fromCommitId, message: fromCommit.message },
          to: { commit: toCommitId, message: toCommit.message },
          diff,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  process.stdout.write(`From: ${fromCommitId.slice(7, 7 + 12)}  ${fromCommit.message}\n`);
  process.stdout.write(`To:   ${toCommitId.slice(7, 7 + 12)}  ${toCommit.message}\n\n`);

  let totalAdded = 0;
  let totalRemoved = 0;
  for (const [table, ids] of Object.entries(diff.addedNodes)) {
    if (ids.length === 0) continue;
    process.stdout.write(`+ ${table}: ${ids.length}\n`);
    totalAdded += ids.length;
  }
  for (const [table, ids] of Object.entries(diff.removedNodes)) {
    if (ids.length === 0) continue;
    process.stdout.write(`- ${table}: ${ids.length}\n`);
    totalRemoved += ids.length;
  }
  if (diff.addedEdges.length > 0) {
    process.stdout.write(`+ edges: ${diff.addedEdges.length}\n`);
  }
  if (diff.removedEdges.length > 0) {
    process.stdout.write(`- edges: ${diff.removedEdges.length}\n`);
  }
  if (diff.modifiedSymbols.length > 0) {
    process.stdout.write(`~ modified symbols: ${diff.modifiedSymbols.length}\n`);
    for (const m of diff.modifiedSymbols.slice(0, 20)) {
      process.stdout.write(`    ${m.table}  ${m.id}\n`);
    }
    if (diff.modifiedSymbols.length > 20) {
      process.stdout.write(`    … and ${diff.modifiedSymbols.length - 20} more\n`);
    }
  }
  if (
    totalAdded === 0 &&
    totalRemoved === 0 &&
    diff.addedEdges.length === 0 &&
    diff.removedEdges.length === 0 &&
    diff.modifiedSymbols.length === 0
  ) {
    process.stdout.write('(no graph changes)\n');
  }
};

// ──────────────────────────────────────────────────────────────────────
// codragraph commit -m <message>
// ──────────────────────────────────────────────────────────────────────
//
// Re-snapshots the live LadybugDB and creates an explicit commit on top
// of the current branch. If the graph hasn't changed since the last
// snapshot the snapshot id is identical (canonical hashing) but the
// commit id differs because the message and timestamp diverge — useful
// as an explicit checkpoint marker (e.g. "before refactor").

export const commitCommand = async (opts: { message?: string } = {}) => {
  if (!opts.message || opts.message.trim() === '') {
    console.error('Usage: codragraph commit -m <message>');
    process.exitCode = 1;
    return;
  }
  const ctx = await resolveGraphstore(process.cwd());
  const repo = await findRepo(process.cwd());
  if (!repo) throw new Error('No CodraGraph index found');

  await initCgdb(repo.cgdbPath);
  try {
    const result = await recordAnalysisSnapshot({
      storagePath: repo.storagePath,
      indexedRepoCommit: hasGitDir(repo.repoPath) ? getCurrentCommit(repo.repoPath) : undefined,
      message: opts.message,
      onSkipTable: (table, err) => {
        process.stderr.write(
          `  skipped ${table}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      },
    });
    if (!result) {
      console.error('commit: snapshot failed (graphstore disabled or empty graph)');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `committed ${result.commitId.slice(7, 7 + 12)} on branch ${result.branch}\n` +
        `snapshot ${result.snapshotId.slice(7, 7 + 12)}  ` +
        `nodes ${result.stats.totalNodeRows}  edges ${result.stats.edgeRowCount}\n`,
    );

    // Mirror into meta.json so `codragraph status` and the registry stay accurate.
    const meta = await loadMeta(repo.storagePath);
    if (meta) {
      meta.currentBranch = result.branch;
      meta.headCommit = result.commitId;
      await saveMeta(repo.storagePath, meta);
    }
  } finally {
    await closeCgdb();
  }

  // Avoid unused warnings while keeping the import live for future callers.
  void ctx;
};

// ──────────────────────────────────────────────────────────────────────
// codragraph branch create <name>
// ──────────────────────────────────────────────────────────────────────

export const branchCreateCommand = async (name: string, opts: { from?: string } = {}) => {
  const ctx = await resolveGraphstore(process.cwd());
  let head: ObjectId | null;
  if (opts.from !== undefined) {
    head = await resolveCommitTarget(ctx, opts.from);
  } else {
    head = await resolveHeadCommit({ root: ctx.graphstoreRoot });
  }
  if (head === null) {
    console.error(
      'No commit to branch from. Run `codragraph analyze` (or `codragraph commit -m`) first.',
    );
    process.exitCode = 1;
    return;
  }
  const branch = await createBranch({ root: ctx.graphstoreRoot, name, commit: head });
  process.stdout.write(`created branch ${branch.name} at ${branch.head.slice(7, 7 + 12)}\n`);
};

// ──────────────────────────────────────────────────────────────────────
// codragraph checkout <target>
// ──────────────────────────────────────────────────────────────────────
//
// Two modes:
//   - default       : just move HEAD (no cgdb rewrite). Cheap; good for
//                     log/diff inspection from a different vantage point.
//   - --materialize : also rebuild the live LadybugDB from the target
//                     snapshot. Destructive of the current cgdb state —
//                     run `commit` first if you have unsaved changes.

export const checkoutCommand = async (target: string, opts: { materialize?: boolean } = {}) => {
  const ctx = await resolveGraphstore(process.cwd());
  const branches = await listBranches({ root: ctx.graphstoreRoot });
  const branchHit = branches.find((b) => b.name === target);

  let commitId: ObjectId;
  if (branchHit) {
    commitId = branchHit.head;
    await writeHeadBranch({ root: ctx.graphstoreRoot, branch: target });
    process.stdout.write(`switched to branch ${target} (${commitId.slice(7, 7 + 12)})\n`);
  } else {
    commitId = parseObjectId(target);
    await writeHeadDetached({ root: ctx.graphstoreRoot, commit: commitId });
    process.stdout.write(`HEAD detached at ${commitId.slice(7, 7 + 12)}\n`);
  }

  if (opts.materialize) {
    const repo = await findRepo(process.cwd());
    if (!repo) throw new Error('No CodraGraph index found');
    const commit = await readCommit(ctx.cas, commitId);

    process.stdout.write(`materializing snapshot ${commit.snapshot.slice(7, 7 + 12)}...\n`);

    // Wipe and reinit cgdb.
    await closeCgdb();
    for (const f of [repo.cgdbPath, `${repo.cgdbPath}.wal`, `${repo.cgdbPath}.lock`]) {
      try {
        await fs.rm(f, { recursive: true, force: true });
      } catch {
        /* swallow */
      }
    }
    await initCgdb(repo.cgdbPath);
    try {
      const sink = await createCgdbRowSinkForCheckout(repo.cgdbPath);
      const result = await materializeSnapshot({
        cas: ctx.cas,
        snapshotId: commit.snapshot,
        sink,
      });
      process.stdout.write(
        `materialized ${Object.keys(result.stats.nodeRowsByTable).length} tables, ` +
          `${result.stats.edgeRowCount} edges\n`,
      );
    } finally {
      await closeCgdb();
    }
  }
};

// ──────────────────────────────────────────────────────────────────────
// codragraph materialize <target> --into <path>
// ──────────────────────────────────────────────────────────────────────
// Read-only inspection: rebuild a snapshot into a fresh sibling cgdb
// without touching the live one. Useful for "let me query the graph as
// it was at commit X" without disturbing current work.

export const materializeCommand = async (target: string, opts: { into: string }) => {
  const ctx = await resolveGraphstore(process.cwd());
  const commitId = await resolveCommitTarget(ctx, target);
  const commit = await readCommit(ctx.cas, commitId);

  const into = path.resolve(opts.into);
  await fs.mkdir(path.dirname(into), { recursive: true });
  // Refuse to overwrite an existing file silently.
  try {
    await fs.access(into);
    console.error(
      `Refusing to overwrite ${into}. Pick a fresh path or delete the existing file first.`,
    );
    process.exitCode = 1;
    return;
  } catch {
    /* doesn't exist, good */
  }

  await initCgdb(into);
  try {
    const sink = await createCgdbRowSinkForCheckout(into);
    const result = await materializeSnapshot({
      cas: ctx.cas,
      snapshotId: commit.snapshot,
      sink,
    });
    process.stdout.write(
      `materialized ${commitId.slice(7, 7 + 12)} into ${into}\n` +
        `tables: ${Object.entries(result.stats.nodeRowsByTable)
          .map(([t, n]) => `${t}=${n}`)
          .join(' ')}\n` +
        `edges:  ${result.stats.edgeRowCount}\n`,
    );
  } finally {
    await closeCgdb();
  }
};

// ──────────────────────────────────────────────────────────────────────
// codragraph blame <symbolId>
// ──────────────────────────────────────────────────────────────────────
//
// Walk history newest-first. For each pair of adjacent commits, ask the
// structural diff whether the symbol's row hash changed. The first
// "changed" hit is the symbol's most-recent change commit; we keep
// walking to surface its full change history.

export const blameCommand = async (
  symbolId: string,
  opts: { table?: string; limit?: string } = {},
) => {
  const ctx = await resolveGraphstore(process.cwd());
  const head = await resolveHeadCommit({ root: ctx.graphstoreRoot });
  if (head === null) {
    console.error('No commits yet. Run `codragraph analyze` first.');
    process.exitCode = 1;
    return;
  }
  const limit = opts.limit !== undefined ? Number.parseInt(opts.limit, 10) : 20;

  const tableHint = opts.table;
  const history: { id: ObjectId; commit: Awaited<ReturnType<typeof readCommit>> }[] = [];
  for await (const entry of walkCommits({ cas: ctx.cas, from: head })) {
    history.push(entry);
  }
  if (history.length === 0) {
    console.error('No history.');
    return;
  }

  process.stdout.write(`Blame: ${symbolId}${tableHint ? ` (table=${tableHint})` : ''}\n\n`);

  let lastHash: ObjectId | null = null;
  let surfaced = 0;
  // Iterate newest → oldest, comparing each commit's row hash for the symbol
  // against the next-older one.
  for (let i = 0; i < history.length; i++) {
    const entry = history[i]!;
    const snapshot = await getJson<Snapshot>(ctx.cas, entry.commit.snapshot);
    const manifest = await getJson<SnapshotManifest>(ctx.cas, parseObjectId(snapshot.manifestId));

    const found = locateSymbolHash(manifest, symbolId, tableHint);
    if (!found) {
      if (lastHash !== null) {
        // Symbol existed in the newer commit but not here → introduced
        // in commit history[i-1].
        const introducedAt = history[i - 1];
        if (introducedAt !== undefined) {
          process.stdout.write(
            `  introduced ${introducedAt.id.slice(7, 7 + 12)}  ${introducedAt.commit.ts}  ` +
              `${introducedAt.commit.message}\n`,
          );
        }
        return;
      }
      continue;
    }

    if (lastHash === null || found.hash !== lastHash) {
      process.stdout.write(
        `  ${found.hash === lastHash ? '   ' : 'CHG'} ${entry.id.slice(7, 7 + 12)}  ` +
          `${entry.commit.ts}  ${found.table}  ${entry.commit.message}\n`,
      );
      surfaced++;
      if (surfaced >= limit) return;
    }
    lastHash = found.hash;
  }
};

const locateSymbolHash = (
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

// ──────────────────────────────────────────────────────────────────────
// CgdbRowSink — used by checkout --materialize and `materialize` command.
// ──────────────────────────────────────────────────────────────────────
//
// Bulk-loads rows back into a fresh LadybugDB instance. Phase 4 keeps it
// simple: per-row CREATE statements through the existing
// `executeWithReusedStatement` helper. For typical repos (≤100k rows)
// this finishes in seconds; CSV-based bulk loading is a Phase 4.5
// optimization once we measure where the bottleneck actually is.

const createCgdbRowSinkForCheckout = async (cgdbPath: string): Promise<RowSink> => {
  const { executeQuery } = await import('../core/cgdb/cgdb-adapter.js');
  const { SCHEMA_QUERIES } = await import('../core/cgdb/schema.js');

  // Recreate the schema; the path was just wiped, so this is a clean install.
  for (const ddl of SCHEMA_QUERIES) {
    try {
      await executeQuery(ddl);
    } catch (err) {
      // Schema queries are idempotent at the SQL level (CREATE NODE TABLE
      // IF NOT EXISTS isn't supported, but the reload happens on a fresh
      // db so duplicates can't happen). Surface anything weird.
      throw new Error(
        `Failed to create schema while materializing checkout: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const sink: RowSink = {
    beginTable: async () => {},
    writeRows: async (tableName, rows) => {
      for (const row of rows) await insertNode(executeQuery, tableName, row);
    },
    endTable: async () => {},
    beginEdges: async () => {},
    writeEdgeRows: async (rows) => {
      for (const row of rows) await insertEdge(executeQuery, row);
    },
    endEdges: async () => {},
    finalize: async () => {},
  };
  void cgdbPath;
  return sink;
};

const insertNode = async (
  executeQuery: (cypher: string) => Promise<unknown[]>,
  table: string,
  row: GraphRow,
): Promise<void> => {
  // Build a property map literal — Cypher CREATE syntax. We escape
  // strings via JSON.stringify (handles quotes/newlines/unicode) and
  // pass through scalar primitives unchanged.
  const props = Object.entries(row)
    .map(([k, v]) => `${k}: ${cypherLiteral(v)}`)
    .join(', ');
  try {
    await executeQuery(`CREATE (n:${table} { ${props} })`);
  } catch {
    // Best-effort: skip rows that fail (e.g. schema mismatch on
    // historical snapshots after a NODE_TABLES extension). Phase 4.5
    // will surface these via the sink's stats.
  }
};

const insertEdge = async (
  executeQuery: (cypher: string) => Promise<unknown[]>,
  row: GraphRow,
): Promise<void> => {
  const from = String(row['from'] ?? '');
  const to = String(row['to'] ?? '');
  const type = String(row['type'] ?? '');
  if (!from || !to || !type) return;
  const extras = Object.entries(row)
    .filter(([k]) => k !== 'from' && k !== 'to' && k !== 'type')
    .map(([k, v]) => `${k}: ${cypherLiteral(v)}`)
    .join(', ');
  try {
    await executeQuery(
      `MATCH (a {id: ${cypherLiteral(from)}}), (b {id: ${cypherLiteral(to)}}) ` +
        `CREATE (a)-[:CodeRelation { type: ${cypherLiteral(type)}${extras ? `, ${extras}` : ''} }]->(b)`,
    );
  } catch {
    /* best-effort */
  }
};

const cypherLiteral = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Fall back to JSON for arrays / nested objects; the underlying cgdb
  // schema is mostly scalar so this is rare.
  return JSON.stringify(v);
};

// ──────────────────────────────────────────────────────────────────────
// codragraph branch delete <name>
// ──────────────────────────────────────────────────────────────────────

export const branchDeleteCommand = async (name: string) => {
  const ctx = await resolveGraphstore(process.cwd());
  try {
    const removed = await deleteBranch({ root: ctx.graphstoreRoot, name });
    if (removed) {
      process.stdout.write(`deleted branch ${name}\n`);
    } else {
      console.error(`No branch named ${name}`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
};

// ──────────────────────────────────────────────────────────────────────
// codragraph merge <branch>
// ──────────────────────────────────────────────────────────────────────

export const mergeCommand = async (target: string, opts: { message?: string } = {}) => {
  const ctx = await resolveGraphstore(process.cwd());
  const headState = await readHead({ root: ctx.graphstoreRoot });
  if (headState.kind !== 'branch') {
    console.error(
      'Refusing to merge from a detached HEAD. Run `codragraph checkout <branch>` first.',
    );
    process.exitCode = 1;
    return;
  }
  const ours = await resolveHeadCommit({ root: ctx.graphstoreRoot });
  if (ours === null) {
    console.error('Current branch has no commits yet — nothing to merge into.');
    process.exitCode = 1;
    return;
  }
  const theirs = await resolveCommitTarget(ctx, target);

  const result = await threeWayMerge({ cas: ctx.cas, ours, theirs });
  switch (result.kind) {
    case 'already-up-to-date':
      process.stdout.write(`Already up to date with ${target}.\n`);
      return;
    case 'fast-forward':
      await setHead({ root: ctx.graphstoreRoot, branch: headState.branch, commit: result.to });
      process.stdout.write(`Fast-forwarded ${headState.branch} → ${result.to.slice(7, 7 + 12)}\n`);
      return;
    case 'conflicts': {
      if (result.base === null) {
        console.error(
          `merge: ${target} has no common ancestor with ${headState.branch} (orphan branches).`,
        );
      } else {
        console.error(
          `merge: ${result.conflicts.length} conflict(s) between ` +
            `${headState.branch} and ${target} (base ${result.base.slice(7, 7 + 12)}):`,
        );
        for (const c of result.conflicts.slice(0, 30)) {
          console.error(`  ${c.kind}  ${c.id}  ${c.reason}`);
        }
        if (result.conflicts.length > 30) {
          console.error(`  … and ${result.conflicts.length - 30} more`);
        }
      }
      process.exitCode = 1;
      return;
    }
    case 'merged': {
      const message = opts.message ?? `Merge ${target} into ${headState.branch}`;
      const commit = await createCommit({
        cas: ctx.cas,
        snapshot: result.snapshotId,
        parents: [ours, theirs],
        author: { name: '@codragraph/cli', email: 'noreply@codragraph.local' },
        message,
      });
      await setHead({
        root: ctx.graphstoreRoot,
        branch: headState.branch,
        commit: commit.commitId,
      });
      const tableSummary = Object.entries(result.stats.tables)
        .filter(([, s]) => s.takenFromOurs + s.takenFromTheirs > 0)
        .map(([t, s]) => `${t}=+${s.takenFromTheirs}/${s.takenFromOurs}`)
        .join(' ');
      process.stdout.write(
        `Merged ${target} into ${headState.branch} (${commit.commitId.slice(7, 7 + 12)})\n` +
          (tableSummary ? `  ${tableSummary}\n` : ''),
      );
      return;
    }
  }
};

// ──────────────────────────────────────────────────────────────────────
// codragraph gc
// ──────────────────────────────────────────────────────────────────────

export const gcCommand = async (opts: { dryRun?: boolean } = {}) => {
  const ctx = await resolveGraphstore(process.cwd());
  const result = await runGc({
    cas: ctx.cas,
    graphstoreRoot: ctx.graphstoreRoot,
    dryRun: opts.dryRun,
  });
  const verb = result.dryRun ? 'would sweep' : 'swept';
  process.stdout.write(
    `${verb} ${result.swept.length} object(s) (${formatBytes(result.bytesFreed)}); ` +
      `${result.reachable} reachable.\n`,
  );
  if (result.dryRun && result.swept.length > 0) {
    process.stdout.write(`(re-run without --dry-run to actually delete)\n`);
  }
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

// ──────────────────────────────────────────────────────────────────────
// codragraph diff --semantic
// ──────────────────────────────────────────────────────────────────────
//
// Promote the existing diff command with a --semantic flag that surfaces
// classified modifications, added/removed APIs, and process changes. We
// expose it as a separate module-local helper so the CLI handler can
// dispatch on the flag.

export const diffSemanticCommand = async (
  from: string,
  to: string,
  opts: { json?: boolean } = {},
) => {
  const ctx = await resolveGraphstore(process.cwd());
  const fromCommit = await readCommit(ctx.cas, await resolveCommitTarget(ctx, from));
  const toCommit = await readCommit(ctx.cas, await resolveCommitTarget(ctx, to));

  const d = await diffSemantic({
    cas: ctx.cas,
    from: fromCommit.snapshot,
    to: toCommit.snapshot,
  });

  // --json: same shape as diff (plain) but with the semantic payload. The
  // PR-review GitHub Action consumes this directly to render the Markdown
  // comment without parsing free-form text.
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          from: { ref: from, message: fromCommit.message },
          to: { ref: to, message: toCommit.message },
          semantic: d,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  process.stdout.write(`From: ${from}  (${fromCommit.message})\n`);
  process.stdout.write(`To:   ${to}    (${toCommit.message})\n\n`);

  if (d.addedAPIs.length > 0) {
    process.stdout.write(`Added APIs (${d.addedAPIs.length}):\n`);
    for (const r of d.addedAPIs) {
      process.stdout.write(`  + ${r.table}  ${r.id}${r.name ? `  (${r.name})` : ''}\n`);
    }
  }
  if (d.removedAPIs.length > 0) {
    process.stdout.write(`Removed APIs (${d.removedAPIs.length}):\n`);
    for (const r of d.removedAPIs) {
      process.stdout.write(`  - ${r.table}  ${r.id}${r.name ? `  (${r.name})` : ''}\n`);
    }
  }
  if (d.addedProcesses.length > 0 || d.removedProcesses.length > 0) {
    process.stdout.write(`\nProcesses:\n`);
    for (const r of d.addedProcesses) {
      process.stdout.write(`  + ${r.id}${r.name ? `  (${r.name})` : ''}\n`);
    }
    for (const r of d.removedProcesses) {
      process.stdout.write(`  - ${r.id}${r.name ? `  (${r.name})` : ''}\n`);
    }
  }
  if (d.classifiedModifications.length > 0) {
    process.stdout.write(`\nModified (${d.classifiedModifications.length}):\n`);
    for (const m of d.classifiedModifications.slice(0, 30)) {
      process.stdout.write(
        `  ~ ${m.table}  ${m.id}  [${m.changes.join(', ')}]` +
          (m.signatureChange?.parameterCountChanged
            ? `  params ${m.signatureChange.parameterCountChanged.from}→${m.signatureChange.parameterCountChanged.to}`
            : '') +
          (m.visibilityFlip ? `  exported ${m.visibilityFlip.from}→${m.visibilityFlip.to}` : '') +
          '\n',
      );
    }
    if (d.classifiedModifications.length > 30) {
      process.stdout.write(`  … and ${d.classifiedModifications.length - 30} more\n`);
    }
  }
  if (
    d.addedAPIs.length === 0 &&
    d.removedAPIs.length === 0 &&
    d.addedProcesses.length === 0 &&
    d.removedProcesses.length === 0 &&
    d.classifiedModifications.length === 0
  ) {
    process.stdout.write('(no semantic changes)\n');
  }
};

// Default-branch helper exposed for tests.
export { DEFAULT_BRANCH };
