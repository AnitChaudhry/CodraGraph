// MCP handler for the harness_run tool.
//
// Wired into the codragraph MCP server out-of-process: codragraph-harness
// exposes this function and codragraph's MCP server (codragraph/src/mcp/local/
// in their handler-dispatch pattern) calls it when a client invokes the
// `harness_run` tool. Keeping the handler here avoids adding codragraph-harness
// as a hard runtime dep of codragraph.
//
// Phase 1 wiring in codragraph: import { handleHarnessRun } from
// "codragraph-harness/mcp/handler" and register it in the local
// handler dispatcher. (RFC.md spells out the exact integration point.)

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { search } from "../algorithm.js";
import { CandidateStore } from "../filesystem.js";
import { CodebaseQAEvaluator, type CodebaseQATask } from "../evaluator/impl.js";
import { ALL_SEEDS, SEEDS_BY_NAME } from "../harness/seeds/index.js";
import { ClaudeCodeProposer } from "../proposer/claude-code.js";
import { makeInferenceProvider, type ProviderName } from "../inference/index.js";
import { LocalGraphClient } from "../graph/local-client.js";
import { compileAndLoadCandidate } from "../loader.js";
import type { Harness } from "../harness/interface.js";
import type { ParetoPoint } from "../pareto.js";
import type { BudgetPolicy } from "../types.js";
import { swarmSearch } from "../swarm/algorithm.js";
import { ExplorerRole } from "../swarm/explorer.js";
import { ExploiterRole } from "../swarm/exploiter.js";
import { LlmCriticRole } from "../swarm/critic.js";
import {
  costBudget,
  maxIterations,
  paretoPlateau,
  timeBudget,
  tokenBudget,
} from "../swarm/termination.js";
import type { TerminationPredicate, SwarmSearchResult } from "../swarm/interface.js";
import { swarmSearchWithMoat } from "../moat/swarm-with-moat.js";
import { FsRecipeStore } from "../moat/recipe-store.js";
import { findReusableRecipes } from "../moat/lookup.js";
import type { Recipe, RecipeMatch } from "../moat/types.js";

export interface HarnessRunInput {
  task: string;
  iterations?: number;
  candidates_per_iteration?: number;
  proposer?: "claude-code";
  inference?: ProviderName;
  seeds?: string;
  output?: string;
  repo?: string;
  /** Token budget policy (default: "balanced"). */
  budget?: BudgetPolicy;
}

export interface HarnessSwarmRunInput {
  task: string;
  max_iterations?: number;
  explore_count?: number;
  exploit_count?: number;
  plateau_k?: number;
  token_budget?: number;
  time_budget_ms?: number;
  cost_budget_usd?: number;
  inference?: ProviderName;
  critic_inference?: ProviderName;
  seeds?: string;
  output?: string;
  repo?: string;
  budget?: BudgetPolicy;
  // ── Phase 4 × Phase 3 moat ──────────────────────────────────────
  /** Task family for the recipe cache (e.g. "codebase-qa"). */
  task_family?: string;
  /** codragraph-graphstore snapshot id at search time. */
  snapshot_id?: string;
  /** When true and an exact recipe match exists, skip the search and return cache. */
  use_cache?: boolean;
  /** Recipe store root. Defaults to `<cwd>/.codragraph/recipes`. */
  recipe_store?: string;
  /** Persist this many top-Pareto recipes after a fresh search. Default 5. */
  persist_top_k?: number;
}

export interface HarnessSwarmRunOutput {
  runId: string;
  runDir: string;
  totalEvaluated: number;
  totalCriticRejected: number;
  totalLoadRejected: number;
  terminatedAt: SwarmSearchResult["terminatedAt"];
  paretoFrontier: SwarmSearchResult["frontier"];
  perRole: SwarmSearchResult["perRole"];
  /** Phase 4 moat: present when task_family + snapshot_id were provided. */
  cache?: {
    fromCache: boolean;
    cachedRecipeIds: string[];
    persistedRecipeIds: string[];
  };
}

