#!/usr/bin/env node
// Tune a swarm recipe for a workload's search-set, persist the winning recipe.
// Used to populate the recipe cache before running `codragraph-swarm-tuned` /
// `codragraph-recipe-cached` benchmark cells.
//
// Usage:
//   tsx swarm-tune.ts \
//     --workload codebase-qa \
//     --inference openai \
//     --inference-base-url http://localhost:8000/v1 \
//     --max-iterations 20 \
//     --plateau-k 5 \
//     --output ../results/recipes/

import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { swarmSearch } from 'codragraph-harness/swarm/algorithm';
import { ExplorerRole } from 'codragraph-harness/swarm/explorer';
import { ExploiterRole } from 'codragraph-harness/swarm/exploiter';
import { LlmCriticRole } from 'codragraph-harness/swarm/critic';
import {
  costBudget,
  maxIterations,
  paretoPlateau,
  timeBudget,
  tokenBudget,
} from 'codragraph-harness/swarm/termination';
import type { TerminationPredicate } from 'codragraph-harness/swarm/interface';
import { CandidateStore } from 'codragraph-harness/filesystem';
import { CodebaseQAEvaluator } from 'codragraph-harness/evaluator/impl';
import { ALL_SEEDS } from 'codragraph-harness/harness/seeds/index';
import { compileAndLoadCandidate } from 'codragraph-harness/loader';
import { LocalGraphClient } from 'codragraph-harness/graph/local-client';
import { OpenAIInferenceProvider } from 'codragraph-harness/inference/openai';
import { ClaudeInferenceProvider } from 'codragraph-harness/inference/claude';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();
program
  .name('swarm-tune')
  .description('Run the Phase 3 swarm to find a winning recipe; persist for reuse')
  .requiredOption('-w, --workload <id>', 'Workload id')
  .option('--max-iterations <n>', 'Hard upper bound on iterations', '20')
  .option('--plateau-k <k>', 'Stop when frontier stagnates for K iterations')
  .option('--token-budget <n>', 'Token budget cap')
  .option('--time-budget-ms <ms>', 'Time budget cap')
  .option('--cost-budget-usd <usd>', 'Cost budget cap')
  .option('--inference <name>', 'Harness inference provider', 'claude')
  .option('--inference-base-url <url>', 'OpenAI-compatible inference URL')
  .option('--inference-model <id>', 'Model id for the inference provider')
  .option('--critic-inference <name>', 'Critic provider', 'claude')
  .option('--explore-count <k>', 'Candidates per Explorer iteration', '2')
  .option('--exploit-count <k>', 'Candidates per Exploiter iteration', '2')
  .option('--repo <path>', 'Indexed repo path', '../../')
  .option('-o, --output <dir>', 'Where to persist recipe + run dir', '../results/recipes/')
  .action(async (opts) => {
    await runSwarmTune(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

interface TuneOpts {
  workload: string;
  maxIterations: string;
  plateauK?: string;
  tokenBudget?: string;
  timeBudgetMs?: string;
  costBudgetUsd?: string;
  inference: string;
  inferenceBaseUrl?: string;
  inferenceModel?: string;
  criticInference: string;
  exploreCount: string;
  exploitCount: string;
  repo: string;
  output: string;
}

async function runSwarmTune(opts: TuneOpts): Promise<void> {
  // Load workload tasks (search set only)
  const workloadPath = path.resolve(
    HERE,
    '..',
    '..',
    'codragraph-harness',
    'test',
    'fixtures',
    'qa-test-set.json',
  );
  const raw = await fs.readFile(workloadPath, 'utf8');
  const data = JSON.parse(raw) as { tasks: any[] };
  // Use first 80% as search set (training); reserve last 20% as held-out
  const splitIdx = Math.floor(data.tasks.length * 0.8);
  const searchSet = data.tasks.slice(0, splitIdx);
  console.error(`Search-set size: ${searchSet.length} (held out: ${data.tasks.length - splitIdx})`);

  const inference = opts.inferenceBaseUrl
    ? new OpenAIInferenceProvider({
        baseURL: opts.inferenceBaseUrl,
        defaultModel: opts.inferenceModel,
        apiKey: 'EMPTY',
      })
    : opts.inference === 'claude'
      ? new ClaudeInferenceProvider({ defaultModel: opts.inferenceModel })
      : new OpenAIInferenceProvider({ defaultModel: opts.inferenceModel });

  const criticInference =
    opts.criticInference === 'claude'
      ? new ClaudeInferenceProvider()
      : new OpenAIInferenceProvider();

  const { LocalBackend } = await import('codragraph/mcp/local/local-backend');
  const backend = new LocalBackend();
  const graph = new LocalGraphClient({ backend, defaultRepo: opts.repo });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(opts.output, `tune-${opts.workload}-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });
  const store = new CandidateStore(path.join(runDir, 'candidates'));

  const contractPath = path.resolve(
    HERE,
    '..',
    '..',
    'codragraph-harness',
    'src',
    'harness',
    'interface.ts',
  );
  const explorer = new ExplorerRole({
    contractPath,
    proposalsRoot: path.join(runDir, 'proposals'),
  });
  const exploiter = new ExploiterRole({
    contractPath,
    proposalsRoot: path.join(runDir, 'proposals'),
  });
  const critic = new LlmCriticRole({ inference: criticInference });

  const predicates: TerminationPredicate[] = [maxIterations(parseInt(opts.maxIterations, 10))];
  if (opts.plateauK) predicates.push(paretoPlateau(parseInt(opts.plateauK, 10)));
  if (opts.tokenBudget) predicates.push(tokenBudget(parseInt(opts.tokenBudget, 10)));
  if (opts.timeBudgetMs) predicates.push(timeBudget(parseInt(opts.timeBudgetMs, 10)));
  if (opts.costBudgetUsd) predicates.push(costBudget(parseFloat(opts.costBudgetUsd)));

  const evaluator = new CodebaseQAEvaluator({ judge: criticInference });
  const result = await swarmSearch({
    tasks: searchSet,
    inference,
    graph,
    store,
    evaluator,
    seeds: ALL_SEEDS,
    budget: { policy: 'balanced' },
    loadCandidate: compileAndLoadCandidate,
    explorer,
    exploiter,
    critic,
    exploreCount: parseInt(opts.exploreCount, 10),
    exploitCount: parseInt(opts.exploitCount, 10),
    termination: predicates,
    onProgress: (event) => {
      if (event.type === 'iteration-start') {
        console.error(
          `[iter ${event.iteration}] population=${event.populationSize} frontier=${event.frontierSize}`,
        );
      } else if (event.type === 'candidate-evaluated' && event.addedToFrontier) {
        console.error(
          `  ★ ${event.role} ${event.id} acc=${event.scores.accuracy.toFixed(3)} tokens=${event.scores.tokens.toFixed(0)}`,
        );
      }
    },
  });

  // Persist a recipe pointer file
  const recipeFile = path.join(runDir, 'recipe.json');
  await fs.writeFile(
    recipeFile,
    JSON.stringify(
      {
        workload: opts.workload,
        runDir,
        terminatedAt: result.terminatedAt,
        bestByAccuracy: result.frontier[0] ?? null,
        frontier: result.frontier,
        perRole: result.perRole,
        // To use this recipe in a subsequent benchmark cell, point loadCandidate at:
        //   <runDir>/candidates/<bestByAccuracy.id>/source/index.ts
      },
      null,
      2,
    ),
    'utf8',
  );
  console.error(`\nRecipe written to: ${recipeFile}`);
  console.error(`Best-by-accuracy: ${result.frontier[0]?.id ?? '<none>'}`);
}
