# Workload 02 — Bug Repair (SWE-bench-lite-mini)

The hard workload. Test-pass-or-fail signal. Where CodraGraph's harness layer earns its rent.

## What it measures

For a given (model, treatment), how often does the agent produce a patch that:
1. Modifies the right files
2. Makes the failing test pass
3. Doesn't break previously-passing tests

## Source of truth

We use a 50-task subset of SWE-bench-lite called `swe-bench-lite-mini-v1`. Tasks are from real Python repos (Django, Sympy, Flask, Pylint) with:
- A failing test
- A reference patch
- A grading harness (apply patch, run pytest, check if specified tests pass)

## Why a 50-task subset

Full SWE-bench is 2,294 tasks. Lite is 300 tasks. Even 300 takes ~12 hours to run on cloud GPU per (model × treatment × 3 runs). For headline numbers, 50 representative tasks at 3 runs gives meaningful signal at ~2 hours per cell.

The subset is curated to span the same difficulty distribution as full SWE-bench-lite. Selection criteria:
- 10 from each of the 5 most-represented repos
- Stratified by patch-size quartile
- Filtered out tasks that require non-Python file edits (markdown, config-only)
- Filtered out tasks where the test setup itself is broken

The exact task list lives at `infra/benchmarking/workloads/swe-bench-lite-mini-v1.json`.

## Scoring

`correct=true` iff:
1. The patch applies cleanly
2. ALL specified `FAIL_TO_PASS` tests pass after the patch
3. NO `PASS_TO_PASS` tests regress

This is binary per task. No partial credit, no LLM judge needed — pytest is ground truth.

## Treatments to run

Same set as Codebase Q&A:

- `baseline-grep` — Cursor-style: model + read_file/grep tools, no codragraph
- `baseline-fullfile` — model + relevant files dropped in context
- `codragraph-graph-only` — codragraph_query/context/impact MCP tools
- `codragraph-graph-compress` — + LLM-aware compression
- `packages/harness-tuned` — best harness from `harness search` on bug-repair search set
- `codragraph-swarm-tuned` — best harness from `swarm-search` (3-role)
- `codragraph-recipe-cached` — same recipe, loaded from versioned graph cache (Phase 4 only)

## Train / test split

50 tasks, split:
- **Search set**: 35 tasks (the harness uses these to find a recipe)
- **Test set**: 15 tasks (held out for final score)

The split is by repo to prevent within-repo leakage:
- Search: Django, Sympy, Flask, Pylint
- Test: Django (different submodule), Sympy (different submodule), Astropy, Sphinx

Same repo families on both sides, but different submodules — close enough to be valid generalization, far enough that the harness can't memorize.

## What "correct" looks like

A successful agent produces a patch like:

```diff
--- a/src/django/db/models/base.py
+++ b/src/django/db/models/base.py
@@ -502,7 +502,7 @@ class Model:
     def save_base(self, raw=False, force_insert=False, force_update=False, ...):
         ...
-        if not raw and not self._state.adding:
+        if not raw and not self._state.adding and self.pk is not None:
             ...
```

The grading harness applies this and runs:
```bash
pytest tests/queries/test_bulk_update.py::test_save_with_pk_none
```

If exit code 0 and the previous passing tests still pass, score = 1.

## Expected publishable headline

A successful run produces:

> "On the 15-task held-out test split of swe-bench-lite-mini v1:
>  Qwen2.5-Coder-32B-Instruct (AWQ, on A100-40) under codragraph-swarm-tuned achieves
>  44% test-pass with mean 12.3k tokens/task and 32s mean latency.
>  Against baseline-grep on Claude Sonnet 4.6, codragraph-swarm-tuned scores 6 pts higher
>  at 1/8th the cost."

The interesting publishable comparisons are:
1. **Same model, different treatments** — shows codragraph payoff
2. **Smaller model + treated vs flagship + baseline** — shows the "smaller models flagship outputs" thesis on a hard benchmark

## Time / cost per sweep

Bug repair is much heavier than Codebase Q&A:

| Sweep | Time (A100 80GB) | Closed-API cost |
|---|---|---|
| 1 model × 7 treatments × 3 runs (× 50 tasks) | ~3.5 hr | ~$0 (self-hosted) |
| 5 models × 7 treatments × 3 runs | ~17 hr | ~$30–80 closed |
| Full headline sweep (10 models) | ~30 hr | ~$60–150 closed |

For cost reasons, the published bug-repair sweep typically uses fewer models (3–5 instead of 10).

## Setup requirements

Bug repair needs an isolated execution environment per task. Each task:
1. Gets a fresh clone of the target repo at the bug commit
2. Has its dependencies installed (pip install)
3. Runs pytest after the agent's patch is applied

This must run in a sandboxed container so a bad patch can't escape. We use Docker with no network access and a 2-minute per-task timeout.

```yaml
# infra/benchmarking/docker/swe-bench-runner.yaml (excerpt)
services:
  swe-runner:
    image: python:3.11-slim
    network_mode: none      # patches can't exfiltrate
    cpus: 2
    mem_limit: 4g
    cap_drop: [ALL]
```

The `scripts/run-bug-repair.ts` script orchestrates:
1. Pull the task definition
2. Spin up a fresh sandbox container for the target repo state
3. Send the task to the agent (via codragraph MCP or via baseline grep tools)
4. Capture the agent's patch
5. Apply patch, run pytest in the sandbox
6. Record pass/fail
7. Tear down the sandbox

## Sandboxing limits

- **Network: disabled.** Agents can't download packages mid-task. All dependencies must be installable from the task's frozen state.
- **Filesystem: scoped to /workspace.** Patches outside this path are rejected.
- **Time: 2 min per task.** Hard kill after 2 minutes; task scores 0.
- **Memory: 4 GB.** Most SWE-bench-lite tasks fit; if not, document.

## Honest limits

- Bug repair is HARD. Even GPT-4o + a state-of-the-art harness gets ~30–40% on full SWE-bench-lite. Don't expect 90%.
- The cost of "wrong patches that pass tests anyway" is real — patches that hack around the test rather than fixing the underlying bug will score `correct=true` here. Manual spot-check of high-scoring runs is recommended.
- The 50-task subset is statistically valid for "is treatment X better than treatment Y" comparisons but not for absolute claims. Reports should say "on swe-bench-lite-mini v1", not "on SWE-bench."
