/**
 * Multi-objective Scores for a harness over a search-set.
 *
 * The Pareto frontier (src/pareto.ts) is maintained over (accuracy↑, tokens↓,
 * latencyMs↓). The proposer reads aggregate Scores per candidate from
 * candidates/<id>/score.json.
 */
export interface Scores {
  /** Mean correctness across the search set, 0..1. */
  accuracy: number;
  /** Mean total tokens (input + output) per task. */
  tokens: number;
  /** Mean latency per task, milliseconds. */
  latencyMs: number;
  /** |𝒳| — number of tasks evaluated. */
  taskCount: number;
  /** Per-task breakdown — useful for the proposer's diagnosis pass. */
  perTask?: PerTaskScore[];
}

export interface PerTaskScore {
  taskId: string;
  question: string;
  expectedAnswer: string;
  actualAnswer: string;
  correct: boolean;
  tokens: number;
  latencyMs: number;
  /** Free-text from the LLM-judge fallback when exact-match doesn't apply. */
  judgeNote?: string;
}

/**
 * Aggregate per-task results into Scores. Mean-aggregated; if the search set
 * is heterogeneous in difficulty, weighted aggregation should be added in a
 * later phase.
 */
export function aggregateScores(perTask: PerTaskScore[]): Scores {
  if (perTask.length === 0) {
    return { accuracy: 0, tokens: 0, latencyMs: 0, taskCount: 0, perTask: [] };
  }
  const correct = perTask.filter((t) => t.correct).length;
  const tokens = perTask.reduce((s, t) => s + t.tokens, 0) / perTask.length;
  const latencyMs = perTask.reduce((s, t) => s + t.latencyMs, 0) / perTask.length;
  return {
    accuracy: correct / perTask.length,
    tokens,
    latencyMs,
    taskCount: perTask.length,
    perTask,
  };
}
