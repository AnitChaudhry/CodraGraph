# RFC — packages/harness Phase 1

| Field | Value |
|---|---|
| Status | Scaffold landed (2026-04-29) |
| Phase | 1 of 5 (Harness in TS) |
| Author | Anit Chaudhary |
| Reference | [Meta-Harness paper, arXiv 2603.28052](https://arxiv.org/abs/2603.28052) |
| Approach | Scaffold first, RFC second (per AskUserQuestion 2026-04-29) |

## 1. Goals

Phase 1 establishes the foundation for capability #2 of the CodraGraph product
(dynamic harness). Specifically:

1. A **TS port of Meta-Harness Algorithm 1** that runs end-to-end on the
   Codebase Q&A task family.
2. **Four core contracts** (`Harness`, `Proposer`, `InferenceProvider`,
   `Evaluator`) with no dependence on a single LLM provider.
3. **Three seed harnesses** (`zero-shot`, `few-shot`, `graph-aware`) that
   exercise the full path through `codragraph` MCP tools.
4. **Three distribution surfaces**: CLI (`packages/harness`), MCP tool
   (`harness_run` registered in `packages/core/src/mcp/tools.ts`), and npm SDK
   re-export (`packages/sdk`).
5. **Filesystem 𝒟** persistence so the proposer can read prior candidates'
   source, traces, and scores — the paper's key insight (rich filesystem
   access vs compressed feedback).

Out of scope for Phase 1 (deferred):

- Compilation pipeline for proposer-written candidates (currently relies on
  `tsx` runtime — see §13).
- Parallel evaluation (sequential by design, for clean traces).
- Swarm / multi-proposer (Phase 3).
- Dolt-like graph storage (Phase 4).
- Codragraph-compress integration (Phase 1.5).

## 2. Package layout

```
packages/harness/
├── package.json                         npm: "packages/harness", v0.1.0
├── tsconfig.json                        ESM, strict, target ES2022
├── vitest.config.ts                     test runner config
├── README.md                            user-facing intro
├── RFC.md                               this doc
├── src/
│   ├── index.ts                         (placeholder; SDK consumes via packages/sdk)
│   ├── algorithm.ts                     Meta-Harness Algorithm 1 (search() + ProgressEvent)
│   ├── filesystem.ts                    CandidateStore (filesystem 𝒟)
│   ├── pareto.ts                        ParetoFrontier (3-objective)
│   ├── trace.ts                         InMemoryTraceWriter
│   ├── types.ts                         shared types (TaskInput, GraphClient, …)
│   ├── harness/
│   │   ├── interface.ts                 Harness, HarnessContext, HarnessOrigin
│   │   └── seeds/
│   │       ├── zero-shot.ts
│   │       ├── few-shot.ts
│   │       ├── graph-aware.ts
│   │       └── index.ts                 ALL_SEEDS, SEEDS_BY_NAME
│   ├── proposer/
│   │   ├── interface.ts                 Proposer, ProposeInput, HarnessSource
│   │   └── claude-code.ts               ClaudeCodeProposer (subprocess)
│   ├── inference/
│   │   ├── interface.ts                 InferenceProvider, CompletionInput, ToolCall
│   │   ├── claude.ts                    ClaudeInferenceProvider (Anthropic SDK)
│   │   ├── openai.ts                    OpenAIInferenceProvider (Codex)
│   │   ├── opencode.ts                  OpenCodeInferenceProvider (OpenAI-compat)
│   │   └── index.ts                     makeInferenceProvider("claude" | "openai" | "opencode")
│   ├── evaluator/
│   │   ├── runner.ts                    Evaluator interface, EvaluateInput
│   │   ├── score.ts                     Scores, PerTaskScore, aggregateScores
│   │   ├── judge.ts                     scoreAnswer (substring + LLM-judge)
│   │   └── impl.ts                      CodebaseQAEvaluator
│   ├── graph/
│   │   └── http-client.ts               HttpGraphClient (codragraph serve over REST)
│   ├── mcp/
│   │   └── handler.ts                   handleHarnessRun (consumed by codragraph MCP)
│   └── cli/
│       └── main.ts                      bin/packages/harness
└── test/
    ├── filesystem.test.ts               vitest, hits real fs in tmp dir
    ├── pareto.test.ts                   pure unit tests
    └── fixtures/
        └── qa-test-set.json             30 hand-labeled Q&A tasks
```

