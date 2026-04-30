// Zero-shot seed: direct inference call, no retrieval, no examples.
//
// This is the floor: any harness that doesn't beat zero-shot on at least one
// objective shouldn't survive to the Pareto frontier. It's also the cheapest
// (lowest tokens) — useful for the proposer to anchor "what does extra context
// cost?" comparisons.

import type { Harness, HarnessContext } from '../interface.js';
import type { HarnessResult, TaskInput } from '../../types.js';

export const zeroShot: Harness = {
  name: 'zero-shot',
  version: '1.0.0',
  origin: { kind: 'seed' },

  async run(task: TaskInput, ctx: HarnessContext): Promise<HarnessResult> {
    const startedAt = Date.now();
    ctx.trace.step('zero-shot.start', { taskId: task.id, question: task.question });

    const result = await ctx.inference.complete({
      systemPrompt:
        "You answer questions about a software codebase. Be concise. If you don't know, say so explicitly.",
      messages: [{ role: 'user', content: task.question }],
      maxTokens: ctx.budget.maxOutputTokens,
      temperature: 0,
    });

    ctx.trace.step('zero-shot.complete', {
      tokens: result.tokens,
      stopReason: result.stopReason,
    });

    return {
      answer: result.content.trim(),
      tokens: result.tokens,
      latencyMs: Date.now() - startedAt,
    };
  },
};

export default zeroShot;
