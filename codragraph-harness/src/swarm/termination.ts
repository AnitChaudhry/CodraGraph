// Termination predicates — composable stop conditions for the swarm loop.
//
// Per user choice (2026-04-29): hybrid termination. Stop on whichever fires
// first: max-N, plateau, token budget, time budget, or cost budget.
//
// Each predicate is pure: takes SwarmState, returns boolean. Compose by
// calling `anyOf(...predicates)` — coordinator stops on the first true.

import type { SwarmState, TerminationPredicate } from "./interface.js";

/**
 * Stop after a fixed number of iterations. Mirrors Phase 1's iterations
 * cap; should always be set as a safety net even when other predicates
 * are configured.
 */
export function maxIterations(n: number): TerminationPredicate {
  if (n < 1) throw new Error("maxIterations: n must be >= 1");
  return {
    name: `max-iterations-${n}`,
    shouldStop(state: SwarmState): boolean {
      return state.iteration >= n;
    },
  };
}

/**
 * Stop when the Pareto frontier hasn't changed for K consecutive iterations.
 * Useful early-stop for easy task families where the swarm converges fast.
 *
 * "Frontier change" = the set of frontier ids has been added to or removed
 * from. Strictly equal scores on the same id don't trigger a change.
 */
export function paretoPlateau(k: number): TerminationPredicate {
  if (k < 1) throw new Error("paretoPlateau: k must be >= 1");
  return {
    name: `pareto-plateau-${k}`,
    shouldStop(state: SwarmState): boolean {
      return state.iterationsSinceFrontierChange >= k;
    },
  };
}

/** Stop when total proposer + evaluator tokens exceed `t`. */
export function tokenBudget(t: number): TerminationPredicate {
  if (t < 1) throw new Error("tokenBudget: t must be >= 1");
  return {
    name: `token-budget-${t}`,
    shouldStop(state: SwarmState): boolean {
      return state.totalTokens >= t;
    },
  };
}

/** Stop when wall-clock elapsed exceeds `ms`. */
export function timeBudget(ms: number): TerminationPredicate {
  if (ms < 1) throw new Error("timeBudget: ms must be >= 1");
  return {
    name: `time-budget-${ms}ms`,
    shouldStop(state: SwarmState): boolean {
      return state.elapsedMs >= ms;
    },
  };
}

/**
 * Stop when total cost (USD) exceeds `usd`. Requires the coordinator to
 * be configured with a cost meter (per-provider $/token table). If
 * state.totalCostUsd is undefined, this predicate never fires.
 */
export function costBudget(usd: number): TerminationPredicate {
  if (usd <= 0) throw new Error("costBudget: usd must be > 0");
  return {
    name: `cost-budget-$${usd}`,
    shouldStop(state: SwarmState): boolean {
      return state.totalCostUsd !== undefined && state.totalCostUsd >= usd;
    },
  };
}

/** Compose: stops when ANY of the given predicates says stop. */
export function anyOf(...predicates: TerminationPredicate[]): TerminationPredicate {
  return {
    name: `any-of(${predicates.map((p) => p.name).join(",")})`,
    shouldStop(state: SwarmState): boolean {
      return predicates.some((p) => p.shouldStop(state));
    },
  };
}

/**
 * Identify which predicate fired (for logging / SwarmSearchResult.terminatedAt.reason).
 * Returns the first predicate whose shouldStop is true, or null.
 */
export function firstFiring(
  predicates: TerminationPredicate[],
  state: SwarmState,
): TerminationPredicate | null {
  for (const p of predicates) {
    if (p.shouldStop(state)) return p;
  }
  return null;
}
