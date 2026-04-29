// SwarmCoordinator — per-iteration orchestration for the 3-role swarm.
//
// Per iteration:
//   1. Inspect 𝒟 to find top-K frontier ids (Exploiter focus) and
//      bottom-quartile ids (Explorer focus).
//   2. Run Explorer + Exploiter subprocess proposers in parallel.
//   3. Concatenate their outputs; tag each proposal with its proposing role.
//   4. Run Critic in-process on each proposal — filter accepted set.
//   5. Return accepted candidates + role stats for SwarmState bookkeeping.
//
// The actual evaluation happens in swarmSearch() (algorithm.ts) so the
// coordinator stays a single-iteration unit — easy to test, easy to
// reason about, easy to run as a stand-alone "what would the swarm
// propose?" mode in the dashboard later.

import type { CandidateStore } from "../filesystem.js";
import type { HarnessSource, ProposeInput } from "../proposer/interface.js";
import type {
  CriticRole,
  ProposingRole,
  RoleStats,
  SwarmCoordinator,
  SwarmStepInput,
  SwarmStepResult,
} from "./interface.js";

export interface DefaultSwarmCoordinatorOptions {
  store: CandidateStore;
  explorer: ProposingRole;
  exploiter: ProposingRole;
  critic: CriticRole;
  /** Number of candidates the Explorer proposes per iteration. Default 2. */
  exploreCount?: number;
  /** Number of candidates the Exploiter proposes per iteration. Default 2. */
  exploitCount?: number;
}

const DEFAULT_EXPLORE_COUNT = 2;
const DEFAULT_EXPLOIT_COUNT = 2;

export class DefaultSwarmCoordinator implements SwarmCoordinator {
  constructor(private readonly options: DefaultSwarmCoordinatorOptions) {}

  async step(input: SwarmStepInput): Promise<SwarmStepResult> {
    const exploreCount = this.options.exploreCount ?? DEFAULT_EXPLORE_COUNT;
    const exploitCount = this.options.exploitCount ?? DEFAULT_EXPLOIT_COUNT;

    // Step 1+2: run Explorer and Exploiter in parallel.
    const explorerInput: ProposeInput = {
      filesystem: this.options.store,
      count: exploreCount,
      populationSize: input.populationSize,
      iteration: input.iteration,
    };
    const exploiterInput: ProposeInput = {
      filesystem: this.options.store,
      count: exploitCount,
      populationSize: input.populationSize,
      iteration: input.iteration,
    };

    const [explorerResults, exploiterResults] = await Promise.allSettled([
      this.options.explorer.proposer.propose(explorerInput),
      this.options.exploiter.proposer.propose(exploiterInput),
    ]);

    const explorerProposals = unwrapResults(explorerResults, "explorer");
    const exploiterProposals = unwrapResults(exploiterResults, "exploiter");

    const tagged: Array<{ source: HarnessSource; proposingRole: string }> = [
      ...explorerProposals.map((s) => ({ source: s, proposingRole: "explorer" })),
      ...exploiterProposals.map((s) => ({ source: s, proposingRole: "exploiter" })),
    ];

    // Step 3: critic-review in parallel (cheap LLM calls; fan out is fine).
    const reviews = await Promise.all(
      tagged.map(async (t) => {
        const review = await this.options.critic.review({
          source: t.source,
          iteration: input.iteration,
        });
        return { ...t, review };
      }),
    );

    const accepted: SwarmStepResult["accepted"] = [];
    const criticRejected: SwarmStepResult["criticRejected"] = [];
    for (const r of reviews) {
      if (r.review.accept) {
        accepted.push({ source: r.source, proposingRole: r.proposingRole });
      } else {
        criticRejected.push({
          source: r.source,
          proposingRole: r.proposingRole,
          reason: r.review.reason,
          riskLevel: r.review.riskLevel,
        });
      }
    }

    // Step 4: assemble per-role stats. Frontier-hits is filled in later by
    // the algorithm after evaluation, so we leave it 0 here.
    const roleStats: Record<string, RoleStats> = {
      explorer: {
        proposed: explorerProposals.length,
        acceptedByCritic: accepted.filter((a) => a.proposingRole === "explorer").length,
        frontierHits: 0,
        meanTokens: 0, // filled after evaluation when we know per-task token cost
      },
      exploiter: {
        proposed: exploiterProposals.length,
        acceptedByCritic: accepted.filter((a) => a.proposingRole === "exploiter").length,
        frontierHits: 0,
        meanTokens: 0,
      },
    };

    return {
      accepted,
      criticRejected,
      roleStats,
      tokensConsumed: 0, // filled by the algorithm — coordinator doesn't see token usage directly
    };
  }
}

function unwrapResults(
  result: PromiseSettledResult<HarnessSource[]>,
  role: string,
): HarnessSource[] {
  if (result.status === "fulfilled") return result.value;
  // One role's failure shouldn't kill the iteration — log to stderr, continue.
  console.error(
    `[swarm] ${role} proposer failed:`,
    result.reason instanceof Error ? result.reason.message : result.reason,
  );
  return [];
}
