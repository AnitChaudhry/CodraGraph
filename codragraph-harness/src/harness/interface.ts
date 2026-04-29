import type {
  GraphClient,
  HarnessResult,
  ResolvedBudget,
  TaskInput,
  TraceWriter,
} from "../types.js";
import type { InferenceProvider } from "../inference/interface.js";

/**
 * Harness — the unit of optimization.
 *
 * A harness is the code around a fixed base model that decides what to store,
 * retrieve, and present at each step. Different harnesses for the same task
 * family produce different (accuracy, token-cost, latency) tradeoffs.
 *
 * Phase 1 ships three seeds: zero-shot, few-shot, graph-aware. The proposer
 * mutates these into new candidates by writing new TS files implementing this
 * interface.
 */
export interface Harness {
  /** Stable identifier; used in the candidate filesystem path. */
  readonly name: string;
  /** Semver-style; bumped when source changes meaningfully. */
  readonly version: string;
  /** Author/origin: "seed", or "proposer:<id>" for evolved candidates. */
  readonly origin: HarnessOrigin;

  /** Single invocation: take a task, return an answer + token/latency cost. */
  run(task: TaskInput, ctx: HarnessContext): Promise<HarnessResult>;
}

export type HarnessOrigin =
  | { kind: "seed" }
  | { kind: "proposer"; proposer: string; iteration: number; parents?: string[] };

/**
 * Resources passed to every harness invocation. Harnesses must not import
 * concrete provider modules directly — pull everything from `ctx`.
 */
export interface HarnessContext {
  /** Codragraph graph capabilities (query, context, impact). */
  graph: GraphClient;
  /** Inference provider (Claude / OpenAI / OpenCode / ...). */
  inference: InferenceProvider;
  /**
   * Concrete resource envelope the harness must respect. Already resolved
   * from a TokenBudget policy by the algorithm before the harness sees it,
   * so harnesses never have to call resolveBudget themselves.
   */
  budget: ResolvedBudget;
  /** Append per-step records here for the proposer to read on the next iteration. */
  trace: TraceWriter;
}
