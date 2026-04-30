// Treatment runners — one function per treatment, all share the same signature.
//
// A treatment takes a list of tasks and returns TaskResult[]. The function is
// responsible for: setting up the agent's tools, running the per-task loop,
// invoking the judge, accumulating tokens/latency/cost.

import { CodebaseQAEvaluator } from '@codragraph/harness/evaluator/impl';
import { scoreAnswer } from '@codragraph/harness/evaluator/judge';
import { LlmCompressor } from '@codragraph/compress/index';
import { graphAware } from '@codragraph/harness/harness/seeds/index';
import { LocalGraphClient } from '@codragraph/harness/graph/local-client';
import { resolveBudget } from '@codragraph/harness/types';
import type { InferenceProvider } from '@codragraph/harness/inference/interface';
import type { Harness, HarnessContext } from '@codragraph/harness/harness/interface';
import type { GraphClient } from '@codragraph/harness/types';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ModelSpec, TaskInput, TaskResult, TreatmentTag } from './types.js';
import { computeCost } from './pricing.js';

export interface RunTreatmentInput {
  treatment: TreatmentTag;
  model: ModelSpec;
  tasks: TaskInput[];
  workload: string;
  inference: InferenceProvider;
  judge: InferenceProvider;
  seed: number;
  repoPath: string;
  taskTimeoutMs: number;
}

export async function runTreatment(input: RunTreatmentInput): Promise<TaskResult[]> {
  switch (input.treatment) {
    case 'baseline-grep':
      return runBaselineGrep(input);
    case 'baseline-fullfile':
      return runBaselineFullFile(input);
    case 'codragraph-graph-only':
      return runWithSeedHarness(input, graphAware);
    case 'codragraph-graph-compress':
      return runGraphCompress(input);
    case 'codragraph-harness-tuned':
    case 'codragraph-swarm-tuned':
    case 'codragraph-recipe-cached':
      throw new Error(
        `Treatment ${input.treatment} requires a precomputed recipe. Run \`tsx swarm-tune.ts\` first to populate the recipe cache, then re-run with the cached recipe path. (Implementation: load the recipe's TS module from the candidate filesystem and use it as the harness in runWithLoadedHarness.)`,
      );
    default: {
      const exhaustive: never = input.treatment;
      throw new Error(`Unknown treatment: ${exhaustive as string}`);
    }
  }
}

// -- baseline: grep + read_file (no codragraph) ------------------------------
//
// We don't run a full agentic tool-use loop here (that's a large dependency).
// Instead we approximate: the model gets a system prompt that describes the
// "explore the repo" workflow + the question, plus a single round of pre-fetched
// "grep results" the model would have asked for. This matches what most
// baseline measurements in the field actually do — full agentic loops vary too
// much across frameworks to be a fair comparison.

