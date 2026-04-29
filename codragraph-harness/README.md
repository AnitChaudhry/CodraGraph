# codragraph-harness

Auto-tuned harnesses for AI agents — Meta-Harness Algorithm 1 with Pareto search over (accuracy, tokens, latency).

Built on top of [`codragraph`](../codragraph/) MCP tools (graph-aware code intelligence) and works with any inference provider (Claude, Codex, OpenCode, OpenAI, Anthropic, Gemini, ...).

## Status

Developer preview. The package ships with single-proposer search,
multi-role swarm search (Explorer + Exploiter + Critic), versioned
recipe memory keyed on graph snapshots, and CLI / MCP entry points.

See [RFC.md](./RFC.md) for the full design.

## Concept

A **harness** is the code around a fixed base model that decides what to store, retrieve, and present at each step. Different harnesses produce different (accuracy, token-cost, latency) tradeoffs for the same task family.

`codragraph-harness search` runs an outer optimization loop:

1. Start with seed harnesses (`zero-shot`, `few-shot`, `graph-aware`).
2. Score each on a search-set of tasks → 3-vector `(accuracy, tokens, latencyMs)`.
3. An agentic **proposer** (Claude Code by default) reads the filesystem of all prior candidates' source + traces + scores and writes new harness variants.
4. Each new harness is validated, scored, added to the Pareto frontier.
5. Loop for N iterations.
6. Return the non-dominated frontier.

Reference: [Meta-Harness paper, arXiv 2603.28052](https://arxiv.org/abs/2603.28052).

## Usage (planned)

```bash
codragraph-harness search \
  --task ./tasks/codebase-qa/ \
  --seeds zero-shot,few-shot,graph-aware \
  --iterations 20 \
  --proposer claude-code \
  --output ./runs/2026-04-29/
```

```ts
import { search } from "codragraph-harness";

const frontier = await search({
  taskSet: "./tasks/codebase-qa/",
  iterations: 20,
  proposer: "claude-code",
});
```

Also exposed as a [`harness_run` MCP tool](../codragraph/) and via [`codragraph-sdk`](../codragraph-sdk/).
