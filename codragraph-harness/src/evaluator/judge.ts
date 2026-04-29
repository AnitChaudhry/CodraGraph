// Two-stage scorer for codebase Q&A: substring match first, LLM-judge fallback.
//
// Exact-match is overly strict (the model may answer correctly but phrase
// it differently) and pure LLM-judge is slow and adds cost to every task.
// We normalize, do a cheap path/symbol substring check, then fall back to a
// judge model for paraphrases.

import type { InferenceProvider } from "../inference/interface.js";

export interface JudgeResult {
  correct: boolean;
  /** "exact-match" | "substring" | "judge:<model>" | "judge-error" */
  method: string;
  note?: string;
}

/**
 * Score a single answer against the expected answer.
 * Caller may supply optional accept_paraphrases — strings any of which is
 * an acceptable answer (no judge needed).
 */
export async function scoreAnswer(
  question: string,
  expected: string,
  actual: string,
  options: {
    acceptParaphrases?: string[];
    judge?: InferenceProvider;
    judgeModel?: string;
  } = {},
): Promise<JudgeResult> {
  const normActual = normalize(actual);
  const candidates = [expected, ...(options.acceptParaphrases ?? [])];

  // Stage 1: normalized exact / substring match against any accepted answer.
  for (const cand of candidates) {
    const normCand = normalize(cand);
    if (normActual === normCand) {
      return { correct: true, method: "exact-match" };
    }
    if (normActual.includes(normCand) || normCand.includes(normActual)) {
      return { correct: true, method: "substring" };
    }
  }

  // Stage 2: LLM judge (optional).
  if (!options.judge) {
    return { correct: false, method: "exact-match", note: "no judge configured" };
  }

  try {
    const result = await options.judge.complete({
      model: options.judgeModel,
      systemPrompt:
        'You are a strict but fair grader. Decide if a candidate answer is semantically equivalent to the reference for the given question. Reply with ONLY a JSON object: {"correct": true|false, "note": "<short reason>"}. Do not include any other text.',
      messages: [
        {
          role: "user",
          content: `Question: ${question}\nReference answer: ${expected}\nCandidate answer: ${actual}`,
        },
      ],
      temperature: 0,
      maxTokens: 200,
    });

    const parsed = parseJudgeJson(result.content);
    if (!parsed) {
      return { correct: false, method: "judge-error", note: "could not parse judge output" };
    }
    return {
      correct: parsed.correct,
      method: `judge:${options.judge.name}`,
      note: parsed.note,
    };
  } catch (err: unknown) {
    return {
      correct: false,
      method: "judge-error",
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\n\r\t]+/g, " ")
    .replace(/[`'"*_]/g, "")
    .trim();
}

function parseJudgeJson(s: string): { correct: boolean; note?: string } | null {
  // Tolerate code-fenced or surrounding text.
  const match = /\{[\s\S]*\}/.exec(s);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { correct?: unknown; note?: unknown };
    if (typeof obj.correct !== "boolean") return null;
    return {
      correct: obj.correct,
      note: typeof obj.note === "string" ? obj.note : undefined,
    };
  } catch {
    return null;
  }
}
