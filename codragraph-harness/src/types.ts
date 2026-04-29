// Common types shared across harness, proposer, evaluator, inference.
//
// Kept in one file so the contracts in harness/, proposer/, inference/, evaluator/
// can import without circular deps. Concrete implementations live in their own
// directories.

/** A single task instance the harness runs against. Codebase Q&A in Phase 1. */
export interface TaskInput {
  id: string;
  question: string;
  /** Optional repo target (alias, name, or path) — passed through to the graph. */
  repo?: string;
  metadata?: Record<string, unknown>;
}

/** Output of a single harness invocation. */
export interface HarnessResult {
  answer: string;
  /** Total tokens consumed across all inference calls in this run. */
  tokens: TokenUsage;
  /** Wall-clock duration in milliseconds. */
  latencyMs: number;
  /** Provider-specific or harness-specific extras. */
  metadata?: Record<string, unknown>;
}

/** Token accounting for a completion or aggregated across a harness run. */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Token budget policy — drives how generous the harness should be with
 * context. Hardcoded caps break long-running tasks (bug repair, proposer
 * reading many candidates, large traces); this policy system lets the user
 * pick a regime and lets harnesses opt up/down without touching code.
 *
 *   "min"      — small, fast, cheap. Truncates aggressively. ~4k in / 1k out.
 *   "balanced" — sensible default. Covers most agent tasks. ~32k in / 4k out.
 *   "max"      — use the provider's full context. ~200k in / 8k out.
 *   "custom"   — read maxInputTokens/maxOutputTokens/timeoutMs explicitly.
 *
 * Within any policy, individual fields can still be overridden; the policy
 * defaults apply only to fields that are undefined.
 */
export type BudgetPolicy = 'min' | 'balanced' | 'max' | 'custom';

/** Bounded resource envelope a harness must respect. */
export interface TokenBudget {
  /** Default: "balanced". Forces "custom" if any explicit field is set without a policy. */
  policy?: BudgetPolicy;
  /** Overrides the policy default. */
  maxInputTokens?: number;
  /** Overrides the policy default. */
  maxOutputTokens?: number;
  /** Hard wall-clock timeout for the entire harness invocation. */
  timeoutMs?: number;
}

/** Concrete numbers — what evaluators and harnesses actually consume. */
export interface ResolvedBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

const POLICY_DEFAULTS: Record<Exclude<BudgetPolicy, 'custom'>, ResolvedBudget> = {
  min: { maxInputTokens: 4_000, maxOutputTokens: 1_024, timeoutMs: 30_000 },
  balanced: { maxInputTokens: 32_000, maxOutputTokens: 4_096, timeoutMs: 60_000 },
  max: { maxInputTokens: 200_000, maxOutputTokens: 8_192, timeoutMs: 180_000 },
};

/**
 * Resolve a TokenBudget to concrete numbers. Policy defaults fill any
 * undefined field; explicit fields always win. "custom" with no fields
 * specified falls back to "balanced" defaults so the harness still has
 * sensible numbers.
 */
export function resolveBudget(budget: TokenBudget = {}): ResolvedBudget {
  const policy = budget.policy ?? 'balanced';
  const base = policy === 'custom' ? POLICY_DEFAULTS.balanced : POLICY_DEFAULTS[policy];
  return {
    maxInputTokens: budget.maxInputTokens ?? base.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens ?? base.maxOutputTokens,
    timeoutMs: budget.timeoutMs ?? base.timeoutMs,
  };
}

/**
 * Per-provider context-window ceilings. Use this to clamp `max` policy at
 * what the provider actually supports — there's no point budgeting 200k for
 * a 32k-context model.
 */
export const PROVIDER_CONTEXT_WINDOWS: Record<string, number> = {
  claude: 200_000, // Claude 3.5/4 Sonnet, Haiku, Opus
  openai: 128_000, // GPT-4o / 4.1 / Codex
  opencode: 32_000, // Conservative default; user can override per-call
};

/** A chat message in a generic provider-agnostic format. */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Abstract client over codragraph's graph capabilities. Wired to the real
 * codragraph backend in Phase 1; the interface exists so harnesses don't
 * depend on whether we call MCP-stdio, HTTP, or import internals directly.
 */
export interface GraphClient {
  query(input: GraphQueryInput): Promise<GraphQueryResult>;
  context(input: GraphContextInput): Promise<GraphContextResult>;
  impact(input: GraphImpactInput): Promise<GraphImpactResult>;
}

export interface GraphQueryInput {
  query: string;
  repo?: string;
  limit?: number;
}
export interface GraphQueryResult {
  results: Array<{
    name: string;
    score: number;
    file?: string;
    snippet?: string;
  }>;
}

export interface GraphContextInput {
  name: string;
  repo?: string;
}
export interface GraphContextResult {
  name: string;
  file?: string;
  callers?: Array<{ name: string; file?: string }>;
  callees?: Array<{ name: string; file?: string }>;
  processes?: string[];
}

export interface GraphImpactInput {
  target: string;
  direction?: 'upstream' | 'downstream';
  repo?: string;
  maxDepth?: number;
}
export interface GraphImpactResult {
  target: string;
  affected: Array<{ name: string; depth: number; file?: string }>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/** Append-only structured trace recorder, persisted to the candidate's traces/ dir. */
export interface TraceWriter {
  step(name: string, payload: Record<string, unknown>): void;
  /** Flush in-memory trace buffer to disk; called by the evaluator after each task. */
  flush(): Promise<void>;
}
