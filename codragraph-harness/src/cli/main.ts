#!/usr/bin/env node
// codragraph-harness CLI — Phase 1 entry point.
//
// Usage examples:
//   codragraph-harness search --task ./test/fixtures/qa-test-set.json
//   codragraph-harness search -t ./tasks.json -s zero-shot,graph-aware -i 10 --inference openai
//   codragraph-harness list-runs
//   codragraph-harness show ./runs/2026-04-29-qa/

import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { search, type ProgressEvent } from "../algorithm.js";
import { swarmSearch, type SwarmProgressEvent } from "../swarm/algorithm.js";
import { swarmSearchWithMoat } from "../moat/swarm-with-moat.js";
import { FsRecipeStore } from "../moat/recipe-store.js";
import { findReusableRecipes } from "../moat/lookup.js";
import { ExplorerRole } from "../swarm/explorer.js";
import { ExploiterRole } from "../swarm/exploiter.js";
import { LlmCriticRole } from "../swarm/critic.js";
import {
  anyOf,
  costBudget,
  maxIterations,
  paretoPlateau,
  timeBudget,
  tokenBudget,
} from "../swarm/termination.js";
import type { TerminationPredicate } from "../swarm/interface.js";
import { CandidateStore } from "../filesystem.js";
import { CodebaseQAEvaluator, type CodebaseQATask } from "../evaluator/impl.js";
import { ALL_SEEDS, SEEDS_BY_NAME } from "../harness/seeds/index.js";
import { ClaudeCodeProposer } from "../proposer/claude-code.js";
import { makeInferenceProvider, type ProviderName } from "../inference/index.js";
import type { Harness } from "../harness/interface.js";
import { LocalGraphClient } from "../graph/local-client.js";
import { compileAndLoadCandidate } from "../loader.js";

const program = new Command();
program
  .name("codragraph-harness")
  .description("Auto-tuned harnesses for AI agents — Meta-Harness search loop")
  .version("0.1.0");

program
  .command("search")
  .description("Run the Meta-Harness outer loop over a task set")
  .requiredOption("-t, --task <path>", "JSON file with the task set (see test/fixtures/qa-test-set.json)")
  .option("-s, --seeds <names>", "Comma-separated seed names, or 'all'", "all")
  .option("-i, --iterations <n>", "Outer-loop iterations N", "20")
  .option("-k, --candidates-per-iteration <k>", "Candidates per iteration", "2")
  .option("-p, --proposer <name>", "Proposer (only 'claude-code' in Phase 1)", "claude-code")
  .option("--inference <name>", "Inference provider: claude | openai | opencode", "claude")
  .option("--judge <name>", "Optional LLM-judge provider for paraphrase scoring", "")
  .option("--repo <name>", "Indexed repo to query (passed through to graph tools)")
  .option("-o, --output <dir>", "Run output directory")
  .option(
    "--budget <policy>",
    "Token budget policy: min | balanced | max | custom (default: balanced)",
    "balanced",
  )
  .option("--max-output-tokens <n>", "Override budget policy's output cap")
  .option("--max-input-tokens <n>", "Override budget policy's input cap")
  .option("--task-timeout-ms <ms>", "Override budget policy's per-task timeout")
  .action(async (opts) => {
    await runSearch(opts);
  });

program
  .command("swarm-search")
  .description(
    "Run the Phase 3 swarm — Explorer + Exploiter (subprocess) + Critic (in-process), with hybrid termination",
  )
  .requiredOption("-t, --task <path>", "Task-set JSON file")
  .option("-s, --seeds <names>", "Seed names or 'all'", "all")
  .option("--explore-count <k>", "Candidates per iteration from Explorer", "2")
  .option("--exploit-count <k>", "Candidates per iteration from Exploiter", "2")
  .option("--max-iterations <n>", "Hard upper bound on iterations", "30")
  .option(
    "--plateau-k <k>",
    "Stop when frontier hasn't changed for K iterations (omit to disable)",
  )
  .option(
    "--token-budget <n>",
    "Stop when total proposer+eval tokens exceed N (omit to disable)",
  )
  .option(
    "--time-budget-ms <ms>",
    "Stop when wall-clock exceeds ms (omit to disable)",
  )
  .option(
    "--cost-budget-usd <usd>",
    "Stop when estimated cost exceeds USD (omit to disable)",
  )
  .option("--inference <name>", "Harness inference provider", "claude")
  .option("--critic-inference <name>", "Critic inference provider", "claude")
  .option("--judge <name>", "Optional LLM-judge for paraphrase scoring")
  .option("--repo <name>", "Indexed repo for graph queries")
  .option("--budget <policy>", "Token budget policy", "balanced")
  .option("-o, --output <dir>", "Run output directory")
  .option(
    "--task-family <name>",
    "Recipe-cache task family (Phase 4 moat). Required to enable --use-cache or --recipe-store.",
  )
  .option(
    "--snapshot-id <id>",
    "codragraph-graphstore snapshot id at search time (required with --task-family)",
  )
  .option(
    "--use-cache",
    "Reuse the top recipe for (snapshot-id, task-family) when found; skip the swarm",
  )
  .option(
    "--recipe-store <dir>",
    "Recipe store root (default: <repo-with-meta>/.codragraph/recipes)",
  )
  .option("--persist-top-k <n>", "Persist this many Pareto recipes after search", "5")
  .action(async (opts) => {
    await runSwarmSearch(opts);
  });

