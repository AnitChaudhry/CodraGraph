# How It Works — The 60-Second Tour

## Section title

**From `npx codragraph analyze` to a smarter agent in under a minute.**

## Step 1 — Index your repo

```bash
npx codragraph analyze .
```

Codragraph parses your repo with tree-sitter, walks 12 ingestion phases (parse, routes, tools, ORM, MRO, communities, processes), and persists the graph locally to `.codragraph/lbug`. **Sixteen languages. One command.** No cloud roundtrip, no source code leaves your machine.

## Step 2 — Wire your editor

```bash
npx codragraph setup
```

One command configures MCP for **Claude Code, Cursor, Codex, OpenCode** — whichever agent you use. The `codragraph_*` tools become available in your agent's tool list immediately.

## Step 3 — Ask a question

```
You: Where is validateUser called from, and what breaks if I rename it?

Agent: (uses codragraph_context + codragraph_impact under the hood)
   validateUser is defined in src/auth/user.ts
   Called from 7 sites: ...
   Renaming will break 4 d=1 callers (HIGH risk):
     - src/api/login.ts:42
     - src/api/refresh.ts:18
     - tests/auth.test.ts:103
     - src/middleware/session.ts:67
```

What used to be 32k tokens of grep slop is now 1.8k tokens of structured intelligence. The agent answers in seconds.

## Step 4 — Tune the harness (optional, advanced)

```bash
npx codragraph-harness swarm-search \
  --task ./tasks/code-review.json \
  --max-iterations 30 \
  --plateau-k 5 \
  --token-budget 5000000
```

Codragraph's three-role swarm (Explorer + Exploiter + Critic) searches for the best harness recipe for your task family. The result is a Pareto frontier — pick the recipe that fits your accuracy/cost target.

## Step 5 — Recipes get smarter over time

Every harness run is **versioned against your codebase snapshot**. Next time you run a similar task, Codragraph reuses the closest known-good recipe — no re-search required. Recipes auto-invalidate only when the relevant subgraph actually changes.

This is the moat: **your harness gets cheaper to run as your codebase stabilizes.**

## How agents call it

| Surface | Use it from |
|---|---|
| **MCP server (stdio)** | Claude Code, Cursor, OpenCode, Codex |
| **MCP over HTTP** | Hosted scenarios, cross-network |
| **HTTP API** (port 4747) | Web UI, custom dashboards |
| **CLI** | Shell pipelines, CI |
| **npm SDK** (`codragraph-sdk`) | Programmatic — your own agent / app |

```ts
import { harness, graph, compress, swarm } from "codragraph-sdk";

// Graph-aware context
const ctx = await new graph.HttpGraphClient().context({ name: "validateUser" });

// Auto-tuned harness search
const result = await swarm.swarmSearch({ tasks, ... });
```

## Designer brief

A horizontal flow diagram with 5 boxes left to right (Index → Wire → Ask → Tune → Recipes). Each box has its CLI snippet underneath. Last box has a small icon indicating "memory / versioning".
