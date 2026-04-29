// Pareto frontier over (accuracy↑, tokens↓, latencyMs↓).
//
// Three-objective vector — no scalarization. The proposer is shown the
// frontier on each iteration so it can target gaps (e.g., "high accuracy
// but high tokens" or "low tokens with mediocre accuracy").

import type { Scores } from "./evaluator/score.js";

/** A single point on the frontier. */
export interface ParetoPoint {
  id: string;
  accuracy: number;
  tokens: number;
  latencyMs: number;
}

/** Result of attempting to insert a point. */
export interface AddResult {
  /** True if `point` was added to the frontier. */
  added: boolean;
  /** Existing points (if any) that were dominated by `point` and removed. */
  removed: ParetoPoint[];
}

/**
 * In-memory Pareto frontier. Mutated in place by the outer loop after every
 * successful evaluation.
 */
export class ParetoFrontier {
  private points: ParetoPoint[] = [];

  /**
   * Strict domination: `a` dominates `b` iff `a` is at least as good as `b`
   * on every objective AND strictly better on at least one.
   */
  static dominates(a: ParetoPoint, b: ParetoPoint): boolean {
    const atLeastAsGood =
      a.accuracy >= b.accuracy && a.tokens <= b.tokens && a.latencyMs <= b.latencyMs;
    if (!atLeastAsGood) return false;
    const strictlyBetter =
      a.accuracy > b.accuracy || a.tokens < b.tokens || a.latencyMs < b.latencyMs;
    return strictlyBetter;
  }

  /**
   * Add a point. If an existing frontier point dominates it, returns
   * `{ added: false, removed: [] }`. If the new point dominates existing
   * points, those are removed and reported. Equal points (identical on all
   * three axes) coexist — they have different ids and the proposer may want
   * to inspect both.
   */
  add(point: ParetoPoint): AddResult {
    for (const existing of this.points) {
      if (ParetoFrontier.dominates(existing, point)) {
        return { added: false, removed: [] };
      }
    }
    const removed: ParetoPoint[] = [];
    this.points = this.points.filter((existing) => {
      if (ParetoFrontier.dominates(point, existing)) {
        removed.push(existing);
        return false;
      }
      return true;
    });
    this.points.push(point);
    return { added: true, removed };
  }

  /** All current frontier points (defensive copy). */
  getAll(): ParetoPoint[] {
    return [...this.points];
  }

  size(): number {
    return this.points.length;
  }

  /** Build a frontier from a list of (id, Scores) pairs in one pass. */
  static fromCandidates(scored: Array<{ id: string; scores: Scores }>): ParetoFrontier {
    const f = new ParetoFrontier();
    for (const { id, scores } of scored) {
      f.add({
        id,
        accuracy: scores.accuracy,
        tokens: scores.tokens,
        latencyMs: scores.latencyMs,
      });
    }
    return f;
  }
}