async function runBaselineGrep(input: RunTreatmentInput): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  for (const task of input.tasks) {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let answer = '';
    let errorReason: string | undefined;
    let toolCalls = 0;

    try {
      // Simulate the tool-use round: grep the repo for keywords from the question
      const grepHits = await simulateGrep(input.repoPath, task.question);
      toolCalls = 1;

      const systemPrompt = [
        'You are a developer answering questions about a codebase.',
        'You ran `grep` with keywords from the question and got these results:',
        '',
        grepHits,
        '',
        'Use the grep results above to answer. If a result references a file, you can trust the path.',
        'Be concise. Cite file paths.',
      ].join('\n');

      const completion = await input.inference.complete({
        model: input.model.modelId,
        systemPrompt,
        messages: [{ role: 'user', content: task.question }],
        temperature: 0,
        maxTokens: 512,
        timeoutMs: input.taskTimeoutMs,
      });
      answer = completion.content.trim();
      inputTokens = completion.tokens.input;
      outputTokens = completion.tokens.output;
    } catch (err: unknown) {
      errorReason = err instanceof Error ? err.message : String(err);
    }

    const judgement = await judgeAnswer(task, answer, input.judge, errorReason);
    const latencyMs = Date.now() - startedAtMs;

    results.push({
      taskId: task.id,
      workload: input.workload,
      treatment: input.treatment,
      modelId: input.model.id,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      judgeTokens: judgement.judgeTokens,
      latencyMs,
      toolCalls,
      answer,
      expectedAnswer: task.expectedAnswer,
      correct: judgement.correct,
      judgeMethod: judgement.method,
      judgeNote: judgement.note,
      costUsd: computeCost(input.model, inputTokens, outputTokens) + judgement.judgeCostUsd,
      errorReason,
      seed: input.seed,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  }
  return results;
}

// -- baseline: full-file context -------------------------------------------

async function runBaselineFullFile(input: RunTreatmentInput): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  for (const task of input.tasks) {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let answer = '';
    let errorReason: string | undefined;

    try {
      const filesBlock = await keywordRankedFiles(input.repoPath, task.question, 32_000);
      const systemPrompt = [
        'You are a developer answering questions about a codebase.',
        'Below are the most likely-relevant files in the repo:',
        '',
        filesBlock,
        '',
        'Answer concisely. Cite file paths.',
      ].join('\n');

      const completion = await input.inference.complete({
        model: input.model.modelId,
        systemPrompt,
        messages: [{ role: 'user', content: task.question }],
        temperature: 0,
        maxTokens: 512,
        timeoutMs: input.taskTimeoutMs,
      });
      answer = completion.content.trim();
      inputTokens = completion.tokens.input;
      outputTokens = completion.tokens.output;
    } catch (err: unknown) {
      errorReason = err instanceof Error ? err.message : String(err);
    }

    const judgement = await judgeAnswer(task, answer, input.judge, errorReason);
    results.push({
      taskId: task.id,
      workload: input.workload,
      treatment: input.treatment,
      modelId: input.model.id,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      judgeTokens: judgement.judgeTokens,
      latencyMs: Date.now() - startedAtMs,
      toolCalls: 0,
      answer,
      expectedAnswer: task.expectedAnswer,
      correct: judgement.correct,
      judgeMethod: judgement.method,
      judgeNote: judgement.note,
      costUsd: computeCost(input.model, inputTokens, outputTokens) + judgement.judgeCostUsd,
      errorReason,
      seed: input.seed,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  }
  return results;
}

// -- codragraph treatments via seed harnesses ------------------------------
//
// The Phase 1 seed harnesses (zero-shot, few-shot, graph-aware) ARE the
// reference implementations of the basic codragraph treatments. We reuse them
// directly — same code path the harness search would tune.

async function runWithSeedHarness(
  input: RunTreatmentInput,
  harness: Harness,
): Promise<TaskResult[]> {
  const graph = await buildGraphClient(input.repoPath);
  const evaluator = new CodebaseQAEvaluator({ judge: input.judge });
  const tasks = input.tasks.map((t) => ({
    id: t.id,
    question: t.question,
    expectedAnswer: t.expectedAnswer,
    acceptParaphrases: t.acceptParaphrases,
    repo: t.repo ?? input.repoPath,
  }));
  const budget = resolveBudget({ policy: 'balanced' });
  const scores = await evaluator.evaluate({
    harness,
    tasks,
    graph,
    inference: input.inference,
    budget,
  });

  const results: TaskResult[] = [];
  for (const pt of scores.perTask ?? []) {
    results.push({
      taskId: pt.taskId,
      workload: input.workload,
      treatment: input.treatment,
      modelId: input.model.id,
      // Evaluator gives total tokens; we don't have input/output split for harness runs.
      // Approximation: 90% input, 10% output (typical for QA harness).
      inputTokens: Math.round(pt.tokens * 0.9),
      outputTokens: Math.round(pt.tokens * 0.1),
      totalTokens: pt.tokens,
      judgeTokens: 0, // CodebaseQAEvaluator's judge calls are baked into pt.tokens currently
      latencyMs: pt.latencyMs,
      toolCalls: 0,
      answer: pt.actualAnswer,
      expectedAnswer: pt.expectedAnswer,
      correct: pt.correct,
      judgeMethod: pt.judgeNote ? 'llm-judge' : 'substring',
      judgeNote: pt.judgeNote,
      costUsd: computeCost(input.model, Math.round(pt.tokens * 0.9), Math.round(pt.tokens * 0.1)),
      seed: input.seed,
      startedAt: new Date(Date.now() - pt.latencyMs).toISOString(),
      finishedAt: new Date().toISOString(),
    });
  }
  return results;
}

async function runGraphCompress(input: RunTreatmentInput): Promise<TaskResult[]> {
  // Build a graph-aware harness wrapped to compress retrieved context.
  const compressedGraphAware: Harness = {
    name: 'graph-aware-compressed',
    version: '1.0.0',
    origin: { kind: 'seed' },
    async run(task, ctx: HarnessContext) {
      // Run graph-aware retrieval as normal
      const graphResult = await ctx.graph.query({
        query: task.question,
        repo: task.repo,
        limit: 3,
      });
      const compressor = new LlmCompressor();
      let contextSnippets = graphResult.results
        .map((r) => `${r.name}${r.file ? ` (${r.file})` : ''}${r.snippet ? `\n${r.snippet}` : ''}`)
        .join('\n\n');
      // Compress when there's substantive context to compress
      if (contextSnippets.length > 500) {
        const compressed = await compressor.compress(contextSnippets, {
          inference: ctx.inference,
          level: 'balanced',
        });
        contextSnippets = compressed.compressed;
      }
      const startedAt = Date.now();
      const result = await ctx.inference.complete({
        systemPrompt:
          'You answer questions about a codebase. Use the compressed context below as authoritative. Cite file paths. Be concise.',
        messages: [
          {
            role: 'user',
            content: `Compressed context:\n${contextSnippets}\n\nQuestion: ${task.question}\nAnswer:`,
          },
        ],
        maxTokens: ctx.budget.maxOutputTokens,
        temperature: 0,
      });
      return {
        answer: result.content.trim(),
        tokens: result.tokens,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
  return runWithSeedHarness(input, compressedGraphAware);
}

// -- helpers ---------------------------------------------------------------

async function buildGraphClient(repoPath: string): Promise<GraphClient> {
  // Use codragraph's LocalBackend in-process. Requires the repo to have been
  // analyzed (`codragraph analyze`) before the bench runs.
  const { LocalBackend } = await import('@codragraph/cli/mcp/local/local-backend');
  const backend = new LocalBackend();
  return new LocalGraphClient({ backend, defaultRepo: repoPath });
}

interface JudgementResult {
  correct: boolean;
  method: TaskResult['judgeMethod'];
  note?: string;
  judgeTokens: number;
  judgeCostUsd: number;
}

async function judgeAnswer(
  task: TaskInput,
  answer: string,
  judge: InferenceProvider,
  harnessError?: string,
): Promise<JudgementResult> {
  if (harnessError) {
    return {
      correct: false,
      method: 'harness-error',
      note: harnessError,
      judgeTokens: 0,
      judgeCostUsd: 0,
    };
  }
  const result = await scoreAnswer(task.question, task.expectedAnswer, answer, {
    acceptParaphrases: task.acceptParaphrases,
    judge,
  });
  // scoreAnswer doesn't currently return token usage; estimate roughly when judge fired.
  // Conservative: 200 input + 50 output tokens per LLM-judge call.
  const usedJudge = result.method.startsWith('judge:');
  const judgeTokens = usedJudge ? 250 : 0;
  const judgeCostUsd = 0; // We track it but provider-specific computation is in computeCost
  return {
    correct: result.correct,
    method: usedJudge ? 'llm-judge' : result.method === 'substring' ? 'substring' : 'exact',
    note: result.note,
    judgeTokens,
    judgeCostUsd,
  };
}

// -- file-system simulation helpers ----------------------------------------

async function simulateGrep(repoPath: string, question: string): Promise<string> {
  // Cheap approximation: take the 3 most distinctive nouns from the question,
  // grep for each across .ts/.py/.md files, return up to 30 hit lines.
  const keywords = extractKeywords(question, 3);
  const hits: string[] = [];
  for (const kw of keywords) {
    const found = await grepLinesIn(repoPath, kw, 10);
    hits.push(`# grep "${kw}":`);
    hits.push(...found);
  }
  return hits.join('\n').slice(0, 6000); // cap
}

async function keywordRankedFiles(
  repoPath: string,
  question: string,
  charLimit: number,
): Promise<string> {
  const keywords = extractKeywords(question, 5);
  const allFiles = await listSourceFiles(repoPath);
  const ranked = await Promise.all(
    allFiles.slice(0, 200).map(async (f) => ({
      path: f,
      score: await scoreFileForKeywords(f, keywords),
    })),
  );
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.filter((r) => r.score > 0).slice(0, 10);
  let body = '';
  for (const t of top) {
    if (body.length > charLimit) break;
    const content = await fs.readFile(t.path, 'utf8').catch(() => '');
    body += `\n=== ${path.relative(repoPath, t.path)} ===\n${content.slice(0, 4000)}\n`;
  }
  return body.slice(0, charLimit);
}

function extractKeywords(question: string, max: number): string[] {
  const stopwords = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'what',
    'where',
    'when',
    'why',
    'how',
    'does',
    'do',
    'did',
    'would',
    'should',
    'could',
    'this',
    'that',
    'those',
    'these',
    'and',
    'or',
    'but',
    'if',
    'then',
    'of',
    'to',
    'in',
    'on',
    'at',
    'for',
    'with',
    'by',
    'from',
    'as',
    'it',
    'its',
    'be',
    'been',
  ]);
  return [
    ...new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9_./\-\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopwords.has(w)),
    ),
  ].slice(0, max);
}

async function grepLinesIn(repoPath: string, keyword: string, limit: number): Promise<string[]> {
  // Pure-JS grep — adequate for benchmark simulation, slow but predictable.
  const matches: string[] = [];
  const files = await listSourceFiles(repoPath);
  for (const f of files) {
    if (matches.length >= limit) break;
    try {
      const content = await fs.readFile(f, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= limit) break;
        if (lines[i]!.toLowerCase().includes(keyword.toLowerCase())) {
          matches.push(`${path.relative(repoPath, f)}:${i + 1}: ${lines[i]!.slice(0, 200)}`);
        }
      }
    } catch {
      /* skip unreadable */
    }
  }
  return matches;
}

async function listSourceFiles(repoPath: string): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'candidates',
    'results',
    '.codragraph',
  ]);
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(ts|tsx|js|mjs|py|md|yaml|json)$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  await walk(repoPath);
  return out;
}

async function scoreFileForKeywords(filePath: string, keywords: string[]): Promise<number> {
  try {
    const content = (await fs.readFile(filePath, 'utf8')).slice(0, 8000).toLowerCase();
    return keywords.reduce(
      (acc, kw) =>
        acc + (content.includes(kw) ? 1 : 0) + (filePath.toLowerCase().includes(kw) ? 2 : 0),
      0,
    );
  } catch {
    return 0;
  }
}
