// Swarm contracts — Phase 3.
//
// The swarm extends Phase 1's single-Proposer model with three specialized
// roles working in parallel each iteration:
//
//   Explorer  — subprocess (Claude Code). Broad mutations across the
//               search space. Reads bottom-quartile candidates to find
//               unexplored territory.
//   Exploiter — subprocess (Claude Code). Targeted refinements of the top-K
//               Pareto frontier. Minimal diffs (param tuning, prompt tweaks).
//   Critic    — in-process LLM call. Reviews each proposed harness BEFORE
//               expensive evaluation runs. Cheap pre-filter; rejects
//               obviously broken proposals (banned imports, missing exports,
//               obviously-wrong shapes).
//
// User feedback (2026-04-29 AskUserQuestion):
//   "Hybrid: in-process for cheap roles, subprocess for code-writers"
//   "Hybrid (early-stop + max-N + budget)" termination
//
// We keep the Phase 1 `Proposer` interface unchanged so single-proposer
// `search()` still works; swarm uses the richer contracts below.

import type { Proposer, HarnessSource } from "../proposer/interface.js";
import type { Scores } from "../evaluator/score.js";

/** Common identity carried by every role. */
export interface Role {
  readonly name: string;
  readonly kind: RoleKind;
}

export type RoleKind = "explorer" | "exploiter" | "critic";

/**
 * A role that *proposes* candidates. Both Explorer and Exploiter implement
 * this; their behavior differs in the prompt and which subset of 𝒟 they
 * read. Both wrap a `Proposer` (typically ClaudeCodeProposer with a
 * role-specific prompt).
 */
export interface ProposingRole extends Role {
  readonly kind: "explorer" | "exploiter";
  /** Underlying proposer; the role customizes inputs/prompts but delegates execution. */
  readonly proposer: Proposer;
}

/**
 * A role that *reviews* proposed candidates BEFORE evaluation. Returns an
 * accept/reject decision so the coordinator can drop bad candidates without
 * paying evaluation cost. Runs in-process (no subprocess) — cheap and fast.
 */
export interface CriticRole extends Role {
  readonly kind: "critic";
  review(input: CriticReviewInput): Promise<CriticReviewResult>;
}

export interface CriticReviewInput {
  source: HarnessSource;
  /** Optional context from the iteration the proposal came from. */
  iteration?: number;
}

export interface CriticReviewResult {
  /** True = let evaluator score this candidate. False = reject without evaluation. */
  accept: boolean;
  /** Free-text reason; written to the critic-rejected log. */
  reason: string;
  /** Severity of any concerns: NONE = looks good, LOW = stylistic, HIGH = likely broken, BLOCK = security/safety. */
  riskLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "BLOCK";
}

/**
 * Termination predicate — evaluated after every iteration. The coordinator
 * stops as soon as ANY configured predicate returns true. Composable;
 * users compose multiple to get hybrid behavior (max-N OR plateau OR budget).
 */
export interface TerminationPredicate {
  readonly name: string;
  /** Called after each iteration with the current swarm state. Return true to stop. */
  shouldStop(state: SwarmState): boolean;
}

export interface SwarmState {
  iteration: number;
  /** Snapshot of the Pareto frontier after this iteration's evaluations. */
  frontierSize: number;
  /** Did the frontier change in this iteration? (added or removed any point) */
  frontierChanged: boolean;
  /** Iterations since last frontier change. Reset to 0 on change. */
  iterationsSinceFrontierChange: number;
  /** Cumulative proposer + evaluator tokens. */
  totalTokens: number;
  /** Wall-clock ms since coordinator started. */
  elapsedMs: number;
  /** Approx USD cost so far (if cost meter is configured). */
  totalCostUsd?: number;
  /** Latest scores per role, keyed by role name. */
  perRole: Record<string, RoleStats>;
}

export interface RoleStats {
  /** How many candidates this role proposed total. */
  proposed: number;
  /** How many of those passed the critic. */
  acceptedByCritic: number;
  /** How many made it onto the Pareto frontier. */
  frontierHits: number;
  /** Mean tokens consumed per proposal call (proposer cost only). */
  meanTokens: number;
}

/**
 * Per-iteration coordinator. Phase 1 used Proposer.propose() once per
 * iteration. The swarm coordinator replaces that with a richer step that
 * runs Explorer + Exploiter in parallel and gates each result through Critic.
 */
export interface SwarmCoordinator {
  /**
   * Run one iteration. Returns the candidates that passed the critic and
   * are ready for evaluation, plus per-role stats for SwarmState.
   */
  step(input: SwarmStepInput): Promise<SwarmStepResult>;
}

export interface SwarmStepInput {
  iteration: number;
  populationSize: number;
  /** Read access to filesystem 𝒟 — passed straight through to roles. */
  filesystemRoot: string;
  /** Top-K frontier candidate ids the Exploiter should focus on. */
  topFrontierIds: string[];
  /** Bottom-quartile candidate ids the Explorer should consider. */
  bottomQuartileIds: string[];
}

export interface SwarmStepResult {
  /** Candidates that passed both the proposer and the critic. */
  accepted: Array<{ source: HarnessSource; proposingRole: string }>;
  /** Candidates that the proposers wrote but the critic rejected. */
  criticRejected: Array<{
    source: HarnessSource;
    proposingRole: string;
    reason: string;
    riskLevel: CriticReviewResult["riskLevel"];
  }>;
  /** Per-role telemetry for SwarmState. */
  roleStats: Record<string, RoleStats>;
  /** Total proposer tokens consumed in this step. */
  tokensConsumed: number;
}

/**
 * The single-shot evaluation result a swarm-aware run produces. Mirrors
 * Phase 1's SearchResult but adds per-role attribution for the dashboard.
 */
export interface SwarmSearchResult {
  /** Pareto-optimal candidates by id, sorted by accuracy descending. */
  frontier: Array<{ id: string; accuracy: number; tokens: number; latencyMs: number }>;
  /** Total candidates evaluated (including ones that didn't make the frontier). */
  totalEvaluated: number;
  /** Proposed candidates the critic rejected before evaluation. */
  totalCriticRejected: number;
  /** Proposed candidates that failed loading / harness validation. */
  totalLoadRejected: number;
  /** Iteration at which the loop terminated, and which predicate fired. */
  terminatedAt: { iteration: number; reason: string };
  /** Final per-role stats — feeds the dashboard's swarm view. */
  perRole: Record<string, RoleStats>;
  /** All scored candidates by id (for dashboard timelines). */
  scoredCandidates: Array<{ id: string; role: string; scores: Scores }>;
}