// ─── Phase 4 × Phase 3 moat: recipes commands ─────────────────────────

const recipesCmd = program.command("recipes").description("Manage harness recipes (Phase 4 moat)");

recipesCmd
  .command("list", { isDefault: true })
  .description("List recipes, newest first")
  .option("--task-family <name>", "Filter by task family")
  .option("--snapshot-id <id>", "Filter by snapshot id")
  .option("--store <dir>", "Recipe store root", "./.codragraph/recipes")
  .action(async (opts: { taskFamily?: string; snapshotId?: string; store: string }) => {
    await runRecipesList(opts);
  });

recipesCmd
  .command("show <id>")
  .description("Print one recipe by id")
  .option("--store <dir>", "Recipe store root", "./.codragraph/recipes")
  .action(async (id: string, opts: { store: string }) => {
    await runRecipesShow(id, opts);
  });

recipesCmd
  .command("prune")
  .description("Keep only the top-N most accurate recipes per task family")
  .option("--keep-n <n>", "Recipes to keep per task family", "5")
  .option("--store <dir>", "Recipe store root", "./.codragraph/recipes")
  .option("--dry-run", "Report what would be deleted without removing")
  .action(
    async (opts: {
      keepN: string;
      store: string;
      dryRun?: boolean;
    }) => {
      await runRecipesPrune(opts);
    },
  );

recipesCmd
  .command("lookup")
  .description("Find recipes for a (snapshot-id, task-family) pair, with staleness if --differ-mock")
  .requiredOption("--task-family <name>", "Task family")
  .requiredOption("--snapshot-id <id>", "Current snapshot id")
  .option("--store <dir>", "Recipe store root", "./.codragraph/recipes")
  .action(async (opts: { taskFamily: string; snapshotId: string; store: string }) => {
    await runRecipesLookup(opts);
  });

program
  .command("list-runs")
  .description("List runs under ./runs/ (or a custom root)")
  .option("--root <dir>", "Runs root directory", "./runs")
  .action(async (opts: { root: string }) => {
    const entries = await fs.readdir(opts.root).catch(() => [] as string[]);
    if (entries.length === 0) {
      console.log(`(no runs found under ${path.resolve(opts.root)})`);
      return;
    }
    for (const e of entries.sort()) {
      console.log(e);
    }
  });

