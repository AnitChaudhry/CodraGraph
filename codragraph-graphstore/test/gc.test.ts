import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FsCAS } from "../src/cas/fs-cas.js";
import { collectReachableObjects, gc } from "../src/gc/sweep.js";
import { putJson } from "../src/cas/interface.js";
import { serializeSnapshot } from "../src/snapshot/serializer.js";
import { createCommit } from "../src/history/commit.js";
import {
  createBranch,
  deleteBranch,
  setHead,
  writeHeadBranch,
} from "../src/history/branch.js";
import { type GraphRow, type RowSource } from "../src/snapshot/row-source.js";

let tmpRoot: string;
let cas: FsCAS;
const author = { name: "test", email: "t@example.com" };

interface FakeGraph {
  readonly nodes: Record<string, GraphRow[]>;
  readonly edges: GraphRow[];
}
const fakeSource = (graph: FakeGraph): RowSource => ({
  listNodeTables: async () => Object.keys(graph.nodes),
  streamNodeTable: async function* (t: string) {
    for (const r of graph.nodes[t] ?? []) yield r;
  },
  streamEdges: async function* () {
    for (const r of graph.edges) yield r;
  },
});

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "graphstore-gc-"));
  cas = new FsCAS({ root: tmpRoot });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("collectReachableObjects", () => {
  it("captures everything reachable from a single branch ref", async () => {
    const { snapshotId } = await serializeSnapshot({
      source: fakeSource({
        nodes: { Function: [{ id: "f1", name: "x" }] },
        edges: [{ from: "f1", to: "f1", type: "CALLS" }],
      }),
      cas,
    });
    const { commitId } = await createCommit({
      cas,
      snapshot: snapshotId,
      parents: [],
      author,
      message: "init",
    });
    await createBranch({ root: tmpRoot, name: "main", commit: commitId });
    await writeHeadBranch({ root: tmpRoot, branch: "main" });

    const reachable = await collectReachableObjects({ cas, graphstoreRoot: tmpRoot });
    // commit + snapshot + manifest + 1 function row + 1 edge row = 5
    expect(reachable.size).toBe(5);
    expect(reachable.has(commitId)).toBe(true);
    expect(reachable.has(snapshotId)).toBe(true);
  });
});

describe("gc", () => {
  it("dry-run reports unreachable objects without deleting", async () => {
    // Reachable: a real commit on `main`.
    const { snapshotId } = await serializeSnapshot({
      source: fakeSource({ nodes: { Function: [{ id: "f1", name: "x" }] }, edges: [] }),
      cas,
    });
    const { commitId } = await createCommit({
      cas,
      snapshot: snapshotId,
      parents: [],
      author,
      message: "init",
    });
    await createBranch({ root: tmpRoot, name: "main", commit: commitId });
    await writeHeadBranch({ root: tmpRoot, branch: "main" });

    // Orphan: write a value that's not referenced by anything.
    const orphanId = await putJson(cas, { type: "orphan", v: 1 });

    const result = await gc({ cas, graphstoreRoot: tmpRoot, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.swept).toContain(orphanId);

    // File still exists after dry-run.
    expect(await cas.has(orphanId)).toBe(true);
  });

  it("sweeps unreachable objects when not dry-run", async () => {
    const { snapshotId } = await serializeSnapshot({
      source: fakeSource({ nodes: { Function: [{ id: "f1", name: "x" }] }, edges: [] }),
      cas,
    });
    const { commitId } = await createCommit({
      cas,
      snapshot: snapshotId,
      parents: [],
      author,
      message: "init",
    });
    await createBranch({ root: tmpRoot, name: "main", commit: commitId });
    await writeHeadBranch({ root: tmpRoot, branch: "main" });

    const orphanId = await putJson(cas, { type: "orphan", note: "should be swept" });
    expect(await cas.has(orphanId)).toBe(true);

    const result = await gc({ cas, graphstoreRoot: tmpRoot });
    expect(result.dryRun).toBe(false);
    expect(result.swept).toContain(orphanId);
    expect(await cas.has(orphanId)).toBe(false);
    expect(await cas.has(commitId)).toBe(true);
  });

  it("after deleting a branch, its objects become sweepable", async () => {
    // Build two branches with disjoint content; delete one and confirm
    // gc collects the orphaned commit/snapshot/manifest/rows.
    const a = await serializeSnapshot({
      source: fakeSource({ nodes: { Function: [{ id: "fa", name: "a-only" }] }, edges: [] }),
      cas,
    });
    const ca = await createCommit({
      cas,
      snapshot: a.snapshotId,
      parents: [],
      author,
      message: "a",
    });
    const b = await serializeSnapshot({
      source: fakeSource({ nodes: { Function: [{ id: "fb", name: "b-only" }] }, edges: [] }),
      cas,
    });
    const cb = await createCommit({
      cas,
      snapshot: b.snapshotId,
      parents: [],
      author,
      message: "b",
    });
    await createBranch({ root: tmpRoot, name: "main", commit: ca.commitId });
    await createBranch({ root: tmpRoot, name: "feature", commit: cb.commitId });
    await writeHeadBranch({ root: tmpRoot, branch: "main" });

    // Both branches keep their commits alive.
    let result = await gc({ cas, graphstoreRoot: tmpRoot, dryRun: true });
    expect(result.swept).not.toContain(ca.commitId);
    expect(result.swept).not.toContain(cb.commitId);

    // Delete the feature branch — its commit + its snapshot are now orphaned.
    expect(await deleteBranch({ root: tmpRoot, name: "feature" })).toBe(true);
    result = await gc({ cas, graphstoreRoot: tmpRoot });
    expect(result.swept).toContain(cb.commitId);
    expect(result.swept).toContain(b.snapshotId);
    expect(await cas.has(ca.commitId)).toBe(true);
  });

  it("refuses to delete the currently-checked-out branch", async () => {
    const { snapshotId } = await serializeSnapshot({
      source: fakeSource({ nodes: { Function: [{ id: "f1" }] }, edges: [] }),
      cas,
    });
    const { commitId } = await createCommit({
      cas,
      snapshot: snapshotId,
      parents: [],
      author,
      message: "init",
    });
    await createBranch({ root: tmpRoot, name: "main", commit: commitId });
    await writeHeadBranch({ root: tmpRoot, branch: "main" });

    await expect(deleteBranch({ root: tmpRoot, name: "main" })).rejects.toThrow(
      /currently checked out/,
    );
  });
});
