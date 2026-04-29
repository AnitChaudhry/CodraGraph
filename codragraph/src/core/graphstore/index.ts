/**
 * Codragraph-side glue for the Phase 4 versioned graph store.
 *
 * The graphstore package itself is engine-agnostic; everything that
 * touches LadybugDB lives here, in codragraph/. Best-effort by design:
 * if any step fails the analyze flow continues and the user keeps a
 * working index — versioning gracefully degrades to "no snapshot
 * recorded for this run" rather than breaking unrelated paths.
 */

import path from "node:path";
import {
  FsCAS,
  serializeSnapshot,
  createCommit,
  setHead,
  writeHeadBranch,
  resolveHeadCommit,
  DEFAULT_BRANCH,
  type ObjectId,
  type Snapshot,
  type SnapshotStats,
} from "codragraph-graphstore";
import { createLbugRowSource } from "./lbug-row-source.js";

/** Subdirectory of `<repo>/.codragraph` that holds versioning artifacts. */
export const GRAPHSTORE_SUBDIR = "graphstore";

export interface RecordAnalysisSnapshotOptions {
  /** Absolute path of the repo's `.codragraph/` storage directory. */
  readonly storagePath: string;
  /** Git HEAD of the indexed repo, when known. */
  readonly indexedRepoCommit?: string;
  /**
   * Author for the implicit "analyze" commit. Defaults to a generic
   * `codragraph` identity when callers don't have a real one to hand.
   */
  readonly author?: { readonly name: string; readonly email: string };
  /** Override the commit message — defaults to a timestamped analyze marker. */
  readonly message?: string;
  /** Called with per-table failures so the analyze caller can log them. */
  readonly onSkipTable?: (tableName: string, error: unknown) => void;
}

export interface RecordAnalysisSnapshotResult {
  readonly snapshotId: ObjectId;
  readonly commitId: ObjectId;
  readonly snapshot: Snapshot;
  readonly stats: SnapshotStats;
  readonly branch: string;
}

/**
 * Snapshot the currently-loaded LadybugDB into the content-addressed
 * store and advance the active branch's HEAD to the new commit. Caller
 * is expected to have already initialized lbug with `initLbug(...)`.
 *
 * Returns null if anything goes sideways (logged via `onSkipTable`); the
 * analyze pipeline treats that as "no snapshot for this run".
 */
export const recordAnalysisSnapshot = async (
  opts: RecordAnalysisSnapshotOptions,
): Promise<RecordAnalysisSnapshotResult | null> => {
  const root = path.join(opts.storagePath, GRAPHSTORE_SUBDIR);
  const cas = new FsCAS({ root });

  let serialized;
  try {
    serialized = await serializeSnapshot({
      source: createLbugRowSource({ onSkip: opts.onSkipTable }),
      cas,
      indexedRepoCommit: opts.indexedRepoCommit,
    });
  } catch (err) {
    opts.onSkipTable?.("<serialize>", err);
    return null;
  }

  // Commit + branch wiring. If HEAD is unborn, we initialize the
  // `main` branch pointing at this commit; otherwise we extend whatever
  // branch is currently checked out.
  const branch = await resolveCurrentBranch({ root });
  let parents: ObjectId[] = [];
  const previous = await resolveHeadCommit({ root });
  if (previous !== null) parents = [previous];

  const commit = await createCommit({
    cas,
    snapshot: serialized.snapshotId,
    parents,
    author: opts.author ?? {
      name: "codragraph",
      email: "noreply@codragraph.local",
    },
    message:
      opts.message ?? `analyze ${new Date().toISOString()}`,
  });

  await setHead({ root, branch, commit: commit.commitId });
  if (parents.length === 0) {
    // First-ever commit: anchor HEAD onto the new branch.
    await writeHeadBranch({ root, branch });
  }

  return {
    snapshotId: serialized.snapshotId,
    commitId: commit.commitId,
    snapshot: serialized.snapshot,
    stats: serialized.stats,
    branch,
  };
};

/** Resolve which branch the next analyze commit should advance. */
const resolveCurrentBranch = async (opts: { root: string }): Promise<string> => {
  // For Phase 4 we only support advancing the currently-checked-out
  // branch; the CLI/MCP layer will introduce explicit `branch` /
  // `checkout` commands later. If HEAD is unborn (first analyze ever)
  // we default to DEFAULT_BRANCH.
  const { readHead } = await import("codragraph-graphstore");
  const head = await readHead(opts);
  if (head.kind === "branch") return head.branch;
  return DEFAULT_BRANCH;
};
