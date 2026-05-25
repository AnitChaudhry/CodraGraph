#!/usr/bin/env node
// Benchmark runner — runs (workload × treatment × model × seeds) cells, persists results.
//
// Usage:
//   tsx run-benchmark.ts \
//     --workload codebase-qa \
//     --treatments baseline-grep,codragraph-graph-only,codragraph-swarm-tuned \
//     --models qwen-coder-7b-awq,claude-haiku \
//     --runs 3 \
//     --output ../results/2026-04-29-headline/

import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import yaml from 'yaml';
import { makeInferenceProvider, type ProviderName } from '@codragraph/harness/inference/index';
import { OpenAIInferenceProvider } from '@codragraph/harness/inference/openai';
import { ClaudeInferenceProvider } from '@codragraph/harness/inference/claude';
import type { InferenceProvider } from '@codragraph/harness/inference/interface';
import type {
  CellResult,
  ModelSpec,
  TaskInput,
  TaskResult,
  TreatmentTag,
  BenchEnv,
} from './types.js';
import { runTreatment } from './treatments.js';
import { computeRunSummary, computeCellAggregate } from './aggregate.js';

const SEEDS_DEFAULT = [42, 1337, 8675309];
const HERE = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name('run-benchmark')
  .description('Run a CodraGraph benchmark sweep')
  .requiredOption('-w, --workload <id>', 'Workload id (e.g. codebase-qa)')
  .requiredOption(
    '-t, --treatments <list>',
    'Comma-separated treatment tags (see workloads/03-baselines.md)',
  )
  .requiredOption('-m, --models <list>', 'Comma-separated model ids from models.yaml')
  .option('-r, --runs <n>', 'Independent runs per cell (different seeds)', '3')
  .option(
    '--seeds <list>',
    'Override seeds (comma-separated). Default: 42,1337,8675309 (first --runs of these).',
  )
  .requiredOption('-o, --output <dir>', 'Output directory for results')
  .option('--vllm-url <url>', 'vLLM/OpenAI-compatible inference URL', process.env.VLLM_URL)
  .option('--repo <path>', 'Indexed repo path', process.env.INDEXED_REPO_PATH ?? '../../')
  .option(
    '--judge-provider <name>',
    'Judge inference provider',
    process.env.JUDGE_PROVIDER ?? 'anthropic',
  )
  .option(
    '--judge-model <id>',
    'Judge model id',
    process.env.JUDGE_MODEL ?? 'claude-haiku-4-5-20251001',
  )
  .option('--task-timeout-ms <ms>', 'Per-task timeout', '120000')
  .option('--tasks <n>', 'Limit to first N tasks for smoke testing', '0')
  .option('--dry-run', "Print plan but don't execute")
  .action(async (opts) => {
    await runBenchmark(opts);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

interface RunOpts {
  workload: string;
  treatments: string;
  models: string;
  runs: string;
  seeds?: string;
  output: string;
  vllmUrl?: string;
  repo: string;
  judgeProvider: string;
  judgeModel: string;
  taskTimeoutMs: string;
  tasks: string;
  dryRun?: boolean;
}

async function runBenchmark(opts: RunOpts): Promise<void> {
  // 1. Load model registry
  const modelsRaw = await fs.readFile(path.join(HERE, 'models.yaml'), 'utf8');
  const modelsParsed = yaml.parse(modelsRaw) as { models: Record<string, Omit<ModelSpec, 'id'>> };
  const modelRegistry: Record<string, ModelSpec> = {};
  for (const [id, spec] of Object.entries(modelsParsed.models)) {
    modelRegistry[id] = { id, ...spec };
  }

  // 2. Validate inputs
  const treatmentTags = opts.treatments.split(',').map((t) => t.trim()) as TreatmentTag[];
  const modelIds = opts.models.split(',').map((m) => m.trim());
  const requestedModels: ModelSpec[] = modelIds.map((id) => {
    const spec = modelRegistry[id];
    if (!spec) throw new Error(`Unknown model: ${id}. See models.yaml for the registry.`);
    return spec;
  });
  const numRuns = parseInt(opts.runs, 10);
  const seeds = opts.seeds
    ? opts.seeds.split(',').map((s) => parseInt(s.trim(), 10))
    : SEEDS_DEFAULT.slice(0, numRuns);
  if (seeds.length < numRuns) {
    throw new Error(`Not enough seeds (${seeds.length}) for ${numRuns} runs`);
  }
  const taskLimit = parseInt(opts.tasks, 10);

  // 3. Load workload
  const workloadPath = await resolveWorkloadPath(opts.workload);
  const workloadRaw = await fs.readFile(workloadPath, 'utf8');
  const workloadJson = JSON.parse(workloadRaw) as {
    name: string;
    version?: string;
    tasks: TaskInput[];
  };
  const allTasks = workloadJson.tasks;
  const tasks = taskLimit > 0 ? allTasks.slice(0, taskLimit) : allTasks;

  // 4. Plan
  const cells: Array<{ treatment: TreatmentTag; model: ModelSpec }> = [];
  for (const t of treatmentTags) {
    for (const m of requestedModels) {
      cells.push({ treatment: t, model: m });
    }
  }
  console.error(`Plan:`);
  console.error(`  Workload: ${opts.workload} (${tasks.length} tasks)`);
  console.error(
    `  Cells: ${cells.length} (${treatmentTags.length} treatments × ${requestedModels.length} models)`,
  );
  console.error(`  Runs per cell: ${numRuns} (seeds: ${seeds.slice(0, numRuns).join(', ')})`);
  console.error(`  Total task-runs: ${cells.length * numRuns * tasks.length}`);
  console.error(`  Output: ${opts.output}`);
  if (opts.dryRun) {
    console.error('\n--dry-run set; exiting.');
    return;
  }

  // 5. Provision output dir + capture env
  await fs.mkdir(opts.output, { recursive: true });
  const env = await captureEnv({
    workloadId: opts.workload,
    workloadVersion: workloadJson.version ?? 'v1',
    taskCount: tasks.length,
    seeds: seeds.slice(0, numRuns),
    judgeProvider: opts.judgeProvider as ProviderName,
    judgeModel: opts.judgeModel,
  });
  await fs.writeFile(path.join(opts.output, 'env.json'), JSON.stringify(env, null, 2), 'utf8');

  // 6. Build judge inference provider (shared across cells)
  const judge = buildInferenceProvider(opts.judgeProvider as ProviderName, {
    defaultModel: opts.judgeModel,
  });

  // 7. Execute cells
  const cellResults: Array<{
    treatment: TreatmentTag;
    modelId: string;
    cell: CellResult;
  }> = [];

  for (const cell of cells) {
    console.error(`\n=== Cell ${cell.treatment} × ${cell.model.id} ===`);
    const inference = buildInferenceProviderForModel(cell.model, opts.vllmUrl);

    const allTaskResults: TaskResult[] = [];
    const runSummaries = [];

    for (let runIdx = 0; runIdx < numRuns; runIdx++) {
      const seed = seeds[runIdx]!;
      console.error(`  Run ${runIdx + 1}/${numRuns} (seed=${seed})`);
      const startedAt = new Date().toISOString();
      const startedAtMs = Date.now();

      const taskResults = await runTreatment({
        treatment: cell.treatment,
        model: cell.model,
        tasks,
        workload: opts.workload,
        inference,
        judge,
        seed,
        repoPath: path.resolve(opts.repo),
        taskTimeoutMs: parseInt(opts.taskTimeoutMs, 10),
      });
      const finishedAt = new Date().toISOString();
      const totalDurationMs = Date.now() - startedAtMs;

      allTaskResults.push(...taskResults);
      const summary = computeRunSummary({
        runId: `${opts.workload}-${cell.treatment}-${cell.model.id}-seed${seed}`,
        workload: opts.workload,
        treatment: cell.treatment,
        model: cell.model,
        taskResults,
        startedAt,
        finishedAt,
        totalDurationMs,
        seed,
      });
      runSummaries.push(summary);

      // Persist incremental results so a crash mid-sweep doesn't lose work
      await persistCellRun(opts.output, cell.treatment, cell.model.id, seed, taskResults, summary);
      console.error(
        `    accuracy=${(summary.scores.accuracy * 100).toFixed(1)}%  meanTokens=${summary.meanTokens.toFixed(0)}  meanLatencyMs=${summary.meanLatencyMs.toFixed(0)}`,
      );
    }

    const aggregate = computeCellAggregate(runSummaries);
    cellResults.push({
      treatment: cell.treatment,
      modelId: cell.model.id,
      cell: { taskResults: allTaskResults, runSummaries, aggregate },
    });
  }

  // 8. Final summary
  await fs.writeFile(
    path.join(opts.output, 'summary.json'),
    JSON.stringify(
      {
        env,
        cells: cellResults.map((c) => ({
          treatment: c.treatment,
          modelId: c.modelId,
          aggregate: c.cell.aggregate,
          runSummaries: c.cell.runSummaries,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.error(`\n=== Sweep complete ===`);
  console.error(`Results: ${path.resolve(opts.output)}`);
  console.error(`Run \`tsx export-report.ts ${opts.output}\` to generate the markdown report.`);
}

// -- helpers ---------------------------------------------------------------

async function resolveWorkloadPath(workloadId: string): Promise<string> {
  const candidates = [
    path.join(HERE, '..', 'workloads', `${workloadId}.json`),
    path.join(HERE, '..', '..', '@codragraph/harness', 'test', 'fixtures', 'qa-test-set.json'),
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error(`Could not resolve workload ${workloadId}. Tried: ${candidates.join(', ')}`);
}

function buildInferenceProvider(
  provider: ProviderName,
  options: { defaultModel?: string; baseURL?: string } = {},
): InferenceProvider {
  if (provider === 'anthropic') {
    return new ClaudeInferenceProvider({ defaultModel: options.defaultModel });
  }
  if (provider === 'openai') {
    return new OpenAIInferenceProvider({
      defaultModel: options.defaultModel,
      baseURL: options.baseURL,
    });
  }
  return makeInferenceProvider(provider as 'claude' | 'openai' | 'opencode');
}

function buildInferenceProviderForModel(
  model: ModelSpec,
  vllmUrl: string | undefined,
): InferenceProvider {
  if (model.provider === 'anthropic') {
    return new ClaudeInferenceProvider({ defaultModel: model.modelId });
  }
  if (model.provider === 'openai') {
    return new OpenAIInferenceProvider({ defaultModel: model.modelId });
  }
  // vLLM / TGI / Ollama / llama.cpp all expose OpenAI-compatible endpoints
  if (!vllmUrl && !model.baseURL) {
    throw new Error(
      `Model ${model.id} (provider=${model.provider}) requires --vllm-url or model.baseURL to be set.`,
    );
  }
  return new OpenAIInferenceProvider({
    defaultModel: model.modelId,
    baseURL: model.baseURL ?? vllmUrl,
    apiKey: 'EMPTY',
  });
}

async function captureEnv(args: {
  workloadId: string;
  workloadVersion: string;
  taskCount: number;
  seeds: number[];
  judgeProvider: ProviderName;
  judgeModel: string;
}): Promise<BenchEnv> {
  return {
    runId: new Date().toISOString().replace(/[:.]/g, '-'),
    timestamp: new Date().toISOString(),
    git: {
      sha: process.env.GIT_SHA ?? 'unknown',
      branch: process.env.GIT_BRANCH ?? 'unknown',
      dirty: false,
    },
    node: {
      version: process.version,
      platform: `${os.platform()}-${os.arch()}`,
    },
    host: {
      os: `${os.type()} ${os.release()}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      ramGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      gpus: [],
    },
    codragraph: {
      version: process.env.CODRAGRAPH_VERSION ?? '0.1.0',
      indexedRepoSha: process.env.INDEXED_REPO_SHA ?? 'unknown',
    },
    workload: {
      id: args.workloadId,
      version: args.workloadVersion,
      taskCount: args.taskCount,
      split: process.env.WORKLOAD_SPLIT ?? 'all',
    },
    seeds: args.seeds,
    judge: {
      provider: args.judgeProvider,
      model: args.judgeModel,
    },
  };
}

async function persistCellRun(
  outputDir: string,
  treatment: TreatmentTag,
  modelId: string,
  seed: number,
  taskResults: TaskResult[],
  summary: unknown,
): Promise<void> {
  const cellDir = path.join(outputDir, `${treatment}_${modelId}`);
  await fs.mkdir(cellDir, { recursive: true });
  await fs.writeFile(
    path.join(cellDir, `run-seed${seed}.json`),
    JSON.stringify({ taskResults, summary }, null, 2),
    'utf8',
  );
}
