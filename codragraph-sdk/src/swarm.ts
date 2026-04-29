// Swarm namespace — Phase 3 multi-role harness search.

export {
  swarmSearch,
  type SwarmSearchOptions,
  type SwarmProgressEvent,
} from '@codragraph/harness/swarm/algorithm';

export { ExplorerRole, type ExplorerOptions } from '@codragraph/harness/swarm/explorer';
export { ExploiterRole, type ExploiterOptions } from '@codragraph/harness/swarm/exploiter';
export { LlmCriticRole, type CriticOptions } from '@codragraph/harness/swarm/critic';

export {
  maxIterations,
  paretoPlateau,
  tokenBudget,
  timeBudget,
  costBudget,
  anyOf,
  firstFiring,
} from '@codragraph/harness/swarm/termination';

export {
  DefaultSwarmCoordinator,
  type DefaultSwarmCoordinatorOptions,
} from '@codragraph/harness/swarm/coordinator';

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
} from '@codragraph/harness/swarm/interface';
