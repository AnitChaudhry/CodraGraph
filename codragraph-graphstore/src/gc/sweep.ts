import {
  type ObjectId,
  type Snapshot,
  type SnapshotManifest,
  parseObjectId,
} from "../types.js";
import { type ContentAddressedStore, getJson } from "../cas/interface.js";
import { walkCommits } from "../history/log.js";
import { listBranches, readHead, type BranchRefsOptions } from "../history/branch.js";

export interface CollectReachableOptions {
  readonly cas: ContentAddressedStore;
  readonly graphstoreRoot: string;
}

/**
 * Walk every branch ref + the HEAD pointer, then for each commit walk
 * snapshot → manifest → row hashes. Returns the set of object ids that
 * are reachable from any reference and therefore must NOT be deleted by
 * the sweeper.
 *
 * Cheap: per-commit work is O(unique row hashes); per-branch work is the
 * length of the commit history. For the typical "tens of commits" repo
 * this finishes in milliseconds.
 */
export const collectReachableObjects = async (
  opts: CollectReachableOptions,
): Promise<Set<ObjectId>> => {
  const reachable = new Set<ObjectId>();

  // Seed: every branch head + (when not unborn) the resolved HEAD.
  const seeds: ObjectId[] = [];
  const branches = await listBranches({ root: opts.graphstoreRoot });
  for (const b of branches) seeds.push(b.head);
  const head = await readHead({ root: opts.graphstoreRoot });
  if (head.kind === "detached") seeds.push(head.commit);

  for (const seed of seeds) {
    for await (const entry of walkCommits({ cas: opts.cas, from: seed })) {
      if (reachable.has(entry.id)) continue;
      reachable.add(entry.id);
      reachable.add(parseObjectId(entry.commit.snapshot));

      const snapshot = await safeGet<Snapshot>(opts.cas, parseObjectId(entry.commit.snapshot));
      if (!snapshot) continue;
      const manifestId = parseObjectId(snapshot.manifestId);
      reachable.add(manifestId);

      const manifest = await safeGet<SnapshotManifest>(opts.cas, manifestId);
      if (!manifest) continue;

      for (const table of Object.values(manifest.nodeTables)) {
        for (const rowId of Object.values(table.rows)) reachable.add(rowId);
      }
      for (const rowId of Object.values(manifest.edges.rows)) reachable.add(rowId);
    }
  }

  return reachable;
};

export interface GcOptions extends CollectReachableOptions {
  /**
   * Dry run: compute the unreachable set but do not delete anything.
   * The result reports the IDs that would be removed.
   */
  readonly dryRun?: boolean;
}

export interface GcResult {
  readonly reachable: number;
  readonly swept: ObjectId[];
  /** Best-effort byte total of the deleted (or would-be-deleted) objects. */
  readonly bytesFreed: number;
  readonly dryRun: boolean;
}

/**
 * Mark-and-sweep garbage collection over the content-addressed store.
 * Anything not reachable from a branch ref or detached HEAD is removed
 * (or, in dry-run mode, just listed).
 *
 * Concurrent writers caveat: this is not safe to run in parallel with an
 * `analyze` invocation on the same repo. Callers are expected to take
 * the same advisory lock that LadybugDB does.
 */
export const gc = async (opts: GcOptions): Promise<GcResult> => {
  const reachable = await collectReachableObjects(opts);

  const swept: ObjectId[] = [];
  let bytesFreed = 0;
  const fs = await import("node:fs/promises");

  // FsCAS exposes pathFor; we type-erase here so any
  // ContentAddressedStore that adds a pathFor in the future also works.
  // `bind` so the extracted reference keeps `this` pointed at the store
  // (FsCAS.pathFor reads `this.objectsDir` internally).
  const rawPathFor = (
    opts.cas as unknown as { pathFor?: (id: ObjectId) => string }
  ).pathFor;
  const pathFor: ((id: ObjectId) => string) | null =
    typeof rawPathFor === "function" ? rawPathFor.bind(opts.cas) : null;

  for await (const id of opts.cas.list()) {
    if (reachable.has(id)) continue;
    swept.push(id);
    if (pathFor !== null) {
      const target = pathFor(id);
      try {
        const stat = await fs.stat(target);
        bytesFreed += stat.size;
      } catch {
        /* ignore — file may have just been deleted */
      }
      if (!opts.dryRun) {
        try {
          await fs.unlink(target);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  return {
    reachable: reachable.size,
    swept,
    bytesFreed,
    dryRun: opts.dryRun ?? false,
  };
};

const safeGet = async <T>(
  cas: ContentAddressedStore,
  id: ObjectId,
): Promise<T | null> => {
  try {
    return await getJson<T>(cas, id);
  } catch {
    return null;
  }
};