program
  .command("show <runDir>")
  .description("Print the Pareto frontier of a completed run")
  .action(async (runDir: string) => {
    const store = new CandidateStore(path.join(runDir, "candidates"));
    const summaries = await store.listCandidates();
    const points: Array<{ id: string; accuracy: number; tokens: number; latencyMs: number }> = [];
    for (const c of summaries) {
      if (!c.hasScore) continue;
      const s = await store.readScore(c.id);
      if (s) {
        points.push({ id: c.id, accuracy: s.accuracy, tokens: s.tokens, latencyMs: s.latencyMs });
      }
    }
    points.sort((a, b) => b.accuracy - a.accuracy);
    console.log("id".padEnd(40), "accuracy".padEnd(10), "tokens".padEnd(8), "latencyMs");
    for (const p of points) {
      console.log(
        p.id.padEnd(40),
        p.accuracy.toFixed(3).padEnd(10),
        p.tokens.toFixed(0).padEnd(8),
        p.latencyMs.toFixed(0),
      );
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// -- search command implementation ------------------------------------------

interface SearchCliOptions {
  task: string;
  seeds: string;
  iterations: string;
  candidatesPerIteration: string;
  proposer: string;
  inference: string;
  judge: string;
  repo?: string;
  output?: string;
  budget: string;
  maxOutputTokens?: string;
  maxInputTokens?: string;
  taskTimeoutMs?: string;
}

async function runSearch(opts: SearchCliOptions): Promise<void> {
  // 1. Load tasks.
  const taskFile = path.resolve(opts.task);
  const taskRaw = await fs.readFile(taskFile, "utf8");
  const taskFileParsed = JSON.parse(taskRaw) as { tasks: CodebaseQATask[] };
  const tasks = taskFileParsed.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error(`Task file ${taskFile} has no tasks`);
  }
  console.error(`Loaded ${tasks.length} tasks from ${taskFile}`);

  // 2. Pick seeds.
  const seeds: Harness[] =
    opts.seeds === "all"
      ? ALL_SEEDS
      : opts.seeds.split(",").map((name) => {
          const seed = SEEDS_BY_NAME[name.trim()];
          if (!seed) throw new Error(`Unknown seed: ${name}. Available: ${Object.keys(SEEDS_BY_NAME).join(", ")}`);
          return seed;
        });
  console.error(`Seeds: ${seeds.map((s) => s.name).join(", ")}`);

  // 3. Wire components.
  const inferenceName = opts.inference as ProviderName;
  const inference = await makeInferenceProvider(inferenceName);
  const judge = opts.judge
    ? await makeInferenceProvider(opts.judge as ProviderName)
    : undefined;

  // In-process graph client. We construct codragraph's LocalBackend directly
  // — same monorepo, no HTTP hop. Out-of-process / hosted scenarios use a
  // future MCP-over-HTTP client (Phase 2).
  const { LocalBackend } = await import("codragraph/mcp/local/local-backend");
  const backend = new LocalBackend();
  const graph = new LocalGraphClient({ backend, defaultRepo: opts.repo });

  // 4. Output directory.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = opts.output ?? path.resolve(`./runs/${stamp}`);
  await fs.mkdir(runDir, { recursive: true });
  const store = new CandidateStore(path.join(runDir, "candidates"));

  // 5. Proposer.
  const contractPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "harness",
    "interface.ts",
  );
  const proposer = new ClaudeCodeProposer({
    contractPath,
    proposalsRoot: path.join(runDir, "proposals"),
  });

  // 6. Budget policy.
  const policy = opts.budget as "min" | "balanced" | "max" | "custom";
  if (!["min", "balanced", "max", "custom"].includes(policy)) {
    throw new Error(`Invalid --budget policy: ${policy}. Use min | balanced | max | custom.`);
  }
  const budget = {
    policy,
    maxInputTokens: opts.maxInputTokens ? parseInt(opts.maxInputTokens, 10) : undefined,
    maxOutputTokens: opts.maxOutputTokens ? parseInt(opts.maxOutputTokens, 10) : undefined,
    timeoutMs: opts.taskTimeoutMs ? parseInt(opts.taskTimeoutMs, 10) : undefined,
  };

  // 7. Evaluator.
  const evaluator = new CodebaseQAEvaluator({
    judge,
    taskTimeoutMs: budget.timeoutMs,
  });

  // 8. Run.
  const result = await search({
    tasks,
    inference,
    graph,
    proposer,
    store,
    evaluator,
    seeds,
    iterations: parseInt(opts.iterations, 10),
    candidatesPerIteration: parseInt(opts.candidatesPerIteration, 10),
    budget,
    loadCandidate: compileAndLoadCandidate,
    onProgress: defaultOnProgress,
  });

  // 8. Summary.
  console.error(``);
  console.error(`=== Search complete ===`);
  console.error(`Run dir: ${runDir}`);
  console.error(`Total evaluated: ${result.totalEvaluated}`);
  console.error(`Total rejected: ${result.totalRejected}`);
  console.error(`Pareto frontier (${result.frontier.length}):`);
  for (const p of result.frontier) {
    console.error(
      `  ${p.id.padEnd(40)} acc=${p.accuracy.toFixed(3)} tokens=${p.tokens.toFixed(0)} latencyMs=${p.latencyMs.toFixed(0)}`,
    );
  }
}

function defaultOnProgress(event: ProgressEvent): void {
  switch (event.type) {
    case "init":
      console.error(`[init] ${event.seedCount} seeds, ${event.iterations} iterations`);
      break;
    case "seed-evaluated":
      console.error(`[seed] ${event.id} acc=${event.scores.accuracy.toFixed(3)} tokens=${event.scores.tokens.toFixed(0)}`);
      break;
    case "iteration-start":
      console.error(`[iter ${event.iteration}] population=${event.populationSize}`);
      break;
    case "candidate-proposed":
      console.error(`  [propose] ${event.id} (${event.name})`);
      break;
    case "candidate-rejected":
      console.error(`  [reject] ${event.name}: ${event.reason}`);
      break;
    case "candidate-evaluated":
      console.error(`  [eval] ${event.id} acc=${event.scores.accuracy.toFixed(3)} tokens=${event.scores.tokens.toFixed(0)}`);
      break;
    case "complete":
      console.error(`[done] frontier=${event.frontier.length} evaluated=${event.totalEvaluated}`);
      break;
  }
}

// loadCandidate is now compileAndLoadCandidate from ../loader.ts — handles
// esbuild compilation + dynamic import in one step. See loader.ts for details.

// -- swarm-search command implementation ------------------------------------

interface SwarmCliOptions {
  task: string;
  seeds: string;
  exploreCount: string;
  exploitCount: string;
  maxIterations: string;
  plateauK?: string;
  tokenBudget?: string;
  timeBudgetMs?: string;
  costBudgetUsd?: string;
  inference: string;
  criticInference: string;
  judge?: string;
  repo?: string;
  budget: string;
  output?: string;
  taskFamily?: string;
  snapshotId?: string;
  useCache?: boolean;
  recipeStore?: string;
  persistTopK: string;
}

async function runSwarmSearch(opts: SwarmCliOptions): Promise<void> {
  const taskFile = path.resolve(opts.task);
  const taskRaw = await fs.readFile(taskFile, "utf8");
  const taskFileParsed = JSON.parse(taskRaw) as { tasks: CodebaseQATask[] };
  const tasks = taskFileParsed.tasks;
  console.error(`Loaded ${tasks.length} tasks from ${taskFile}`);

  const seeds: Harness[] =
    opts.seeds === "all"
      ? ALL_SEEDS
      : opts.seeds.split(",").map((name) => {
          const seed = SEEDS_BY_NAME[name.trim()];
          if (!seed) throw new Error(`Unknown seed: ${name}`);
          return seed;
        });

  const inference = await makeInferenceProvider(opts.inference as ProviderName);
  const criticInference = await makeInferenceProvider(opts.criticInference as ProviderName);
  const judge = opts.judge
    ? await makeInferenceProvider(opts.judge as ProviderName)
    : undefined;

  const { LocalBackend } = await import("codragraph/mcp/local/local-backend");
  const backend = new LocalBackend();
  const graph = new LocalGraphClient({ backend, defaultRepo: opts.repo });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = opts.output ?? path.resolve(`./runs/swarm-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });
  const store = new CandidateStore(path.join(runDir, "candidates"));

  const contractPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "harness",
    "interface.ts",
  );
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
    maxIterations(parseInt(opts.maxIterations, 10)),
  ];
  if (opts.plateauK) predicates.push(paretoPlateau(parseInt(opts.plateauK, 10)));
  if (opts.tokenBudget) predicates.push(tokenBudget(parseInt(opts.tokenBudget, 10)));
  if (opts.timeBudgetMs) predicates.push(timeBudget(parseInt(opts.timeBudgetMs, 10)));
  if (opts.costBudgetUsd) predicates.push(costBudget(parseFloat(opts.costBudgetUsd)));
  // Reference anyOf so it stays in scope for the dashboard's progress reporter.
  void anyOf;

  const evaluator = new CodebaseQAEvaluator({ judge });

  // ── Moat hook (Phase 4 × Phase 3) ─────────────────────────────────
  // When the user passes --task-family + --snapshot-id, route through
  // swarmSearchWithMoat so cache lookup + persistence happen
  // automatically. Without those flags, we keep the raw swarmSearch
  // path for backwards compat.
  const baseSwarmOptions = {
    tasks,
    inference,
    graph,
    store,
    evaluator,
    seeds,
    budget: { policy: opts.budget as "min" | "balanced" | "max" | "custom" },
    loadCandidate: compileAndLoadCandidate,
    explorer,
    exploiter,
    critic,
    exploreCount: parseInt(opts.exploreCount, 10),
    exploitCount: parseInt(opts.exploitCount, 10),
    termination: predicates,
    onProgress: defaultSwarmProgress,
  };

  const moatEnabled = opts.taskFamily !== undefined && opts.snapshotId !== undefined;
  if (opts.useCache && !moatEnabled) {
    throw new Error(
      "--use-cache requires both --task-family <name> and --snapshot-id <id>",
    );
  }

  let result;
  let fromCache = false;
  let cachedRecipeIds: string[] = [];
  let persistedRecipeIds: string[] = [];

  if (moatEnabled) {
    const recipeStoreRoot = path.resolve(
      opts.recipeStore ?? path.join(process.cwd(), ".codragraph", "recipes"),
    );
    const recipeStore = new FsRecipeStore({ root: recipeStoreRoot });
    const moat = await swarmSearchWithMoat({
      ...baseSwarmOptions,
      recipeStore,
      snapshotId: opts.snapshotId!,
      taskFamily: opts.taskFamily!,
      useCache: opts.useCache ?? false,
      persistTopK: parseInt(opts.persistTopK, 10),
    });
    result = moat;
    fromCache = moat.fromCache;
    cachedRecipeIds = [...moat.cachedRecipeIds];
    persistedRecipeIds = [...moat.persistedRecipeIds];
    if (fromCache) {
      console.error(
        `[cache] Hit for (${opts.snapshotId}, ${opts.taskFamily}) — reused ${cachedRecipeIds.length} recipe(s); skipped swarm search.`,
      );
    } else {
      console.error(
        `[cache] Miss for (${opts.snapshotId}, ${opts.taskFamily}) — ran fresh swarm; persisted ${persistedRecipeIds.length} recipe(s) to ${recipeStoreRoot}`,
      );
    }
  } else {
    result = await swarmSearch(baseSwarmOptions);
  }
  // Reference moat state so an early-return path doesn't drop them in
  // a future refactor — these are surfaced via stderr above.
  void fromCache;
  void cachedRecipeIds;
  void persistedRecipeIds;

  console.error("");
  console.error(`=== Swarm complete ===`);
  console.error(`Run dir: ${runDir}`);
  console.error(`Terminated: ${result.terminatedAt.reason} at iteration ${result.terminatedAt.iteration}`);
  console.error(`Total evaluated: ${result.totalEvaluated}`);
  console.error(`Critic rejected: ${result.totalCriticRejected}`);
  console.error(`Load rejected: ${result.totalLoadRejected}`);
  console.error("\nPer-role contribution:");
  for (const [role, stats] of Object.entries(result.perRole)) {
    console.error(
      `  ${role.padEnd(12)} proposed=${stats.proposed} accepted=${stats.acceptedByCritic} frontier-hits=${stats.frontierHits} mean-tokens=${stats.meanTokens.toFixed(0)}`,
    );
  }
  console.error(`\nPareto frontier (${result.frontier.length}):`);
  for (const p of result.frontier) {
    console.error(
      `  ${p.id.padEnd(40)} acc=${p.accuracy.toFixed(3)} tokens=${p.tokens.toFixed(0)} latencyMs=${p.latencyMs.toFixed(0)}`,
    );
  }
}

// ─── Phase 4 × Phase 3 moat: recipes commands ─────────────────────────

interface RecipesListOpts {
  taskFamily?: string;
  snapshotId?: string;
  store: string;
}
async function runRecipesList(opts: RecipesListOpts): Promise<void> {
  const store = new FsRecipeStore({ root: path.resolve(opts.store) });
  const recipes = await store.list({
    taskFamily: opts.taskFamily,
    snapshotId: opts.snapshotId,
  });
  if (recipes.length === 0) {
    console.error(`(no recipes under ${path.resolve(opts.store)})`);
    return;
  }
  console.log(
    "id".padEnd(40),
    "family".padEnd(16),
    "snapshot".padEnd(20),
    "acc".padEnd(6),
    "tokens".padEnd(8),
    "latencyMs".padEnd(10),
    "searched",
  );
  for (const r of recipes) {
    console.log(
      r.id.padEnd(40),
      r.taskFamily.padEnd(16),
      r.snapshotId.slice(7, 7 + 16).padEnd(20),
      r.paretoCoords.accuracy.toFixed(3).padEnd(6),
      r.paretoCoords.tokens.toFixed(0).padEnd(8),
      r.paretoCoords.latencyMs.toFixed(0).padEnd(10),
      r.searchedAt,
    );
  }
}

async function runRecipesShow(id: string, opts: { store: string }): Promise<void> {
  const store = new FsRecipeStore({ root: path.resolve(opts.store) });
  const recipe = await store.get(id);
  if (!recipe) {
    console.error(`No recipe with id ${id} in ${path.resolve(opts.store)}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(recipe, null, 2));
}

async function runRecipesPrune(opts: {
  keepN: string;
  store: string;
  dryRun?: boolean;
}): Promise<void> {
  const store = new FsRecipeStore({ root: path.resolve(opts.store) });
  const keepN = parseInt(opts.keepN, 10);
  const all = await store.list();
  const byFamily = new Map<string, typeof all>();
  for (const r of all) {
    const arr = byFamily.get(r.taskFamily) ?? [];
    arr.push(r);
    byFamily.set(r.taskFamily, arr);
  }

  const verb = opts.dryRun ? "would delete" : "deleting";
  let totalDeleted = 0;
  for (const [family, list] of byFamily) {
    // Rank by accuracy desc, then tokens asc — Pareto-aware "best".
    const ranked = [...list].sort((a, b) => {
      if (a.paretoCoords.accuracy !== b.paretoCoords.accuracy) {
        return b.paretoCoords.accuracy - a.paretoCoords.accuracy;
      }
      return a.paretoCoords.tokens - b.paretoCoords.tokens;
    });
    const losers = ranked.slice(keepN);
    if (losers.length === 0) continue;
    console.error(`[${family}] ${verb} ${losers.length} recipe(s) (keeping top ${keepN})`);
    for (const r of losers) {
      console.error(`  - ${r.id}  acc=${r.paretoCoords.accuracy.toFixed(3)}`);
      if (!opts.dryRun) {
        const ok = await store.delete(r.id);
        if (ok) totalDeleted++;
      }
    }
  }
  if (!opts.dryRun) console.error(`Deleted ${totalDeleted} recipe(s).`);
}

async function runRecipesLookup(opts: {
  taskFamily: string;
  snapshotId: string;
  store: string;
}): Promise<void> {
  const store = new FsRecipeStore({ root: path.resolve(opts.store) });
  const result = await findReusableRecipes({
    store,
    snapshotId: opts.snapshotId,
    taskFamily: opts.taskFamily,
  });
  console.log(`Exact matches (${result.exact.length}):`);
  for (const r of result.exact) {
    console.log(
      `  ${r.id}  acc=${r.paretoCoords.accuracy.toFixed(3)} tokens=${r.paretoCoords.tokens.toFixed(0)} ${r.searchedAt}`,
    );
  }
  console.log(`\nCandidates from other snapshots (${result.candidates.length}):`);
  for (const c of result.candidates) {
    if (c.kind !== "candidate") continue;
    console.log(
      `  ${c.recipe.id}  acc=${c.recipe.paretoCoords.accuracy.toFixed(3)} ` +
        `risk=${c.staleness.riskLevel} ` +
        `snapshot=${c.recipe.snapshotId.slice(7, 7 + 16)} (${c.recipe.searchedAt})`,
    );
  }
}

function defaultSwarmProgress(event: SwarmProgressEvent): void {
  switch (event.type) {
    case "init":
      console.error(`[init] ${event.seedCount} seeds, predicates: ${event.predicates.join(", ")}`);
      break;
    case "seed-evaluated":
      console.error(`[seed] ${event.id} acc=${event.scores.accuracy.toFixed(3)}`);
      break;
    case "iteration-start":
      console.error(
        `[iter ${event.iteration}] population=${event.populationSize} frontier=${event.frontierSize}`,
      );
      break;
    case "swarm-step-complete":
      console.error(
        `  [step] proposed=${event.proposed} accepted=${event.criticAccepted} rejected=${event.criticRejected}`,
      );
      break;
    case "candidate-rejected":
      console.error(`  [reject:${event.stage}] ${event.name}: ${event.reason}`);
      break;
    case "candidate-evaluated":
      {
        const arrow = event.addedToFrontier ? "★" : " ";
        console.error(
          `  ${arrow} [eval:${event.role}] ${event.id} acc=${event.scores.accuracy.toFixed(3)} tokens=${event.scores.tokens.toFixed(0)}`,
        );
      }
      break;
    case "complete":
      console.error(
        `[done] frontier=${event.frontier.length} stopped: ${event.terminatedAt.reason} @ ${event.terminatedAt.iteration}`,
      );
      break;
  }
}
