// Few-shot seed: 3 hardcoded codebase-Q&A exemplars in the system prompt.
//
// Demonstrates the format we want answers in (terse, file-path-cited). Costs
// more tokens than zero-shot per call (the exemplars are ~200 tokens) but
// typically lifts accuracy on questions the model would otherwise hallucinate.

import type { Harness, HarnessContext } from "../interface.js";
import type { HarnessResult, TaskInput } from "../../types.js";

const EXEMPLARS = [
  {
    q: "Where is the parse phase defined?",
    a: "codragraph/src/core/ingestion/pipeline-phases/parse.ts (delegates heavy work to parse-impl.ts).",
  },
  {
    q: "What does the impact MCP tool return?",
    a: "Blast radius: a list of upstream/downstream symbols affected by changing the target, each with a depth and a risk level (LOW/MEDIUM/HIGH/CRITICAL).",
  },
  {
    q: "Which package owns the React UI?",
    a: "codragraph-web/ — Vite + React + Sigma.js. Talks to the rest of the system over the codragraph serve HTTP API on port 4747.",
  },
];

const SYSTEM_PROMPT = [
  "You answer questions about a software codebase. Be concise and cite file paths when relevant. Format like the examples.",
  "",
  "Examples:",
  ...EXEMPLARS.flatMap((ex) => [`Q: ${ex.q}`, `A: ${ex.a}`, ""]),
  "If you don't know, say so explicitly rather than inventing a path.",
].join("\n");

export const fewShot: Harness = {
  name: "few-shot",
  version: "1.0.0",
  origin: { kind: "seed" },

  async run(task: TaskInput, ctx: HarnessContext): Promise<HarnessResult> {
    const startedAt = Date.now();
    ctx.trace.step("few-shot.start", { taskId: task.id, question: task.question });

    const result = await ctx.inference.complete({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Q: ${task.question}\nA:` }],
      maxTokens: ctx.budget.maxOutputTokens,
      temperature: 0,
    });

    ctx.trace.step("few-shot.complete", {
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

export default fewShot;
