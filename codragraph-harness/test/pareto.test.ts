import { describe, it, expect } from "vitest";
import { ParetoFrontier } from "../src/pareto.js";

const p = (id: string, accuracy: number, tokens: number, latencyMs: number) => ({
  id,
  accuracy,
  tokens,
  latencyMs,
});

describe("ParetoFrontier.dominates", () => {
  it("strict domination: better on all three axes", () => {
    expect(ParetoFrontier.dominates(p("a", 0.9, 100, 50), p("b", 0.8, 200, 100))).toBe(true);
    expect(ParetoFrontier.dominates(p("b", 0.8, 200, 100), p("a", 0.9, 100, 50))).toBe(false);
  });

  it("ties on some axes still dominate if strictly better on at least one", () => {
    expect(ParetoFrontier.dominates(p("a", 0.9, 100, 50), p("b", 0.9, 100, 100))).toBe(true);
    expect(ParetoFrontier.dominates(p("a", 0.9, 100, 50), p("b", 0.9, 100, 50))).toBe(false);
  });

  it("incomparable points: neither dominates", () => {
    expect(ParetoFrontier.dominates(p("a", 0.9, 200, 50), p("b", 0.7, 100, 50))).toBe(false);
    expect(ParetoFrontier.dominates(p("b", 0.7, 100, 50), p("a", 0.9, 200, 50))).toBe(false);
  });

  it("worse on at least one axis: no domination", () => {
    expect(ParetoFrontier.dominates(p("a", 0.9, 100, 50), p("b", 0.95, 100, 50))).toBe(false);
  });
});

describe("ParetoFrontier.add", () => {
  it("first point is always added", () => {
    const f = new ParetoFrontier();
    const r = f.add(p("a", 0.8, 100, 50));
    expect(r.added).toBe(true);
    expect(r.removed).toEqual([]);
    expect(f.size()).toBe(1);
  });

  it("dominated point is rejected", () => {
    const f = new ParetoFrontier();
    f.add(p("a", 0.9, 100, 50));
    const r = f.add(p("b", 0.8, 200, 100));
    expect(r.added).toBe(false);
    expect(f.size()).toBe(1);
  });

  it("dominating point removes existing dominated ones", () => {
    const f = new ParetoFrontier();
    // Add 3 incomparable points first so they coexist on the frontier.
    f.add(p("hi-acc", 0.95, 300, 120));
    f.add(p("cheap", 0.7, 80, 30));
    f.add(p("low-lat", 0.75, 200, 20));
    expect(f.size()).toBe(3);
    // A point that dominates all three at once.
    const r = f.add(p("super", 0.96, 70, 15));
    expect(r.added).toBe(true);
    expect(r.removed.map((x) => x.id).sort()).toEqual(["cheap", "hi-acc", "low-lat"]);
    expect(f.size()).toBe(1);
    expect(f.getAll()[0]?.id).toBe("super");
  });

  it("incremental adds: a dominated point added BEFORE a stronger one is auto-removed", () => {
    const f = new ParetoFrontier();
    f.add(p("a", 0.7, 200, 100));
    // b dominates a — adding b should remove a.
    const rb = f.add(p("b", 0.8, 150, 80));
    expect(rb.added).toBe(true);
    expect(rb.removed.map((x) => x.id)).toEqual(["a"]);
    // c dominates b — adding c should remove b.
    const rc = f.add(p("c", 0.9, 100, 50));
    expect(rc.added).toBe(true);
    expect(rc.removed.map((x) => x.id)).toEqual(["b"]);
    expect(f.size()).toBe(1);
    expect(f.getAll()[0]?.id).toBe("c");
  });

  it("equal points (all three axes) coexist", () => {
    const f = new ParetoFrontier();
    f.add(p("a", 0.85, 150, 75));
    const r = f.add(p("b", 0.85, 150, 75));
    expect(r.added).toBe(true);
    expect(f.size()).toBe(2);
  });

  it("incomparable points coexist on the frontier", () => {
    const f = new ParetoFrontier();
    f.add(p("hi-acc", 0.95, 1000, 500)); // expensive but accurate
    f.add(p("cheap", 0.7, 100, 50)); // cheap but mediocre
    f.add(p("balanced", 0.85, 400, 200)); // middle
    expect(f.size()).toBe(3);
  });
});

describe("ParetoFrontier.fromCandidates", () => {
  it("builds the frontier from a batch", () => {
    const f = ParetoFrontier.fromCandidates([
      { id: "a", scores: { accuracy: 0.7, tokens: 200, latencyMs: 100, taskCount: 30 } },
      { id: "b", scores: { accuracy: 0.9, tokens: 100, latencyMs: 50, taskCount: 30 } },
      { id: "c", scores: { accuracy: 0.8, tokens: 150, latencyMs: 80, taskCount: 30 } },
    ]);
    expect(f.size()).toBe(1);
    expect(f.getAll()[0]?.id).toBe("b");
  });
});
