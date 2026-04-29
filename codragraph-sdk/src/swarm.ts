// Swarm namespace — Phase 3 multi-role harness search.

export {
  swarmSearch,
  type SwarmSearchOptions,
  type SwarmProgressEvent,
} from "codragraph-harness/dist/swarm/algorithm.js";

export { ExplorerRole, type ExplorerOptions } from "codragraph-harness/dist/swarm/explorer.js";
export { ExploiterRole, type ExploiterOptions } from "codragraph-harness/dist/swarm/exploiter.js";
export { LlmCriticRole, type CriticOptions } from "codragraph-harness/dist/swarm/critic.js";

export {
  maxIterations,
  paretoPlateau,
  tokenBudget,
  timeBudget,
  costBudget,
  anyOf,
  firstFiring,
} from "codragraph-harness/dist/swarm/termination.js";

export {
  DefaultSwarmCoordinator,
  type DefaultSwarmCoordinatorOptions,
} from "codragraph-harness/dist/swarm/coordinator.js";

export type {
  Role,
  RoleKind,
  ProposingRole,
  CriticRole,
  CriticReviewInput,
  CriticReviewResult,
  TerminationPredicate,
  SwarmState,
  RoleStats,
  SwarmCoordinator,
  SwarmStepInput,
  SwarmStepResult,
  SwarmSearchResult,
} from "codragraph-harness/dist/swarm/interface.js";
