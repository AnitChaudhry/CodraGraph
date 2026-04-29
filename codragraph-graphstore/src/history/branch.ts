import fs from "node:fs/promises";
import path from "node:path";
import {
  type Branch,
  type ObjectId,
  parseObjectId,
} from "../types.js";

/**
 * On-disk layout (all relative to the graphstore root):
 *
 *   refs/heads/<name>   one-line file containing a commit id
 *   HEAD                either `ref: refs/heads/<name>` or a bare commit id
 *
 * We follow the Git/Dolt convention rather than inventing a new scheme
 * so users can build mental models from prior tools. No symbolic refs
 * other than HEAD for Phase 4 — everything else is a plain commit ref.
 */

export interface BranchRefsOptions {
  /** Graphstore root, e.g. `<repo>/.codragraph/graphstore`. */
  readonly root: string;
}

const HEADS_SUBDIR = path.posix.join("refs", "heads");
const HEAD_FILE = "HEAD";
const HEAD_REF_PREFIX = "ref: ";

/** Pattern enforcing safe branch names — no path traversal, no whitespace. */
const VALID_BRANCH_NAME = /^[A-Za-z0-9._/-]+$/;

const validateBranchName = (name: string): void => {
  if (!VALID_BRANCH_NAME.test(name) || name.startsWith("/") || name.includes("..")) {
    throw new Error(
      `Invalid branch name ${JSON.stringify(name)} — must match ${VALID_BRANCH_NAME.source} ` +
        `and contain no leading slash or '..' segment`,
    );
  }
};

const refPath = (root: string, name: string): string => {
  validateBranchName(name);
  return path.join(root, HEADS_SUBDIR, name);
};

const headPath = (root: string): string => path.join(root, HEAD_FILE);

/**
 * Create a new branch pointing at the given commit. Refuses to overwrite
 * an existing ref — callers wanting to move a head must use
 * {@link setHead}.
 */
export const createBranch = async (
  opts: BranchRefsOptions & { name: string; commit: ObjectId },
): Promise<Branch> => {
  parseObjectId(opts.commit);
  const target = refPath(opts.root, opts.name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // `wx` flag fails if the file already exists — atomic create-or-fail.
  await fs.writeFile(target, `${opts.commit}\n`, { flag: "wx" });
  const stat = await fs.stat(target);
  return {
    name: opts.name,
    head: opts.commit,
    createdAt: stat.birthtime.toISOString(),
  };
};

/** Move an existing branch to a new commit. Creates the ref if missing. */
export const setHead = async (
  opts: BranchRefsOptions & { branch: string; commit: ObjectId },
): Promise<void> => {
  parseObjectId(opts.commit);
  const target = refPath(opts.root, opts.branch);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${opts.commit}\n`);
};

/** Read the commit id a branch currently points at. Returns null if no such ref. */
export const getHead = async (
  opts: BranchRefsOptions & { branch: string },
): Promise<ObjectId | null> => {
  try {
    const raw = await fs.readFile(refPath(opts.root, opts.branch), "utf-8");
    return parseObjectId(raw.trim());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

/**
 * Delete a branch ref. Refuses to delete the currently-checked-out
 * branch (caller should switch HEAD first). Idempotent on missing
 * branches — returns `false` rather than throwing.
 */
export const deleteBranch = async (
  opts: BranchRefsOptions & { name: string },
): Promise<boolean> => {
  validateBranchName(opts.name);
  const target = refPath(opts.root, opts.name);

  // Refuse to delete the currently-checked-out branch.
  let head: HeadState;
  try {
    head = await readHead(opts);
  } catch {
    head = { kind: "unborn" };
  }
  if (head.kind === "branch" && head.branch === opts.name) {
    throw new Error(
      `Refusing to delete branch ${JSON.stringify(opts.name)} — it is currently checked out`,
    );
  }

  try {
    await fs.unlink(target);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
};

/** List every branch in the graphstore. */
export const listBranches = async (
  opts: BranchRefsOptions,
): Promise<Branch[]> => {
  const dir = path.join(opts.root, HEADS_SUBDIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const branches: Branch[] = [];
  for (const rel of entries) {
    // Skip directory entries on the recursive walk; we only care about files.
    const full = path.join(dir, rel);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const raw = await fs.readFile(full, "utf-8");
    let head: ObjectId;
    try {
      head = parseObjectId(raw.trim());
    } catch {
      // Skip malformed refs rather than aborting the whole listing —
      // the user's `branch list` should still surface the valid ones.
      continue;
    }
    // Normalize separators so listings look the same on Windows / POSIX.
    const name = rel.split(path.sep).join("/");
    branches.push({ name, head, createdAt: stat.birthtime.toISOString() });
  }
  branches.sort((a, b) => a.name.localeCompare(b.name));
  return branches;
};

// ──────────────────────────────────────────────────────────────────────
// HEAD pointer
// ──────────────────────────────────────────────────────────────────────

export type HeadState =
  | { readonly kind: "branch"; readonly branch: string }
  | { readonly kind: "detached"; readonly commit: ObjectId }
  | { readonly kind: "unborn" };

/**
 * Read the HEAD pointer. `unborn` means no HEAD file exists yet — the
 * graphstore has been created but no branch has been checked out.
 */
export const readHead = async (opts: BranchRefsOptions): Promise<HeadState> => {
  let raw: string;
  try {
    raw = await fs.readFile(headPath(opts.root), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "unborn" };
    }
    throw err;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith(HEAD_REF_PREFIX)) {
    const refTarget = trimmed.slice(HEAD_REF_PREFIX.length);
    // Accept the canonical `refs/heads/<name>` form.
    const prefix = `${HEADS_SUBDIR.replace(/\\/g, "/")}/`;
    if (!refTarget.startsWith(prefix)) {
      throw new Error(
        `readHead: HEAD points at ${JSON.stringify(refTarget)}, expected refs/heads/<name>`,
      );
    }
    return { kind: "branch", branch: refTarget.slice(prefix.length) };
  }
  return { kind: "detached", commit: parseObjectId(trimmed) };
};

/** Point HEAD at a branch (`HEAD -> ref: refs/heads/<name>`). */
export const writeHeadBranch = async (
  opts: BranchRefsOptions & { branch: string },
): Promise<void> => {
  validateBranchName(opts.branch);
  await fs.mkdir(opts.root, { recursive: true });
  const refTarget = `${HEADS_SUBDIR.replace(/\\/g, "/")}/${opts.branch}`;
  await fs.writeFile(headPath(opts.root), `${HEAD_REF_PREFIX}${refTarget}\n`);
};

/** Detach HEAD onto a specific commit. */
export const writeHeadDetached = async (
  opts: BranchRefsOptions & { commit: ObjectId },
): Promise<void> => {
  parseObjectId(opts.commit);
  await fs.mkdir(opts.root, { recursive: true });
  await fs.writeFile(headPath(opts.root), `${opts.commit}\n`);
};

/**
 * Convenience: resolve HEAD all the way to a commit id, following the
 * branch ref if needed. Returns null when HEAD is unborn or the branch
 * ref it points at doesn't exist.
 */
export const resolveHeadCommit = async (
  opts: BranchRefsOptions,
): Promise<ObjectId | null> => {
  const head = await readHead(opts);
  if (head.kind === "unborn") return null;
  if (head.kind === "detached") return head.commit;
  return getHead({ root: opts.root, branch: head.branch });
};
