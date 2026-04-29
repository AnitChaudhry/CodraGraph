// swarmSearch() — Phase 3 swarm-aware outer loop.
//
// Differences from Phase 1 search():
//   - Replaces the single proposer.propose() call per iteration with a
//     SwarmCoordinator.step() that runs Explorer + Exploiter in parallel
//     and gates each proposal through the Critic.
//   - Uses composable termination predicates (max-N + plateau + budget)
//     instead of a fixed iteration count.
//   - Tracks per-role stats so the dashboard (Phase 2, lands AFTER Phase 4)
//     can attribute frontier hits to roles.
//
// Phase 1's search() stays unchanged — single-proposer use cases still work.

import type { Harness } from '../harness/interface.js';
import type { TokenBudget, TaskInput, GraphClient } from '../types.js';
import { resolveBudget } from '../types.js';
import type { InferenceProvider } from '../inference/interface.js';
import type { Evaluator } from '../evaluator/runner.js';
import type { Scores } from '../evaluator/score.js';
import { CandidateStore } from '../filesystem.js';
import { ParetoFrontier, type ParetoPoint } from '../pareto.js';
import { firstFiring } from './termination.js';
import type {
  ProposingRole,
  CriticRole,
  RoleStats,
  SwarmCoordinator,
  SwarmSearchResult,
  SwarmState,
  TerminationPredicate,
} from './interface.js';
import { DefaultSwarmCoordinator } from './coordinator.js';

export interface SwarmSearchOptions {
  /** Search-set 𝒳. */
  tasks: TaskInput[];
  /** Frozen base model adapter for harness execution. */
  inference: InferenceProvider;
  /** Graph client (codragraph MCP). */
  graph: GraphClient;
  /** Filesystem 𝒟. */
  store: CandidateStore;
  /** Evaluator. */
  evaluator: Evaluator;
  /** Initial population ℋ. */
  seeds: Harness[];
  /** Token budget policy passed to harnesses. */
  budget: TokenBudget;
  /**
   * Loader from Phase 1 — resolves a candidate's source/ to a live Harness
   * instance. Use compileAndLoadCandidate from ../loader.js.
   */
  loadCandidate: (candidateDir: string) => Promise<Harness>;
  /**
   * Roles. If `coordinator` is provided, these are unused — provide either
   * `coordinator` or all three role fields, not both.
   */
  explorer?: ProposingRole;
  exploiter?: ProposingRole;
  critic?: CriticRole;
  /** Per-role candidate counts; passed through to DefaultSwarmCoordinator. */
  exploreCount?: number;
  exploitCount?: number;
  /** Direct coordinator override; bypasses DefaultSwarmCoordinator construction. */
  coordinator?: SwarmCoordinator;
  /**
   * Termination predicates — composed via anyOf inside swarmSearch. Stop
   * on the first predicate that fires. ALWAYS include a maxIterations as
   * a safety net.
   */
  termination: TerminationPredicate[];
  /** Optional progress stream. Roles + termination events surface here. */
  onProgress?: (event: SwarmProgressEvent) => void;
}

export type SwarmProgressEvent =
  | { type: 'init'; seedCount: number; predicates: string[] }
  | { type: 'seed-evaluated'; id: string; scores: Scores }
  | {
      type: 'iteration-start';
      iteration: number;
      populationSize: number;
      frontierSize: number;
    }
  | {
      type: 'swarm-step-complete';
      iteration: number;
      proposed: number;
      criticAccepted: number;
      criticRejected: number;
    }
  | {
      type: 'candidate-rejected';
      iteration: number;
      name: string;
      reason: string;
      stage: 'critic' | 'load';
    }
  | {
      type: 'candidate-evaluated';
      id: string;
      iteration: number;
      role: string;
      scores: Scores;
      addedToFrontier: boolean;
    }
  | {
      type: 'complete';
      frontier: ParetoPoint[];
      terminatedAt: { iteration: number; reason: string };
      perRole: Record<string, RoleStats>;
    };

