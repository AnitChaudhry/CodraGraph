// Aggregation: per-task results → run summary; multiple runs → cell aggregate.

import type { ModelSpec, RunSummary, TaskResult, TreatmentTag } from './types.js';

export interface ComputeRunSummaryInput {
  runId: string;
  workload: string;
  treatment: TreatmentTag;
  model: ModelSpec;
  taskResults: TaskResult[];
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  seed: number;
}

export function computeRunSummary(input: ComputeRunSummaryInput): RunSummary {
  const tr = input.taskResults;
  const correct = tr.filter((t) => t.correct).length;
  const accuracy = tr.length > 0 ? correct / tr.length : 0;
  const tokensSorted = tr.map((t) => t.totalTokens).sort((a, b) => a - b);
  const latencySorted = tr.map((t) => t.latencyMs).sort((a, b) => a - b);
  const tokensSum = tokensSorted.reduce((s, x) => s + x, 0);
  const meanTokens = tr.length > 0 ? tokensSum / tr.length : 0;
  const meanLatencyMs = tr.length > 0 ? latencySorted.reduce((s, x) => s + x, 0) / tr.length : 0;
  const costUsdSum = tr.reduce((s, t) => s + t.costUsd, 0);

  return {
    runId: input.runId,
    workload: input.workload,
    treatment: input.treatment,
    model: input.model,
    taskCount: tr.length,
    scores: {
      accuracy,
      tokens: meanTokens,
      latencyMs: meanLatencyMs,
      taskCount: tr.length,
    },
    meanTokens,
    tokensP50: percentile(tokensSorted, 0.5),
    tokensP95: percentile(tokensSorted, 0.95),
    meanLatencyMs,
    latencyP95Ms: percentile(latencySorted, 0.95),
    costUsdSum,
    accuracyCi95: wilsonCi95(correct, tr.length),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    totalDurationMs: input.totalDurationMs,
    seed: input.seed,
  };
}

export function computeCellAggregate(runs: RunSummary[]) {
  if (runs.length === 0) {
    return {
      accuracyMean: 0,
      accuracyStdDev: 0,
      accuracyMin: 0,
      accuracyMax: 0,
      tokensMeanMean: 0,
      costSumSum: 0,
    };
  }
  const accuracies = runs.map((r) => r.scores.accuracy);
  const accuracyMean = accuracies.reduce((s, x) => s + x, 0) / accuracies.length;
  const accuracyStdDev = Math.sqrt(
    accuracies.reduce((s, x) => s + (x - accuracyMean) ** 2, 0) / accuracies.length,
  );
  const tokens = runs.map((r) => r.meanTokens);
  const tokensMeanMean = tokens.reduce((s, x) => s + x, 0) / tokens.length;
  const costSumSum = runs.reduce((s, r) => s + r.costUsdSum, 0);
  return {
    accuracyMean,
    accuracyStdDev,
    accuracyMin: Math.min(...accuracies),
    accuracyMax: Math.max(...accuracies),
    tokensMeanMean,
    costSumSum,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

/** Wilson score interval at 95% confidence. */
function wilsonCi95(successes: number, n: number): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 0 };
  const z = 1.96; // ~95%
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lower: Math.max(0, center - halfWidth), upper: Math.min(1, center + halfWidth) };
}
