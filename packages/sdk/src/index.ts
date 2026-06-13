// codragraph-sdk — one-import surface for the CodraGraph platform.
//
// Usage:
//   import { harness, graph, compress, swarm, graphstore, recipes } from "@codragraph/sdk";
//
//   const frontier = await harness.search({ ... });
//   const ctx       = await graph.context({ name: "validateUser" });
//   const settings  = await graph.featureContext({ name: "Settings" });
//   const snap      = await graphstore.serializeSnapshot({ source, cas });
//   const cached    = await recipes.findReusableRecipes({ store, snapshotId, taskFamily });
//
// Or import sub-namespaces directly:
//   import { search, ALL_SEEDS } from "@codragraph/sdk/harness";
//   import { FsCAS, diffSnapshots } from "@codragraph/sdk/graphstore";
//   import { createGraphpackHttpClient } from "@codragraph/sdk/graphpack";

export * as harness from './harness.js';
export * as graph from './graph.js';
export * as compress from './compress.js';
export * as swarm from './swarm.js';
export * as graphstore from './graphstore.js';
export * as recipes from './recipes.js';
export * as graphpack from './graphpack.js';

// Re-export common types at the top level for ergonomics.
export type {
  TaskInput,
  HarnessResult,
  TokenBudget,
  BudgetPolicy,
  ResolvedBudget,
  TokenUsage,
  Message,
  GraphClient,
  GraphClusterImpactInput,
  GraphClusterImpactResult,
  GraphQueryInput,
  GraphQueryResult,
  GraphContextInput,
  GraphContextResult,
  GraphFeatureClustersInput,
  GraphFeatureClustersResult,
  GraphFeatureClusterSummary,
  GraphFeatureContextInput,
  GraphFeatureContextMember,
  GraphFeatureContextResult,
  GraphImpactInput,
  GraphImpactResult,
} from '@codragraph/harness/types';

export type {
  GraphpackHttpClientOptions,
  GraphpackLock,
  GraphpackPullInput,
  GraphpackPullResult,
  GraphpackPublishInput,
  GraphpackStatus,
  GraphpackTarget,
  SemanticRelationship,
  SemanticRelationshipFamily,
  SemanticRelationshipReport,
} from './graphpack.js';
