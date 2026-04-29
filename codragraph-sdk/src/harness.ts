// Harness namespace — Meta-Harness search loop, seeds, contracts.

export {
  search,
  type SearchOptions,
  type SearchResult,
  type ProgressEvent,
} from 'codragraph-harness/algorithm';

export {
  ALL_SEEDS,
  SEEDS_BY_NAME,
  zeroShot,
  fewShot,
  graphAware,
} from 'codragraph-harness/harness/seeds/index';

export type { Harness, HarnessContext, HarnessOrigin } from 'codragraph-harness/harness/interface';

export type {
  Proposer,
  ProposeInput,
  HarnessSource,
  SourceFile,
} from 'codragraph-harness/proposer/interface';

export { ClaudeCodeProposer } from 'codragraph-harness/proposer/claude-code';

export type {
  InferenceProvider,
  CompletionInput,
  CompletionResult,
  ToolDefinition,
  ToolCall,
} from 'codragraph-harness/inference/interface';

export {
  ClaudeInferenceProvider,
  OpenAIInferenceProvider,
  OpenCodeInferenceProvider,
  makeInferenceProvider,
  type ProviderName,
} from 'codragraph-harness/inference/index';

export {
  CandidateStore,
  type CandidateSummary,
  type CandidateMetadata,
  type TraceRecord,
} from 'codragraph-harness/filesystem';

export { ParetoFrontier, type ParetoPoint, type AddResult } from 'codragraph-harness/pareto';

export {
  CodebaseQAEvaluator,
  type CodebaseQATask,
  type CodebaseQAEvaluatorOptions,
} from 'codragraph-harness/evaluator/impl';

export type { Scores, PerTaskScore } from 'codragraph-harness/evaluator/score';
