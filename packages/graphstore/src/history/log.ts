import { type Commit, type ObjectId } from '../types.js';
import { type ContentAddressedStore } from '../cas/interface.js';
import { readCommit } from './commit.js';

export interface WalkCommitsOptions {
  readonly cas: ContentAddressedStore;
  /** Commit id to start the walk from. */
  readonly from: ObjectId;
  /**
   * Maximum number of commits to yield. Walk stops once this many
   * have been emitted, regardless of remaining ancestors. Default:
   * unbounded.
   */
  readonly limit?: number;
}

export interface CommitLogEntry {
  readonly id: ObjectId;
  readonly commit: Commit;
}

/**
 * Walk a commit's ancestry first-parent-first, breadth-first. Each
 * commit is yielded exactly once even when the DAG re-converges
 * (e.g. after a merge), so callers get a clean linearization.
 *
 * Order: deterministic — each level processes parents in their
 * stored order. Roughly matches `git log --first-parent` semantics
 * for linear histories; for merge histories it interleaves parents
 * by BFS depth, which is enough for the Phase 4 `codragraph log` CLI.
 */
export const walkCommits = async function* (
  opts: WalkCommitsOptions,
): AsyncGenerator<CommitLogEntry> {
  const seen = new Set<ObjectId>();
  const queue: ObjectId[] = [opts.from];
  let yielded = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);

    const commit = await readCommit(opts.cas, id);
    yield { id, commit };
    yielded++;
    if (opts.limit !== undefined && yielded >= opts.limit) return;

    for (const parent of commit.parents) {
      if (!seen.has(parent)) queue.push(parent);
    }
  }
};

/**
 * Compute the lowest common ancestor of two commits — the most recent
 * commit that is reachable from both `a` and `b` via parent edges.
 *
 * Used by three-way merge (Phase 4.5). For the linear case (`a` is an
 * ancestor of `b` or vice versa), returns the older of the two. Returns
 * null if the histories don't share a common ancestor (orphan branches).
 */
export const findLowestCommonAncestor = async (
  cas: ContentAddressedStore,
  a: ObjectId,
  b: ObjectId,
): Promise<ObjectId | null> => {
  if (a === b) return a;

  // Collect every ancestor of `a` — we then BFS `b`'s ancestors and
  // return the first one we recognize. This is O(|history|) and good
  // enough for the typical "tens of commits per branch" Phase 4 case.
  const ancestorsOfA = new Set<ObjectId>();
  for await (const entry of walkCommits({ cas, from: a })) {
    ancestorsOfA.add(entry.id);
  }
  for await (const entry of walkCommits({ cas, from: b })) {
    if (ancestorsOfA.has(entry.id)) return entry.id;
  }
  return null;
};
