# Workload 01 — Codebase Q&A

The primary benchmark workload. Tests retrieval-heavy agent behavior — precisely where Codragraph claims its biggest wins.

## What it measures

For a given (model, treatment), how accurately and how cheaply does the agent answer structural questions about a codebase?

## Source of truth

`codragraph-harness/test/fixtures/qa-test-set.json` — 105 hand-labeled tasks. Maintained as the workload's `v1`.

Each task:
```json
{
  "id": "qa-001",
  "question": "Where is the parse phase defined?",
  "expectedAnswer": "codragraph/src/core/ingestion/pipeline-phases/parse.ts",
  "acceptParaphrases": ["pipeline-phases/parse.ts"]
}
```

Mix:
- **Symbol location** ("which file defines X") — 30 tasks
- **Caller / callee tracing** ("where is Y called from") — 20 tasks
- **Architecture / config** ("what graph DB does codragraph use") — 25 tasks
- **Cross-package questions** ("which package owns the React UI") — 15 tasks
- **Language-specific MRO / call resolution** — 8 tasks
- **Build / CI / pipeline** — 7 tasks

## Target repository

The workload runs against the **codragraph monorepo itself**. We pick this for three reasons:

1. **Self-explanatory** — readers can verify answers against the visible source
2. **Realistic complexity** — 6+ packages, 16-language indexer, ~50k LOC of TS
3. **Stable in scope** — we control the answer key as the repo evolves

Ground truth is fixed at the repo SHA documented in each run's `env.json`. If the repo changes, the workload version bumps.

## Train / test split

Tasks 1–80 are the **search set** — used by the harness during `harness search` / `swarm-search` to find the best recipe.

Tasks 81–105 are the **test set** — held out, never seen by the harness during search, used only for final scoring.

This split is enforced by the bench script: when running a `codragraph-harness-tuned` or `codragraph-swarm-tuned` treatment, the harness search uses tasks 1–80; the final scores published are on tasks 81–105.

## Treatments to run

Standard sweep:

```bash
npm run benchmark -- \
  --workload codebase-qa \
  --treatments \
      baseline-grep,\
      baseline-fullfile,\
      codragraph-graph-only,\
      codragraph-graph-compress,\
      codragraph-harness-tuned,\
      codragraph-swarm-tuned,\
      codragraph-recipe-cached \
  --models <list> \
  --runs 3 \
  --output ./results/<run-id>/
```

## Scoring

Three-stage cascade per task (matches `codragraph-harness/src/evaluator/judge.ts`):

1. **Exact match** (free, deterministic)
2. **Substring / paraphrase match** (free)
3. **LLM judge** (small fast model, costs tokens but tracked separately)

A task scores `correct=true` if any stage passes.

For the judge, we use **Claude Haiku 4.5** by default — it's cheap and good at structured grading. Configure via `--judge claude-haiku` or set `JUDGE_MODEL` env var.

## Expected publishable headline

A successful run produces:

> "On the 25-task held-out test split of Codebase Q&A v1:
>  Qwen2.5-Coder-7B-Instruct (AWQ, on RTX 4090) under codragraph-swarm-tuned achieves
>  84% accuracy with mean 1,840 tokens/task and 4.2s mean latency.
>  Against baseline-grep on the same model, this is a 71% token reduction
>  with +6 pts accuracy (95% CI: [+3, +9])."

The matrix has 5 model tiers × 7 treatments. The headline picks ONE cell that best illustrates the thesis (smaller-model + treated-stack ≈ flagship-model + baseline). Other cells go in a results table.

## What this workload does NOT cover

- **Code generation** — the agent doesn't write new code in Codebase Q&A. See `02-bug-repair.md` for that.
- **Multi-step reasoning** — most tasks resolve in 1–2 graph queries. Complex reasoning tasks (e.g. "why is the build slow") are not in the set.
- **Cross-repo (group) queries** — tasks are single-repo. A future v2 may add group-mode tasks.
- **Long-context tests** — typical retrieved context is < 4k tokens. The workload doesn't stress 100k+ contexts.

For cross-coverage, run multiple workloads and report the matrix.

## Adding tasks (workload v2)

If you add new tasks, bump the workload version (`v2`). Old `v1` runs stay valid; new runs against `v2` aren't comparable to v1 numbers without rebaselining.

Process:
1. Add tasks to `qa-test-set.json` — keep old ones; only append
2. Update `version` field in the JSON
3. Bump task split (e.g., new tasks added to either set as appropriate)
4. Document changes in `Benchmarking/workloads/CHANGELOG.md`

## Time / cost per sweep

| Models | Treatments | Time (A100 80GB) | Closed-API cost |
|---|---|---|---|
| 1 model × 7 treatments × 3 runs | All | ~25 min | ~$0 (self-hosted only) |
| 5 models × 7 treatments × 3 runs | All | ~2.5 hr | $0 (open) + $5–15 (closed) |
| Full headline sweep (10 models × 7 treatments × 3 runs) | All | ~5 hr | $0 (open) + $15–40 (closed) |

These are estimates. Closed-API costs scale with model (Opus is ~5× the cost of Haiku per token).
