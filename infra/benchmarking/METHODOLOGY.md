# Methodology

How we measure, what counts as accurate, and the statistical conventions every published number must follow.

## Definitions

### Workload

A `Workload` is a JSON-defined task set:
- A list of tasks, each with `{ id, question, expectedAnswer, acceptParaphrases?, repo }`
- A scoring function (exact match → substring → LLM judge)
- A target repository (must be indexed before the run)

Existing workloads:
1. **`codebase-qa`** — 105 hand-labeled questions about the codragraph monorepo itself (lives at `packages/harness/test/fixtures/qa-test-set.json`).
2. **`swe-bench-lite-mini`** — 50-task subset of SWE-bench-lite, scored by test-pass rate.

### Treatment

A `Treatment` is one configuration of the inference path:

| Tag | Description |
|---|---|
| `baseline-grep` | Agent loops with read_file/grep/ls/find tools. No codragraph. Standard tool-use harness. |
| `baseline-fullfile` | Agent loaded with one or more "potentially relevant" full files chosen by simple keyword match. Generous baseline. |
| `codragraph-graph-only` | Agent uses `codragraph_query`/`codragraph_context`/`codragraph_impact` MCP tools. No compression, no harness search. |
| `codragraph-graph-compress` | Same + LlmCompressor on retrieved context (level: balanced). |
| `packages/harness-tuned` | Best harness from `packages/harness search` over the workload's search-set. |
| `codragraph-swarm-tuned` | Best harness from `swarm-search` (Explorer + Exploiter + Critic). |
| `codragraph-recipe-cached` | Same recipe, but loaded from versioned graph cache (no fresh search). Phase 4 only. |

### Model

A `Model` is a pinned inference target. Required fields:
- `id` — provider model id (`gpt-4o-mini-2026-05-12`, `claude-haiku-4-5-20251001`, `Qwen/Qwen2.5-Coder-7B-Instruct`)
- `provider` — `openai` | `anthropic` | `vllm` | `ollama` | `tgi`
- `endpoint` — URL (for self-hosted) or null (for API providers)
- `quantization` — none / Q8 / Q5_K_M / Q4_K_M / AWQ / GPTQ
- `max_context` — provider/quant-specific cap

## What we measure

### Per-task

```ts
interface TaskResult {
  taskId: string;
  workload: string;
  treatment: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;          // wall-clock from request issued to first token's settled
  toolCalls: number;          // for tool-using treatments
  answer: string;
  expectedAnswer: string;
  correct: boolean;
  judgeMethod: "exact" | "substring" | "llm-judge" | "test-pass";
  costUsd: number;            // tokens × provider rate (or $0 for self-hosted)
  errorReason?: string;
  seed: number;
}
```

### Per-run (one model × one treatment × one workload, N tasks)

Aggregated over the N tasks:
- `accuracy` — `correct.count / N`
- `tokens.mean / p50 / p95 / sum`
- `latency.mean / p50 / p95`
- `cost.sum`
- `confidence interval (95%)` on accuracy via Wilson score

### Comparison metrics

- **Token reduction %** = `1 - (treatment.tokens.mean / baseline.tokens.mean)`
- **Cost ratio** = `treatment.cost.sum / baseline.cost.sum`
- **Accuracy delta** = `treatment.accuracy - baseline.accuracy` (with paired bootstrap CI)
- **Pareto plot** = `(tokens.mean, accuracy)` per (model × treatment) — show that smaller models on the codragraph stack land in the top-left of the chart

## Scoring

### Codebase Q&A (existing 105-task set)

Three-stage cascade per task (matches `packages/harness/src/evaluator/judge.ts`):

1. **Exact match** — normalized substring contains. Free.
2. **Paraphrase tolerance** — same check against `acceptParaphrases` list. Free.
3. **LLM judge** — fall through to a small-model judge (e.g. Haiku, GPT-4o-mini). JSON output: `{"correct": true|false, "note": ""}`. Cost recorded separately as `judge_cost_usd` so it doesn't pollute treatment cost.

A task scores `correct=true` if any stage returns true.

### Bug-repair (SWE-bench-lite-mini)

`correct=true` iff the test suite passes after the patch is applied. No LLM judge — pure test-pass.

## Statistical conventions

Every published comparison must include:

1. **N ≥ 30 tasks per (model, treatment).** Below 30, accuracy CIs are too wide to mean anything.
2. **3 runs minimum.** Aggregate via mean of run means. Per-run variance reported.
3. **Different seeds per run.** Seeds: 42, 1337, 8675309 (or any deterministic set; document them).
4. **95% confidence intervals** on accuracy via Wilson score interval.
5. **Paired bootstrap** for accuracy deltas (10,000 resamples). Don't use unpaired t-tests.
6. **Token cost expressed as a ratio**, not just delta. `0.4× tokens` (60% reduction) reads cleaner than `−12k tokens`.

## Anti-gimmicks

The benchmarks must NEVER:

- **Use the workload's training set as the search set for the harness.** Train/test split is enforced. The harness sees a separate `searchSet`; final numbers come from `testSet`.
- **Reuse a task in multiple treatments without resetting state.** Each treatment runs against fresh state.
- **Cherry-pick "good runs".** Report all runs; outliers stay in unless flagged with a documented reason.
- **Compare different models with different prompt budgets.** All treatments get the same `maxOutputTokens` ceiling.
- **Hide judge costs.** Judge calls are recorded separately and shown in the per-run report.
- **Adjust the prompt mid-sweep.** If the prompt changes, that's a new sweep with a new tag.

## Artifacts a benchmark run must produce

```
results/<date>-<model>-<workload>-<treatment>/
├── run.json              # full TaskResult[] + run metadata
├── summary.json          # aggregated metrics
├── traces/               # per-task trace records (for audit)
│   └── <taskId>.json
├── env.json              # captured environment (see REPRODUCIBILITY.md)
└── README.md             # human-readable summary
```

The `env.json` file is critical — it lets a third party rerun the same setup.

## Reporting templates

Located in `scripts/templates/`. Two formats:

1. **`comparison.md`** — single comparison: model X under baseline vs treatment.
2. **`sweep.md`** — full sweep: matrix of models × treatments × workloads.

## What honest reporting looks like

A passing benchmark report includes:

- Headline number ("Qwen2.5-Coder-7B with codragraph-swarm-tuned: 73% token reduction vs baseline-grep at +1pt accuracy")
- The CI bound ("95% CI: [70%, 76%] reduction")
- The losing case ("Same setup loses 2pts accuracy on the 3 hardest tasks involving cross-package reasoning")
- The cost picture ("Net cost reduction including judge: 71%")
- The honest caveat ("Recipe was tuned on tasks 1–80; tested on 81–105. Held out cleanly.")