export interface HarnessRunOutput {
  runId: string;
  runDir: string;
  totalEvaluated: number;
  totalRejected: number;
  paretoFrontier: ParetoPoint[];
}

/**
 * Run the harness search loop and return the Pareto frontier.
 *
 * This is the implementation behind the `harness_run` MCP tool registered
 * in codragraph/src/mcp/tools.ts. Pure function — all I/O scoped to the
 * provided run directory.
 */
export async function handleHarnessRun(
  input: HarnessRunInput,
): Promise<HarnessRunOutput> {
  const taskFile = path.resolve(input.task);
  const taskRaw = await fs.readFile(taskFile, "utf8");
  const taskFileParsed = JSON.parse(taskRaw) as { tasks: CodebaseQATask[] };
  const tasks = taskFileParsed.tasks;

  const seedNames = input.seeds && input.seeds !== "all" ? input.seeds.split(",").map((s) => s.trim()) : null;
  const seeds: Harness[] = seedNames
    ? seedNames.map((name) => {
        const seed = SEEDS_BY_NAME[name];
        if (!seed) throw new Error(`Unknown seed: ${name}`);
        return seed;
      })
    : ALL_SEEDS;

  const inference = await makeInferenceProvider((input.inference ?? "claude") as ProviderName);

  // In-process graph client via codragraph's LocalBackend.
  const { LocalBackend } = await import("codragraph/mcp/local/local-backend");
  const backend = new LocalBackend();
  const graph = new LocalGraphClient({ backend, defaultRepo: input.repo });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `harness-${stamp}`;
  const runDir = input.output ?? path.resolve(`./runs/${runId}`);
  await fs.mkdir(runDir, { recursive: true });
  const store = new CandidateStore(path.join(runDir, "candidates"));

  // Locate the contract path relative to this file so handler works under tsx
  // and from the compiled dist/. fileURLToPath is required for Windows paths.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const contractPath = path.resolve(here, "..", "harness", "interface.ts");

  const proposer = new ClaudeCodeProposer({
    contractPath,
    proposalsRoot: path.join(runDir, "proposals"),
  });
  const evaluator = new CodebaseQAEvaluator();

  const result = await search({
    tasks,
    inference,
    graph,
    proposer,
    store,
    evaluator,
    seeds,
    iterations: input.iterations ?? 20,
    candidatesPerIteration: input.candidates_per_iteration ?? 2,
    budget: { policy: input.budget ?? "balanced" },
    loadCandidate: compileAndLoadCandidate,
  });

  return {
    runId,
    runDir,
    totalEvaluated: result.totalEvaluated,
    totalRejected: result.totalRejected,
    paretoFrontier: result.frontier,
  };
}

/**
 * Run the Phase 3 swarm: Explorer + Exploiter (subprocess) + Critic (in-process)
 * with hybrid termination. Implementation behind the `harness_swarm_run` MCP
 * tool registered in codragraph/src/mcp/tools.ts.
 */
