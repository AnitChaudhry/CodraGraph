import {
  type Commit,
  type CommitAuthor,
  type ObjectId,
  parseObjectId,
  SCHEMA_VERSION,
} from "../types.js";
import { type ContentAddressedStore, getJson, putJson } from "../cas/interface.js";

export interface CreateCommitOptions {
  readonly cas: ContentAddressedStore;
  readonly snapshot: ObjectId;
  readonly parents: readonly ObjectId[];
  readonly author: CommitAuthor;
  readonly message: string;
  /** ISO 8601 timestamp; defaults to `new Date().toISOString()` at call time. */
  readonly ts?: string;
}

export interface CreateCommitResult {
  readonly commitId: ObjectId;
  readonly commit: Commit;
}

/**
 * Build a {@link Commit} object, write it to CAS, and return its id.
 *
 * Two semantically equal commits — same snapshot, parents, author,
 * message, timestamp — produce the same commit id. The timestamp is
 * the deciding factor in practice (callers passing the current time
 * each call will always get a fresh id).
 */
export const createCommit = async (
  opts: CreateCommitOptions,
): Promise<CreateCommitResult> => {
  const commit: Commit = {
    schemaVersion: SCHEMA_VERSION,
    type: "commit",
    snapshot: opts.snapshot,
    parents: [...opts.parents],
    author: { name: opts.author.name, email: opts.author.email },
    ts: opts.ts ?? new Date().toISOString(),
    message: opts.message,
  };
  const commitId = await putJson(opts.cas, commit);
  return { commitId, commit };
};

/**
 * Read and validate a Commit from CAS. Throws if the object exists but
 * doesn't have the expected shape.
 */
export const readCommit = async (
  cas: ContentAddressedStore,
  id: ObjectId,
): Promise<Commit> => {
  const commit = await getJson<Commit>(cas, id);
  if (commit.type !== "commit") {
    throw new Error(
      `readCommit: object ${id} is not a commit ` +
        `(type=${JSON.stringify((commit as { type?: unknown }).type)})`,
    );
  }
  // Defensive: on-disk objects could be hand-edited or written by a
  // future version — re-validate parent ids and snapshot id at trust
  // boundary so downstream code can assume well-formed input.
  parseObjectId(commit.snapshot);
  for (const parent of commit.parents) parseObjectId(parent);
  return commit;
};
