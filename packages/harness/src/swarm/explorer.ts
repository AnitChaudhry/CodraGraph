// ExplorerRole — broad mutations across the search space.
//
// The Explorer's job is *coverage*. It reads the bottom quartile of
// candidates (where the search has clearly underperformed) and the current
// Pareto frontier (so it knows what NOT to repeat), then proposes mutations
// that target unexplored corners — different retrieval strategies, prompt
// formats, scoring approaches.
//
// Implementation: wraps ClaudeCodeProposer with explorer-specific guidance
// in the prompt. Same subprocess pattern as Phase 1; differs only in what
// it asks the LLM to focus on.

import { ClaudeCodeProposer, type ClaudeCodeProposerOptions } from '../proposer/claude-code.js';
import type { Proposer } from '../proposer/interface.js';
import type { ProposingRole } from './interface.js';

export interface ExplorerOptions extends Omit<
  ClaudeCodeProposerOptions,
  'additionalGuidance' | 'proposerName' | 'iterationDirNamer'
> {
  /** Override the explorer's prompt guidance. Default: built-in EXPLORER_GUIDANCE. */
  guidance?: string;
}

const EXPLORER_GUIDANCE = `You are the EXPLORER role in a swarm of harness-proposing agents.

Your job is COVERAGE. Most candidates in the population have probably converged on similar strategies. Your value is finding strategies that NO existing candidate has tried.

Required reading order:
1. List 𝒟 sorted by accuracy ASCENDING. Read source/ + traces/ for the bottom quartile — these are the failure modes.
2. Read the Pareto frontier (top by accuracy, lowest by tokens, lowest by latency). Note what each frontier member does well.
3. Identify GAPS: dimensions of the design space (retrieval strategy, prompt structure, post-processing, error handling, tool-use vs single-shot) that are under-explored.

When proposing:
- Each candidate must target a DIFFERENT hypothesis. Don't propose two variants on the same idea.
- Lean weird. If every existing candidate uses BM25, try semantic-only or no-retrieval. If every candidate uses chat format, try a structured-output JSON harness.
- Do NOT make incremental tweaks to top performers — that's the Exploiter's job.
- Each rationale.md should explicitly name which gap you're targeting.

Quality bar: a proposal that loses on accuracy but lights up an unexplored region of the (accuracy, tokens, latency) Pareto frontier is GOOD. The Exploiter will refine winners later.`;

export class ExplorerRole implements ProposingRole {
  readonly name = 'explorer';
  readonly kind = 'explorer' as const;
  readonly proposer: Proposer;

  constructor(options: ExplorerOptions) {
    this.proposer = new ClaudeCodeProposer({
      ...options,
      additionalGuidance: options.guidance ?? EXPLORER_GUIDANCE,
      proposerName: 'explorer',
      iterationDirNamer: (i) => `iteration-${i}-explorer`,
    });
  }
}
