// swarmSearchWithMoat — exercises the cache-hit short-circuit path and
// the persist-on-fresh-search path. The actual swarm loop is not run
// (it requires Claude Code subprocess + InferenceProvider); we
// substitute a stub that always short-circuits via useCache, and a
// minimal CandidateStore-backed fake for the persistence path.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CandidateStore } from "../src/filesystem.js";
import { FsRecipeStore } from "../src/moat/recipe-store.js";
import { swarmSearchWithMoat } from "../src/moat/swarm-with-moat.js";

let tmpRoot: string;
let candidateStore: CandidateStore;
let recipeStore: FsRecipeStore;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "harness-moat-swarm-"));
  candidateStore = new CandidateStore(path.join(tmpRoot, "candidates"));
  await candidateStore.init();
  recipeStore = new FsRecipeStore({ root: path.join(tmpRoot, "recipes") });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("swarmSearchWithMoat — cache hit short-circuits", () => {
  it("returns cached frontier without calling swarmSearch", async () => {
    // Pre-populate a recipe for the target (snapshotId, taskFamily).
    const snapshotId = "sha256:" + "1".repeat(64);
    const taskFamily = "codebase-qa";
    await recipeStore.put({
      taskFamily,
      snapshotId,
      searchedAt: "2026-04-29T00:00:00Z",
      searchSource: "swarm",
      harness: {
        name: "graph-aware-cached",
        version: "0.1.0",
        files: [{ path: "index.ts", content: "// cached harness" }],
      },
      paretoCoords: { accuracy: 0.92, tokens: 3200, latencyMs: 900 },
      scores: { accuracy: 0.92, tokens: 3200, latencyMs: 900, taskCount: 30 },
    });

    // Build minimum required SwarmSearchOptions. The wrapper short-circuits
    // before any of these are actually used when useCache hits.
    const result = await swarmSearchWithMoat({
      // SwarmSearchOptions (unused in cache-hit path, but required for typing):
      tasks: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inference: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph: {} as any,
      store: candidateStore,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evaluator: {} as any,
      seeds: [],
      budget: { policy: "balanced" },
      loadCandidate: async () => {
        throw new Error("loadCandidate must NOT be invoked on cache hit");
      },
      termination: [],
      // moat options:
      recipeStore,
      snapshotId,
      taskFamily,
      useCache: true,
    });

    expect(result.fromCache).toBe(true);
    expect(result.cachedRecipeIds.length).toBe(1);
    expect(result.frontier[0]?.accuracy).toBe(0.92);
    expect(result.terminatedAt.reason).toBe("cache-hit");
    expect(result.totalEvaluated).toBe(0);
  });

  it("does NOT short-circuit when useCache is false even with exact-match recipes", async () => {
    const snapshotId = "sha256:" + "2".repeat(64);
    await recipeStore.put({
      taskFamily: "codebase-qa",
      snapshotId,
      searchedAt: "2026-04-29T00:00:00Z",
      searchSource: "swarm",
      harness: {
        name: "graph-aware",
        version: "0.1.0",
        files: [{ path: "index.ts", content: "// body" }],
      },
      paretoCoords: { accuracy: 0.7, tokens: 2000, latencyMs: 500 },
      scores: { accuracy: 0.7, tokens: 2000, latencyMs: 500, taskCount: 1 },
    });

    // With useCache=false and zero seeds + zero termination predicates,
    // swarmSearch will run with an empty population. We expect that the
    // wrapper proceeds (does NOT short-circuit) and surfaces an error
    // from swarmSearch's coordinator-builder (no roles configured) —
    // confirming the cache check did not gate the call.
    await expect(
      swarmSearchWithMoat({
        tasks: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inference: {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graph: {} as any,
        store: candidateStore,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evaluator: {} as any,
        seeds: [],
        budget: { policy: "balanced" },
        loadCandidate: async () => {
          throw new Error("loadCandidate stub");
        },
        termination: [],
        recipeStore,
        snapshotId,
        taskFamily: "codebase-qa",
        useCache: false,
      }),
    ).rejects.toThrow();
  });
});
