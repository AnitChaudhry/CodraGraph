# @codragraph/harness

Auto-tuned harnesses for AI agents — Meta-Harness Algorithm 1 with Pareto search over (accuracy, tokens, latency).

Built on top of [`@codragraph/cli`](../core/) MCP tools (graph-aware code intelligence and FeatureCluster context packs) and works with any inference provider (Claude, Codex, OpenCode, OpenAI, Anthropic, Gemini, ...).

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

## Usage

```bash
codragraph-harness search \
  --task ./tasks/codebase-qa/tasks.json \
  --seeds zero-shot,few-shot,graph-aware \
  --iterations 20 \
  --proposer claude-code \
  --output ./runs/2026-04-29/
```

```ts
import { search } from "@codragraph/harness";

const frontier = await search({
  taskSet: "./tasks/codebase-qa/",
  iterations: 20,
  proposer: "claude-code",
});
```

The same runtime is exposed as `harness_run`, `harness_swarm_run`, and
`harness_recipes_*` MCP tools from [`@codragraph/cli`](../core/) and via
[`@codragraph/sdk`](../sdk/).

## Package composition

Install `@codragraph/harness` when you are optimizing agent behavior over a
task family. Pair it with:

| Pair with | Why |
|---|---|
| `@codragraph/cli` | Supplies indexed repos, MCP tools, FeatureCluster packs, and graphstore snapshots |
| `@codragraph/sdk` | Provides the programmatic graph client used by custom harness runners |
| `@codragraph/compress` | Reduces prompt size when a harness loads large feature context packs |

## License

PolyForm Noncommercial License 1.0.0. You may use, modify, and redistribute
this package for noncommercial purposes only — personal projects, study,
research, and charitable, educational, or government use. Commercial use is
not permitted. See the LICENSE and NOTICE files shipped with this package.
