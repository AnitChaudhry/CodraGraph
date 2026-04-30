// Shared types across the bench scripts.

import type { Scores } from '@codragraph/harness/evaluator/score';

export type TreatmentTag =
  | 'baseline-grep'
  | 'baseline-fullfile'
  | 'codragraph-graph-only'
  | 'codragraph-graph-compress'
  | 'codragraph-harness-tuned'
  | 'codragraph-swarm-tuned'
  | 'codragraph-recipe-cached';

export type ProviderName = 'anthropic' | 'openai' | 'vllm' | 'ollama' | 'tgi';

export interface ModelSpec {
  /** Internal id used in CLI flags + result filenames. */
  id: string;
  /** Human-readable name. */
  displayName: string;
  /** Inference provider category. */
  provider: ProviderName;
  /** Provider-specific model id (e.g. "Qwen/Qwen2.5-Coder-7B-Instruct"). */
  modelId: string;
  /** Pinned HuggingFace revision SHA, if applicable. */
  revision?: string;
  /** Quantization label (none / awq / gptq / q5_k_m / etc.). */
  quantization?: string;
  /** Max context window the model exposes. */
  maxContext: number;
  /** Optional override for the inference server URL. */
  baseURL?: string;
}

export interface TaskInput {
  id: string;
  question: string;
  expectedAnswer: string;
  acceptParaphrases?: string[];
  repo?: string;
}

export interface TaskResult {
  taskId: string;
  workload: string;
  treatment: TreatmentTag;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  judgeTokens: number;
  latencyMs: number;
  toolCalls: number;
  answer: string;
  expectedAnswer: string;
  correct: boolean;
  judgeMethod: 'exact' | 'substring' | 'llm-judge' | 'harness-error' | 'test-pass';
  judgeNote?: string;
  costUsd: number;
  errorReason?: string;
  seed: number;
  startedAt: string;
  finishedAt: string;
}

export interface RunSummary {
  runId: string;
  workload: string;
  treatment: TreatmentTag;
  model: ModelSpec;
  taskCount: number;
  scores: Scores;
  /** Mean total tokens (input + output) per task. */
  meanTokens: number;
  /** p50 / p95 distribution. */
  tokensP50: number;
  tokensP95: number;
  /** Mean / p95 latency in ms. */
  meanLatencyMs: number;
  latencyP95Ms: number;
  /** Sum cost across all tasks (USD). */
  costUsdSum: number;
  /** 95% Wilson confidence interval for accuracy. */
  accuracyCi95: { lower: number; upper: number };
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  seed: number;
}

export interface CellResult {
  /** All task results in a single (workload × treatment × model × runs) cell. */
  taskResults: TaskResult[];
  /** Per-run summaries (one per seed). */
  runSummaries: RunSummary[];
  /** Aggregate over runs. */
  aggregate: {
    accuracyMean: number;
    accuracyStdDev: number;
    accuracyMin: number;
    accuracyMax: number;
    tokensMeanMean: number;
    costSumSum: number;
  };
}

export interface BenchEnv {
  runId: string;
  timestamp: string;
  git: {
    sha: string;
    branch: string;
    dirty: boolean;
  };
  node: {
    version: string;
    platform: string;
  };
  host: {
    os: string;
    cpu: string;
    ramGb: number;
    gpus: Array<{
      name: string;
      driver: string;
      cuda: string;
      memoryGb: number;
    }>;
  };
  inferenceServer?: {
    kind: 'vllm' | 'ollama' | 'tgi' | 'llamacpp';
    version: string;
    args: string;
  };
  codragraph: {
    version: string;
    indexedRepoSha: string;
    /** Set when Phase 4 is in use. */
    graphSnapshotId?: string;
  };
  workload: {
    id: string;
    version: string;
    taskCount: number;
    split: string;
  };
  seeds: number[];
  judge: {
    provider: ProviderName;
    model: string;
  };
}
