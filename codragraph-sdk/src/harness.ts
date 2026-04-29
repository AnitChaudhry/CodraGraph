// Harness namespace — Meta-Harness search loop, seeds, contracts.

export {
  search,
  type SearchOptions,
  type SearchResult,
  type ProgressEvent,
} from "codragraph-harness/dist/algorithm.js";

export {
  ALL_SEEDS,
  SEEDS_BY_NAME,
  zeroShot,
  fewShot,
  graphAware,
} from "codragraph-harness/dist/harness/seeds/index.js";

export type {
  Harness,
  HarnessContext,
  HarnessOrigin,
} from "codragraph-harness/dist/harness/interface.js";

export type {
  Proposer,
  ProposeInput,
  HarnessSource,
  SourceFile,
} from "codragraph-harness/dist/proposer/interface.js";

export { ClaudeCodeProposer } from "codragraph-harness/dist/proposer/claude-code.js";

export type {
  InferenceProvider,
  CompletionInput,
  CompletionResult,
  ToolDefinition,
  ToolCall,
} from "codragraph-harness/dist/inference/interface.js";

export {
  ClaudeInferenceProvider,
  OpenAIInferenceProvider,
  OpenCodeInferenceProvider,
  makeInferenceProvider,
  type ProviderName,
} from "codragraph-harness/dist/inference/index.js";

export {
  CandidateStore,
  type CandidateSummary,
  type CandidateMetadata,
  type TraceRecord,
} from "codragraph-harness/dist/filesystem.js";

export {
  ParetoFrontier,
  type ParetoPoint,
  type AddResult,
} from "codragraph-harness/dist/pareto.js";

export {
  CodebaseQAEvaluator,
  type CodebaseQATask,
  type CodebaseQAEvaluatorOptions,
} from "codragraph-harness/dist/evaluator/impl.js";

export type {
  Scores,
  PerTaskScore,
} from "codragraph-harness/dist/evaluator/score.js";
