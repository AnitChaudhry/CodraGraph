// Evaluator interface — runs a Harness against a search-set 𝒳 and returns Scores.
//
// The implementation lives here in Phase 1 task 10 (Implement evaluator + scoring).
// This file defines the contract so algorithm.ts can wire it without depending on
// the implementation.

import type { Harness } from '../harness/interface.js';
import type { GraphClient, ResolvedBudget, TaskInput } from '../types.js';
import type { InferenceProvider } from '../inference/interface.js';
import type { TraceRecord } from '../filesystem.js';
import type { Scores } from './score.js';

export interface Evaluator {
  /** Stable identifier; allows multiple evaluator strategies (e.g., "exact-match", "llm-judge"). */
  readonly name: string;

  evaluate(input: EvaluateInput): Promise<Scores>;
}

export interface EvaluateInput {
  harness: Harness;
  tasks: TaskInput[];
  graph: GraphClient;
  inference: InferenceProvider;
  budget: ResolvedBudget;
  /** Called once per task with the trace record so the algorithm can persist it via CandidateStore. */
  onTraceFinished?: (record: TraceRecord) => void | Promise<void>;
  /** Optional per-task progress callback. */
  onTaskFinished?: (
    taskId: string,
    perTaskScore: { correct: boolean; tokens: number; latencyMs: number },
  ) => void;
}