## 3. Contracts

### 3.1 Harness

```ts
interface Harness {
  readonly name: string;
  readonly version: string;
  readonly origin: HarnessOrigin;
  run(task: TaskInput, ctx: HarnessContext): Promise<HarnessResult>;
}
```

`HarnessOrigin` discriminates `seed` vs `proposer`. The proposer-origin
variant carries `proposer`, `iteration`, and optional `parents` so the
search can reconstruct lineage from the filesystem alone.

`HarnessContext` carries the four resources every harness needs:
`graph`, `inference`, `budget`, `trace`. Harnesses **must** pull all
externals from `ctx` rather than importing concrete modules — this is
what makes `--inference openai|claude|opencode` cheap.

### 3.2 Proposer

```ts
interface Proposer {
  readonly name: string;
  propose(input: ProposeInput): Promise<HarnessSource[]>;
}
```

`ProposeInput` carries the live `CandidateStore` (filesystem 𝒟) — not a
compressed summary. This mirrors the paper's emphasis on filesystem access
(median 82 files read per iteration, 10M-token contexts).

### 3.3 InferenceProvider

```ts
interface InferenceProvider {
  readonly name: string;
  complete(input: CompletionInput): Promise<CompletionResult>;
}
```

`CompletionInput` is provider-neutral: `messages`, optional `systemPrompt`,
`tools`, `temperature`, `maxTokens`, `timeoutMs`. `CompletionResult`
includes a normalized `tokens: { input, output, total }` for the
evaluator's token-cost objective.

### 3.4 Evaluator

```ts
interface Evaluator {
  readonly name: string;
  evaluate(input: EvaluateInput): Promise<Scores>;
}
```

`EvaluateInput` is the closure of resources needed to run a harness on a
batch of tasks plus optional callbacks (`onTraceFinished`,
`onTaskFinished`) the algorithm uses to persist artifacts.

## 4. Algorithm 1 mapping

Faithful to arXiv 2603.28052 §3 / Algorithm 1:

```
Input: tasks 𝒳, frozen LLM M, proposer P, iterations N
Init:  population ℋ ← {seed harnesses}, filesystem 𝒟 ← ∅

for H ∈ ℋ:                                          ← Step 1: evaluate seeds
    𝒟 ← 𝒟 ∪ {(H, Evaluate(H, M, 𝒳))}

for t = 1..N:                                       ← Step 2: outer loop
    P queries 𝒟              # CandidateStore on disk
    {H_1..H_k} ← P.propose() # ClaudeCodeProposer subprocess
    for H_i:
        if H_i passes interface validation:
            𝒟 ← 𝒟 ∪ {(H_i, Evaluate(H_i, M, 𝒳))}

return Pareto frontier of 𝒟                         ← Step 3
```

TS implementation: `src/algorithm.ts` `search(options): Promise<SearchResult>`.
Sequential by design (one candidate at a time) so traces stay clean for
the proposer. Parallel evaluation deferred to Phase 3 (swarm).

`onProgress(event)` emits seven event types covering init,
seed-evaluated, iteration-start, candidate-proposed, candidate-rejected,
candidate-evaluated, complete — the dashboard (Phase 2) consumes these.

## 5. Filesystem 𝒟 layout

Per candidate:

```
candidates/<id>/
├── source/                    # TS source files (proposer-writable)
│   ├── index.ts               # default-export of Harness
│   └── ...                    # optional helper files
├── traces/                    # one JSON file per evaluated task
│   └── <taskId>.json          # { taskId, steps, startedAt, finishedAt }
├── score.json                 # aggregate Scores
├── metadata.json              # CandidateMetadata (id, name, origin, parents, createdAt)
└── rationale.md               # proposer's natural-language explanation (proposer origin only)
```

