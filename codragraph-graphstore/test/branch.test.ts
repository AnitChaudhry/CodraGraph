import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createBranch,
  getHead,
  listBranches,
  readHead,
  resolveHeadCommit,
  setHead,
  writeHeadBranch,
  writeHeadDetached,
} from "../src/history/branch.js";
import { makeObjectId } from "../src/types.js";

let tmpRoot: string;
const commitA = makeObjectId("a".repeat(64));
const commitB = makeObjectId("b".repeat(64));

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "graphstore-refs-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("branch refs", () => {
  it("createBranch writes a ref and refuses to overwrite", async () => {
    const branch = await createBranch({ root: tmpRoot, name: "main", commit: commitA });
    expect(branch.name).toBe("main");
    expect(branch.head).toBe(commitA);

    await expect(
      createBranch({ root: tmpRoot, name: "main", commit: commitB }),
    ).rejects.toThrow();
  });

  it("setHead moves an existing branch and creates if missing", async () => {
    await createBranch({ root: tmpRoot, name: "main", commit: commitA });
    await setHead({ root: tmpRoot, branch: "main", commit: commitB });
    expect(await getHead({ root: tmpRoot, branch: "main" })).toBe(commitB);

    await setHead({ root: tmpRoot, branch: "feature", commit: commitA });
    expect(await getHead({ root: tmpRoot, branch: "feature" })).toBe(commitA);
  });

  it("getHead returns null for a missing branch", async () => {
    expect(await getHead({ root: tmpRoot, branch: "nope" })).toBeNull();
  });

  it("listBranches returns every ref sorted by name", async () => {
    await createBranch({ root: tmpRoot, name: "zeta", commit: commitB });
    await createBranch({ root: tmpRoot, name: "alpha", commit: commitA });
    const branches = await listBranches({ root: tmpRoot });
    expect(branches.map((b) => b.name)).toEqual(["alpha", "zeta"]);
  });

  it("rejects path-traversal branch names", async () => {
    await expect(
      createBranch({ root: tmpRoot, name: "../../../etc/passwd", commit: commitA }),
    ).rejects.toThrow(/Invalid branch name/);
    await expect(
      createBranch({ root: tmpRoot, name: "/abs", commit: commitA }),
    ).rejects.toThrow(/Invalid branch name/);
  });
});

describe("HEAD", () => {
  it("readHead returns 'unborn' before any HEAD file is written", async () => {
    const head = await readHead({ root: tmpRoot });
    expect(head.kind).toBe("unborn");
  });

  it("writeHeadBranch + readHead → branch state", async () => {
    await writeHeadBranch({ root: tmpRoot, branch: "main" });
    const head = await readHead({ root: tmpRoot });
    expect(head).toEqual({ kind: "branch", branch: "main" });
  });

  it("writeHeadDetached + readHead → detached state", async () => {
    await writeHeadDetached({ root: tmpRoot, commit: commitA });
    const head = await readHead({ root: tmpRoot });
    expect(head).toEqual({ kind: "detached", commit: commitA });
  });

  it("resolveHeadCommit follows HEAD → branch → commit", async () => {
    await createBranch({ root: tmpRoot, name: "main", commit: commitA });
    await writeHeadBranch({ root: tmpRoot, branch: "main" });
    expect(await resolveHeadCommit({ root: tmpRoot })).toBe(commitA);
  });

  it("resolveHeadCommit returns null when HEAD is unborn", async () => {
    expect(await resolveHeadCommit({ root: tmpRoot })).toBeNull();
  });
});
