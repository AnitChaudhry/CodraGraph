// Meta-Harness Algorithm 1 — outer optimization loop over harnesses.
//
// Reference: arXiv 2603.28052, Algorithm 1.
//
//   Input: tasks 𝒳, frozen LLM M, proposer P, iterations N
//   Init:  population ℋ ← {baseline harnesses}, filesystem 𝒟 ← ∅
//
//   for H ∈ ℋ:  𝒟 ← 𝒟 ∪ {(H, Evaluate(H, M, 𝒳))}
//
//   for t = 1..N:
//       P queries 𝒟              # reads code, traces, scores by hand
//       {H_1..H_k} ← P.propose()
//       for H_i:
//           if H_i passes interface validation:
//               𝒟 ← 𝒟 ∪ {(H_i, Evaluate(H_i, M, 𝒳))}
//
//   return Pareto frontier of 𝒟
//
// The deliberate minimalism (no parent selection, no mutation operators, no
// scaffold constraints) is the paper's key thesis: delegate search heuristics
// to the proposer's coding ability.

import type { Harness } from "./harness/interface.js";
import type { Proposer } from "./proposer/interface.js";
import type { InferenceProvider } from "./inference/interface.js";
import type { GraphClient, TaskInput, TokenBudget } from "./types.js";
import { resolveBudget } from "./types.js";
import type { Evaluator } from "./evaluator/runner.js";
import type { Scores } from "./evaluator/score.js";
import { CandidateStore } from "./filesystem.js";
import { ParetoFrontier, type ParetoPoint } from "./pareto.js";

export interface SearchOptions {
  /** Search-set 𝒳. */
  tasks: TaskInput[];
  /** Frozen base model adapter. */
  inference: InferenceProvider;
  /** Graph client (codragraph MCP, abstracted). */
  graph: GraphClient;
  /** Proposer that generates new candidates from 𝒟. */
  proposer: Proposer;
  /** Filesystem 𝒟. */
  store: CandidateStore;
  /** Evaluator that runs Evaluate(H, M, 𝒳) → Scores. */
  evaluator: Evaluator;
  /** Initial population ℋ. */
  seeds: Harness[];
  /** Iterations N (outer loop). */
  iterations: number;
  /** Candidates per iteration k. Default 2 (paper's typical value). */
  candidatesPerIteration?: number;
  /**
   * Resource envelope passed into each harness invocation. Pass a TokenBudget
   * with `policy: "min" | "balanced" | "max" | "custom"` and optionally
   * override individual fields. Resolved internally before reaching harnesses.
   */
  budget: TokenBudget;
  /**
   * Resolves a candidate's on-disk source into a live Harness instance.
   * Required because the proposer writes raw TS to candidates/<id>/source/
   * and the algorithm shouldn't know about tsx/esbuild/dynamic-import.
   */
  loadCandidate: (candidateDir: string) => Promise<Harness>;
  /** Optional progress stream — used by the CLI and (future) dashboard. */
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: "init"; seedCount: number; iterations: number }
  | { type: "seed-evaluated"; id: string; scores: Scores }
  | { type: "iteration-start"; iteration: number; populationSize: number }
  | { type: "candidate-proposed"; id: string; iteration: number; name: string }
  | {
      type: "candidate-rejected";
      iteration: number;
      name: string;
      reason: string;
    }
  | { type: "candidate-evaluated"; id: string; iteration: number; scores: Scores }
  | { type: "complete"; frontier: ParetoPoint[]; totalEvaluated: number };

export interface SearchResult {
  /** Pareto-optimal candidates by id, sorted by accuracy descending. */
  frontier: ParetoPoint[];
  /** Total candidates that were evaluated (seeds + accepted proposals). */
  totalEvaluated: number;
  /** Candidates that were proposed but rejected (failed validation). */
  totalRejected: number;
}