`<id>` format: `NNN_<sanitized-name>` — zero-padded sequence + safe-chars
name, e.g. `001_few-shot`, `004_proposer-002_graph-aware-rerank`. Sortable
by insertion order, human-readable.

`CandidateStore.addCandidate()` is atomic per candidate dir. Traces
written incrementally as the evaluator processes tasks. Scores written
after the full batch aggregates.

## 6. Pareto definition

Three objectives:

| Objective | Direction | Source |
|---|---|---|
| `accuracy` | maximize | mean correctness over search-set |
| `tokens` | minimize | mean total input+output tokens per task |
| `latencyMs` | minimize | mean wall-clock per task |

Strict domination: `a` dominates `b` iff `a` is at least as good on all
three AND strictly better on at least one. Equal points (identical on all
three axes) coexist on the frontier.

`ParetoFrontier.add()` returns `{ added: boolean, removed: ParetoPoint[] }` —
the algorithm uses this so the dashboard can animate frontier changes.

## 7. Proposer protocol (Claude Code subprocess)

`ClaudeCodeProposer.propose()`:

1. Build a prompt referencing:
   - Contract path (`src/harness/interface.ts`)
   - Candidate store root (read-only filesystem 𝒟)
   - Proposal output dir (write-only, this iteration's)
   - Recommended reading order: top-3 by accuracy + bottom-1
   - Required output: subdirectories under proposal dir, each with
     `index.ts` + `rationale.md`
   - Manifest signal: `<<<HARNESS_MANIFEST>>>{json}<<<END_HARNESS_MANIFEST>>>`
     to stdout
2. Spawn `claude -p --dangerously-skip-permissions "<prompt>"`
3. Wait for exit (default 10 min timeout)
4. Read the proposal directory; each subdirectory becomes a `HarnessSource`
5. Return `HarnessSource[]`

The proposer handler is **out-of-process**: packages/harness exposes
`handleHarnessRun()` from `src/mcp/handler.ts`, and codragraph's MCP
server (in `packages/core/src/mcp/local/` per their dispatch pattern) is
expected to import and route the `harness_run` tool to it. This avoids
making packages/harness a hard runtime dep of codragraph.

**TODO:** Add the actual handler dispatch wiring in
`packages/core/src/mcp/local/`. Currently `tools.ts` declares the tool but
the dispatcher needs an import + case statement. Tracked as a Phase 1
follow-up (§13).

## 8. Scoring (Codebase Q&A)

`CodebaseQAEvaluator` (src/evaluator/impl.ts) for each task:

1. Construct `HarnessContext` (graph, inference, budget, fresh
   `InMemoryTraceWriter`).
2. Race `harness.run(task, ctx)` against a per-task timeout (default 60s).
3. On success: score the answer via `scoreAnswer()`:
   - **Stage 1** — normalized substring match against the expected
     answer or any `acceptParaphrases`. Cheap, deterministic.
   - **Stage 2 (optional)** — LLM judge fallback (any `InferenceProvider`).
     Strict JSON output: `{"correct": bool, "note": "..."}`.
4. On harness error or timeout: mark incorrect, record the error in the
   trace.
5. Build `PerTaskScore`, push the trace via `onTraceFinished`.

`aggregateScores()` is mean-aggregated across the batch. Heterogeneous
search-sets (mixed difficulty) need weighted aggregation in a later
phase — flagged in §13.

## 9. CLI surface

```bash
packages/harness search \
  --task ./test/fixtures/qa-test-set.json \
  --seeds zero-shot,few-shot,graph-aware \
  --iterations 20 \
  --candidates-per-iteration 2 \
  --proposer claude-code \
  --inference claude \
  --judge claude \
  --graph-url http://localhost:4747 \
  --output ./runs/2026-04-29-qa/
```

Also: `packages/harness list-runs`, `packages/harness show <runDir>`.

The CLI emits progress events to stderr; final summary includes the Pareto
frontier table. JSON output mode flagged for the dashboard integration.

## 10. MCP surface

`harness_run` tool added to `CODRAGRAPH_TOOLS` in
`packages/core/src/mcp/tools.ts`. Inputs:

| Field | Type | Default | Notes |
|---|---|---|---|
| `task` | string (path) | — required | task-set JSON file |
| `iterations` | number | 20 | Outer-loop N |
| `candidates_per_iteration` | number | 2 | k |
| `proposer` | enum | `"claude-code"` | (only one in Phase 1) |
| `inference` | enum | `"claude"` | claude / openai / opencode |
| `seeds` | string | `"all"` | comma-list or "all" |
| `output` | string | auto | run dir |
| `repo` | string | — | passed to graph tools |

Output: `{ runId, runDir, totalEvaluated, totalRejected, paretoFrontier }`.

Implementation: `packages/harness/src/mcp/handler.ts:handleHarnessRun`.

## 11. SDK surface (packages/sdk)

```ts
import { harness, graph } from "packages/sdk";

await harness.search({ ... });
new graph.HttpGraphClient({ ... });
```

Or sub-namespaced: `packages/sdk/harness`, `packages/sdk/graph`.

Compression namespace lands in Phase 1.5. Today the SDK is a thin
re-export of packages/harness's public surface plus the HTTP graph
client.

## 12. Decisions & rationale

| Decision | Why |
|---|---|
| Sequential outer loop | Clean traces for proposer reasoning; parallelism is Phase 3 |
| Filesystem 𝒟 not DB | Proposer reads via grep/cat; matches paper |
| Claude Code subprocess | Paper's exact pattern (their claude_wrapper.py) |
| `tsx` for candidate loading | Avoid a per-candidate compile step in Phase 1 |
| OpenAI SDK for OpenCode | OpenCode is OpenAI-compatible; one less adapter |
| Pareto, not scalarized score | User explicitly wants accuracy/tokens/latency as 3 headlines |
| Substring + judge scoring | Substring is free and accurate for path/symbol questions; judge handles paraphrases |
| Out-of-process MCP handler | packages/harness depends on codragraph, not the reverse |
| All `codragraph-*` packages Apache-2.0 | Inherits monorepo license; permissive OSS unblocks SaaS / org-tier features |

## 13. Open follow-ups

Tracked, not blockers for Phase 1 sign-off.

1. **Wire `harness_run` handler dispatch** in `packages/core/src/mcp/local/` (the
   codragraph MCP server's case statement). Currently the tool is declared
   but the dispatcher needs to import `handleHarnessRun` and route to it.
2. **Compile candidates before evaluation** — Phase 1 relies on the host
   CLI being run under tsx. Production: add an esbuild step that produces
   a sibling `index.js` per candidate before `loadCandidate()`.
3. **Validate proposer output** — currently `loadCandidate` is the only
   gate. Add a syntactic check (TS parse) before persisting to 𝒟 so we
   catch malformed proposer output earlier and report a richer rejection
   reason.
4. **Real graph wire-up** — `HttpGraphClient` assumes `codragraph serve`
   exposes `/api/query`, `/api/context`, `/api/impact` over POST. Confirm
   against codragraph's actual API shape and adjust.
5. **Heterogeneous search-set scoring** — current aggregator is mean.
   Hard tasks should get higher weight; needs a `difficulty` field in the
   task JSON.
6. **Codebase Q&A test set growth** — 30 tasks is the floor; target 100+
   before publishing benchmark numbers. Mix in cross-package, recursive
   reasoning, and "what breaks if X" questions.
7. ~~**License gate**~~ — RESOLVED 2026-04-29. Monorepo relicensed to
   Apache-2.0; Phase 5 (org features) is unblocked.

## 14. Phase order

| Phase | Scope | Status |
|---|---|---|
| 1 | Harness in TS (this RFC) | Scaffold landed |
| 1.5 | Port `packages/compress` to TS | Pending |
| 2 | Dashboard MVP in `apps/web` | Pending |
| 3 | Swarm — multiple proposers in parallel | Pending |
| 4 | Dolt-like versioned graph (research) | Pending |
| 5 | Org features (multi-tenant, SSO, audit) | Scaffold landed 2026-04-29 — see packages/org/RFC.md |
