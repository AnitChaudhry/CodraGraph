// Graph-aware seed: uses codragraph_query + codragraph_context before prompting.
//
// The thesis: graph-aware retrieval gives the model the *right* small chunk
// of context instead of forcing it to guess. Should beat zero-shot/few-shot
// on accuracy at the cost of more input tokens (the retrieved context
// adds ~500–2000 tokens per query).

import type { Harness, HarnessContext } from '../interface.js';
import type { HarnessResult, TaskInput } from '../../types.js';

/** How many top hits to fetch full context for. Tunable surface for the proposer. */
const TOP_K_QUERY_HITS = 3;
const CONTEXT_FOR_TOP_N = 1;

export const graphAware: Harness = {
  name: 'graph-aware',
  version: '1.0.0',
  origin: { kind: 'seed' },

  async run(task: TaskInput, ctx: HarnessContext): Promise<HarnessResult> {
    const startedAt = Date.now();
    ctx.trace.step('graph-aware.start', { taskId: task.id, question: task.question });

    // Step 1: hybrid BM25 + vector query.
    const queryResult = await ctx.graph.query({
      query: task.question,
      repo: task.repo,
      limit: TOP_K_QUERY_HITS,
    });
    ctx.trace.step('graph-aware.query', {
      hits: queryResult.results.map((r) => ({ name: r.name, score: r.score })),
    });

    // Step 2: full 360° context for the top hits.
    const contexts = [];
    for (const hit of queryResult.results.slice(0, CONTEXT_FOR_TOP_N)) {
      try {
        const c = await ctx.graph.context({ name: hit.name, repo: task.repo });
        contexts.push(c);
      } catch (err: unknown) {
        ctx.trace.step('graph-aware.context-error', {
          name: hit.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    ctx.trace.step('graph-aware.context', { count: contexts.length });

    // Step 3: assemble prompt.
    const contextBlock = formatContext(queryResult.results, contexts);
    const result = await ctx.inference.complete({
      systemPrompt:
        'You answer questions about a software codebase. The graph context block below is authoritative — prefer it over your priors. Cite file paths from the context. If the answer is not in the context, say so.',
      messages: [
        {
          role: 'user',
          content: `${contextBlock}\n\nQuestion: ${task.question}\nAnswer:`,
        },
      ],
      maxTokens: ctx.budget.maxOutputTokens,
      temperature: 0,
    });
    ctx.trace.step('graph-aware.complete', {
      tokens: result.tokens,
      stopReason: result.stopReason,
    });

    return {
      answer: result.content.trim(),
      tokens: result.tokens,
      latencyMs: Date.now() - startedAt,
      metadata: { hitsUsed: queryResult.results.length, contextsUsed: contexts.length },
    };
  },
};

export default graphAware;

function formatContext(
  hits: Array<{ name: string; score: number; file?: string; snippet?: string }>,
  contexts: Array<{
    name: string;
    file?: string;
    callers?: Array<{ name: string; file?: string }>;
    callees?: Array<{ name: string; file?: string }>;
  }>,
): string {
  const lines: string[] = ['=== CodraGraph context ==='];

  if (hits.length > 0) {
    lines.push('', 'Search hits:');
    for (const h of hits) {
      const file = h.file ? ` (${h.file})` : '';
      const snippet = h.snippet ? ` — ${h.snippet}` : '';
      lines.push(`  - ${h.name}${file}${snippet}`);
    }
  }

  for (const c of contexts) {
    lines.push('', `Symbol: ${c.name}${c.file ? ` (${c.file})` : ''}`);
    if (c.callers && c.callers.length > 0) {
      lines.push(
        `  Callers: ${c.callers
          .map((x) => x.name)
          .slice(0, 5)
          .join(', ')}`,
      );
    }
    if (c.callees && c.callees.length > 0) {
      lines.push(
        `  Callees: ${c.callees
          .map((x) => x.name)
          .slice(0, 5)
          .join(', ')}`,
      );
    }
  }

  lines.push('', '=== End context ===');
  return lines.join('\n');
}