/**
 * Run the outer loop. Sequential: one candidate is evaluated at a time. Phase 3
 * will add parallelism (multiple proposers, parallel evaluation) — for Phase 1
 * we want clean traces and deterministic ordering for the proposer to reason over.
 */
export async function search(options: SearchOptions): Promise<SearchResult> {
  const k = options.candidatesPerIteration ?? 2;
  const onProgress = options.onProgress ?? (() => {});

  await options.store.init();
  onProgress({
    type: "init",
    seedCount: options.seeds.length,
    iterations: options.iterations,
  });

  let totalEvaluated = 0;
  let totalRejected = 0;

  // Step 1: evaluate seeds.
  for (const seed of options.seeds) {
    const id = await options.store.addCandidate({
      name: seed.name,
      version: seed.version,
      origin: seed.origin,
      // Seeds are imported as code, not stored — but we still record an empty
      // source/ directory plus a marker file so the proposer can see "this
      // candidate was a seed, source is in the codragraph-harness package".
      files: [
        {
          path: "SEED.md",
          content: `# Seed harness\n\nName: ${seed.name}\nVersion: ${seed.version}\n\nSource lives in the codragraph-harness package (src/harness/seeds/) — not duplicated here. Proposer should read it from there to understand the baseline behavior.\n`,
        },
      ],
    });
    const scores = await runEvaluate(options, seed, id);
    onProgress({ type: "seed-evaluated", id, scores });
    totalEvaluated++;
  }

  // Step 2: outer loop.
  for (let t = 1; t <= options.iterations; t++) {
    const populationSize = (await options.store.listCandidates()).length;
    onProgress({ type: "iteration-start", iteration: t, populationSize });

    const sources = await options.proposer.propose({
      filesystem: options.store,
      count: k,
      populationSize,
      iteration: t,
    });

    for (const source of sources) {
      const id = await options.store.addCandidate({
        name: source.name,
        version: "0.1.0",
        origin: {
          kind: "proposer",
          proposer: options.proposer.name,
          iteration: t,
          parents: source.parents,
        },
        files: source.files,
        parents: source.parents,
        rationale: source.rationale,
      });
      onProgress({ type: "candidate-proposed", id, iteration: t, name: source.name });

      let harness: Harness;
      try {
        harness = await options.loadCandidate(options.store.candidateDir(id));
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        onProgress({
          type: "candidate-rejected",
          iteration: t,
          name: source.name,
          reason,
        });
        totalRejected++;
        continue;
      }

      const scores = await runEvaluate(options, harness, id);
      onProgress({ type: "candidate-evaluated", id, iteration: t, scores });
      totalEvaluated++;
    }
  }

  // Step 3: assemble frontier from all scored candidates.
  const summaries = await options.store.listCandidates();
  const points: Array<{ id: string; scores: Scores }> = [];
  for (const c of summaries) {
    if (!c.hasScore) continue;
    const s = await options.store.readScore(c.id);
    if (s) points.push({ id: c.id, scores: s });
  }
  const frontier = ParetoFrontier.fromCandidates(points)
    .getAll()
    .sort((a, b) => b.accuracy - a.accuracy);

  onProgress({ type: "complete", frontier, totalEvaluated });
  return { frontier, totalEvaluated, totalRejected };
}

/** Helper: run the evaluator on one harness, persist score + traces. */
async function runEvaluate(
  options: SearchOptions,
  harness: Harness,
  id: string,
): Promise<Scores> {
  // Resolve TokenBudget → ResolvedBudget once per evaluation so harnesses
  // see concrete numbers and never have to re-evaluate the policy.
  const resolved = resolveBudget(options.budget);
  const scores = await options.evaluator.evaluate({
    harness,
    tasks: options.tasks,
    graph: options.graph,
    inference: options.inference,
    budget: resolved,
    onTraceFinished: async (record) => {
      await options.store.addTrace(id, record);
    },
  });
  await options.store.addScore(id, scores);
  return scores;
}