export async function swarmSearch(options: SwarmSearchOptions): Promise<SwarmSearchResult> {
  const onProgress = options.onProgress ?? (() => {});

  // Build the coordinator.
  const coordinator = options.coordinator ?? buildDefaultCoordinator(options);

  await options.store.init();
  onProgress({
    type: 'init',
    seedCount: options.seeds.length,
    predicates: options.termination.map((p) => p.name),
  });

  // Trackers.
  const startedAtMs = Date.now();
  const frontier = new ParetoFrontier();
  const scoredCandidates: SwarmSearchResult['scoredCandidates'] = [];
  const perRole: Record<string, RoleStats> = {
    seed: { proposed: 0, acceptedByCritic: 0, frontierHits: 0, meanTokens: 0 },
    explorer: { proposed: 0, acceptedByCritic: 0, frontierHits: 0, meanTokens: 0 },
    exploiter: { proposed: 0, acceptedByCritic: 0, frontierHits: 0, meanTokens: 0 },
  };
  let totalTokens = 0;
  let totalEvaluated = 0;
  let totalCriticRejected = 0;
  let totalLoadRejected = 0;
  let iterationsSinceFrontierChange = 0;

  // Step 1: evaluate seeds.
  for (const seed of options.seeds) {
    const id = await options.store.addCandidate({
      name: seed.name,
      version: seed.version,
      origin: seed.origin,
      files: [
        {
          path: 'SEED.md',
          content: `# Seed harness\n\nName: ${seed.name}\nVersion: ${seed.version}\n`,
        },
      ],
    });
    const scores = await runEvaluate(options, seed, id);
    scoredCandidates.push({ id, role: 'seed', scores });
    totalTokens += scores.tokens * scores.taskCount;
    totalEvaluated++;
    perRole.seed!.proposed++;
    perRole.seed!.acceptedByCritic++;
    const point: ParetoPoint = {
      id,
      accuracy: scores.accuracy,
      tokens: scores.tokens,
      latencyMs: scores.latencyMs,
    };
    const r = frontier.add(point);
    if (r.added) {
      perRole.seed!.frontierHits++;
      iterationsSinceFrontierChange = 0;
    }
    onProgress({ type: 'seed-evaluated', id, scores });
  }

  // Step 2: outer swarm loop.
  let iteration = 0;
  let terminationReason = '<no-termination>';
  while (true) {
    iteration++;
    onProgress({
      type: 'iteration-start',
      iteration,
      populationSize: (await options.store.listCandidates()).length,
      frontierSize: frontier.size(),
    });

    // Compute top-K frontier and bottom-quartile ids for role focus.
    const allCandidates = await options.store.listCandidates();
    const scored: Array<{ id: string; scores: Scores }> = [];
    for (const c of allCandidates) {
      if (!c.hasScore) continue;
      const s = await options.store.readScore(c.id);
      if (s) scored.push({ id: c.id, scores: s });
    }
    scored.sort((a, b) => b.scores.accuracy - a.scores.accuracy);
    const topFrontierIds = scored.slice(0, 5).map((s) => s.id);
    const bottomQuartileIds = scored.slice(Math.floor(scored.length * 0.75)).map((s) => s.id);

    // One swarm step (Explorer || Exploiter, then Critic gate).
    const stepResult = await coordinator.step({
      iteration,
      populationSize: allCandidates.length,
      filesystemRoot: options.store.rootPath,
      topFrontierIds,
      bottomQuartileIds,
    });

    onProgress({
      type: 'swarm-step-complete',
      iteration,
      proposed: stepResult.accepted.length + stepResult.criticRejected.length,
      criticAccepted: stepResult.accepted.length,
      criticRejected: stepResult.criticRejected.length,
    });

    // Update role stats from coordinator output.
    for (const [name, s] of Object.entries(stepResult.roleStats)) {
      const role = perRole[name];
      if (role) {
        role.proposed += s.proposed;
        role.acceptedByCritic += s.acceptedByCritic;
      }
    }

    // Handle critic rejections.
    for (const cr of stepResult.criticRejected) {
      onProgress({
        type: 'candidate-rejected',
        iteration,
        name: cr.source.name,
        reason: cr.reason,
        stage: 'critic',
      });
    }
    totalCriticRejected += stepResult.criticRejected.length;

    // Persist + evaluate accepted candidates.
    let frontierChangedThisIter = false;
    for (const a of stepResult.accepted) {
      const id = await options.store.addCandidate({
        name: a.source.name,
        version: '0.1.0',
        origin: {
          kind: 'proposer',
          proposer: a.proposingRole,
          iteration,
          parents: a.source.parents,
        },
        files: a.source.files,
        parents: a.source.parents,
        rationale: a.source.rationale,
      });

      let harness: Harness;
      try {
        harness = await options.loadCandidate(options.store.candidateDir(id));
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        onProgress({
          type: 'candidate-rejected',
          iteration,
          name: a.source.name,
          reason,
          stage: 'load',
        });
        totalLoadRejected++;
        continue;
      }

      const scores = await runEvaluate(options, harness, id);
      scoredCandidates.push({ id, role: a.proposingRole, scores });
      totalTokens += scores.tokens * scores.taskCount;
      totalEvaluated++;

      const point: ParetoPoint = {
        id,
        accuracy: scores.accuracy,
        tokens: scores.tokens,
        latencyMs: scores.latencyMs,
      };
      const r = frontier.add(point);
      if (r.added) {
        const role = perRole[a.proposingRole];
        if (role) role.frontierHits++;
        frontierChangedThisIter = true;
      }
      onProgress({
        type: 'candidate-evaluated',
        id,
        iteration,
        role: a.proposingRole,
        scores,
        addedToFrontier: r.added,
      });
    }
    iterationsSinceFrontierChange = frontierChangedThisIter ? 0 : iterationsSinceFrontierChange + 1;

    // Check termination predicates AFTER the iteration completes.
    const state: SwarmState = {
      iteration,
      frontierSize: frontier.size(),
      frontierChanged: frontierChangedThisIter,
      iterationsSinceFrontierChange,
      totalTokens,
      elapsedMs: Date.now() - startedAtMs,
      perRole,
    };
    const fired = firstFiring(options.termination, state);
    if (fired) {
      terminationReason = fired.name;
      break;
    }
  }

  // Compute mean tokens per role for telemetry.
  for (const [name, role] of Object.entries(perRole)) {
    const matching = scoredCandidates.filter((sc) => sc.role === name);
    if (matching.length > 0) {
      role.meanTokens = matching.reduce((sum, m) => sum + m.scores.tokens, 0) / matching.length;
    }
  }

  const sortedFrontier = frontier.getAll().sort((a, b) => b.accuracy - a.accuracy);
  onProgress({
    type: 'complete',
    frontier: sortedFrontier,
    terminatedAt: { iteration, reason: terminationReason },
    perRole,
  });

  return {
    frontier: sortedFrontier,
    totalEvaluated,
    totalCriticRejected,
    totalLoadRejected,
    terminatedAt: { iteration, reason: terminationReason },
    perRole,
    scoredCandidates,
  };
}

function buildDefaultCoordinator(options: SwarmSearchOptions): SwarmCoordinator {
  if (!options.explorer || !options.exploiter || !options.critic) {
    throw new Error(
      'swarmSearch: must provide explorer + exploiter + critic, or a custom coordinator',
    );
  }
  return new DefaultSwarmCoordinator({
    store: options.store,
    explorer: options.explorer,
    exploiter: options.exploiter,
    critic: options.critic,
    exploreCount: options.exploreCount,
    exploitCount: options.exploitCount,
  });
}

async function runEvaluate(
  options: SwarmSearchOptions,
  harness: Harness,
  id: string,
): Promise<Scores> {
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
