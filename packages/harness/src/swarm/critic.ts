// CriticRole — in-process pre-evaluation gate.
//
// The Critic reviews each proposed harness BEFORE the evaluator runs it.
// Cheap LLM call (single completion, no subprocess) that filters out:
//   - Obvious TS errors / missing exports
//   - Banned patterns (file system writes outside the candidate dir,
//     network calls to non-allowed hosts, infinite loops)
//   - Trivial mutations the proposer claimed were "novel"
//   - Code that doesn't actually implement the contract
//
// Saves evaluator cost ($) and time on bad proposals. Defaults to a
// small/fast model since the task is structured (yes/no + reason).

import type { InferenceProvider } from '../inference/interface.js';
import type { CriticReviewInput, CriticReviewResult, CriticRole } from './interface.js';

export interface CriticOptions {
  /** Inference provider for review calls. Use a small/fast model — Haiku, GPT-4o-mini, etc. */
  inference: InferenceProvider;
  /** Provider-specific model id. Default: provider's default. */
  model?: string;
  /** Free-text supplemental instructions to append to the system prompt. */
  additionalGuidance?: string;
  /** Hard timeout per review. Default 30s. */
  timeoutMs?: number;
  /** If true, treat malformed JSON output as accept (fail-open). Default false (fail-closed). */
  failOpen?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const CRITIC_SYSTEM_PROMPT = `You are the CRITIC role in a swarm of harness-proposing agents.

Your job is to review a single proposed harness BEFORE it goes to the evaluator. The evaluator is expensive (real model calls on a search-set). Your review is cheap. Reject obvious failures so the swarm spends evaluation budget on plausible candidates.

You are looking for:
- Missing default export of a Harness (must export an object with run(task, ctx) -> Promise<HarnessResult>)
- Imports of modules outside the allowed list: codragraph-harness/* and node: builtins
- File system writes outside the candidate's own directory (path.join with .., absolute paths to /etc, /tmp non-test usage)
- Network calls to non-allowed hosts (anything beyond the inference provider and codragraph graph)
- Infinite loops or unbounded recursion
- Code that ignores ctx.budget (e.g. hard-codes maxTokens above ctx.budget.maxOutputTokens)
- Trivial mutations dressed up as innovation (renamed variables, reformatted whitespace)

You are NOT trying to predict whether the harness will SCORE well. The evaluator does that. You are catching code-level failure modes only.

Reply with ONLY a JSON object on a single line:
{"accept": true|false, "reason": "<short>", "riskLevel": "NONE"|"LOW"|"MEDIUM"|"HIGH"|"BLOCK"}

riskLevel guide:
- NONE   = looks clean
- LOW    = stylistic issue, accept anyway
- MEDIUM = concerning but not blocking; accept with note
- HIGH   = likely broken at runtime; reject
- BLOCK  = security/safety violation; reject and flag for human review`;

export class LlmCriticRole implements CriticRole {
  readonly name = 'critic';
  readonly kind = 'critic' as const;

  constructor(private readonly options: CriticOptions) {}

  async review(input: CriticReviewInput): Promise<CriticReviewResult> {
    const sourceConcat = input.source.files
      .map((f) => `=== ${f.path} ===\n${f.content}`)
      .join('\n\n');

    const userMessage = [
      `Proposed harness: ${input.source.name}`,
      input.iteration ? `Iteration: ${input.iteration}` : '',
      input.source.parents && input.source.parents.length > 0
        ? `Parents: ${input.source.parents.join(', ')}`
        : '',
      '',
      'Source:',
      sourceConcat,
      '',
      input.source.rationale ? `Rationale: ${input.source.rationale}` : '',
    ]
      .filter((s) => s.length > 0)
      .join('\n');

    let raw: string;
    try {
      const result = await this.options.inference.complete({
        model: this.options.model,
        systemPrompt:
          CRITIC_SYSTEM_PROMPT +
          (this.options.additionalGuidance ? `\n\n${this.options.additionalGuidance}` : ''),
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0,
        maxTokens: 200,
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      raw = result.content;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        accept: this.options.failOpen ?? false,
        reason: `critic call failed: ${reason}`,
        riskLevel: 'MEDIUM',
      };
    }

    const parsed = parseCriticJson(raw);
    if (!parsed) {
      return {
        accept: this.options.failOpen ?? false,
        reason: 'critic returned malformed JSON; defaulting per failOpen policy',
        riskLevel: 'MEDIUM',
      };
    }
    return parsed;
  }
}

function parseCriticJson(text: string): CriticReviewResult | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Partial<CriticReviewResult>;
    if (typeof obj.accept !== 'boolean') return null;
    if (typeof obj.reason !== 'string') return null;
    const validRiskLevels: CriticReviewResult['riskLevel'][] = [
      'NONE',
      'LOW',
      'MEDIUM',
      'HIGH',
      'BLOCK',
    ];
    if (!validRiskLevels.includes(obj.riskLevel as CriticReviewResult['riskLevel'])) {
      return null;
    }
    return {
      accept: obj.accept,
      reason: obj.reason,
      riskLevel: obj.riskLevel as CriticReviewResult['riskLevel'],
    };
  } catch {
    return null;
  }
}
