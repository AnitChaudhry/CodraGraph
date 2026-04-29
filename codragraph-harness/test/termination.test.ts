import { describe, it, expect } from "vitest";
import {
  maxIterations,
  paretoPlateau,
  tokenBudget,
  timeBudget,
  costBudget,
  anyOf,
  firstFiring,
} from "../src/swarm/termination.js";
import type { SwarmState } from "../src/swarm/interface.js";

const state = (overrides: Partial<SwarmState> = {}): SwarmState => ({
  iteration: 1,
  frontierSize: 1,
  frontierChanged: false,
  iterationsSinceFrontierChange: 0,
  totalTokens: 0,
  elapsedMs: 0,
  totalCostUsd: undefined,
  perRole: {},
  ...overrides,
});

describe("maxIterations", () => {
  it("fires when iteration >= N", () => {
    const p = maxIterations(10);
    expect(p.shouldStop(state({ iteration: 9 }))).toBe(false);
    expect(p.shouldStop(state({ iteration: 10 }))).toBe(true);
    expect(p.shouldStop(state({ iteration: 11 }))).toBe(true);
  });
  it("rejects N < 1", () => {
    expect(() => maxIterations(0)).toThrow();
  });
});

describe("paretoPlateau", () => {
  it("fires when stagnation >= K", () => {
    const p = paretoPlateau(5);
    expect(p.shouldStop(state({ iterationsSinceFrontierChange: 4 }))).toBe(false);
    expect(p.shouldStop(state({ iterationsSinceFrontierChange: 5 }))).toBe(true);
  });
});

describe("tokenBudget", () => {
  it("fires when totalTokens >= t", () => {
    const p = tokenBudget(1_000_000);
    expect(p.shouldStop(state({ totalTokens: 999_999 }))).toBe(false);
    expect(p.shouldStop(state({ totalTokens: 1_000_000 }))).toBe(true);
  });
});

describe("timeBudget", () => {
  it("fires when elapsedMs >= ms", () => {
    const p = timeBudget(60_000);
    expect(p.shouldStop(state({ elapsedMs: 59_999 }))).toBe(false);
    expect(p.shouldStop(state({ elapsedMs: 60_000 }))).toBe(true);
  });
});

describe("costBudget", () => {
  it("does NOT fire when totalCostUsd is undefined", () => {
    const p = costBudget(10);
    expect(p.shouldStop(state({ totalCostUsd: undefined }))).toBe(false);
  });
  it("fires when totalCostUsd >= cap", () => {
    const p = costBudget(10);
    expect(p.shouldStop(state({ totalCostUsd: 9.99 }))).toBe(false);
    expect(p.shouldStop(state({ totalCostUsd: 10 }))).toBe(true);
  });
});

describe("anyOf", () => {
  it("fires when ANY child predicate fires", () => {
    const p = anyOf(maxIterations(100), paretoPlateau(3));
    expect(p.shouldStop(state({ iteration: 50, iterationsSinceFrontierChange: 0 }))).toBe(false);
    expect(p.shouldStop(state({ iteration: 50, iterationsSinceFrontierChange: 3 }))).toBe(true);
    expect(p.shouldStop(state({ iteration: 100, iterationsSinceFrontierChange: 0 }))).toBe(true);
  });
});

describe("firstFiring", () => {
  it("returns the first predicate that fires, in declared order", () => {
    const a = maxIterations(100);
    const b = paretoPlateau(3);
    const c = tokenBudget(1_000_000);
    const fired = firstFiring(
      [a, b, c],
      state({ iteration: 100, iterationsSinceFrontierChange: 5, totalTokens: 2_000_000 }),
    );
    expect(fired).toBe(a);
  });
  it("returns null when no predicate fires", () => {
    const fired = firstFiring(
      [maxIterations(100), tokenBudget(1_000_000)],
      state({ iteration: 5, totalTokens: 100 }),
    );
    expect(fired).toBeNull();
  });
});
