# Baseline Definitions

For Codragraph's claims to mean anything, the baselines have to be honest. This file documents what each baseline IS, why it's representative of how things work today, and what's deliberately equal across all treatments.

## What we hold equal across treatments

Within a (model × workload × seed) cell, ALL treatments share:

- The same underlying model + sampling config (temperature, top_p)
- The same `maxOutputTokens` ceiling
- The same per-task hard timeout
- The same scoring rules
- The same workload + same task-id ordering
- The same agent harness shell (commander, error handling, retries)

What VARIES per treatment is the **context retrieval and prompt construction strategy**. That's the variable we're measuring.

## Treatment 1 — `baseline-grep`

**What:** A standard tool-use agent loop. The model has access to filesystem tools and uses them like a developer would.

**Tools available:**
- `read_file(path: string) → string`
- `grep(pattern: string, path?: string) → list of matches`
- `list_dir(path: string) → list of entries`
- `find(name: string) → list of file paths`

**Prompt:** A reasonable system prompt explaining the available tools and that the agent should investigate before answering.

**This represents:** how Cursor, Claude Code (without MCP graph tools), Copilot Workspace, Aider, and most "agent of the week" tools work today.

**Honest comparison guard:** the prompt explicitly tells the agent to use tools efficiently. We're not gimping it with a verbose prompt that encourages random reading.

## Treatment 2 — `baseline-fullfile`

**What:** A "give the model the right files and let it answer" baseline. Approximates what someone might do with a 200k context window: dump ten potentially-relevant files into the prompt and ask.

**File selection algorithm:**
1. Compute keyword overlap between the question and each file's path + first 100 LOC
2. Rank files by overlap; take top 10 (or until total tokens ≤ 32k)
3. Drop them all into the system prompt as `=== <path> ===\n<content>` blocks
4. Ask the question

**This represents:** the "just use a big context window" objection. Anthropic and Gemini fans say "you don't need retrieval, just feed everything." This baseline is what that actually looks like.

**Why this matters:** if Codragraph doesn't beat baseline-fullfile on token efficiency, the whole pitch falls apart. We expect Codragraph to win convincingly here — graph retrieval is a much sharper signal than keyword overlap.

## Treatment 3 — `codragraph-graph-only`

**What:** Same agent shell as baseline-grep, but the toolset is `codragraph_query`, `codragraph_context`, `codragraph_impact` (and read_file for verification, no grep).

**Prompt:** Same as baseline-grep but instructs the agent to use the graph tools first.

**This isolates:** Layer 1 (graph indexing) ALONE, without compression or harness tuning.

## Treatment 4 — `codragraph-graph-compress`

**What:** Same as `codragraph-graph-only`, but the retrieved context is run through `LlmCompressor` (level: balanced) before being included in the agent's working context.

**This isolates:** Layer 1 + Layer 2.

## Treatment 5 — `codragraph-harness-tuned`

**What:** The single-proposer harness search (Phase 1's `search()`) runs over the workload's search set to find a Pareto-optimal recipe. The best-on-accuracy recipe is then evaluated on the test set.

**Key methodology constraint:**
- Harness search uses ONLY the search set, never the test set
- Final scores reported are from the test set
- Best-on-accuracy is the default; we also report best-on-tokens and best-on-balance separately

**This isolates:** Layer 1 + 2 + 3 (single-proposer).

## Treatment 6 — `codragraph-swarm-tuned`

**What:** The Phase 3 swarm search (Explorer + Exploiter + Critic) runs over the search set. Best-on-accuracy recipe evaluated on test set.

**This isolates:** Layer 1 + 2 + 3 (swarm) — the full Phase 3 picture.

## Treatment 7 — `codragraph-recipe-cached`

**What (Phase 4 only):** A previously-cached recipe is loaded from the versioned graph store and applied. NO fresh search runs in this iteration.

**Setup:** Before the benchmark, run `swarm-tuned` once to populate the cache. Then for the actual benchmark, the recipe is fetched from cache for each (workload, snapshot_id) lookup.

**This isolates:** the recipe-memory layer specifically. The cost-amortization story.

## What every treatment writes to the result

```json
{
  "taskId": "qa-001",
  "treatment": "codragraph-swarm-tuned",
  "model": "qwen-coder-7b",
  "inputTokens": 2840,
  "outputTokens": 142,
  "totalTokens": 2982,
  "judgeTokens": 86,
  "latencyMs": 4210,
  "toolCalls": 3,
  "answer": "...",
  "correct": true,
  "judgeMethod": "substring",
  "costUsd": 0.0,
  "seed": 42
}
```

## What we DON'T do (anti-pattern guard)

- ❌ **Cherry-pick treatments per task.** Every (treatment × task) cell runs uniformly.
- ❌ **Re-run failed runs without recording.** Failures stay in the dataset.
- ❌ **Use different models for the judge in different cells.** Judge is fixed per workload.
- ❌ **Tune the prompt mid-sweep.** A prompt change = a new sweep = a new tag.
- ❌ **Hide harness search cost.** Search-set evaluation tokens are reported alongside test-set numbers in the run summary.
- ❌ **Compare absolute test-set accuracy across (search-set, test-set) splits.** The split must be the same across the comparison.

## Reporting the comparisons

In the published report, the headline number is one of:

```
For (Qwen2.5-Coder-7B AWQ × codebase-qa, 25-task held-out test):
  baseline-grep:                73% accuracy, 8,120 mean tokens, $—
  codragraph-graph-only:        78% accuracy, 2,310 mean tokens, $—   (-72% tokens)
  codragraph-graph-compress:    79% accuracy, 1,840 mean tokens, $—   (-77% tokens)
  codragraph-swarm-tuned:       82% accuracy, 1,650 mean tokens, $—   (-80% tokens, +9 pts vs baseline)
  codragraph-recipe-cached:     82% accuracy, 1,650 mean tokens, $—   (same as -tuned, ~free at inference)
```

This shows incremental wins per layer, makes the trade-offs visible, and gives the reader the data to draw their own conclusions.

## Sanity-check expectations (pre-run gut feel)

If our claims are real, we expect:

- `codragraph-graph-only` to match or beat `baseline-fullfile` on accuracy with ~5–8× fewer tokens
- `codragraph-graph-compress` to add another ~25–40% token reduction with ≤1pt accuracy cost
- `codragraph-harness-tuned` to add a few accuracy points with similar tokens
- `codragraph-swarm-tuned` to beat `codragraph-harness-tuned` by 1–3 pts on hard tasks
- `codragraph-recipe-cached` to MATCH `codragraph-swarm-tuned` on inference (and have near-zero search cost — that's the point)

If the actual numbers contradict this, the report says so. The product still has value if the wins are smaller than predicted; they just have to be communicated honestly.