export async function handleHarnessSwarmRun(
  input: HarnessSwarmRunInput,
): Promise<HarnessSwarmRunOutput> {
  const taskFile = path.resolve(input.task);
  const taskRaw = await fs.readFile(taskFile, "utf8");
  const taskFileParsed = JSON.parse(taskRaw) as { tasks: CodebaseQATask[] };
  const tasks = taskFileParsed.tasks;

  const seedNames = input.seeds && input.seeds !== "all" ? input.seeds.split(",").map((s) => s.trim()) : null;
  const seeds: Harness[] = seedNames
    ? seedNames.map((name) => {
        const seed = SEEDS_BY_NAME[name];
        if (!seed) throw new Error(`Unknown seed: ${name}`);
        return seed;
      })
    : ALL_SEEDS;

  const inference = await makeInferenceProvider((input.inference ?? "claude") as ProviderName);
  const criticInference = await makeInferenceProvider(
    (input.critic_inference ?? input.inference ?? "claude") as ProviderName,
  );

  const { LocalBackend } = await import("codragraph/mcp/local/local-backend");
  const backend = new LocalBackend();
  const graph = new LocalGraphClient({ backend, defaultRepo: input.repo });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `harness-swarm-${stamp}`;
  const runDir = input.output ?? path.resolve(`./runs/${runId}`);
  await fs.mkdir(runDir, { recursive: true });
  const store = new CandidateStore(path.join(runDir, "candidates"));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const contractPath = path.resolve(here, "..", "harness", "interface.ts");

  const explorer = new ExplorerRole({
    contractPath,
    proposalsRoot: path.join(runDir, "proposals"),
  });
  const exploiter = new ExploiterRole({
    contractPath,
    proposalsRoot: path.join(runDir, "proposals"),
  });
  const critic = new LlmCriticRole({ inference: criticInference });

  const predicates: TerminationPredicate[] = [
    maxIterations(input.max_iterations ?? 30),
  ];
  if (input.plateau_k) predicates.push(paretoPlateau(input.plateau_k));
  if (input.token_budget) predicates.push(tokenBudget(input.token_budget));
  if (input.time_budget_ms) predicates.push(timeBudget(input.time_budget_ms));
  if (input.cost_budget_usd) predicates.push(costBudget(input.cost_budget_usd));

  const evaluator = new CodebaseQAEvaluator();

  const baseOptions = {
    tasks,
    inference,
    graph,
    store,
    evaluator,
    seeds,
    budget: { policy: input.budget ?? "balanced" } as const,
    loadCandidate: compileAndLoadCandidate,
    explorer,
    exploiter,
    critic,
    exploreCount: input.explore_count ?? 2,
    exploitCount: input.exploit_count ?? 2,
    termination: predicates,
  };

  const moatEnabled =
    input.task_family !== undefined && input.snapshot_id !== undefined;
  if (input.use_cache && !moatEnabled) {
    throw new Error(
      "harness_swarm_run: use_cache requires both task_family and snapshot_id",
    );
  }

  if (moatEnabled) {
    const recipeStoreRoot = path.resolve(
      input.recipe_store ?? path.join(process.cwd(), ".codragraph", "recipes"),
    );
    const recipeStore = new FsRecipeStore({ root: recipeStoreRoot });
    const moat = await swarmSearchWithMoat({
      ...baseOptions,
      recipeStore,
      snapshotId: input.snapshot_id!,
      taskFamily: input.task_family!,
      useCache: input.use_cache ?? false,
      persistTopK: input.persist_top_k ?? 5,
    });
    return {
      runId,
      runDir,
      totalEvaluated: moat.totalEvaluated,
      totalCriticRejected: moat.totalCriticRejected,
      totalLoadRejected: moat.totalLoadRejected,
      terminatedAt: moat.terminatedAt,
      paretoFrontier: moat.frontier,
      perRole: moat.perRole,
      cache: {
        fromCache: moat.fromCache,
        cachedRecipeIds: [...moat.cachedRecipeIds],
        persistedRecipeIds: [...moat.persistedRecipeIds],
      },
    };
  }

  const result = await swarmSearch(baseOptions);

  return {
    runId,
    runDir,
    totalEvaluated: result.totalEvaluated,
    totalCriticRejected: result.totalCriticRejected,
    totalLoadRejected: result.totalLoadRejected,
    terminatedAt: result.terminatedAt,
    paretoFrontier: result.frontier,
    perRole: result.perRole,
  };
}

// ──────────────────────────────────────────────────────────────────────
// harness_recipes_list — Phase 4 × Phase 3 moat MCP tool
// ──────────────────────────────────────────────────────────────────────

export interface HarnessRecipesListInput {
  /** Task family filter; omit for all families. */
  task_family?: string;
  /** Snapshot id filter; omit for all snapshots. */
  snapshot_id?: string;
  /** Recipe store root. Defaults to `<cwd>/.codragraph/recipes`. */
  recipe_store?: string;
  /** Maximum entries returned. Default 50. */
  limit?: number;
}

