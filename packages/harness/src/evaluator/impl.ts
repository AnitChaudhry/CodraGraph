// Evaluator implementation: runs a Harness against a search-set, captures
// per-task traces and aggregate Scores. Lives in impl.ts so runner.ts stays a
// pure interface module.

import type { HarnessContext } from '../harness/interface.js';
import type { TaskInput } from '../types.js';
import { InMemoryTraceWriter } from '../trace.js';
import { aggregateScores, type PerTaskScore, type Scores } from './score.js';
import { scoreAnswer, type JudgeResult } from './judge.js';
import type { Evaluator, EvaluateInput } from './runner.js';
import type { InferenceProvider } from '../inference/interface.js';

export interface CodebaseQATask extends TaskInput {
  /** Expected answer string — substring or paraphrase match accepted. */
  expectedAnswer: string;
  /** Additional accepted phrasings; any match passes the substring check. */
  acceptParaphrases?: string[];
}

export interface CodebaseQAEvaluatorOptions {
  /**
   * Optional LLM judge for paraphrase detection. If omitted, scoring falls
   * back to substring-only (cheap, lossy). Best practice: pass a small model
   * here (e.g., haiku) — it'll only be called on substring-misses.
   */
  judge?: InferenceProvider;
  /** Model id passed to the judge. Default: provider's own default. */
  judgeModel?: string;
  /** Per-task hard timeout (ms). Default: 60_000. */
  taskTimeoutMs?: number;
}

const DEFAULT_TASK_TIMEOUT_MS = 60_000;

/**
 * Evaluator for the Codebase Q&A task family. Other task families (bug
 * repair, code review) will have their own Evaluator implementation; the
 * Evaluator interface stays minimal so the algorithm doesn't need to know.
 */
export class CodebaseQAEvaluator implements Evaluator {
  readonly name = 'codebase-qa';
  constructor(private readonly options: CodebaseQAEvaluatorOptions = {}) {}

  async evaluate(input: EvaluateInput): Promise<Scores> {
    const perTask: PerTaskScore[] = [];

    for (const task of input.tasks as CodebaseQATask[]) {
      const trace = new InMemoryTraceWriter();
      const ctx: HarnessContext = {
        graph: input.graph,
        inference: input.inference,
        budget: input.budget,
        trace,
      };

      const startedAt = Date.now();
      let answer = '';
      let tokens = 0;
      let runError: string | undefined;
      try {
        const result = await withTimeout(
          input.harness.run(task, ctx),
          this.options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
          `harness ${input.harness.name} exceeded ${this.options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS}ms on task ${task.id}`,
        );
        answer = result.answer;
        tokens = result.tokens.total;
      } catch (err: unknown) {
        runError = err instanceof Error ? err.message : String(err);
        trace.step('evaluator.error', { error: runError });
      }
      const latencyMs = Date.now() - startedAt;

      let judgement: JudgeResult;
      if (runError) {
        judgement = { correct: false, method: 'harness-error', note: runError };
      } else {
        judgement = await scoreAnswer(task.question, task.expectedAnswer, answer, {
          acceptParaphrases: task.acceptParaphrases,
          judge: this.options.judge,
          judgeModel: this.options.judgeModel,
        });
      }

      const score: PerTaskScore = {
        taskId: task.id,
        question: task.question,
        expectedAnswer: task.expectedAnswer,
        actualAnswer: answer,
        correct: judgement.correct,
        tokens,
        latencyMs,
        judgeNote: judgement.note,
      };
      perTask.push(score);

      input.onTaskFinished?.(task.id, {
        correct: judgement.correct,
        tokens,
        latencyMs,
      });

      if (input.onTraceFinished) {
        const record = trace.build(task.id);
        await input.onTraceFinished(record);
      }
    }

    return aggregateScores(perTask);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
