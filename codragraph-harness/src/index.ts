// Public SDK surface for codragraph-harness.
//
// Populated incrementally by phase tasks:
//   - contracts: ./harness/interface, ./proposer/interface, ./inference/interface
//   - algorithm: ./algorithm
//   - filesystem: ./filesystem
//   - pareto:    ./pareto
//   - evaluator: ./evaluator/runner, ./evaluator/score
//   - seeds:     ./harness/seeds/*
//   - swarm:     ./swarm/* (Phase 3)
//   - moat:      ./moat/*  (Phase 4 × Phase 3 — versioned recipe memory)
//   - cli:       ./cli/main (binary entry — not re-exported here)

// Contract types — these are stable public surface that consumer
// packages (codragraph-compress, codragraph-sdk) import to build on
// top of. Re-exporting here means consumers can use the main package
// entry (`from "@codragraph/harness"`) instead of reaching into
// dist-mapped subpaths that require the package to be built first.
export type {
  InferenceProvider,
  CompletionInput,
  CompletionResult,
  ToolDefinition,
  ToolCall,
} from './inference/interface.js';
export type { Message, TokenUsage } from './types.js';

export * from './moat/index.js';