export interface HarnessRecipesListOutput {
  recipeStoreRoot: string;
  recipes: Array<{
    id: string;
    taskFamily: string;
    snapshotId: string;
    searchedAt: string;
    accuracy: number;
    tokens: number;
    latencyMs: number;
    harnessName: string;
  }>;
}

export async function handleHarnessRecipesList(
  input: HarnessRecipesListInput,
): Promise<HarnessRecipesListOutput> {
  const recipeStoreRoot = path.resolve(
    input.recipe_store ?? path.join(process.cwd(), ".codragraph", "recipes"),
  );
  const store = new FsRecipeStore({ root: recipeStoreRoot });
  const limit = input.limit ?? 50;
  const filter: { taskFamily?: string; snapshotId?: string } = {};
  if (input.task_family !== undefined) filter.taskFamily = input.task_family;
  if (input.snapshot_id !== undefined) filter.snapshotId = input.snapshot_id;
  const recipes: Recipe[] = (await store.list(filter)).slice(0, limit);
  return {
    recipeStoreRoot,
    recipes: recipes.map((r) => ({
      id: r.id,
      taskFamily: r.taskFamily,
      snapshotId: r.snapshotId,
      searchedAt: r.searchedAt,
      accuracy: r.paretoCoords.accuracy,
      tokens: r.paretoCoords.tokens,
      latencyMs: r.paretoCoords.latencyMs,
      harnessName: r.harness.name,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// harness_recipes_lookup — surface exact + candidate matches
// ──────────────────────────────────────────────────────────────────────

export interface HarnessRecipesLookupInput {
  task_family: string;
  snapshot_id: string;
  recipe_store?: string;
  limit?: number;
}

export interface HarnessRecipesLookupOutput {
  recipeStoreRoot: string;
  exact: HarnessRecipesListOutput["recipes"];
  candidates: Array<
    HarnessRecipesListOutput["recipes"][number] & {
      staleness: {
        diffComputed: boolean;
        riskLevel: "low" | "medium" | "high" | "unknown";
        summary?: {
          addedNodes: number;
          removedNodes: number;
          modifiedSymbols: number;
          addedEdges: number;
          removedEdges: number;
        };
      };
    }
  >;
}

export async function handleHarnessRecipesLookup(
  input: HarnessRecipesLookupInput,
): Promise<HarnessRecipesLookupOutput> {
  const recipeStoreRoot = path.resolve(
    input.recipe_store ?? path.join(process.cwd(), ".codragraph", "recipes"),
  );
  const store = new FsRecipeStore({ root: recipeStoreRoot });
  const result = await findReusableRecipes({
    store,
    snapshotId: input.snapshot_id,
    taskFamily: input.task_family,
    limit: input.limit ?? 10,
  });

  const summarize = (r: Recipe): HarnessRecipesListOutput["recipes"][number] => ({
    id: r.id,
    taskFamily: r.taskFamily,
    snapshotId: r.snapshotId,
    searchedAt: r.searchedAt,
    accuracy: r.paretoCoords.accuracy,
    tokens: r.paretoCoords.tokens,
    latencyMs: r.paretoCoords.latencyMs,
    harnessName: r.harness.name,
  });

  const candidates: HarnessRecipesLookupOutput["candidates"] = [];
  for (const c of result.candidates as RecipeMatch[]) {
    if (c.kind !== "candidate") continue;
    const base = summarize(c.recipe);
    const stalenessOut: HarnessRecipesLookupOutput["candidates"][number]["staleness"] = {
      diffComputed: c.staleness.diffComputed,
      riskLevel: c.staleness.riskLevel,
    };
    if (c.staleness.summary) stalenessOut.summary = c.staleness.summary;
    candidates.push({ ...base, staleness: stalenessOut });
  }

  return {
    recipeStoreRoot,
    exact: result.exact.map(summarize),
    candidates,
  };
}
