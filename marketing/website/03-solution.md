# The Solution — Four Layers, One Stack

## Section title

**CodraGraph: the context layer for agentic AI.**

## Body

CodraGraph sits between your codebase and your agent. Four layers stack on top of each other; each one multiplies the next.

---

### Layer 1 — Code-aware Indexing
**16 languages. 45 node types. 23 relationship types. One unified graph.**

CodraGraph parses your repo with tree-sitter, builds a knowledge graph (call edges, type relationships, route handlers, ORM queries, process flows), and stores it in a local LadybugDB. When your agent asks "what calls `validateUser`?", it gets a structured answer in milliseconds — not a substring scan.

> **Wins:** ~8–10× fewer tokens vs grep. Higher answer quality. No cloud roundtrip.

---

### Layer 2 — LLM-aware Compression
**Defensive bound on token cost.**

Even surgical retrieval sometimes returns more than you need. CodraGraph's compression layer (semantic, not character-based) tightens the retrieved context further while preserving meaning. It's the safety net.

> **Wins:** ~30–50% additional reduction on whatever the graph returned. Bounded worst case.

---

### Layer 3 — Auto-tuned Harness
**Your agent learns the right recipe for each task family.**

Inspired by the [Meta-Harness paper (arXiv 2603.28052)](https://arxiv.org/abs/2603.28052), CodraGraph runs a swarm of three roles — Explorer, Exploiter, Critic — that propose and test harness variants for your task type. The result: a Pareto frontier of (accuracy, tokens, latency) — pick the recipe that fits your budget.

> **Wins:** No hand-tuning. The harness finds prompts and retrieval patterns you wouldn't.

---

### Layer 4 — Versioned Graph (the moat)
**Recipe memory that ages with your code.**

Each `codragraph analyze` produces a content-addressed snapshot of your knowledge graph (Dolt-like, sha256-rooted). The harness's winning recipes are tagged against that snapshot. Next task: lookup the closest known-good recipe — reuse it if the relevant subgraph is unchanged, re-search if it isn't.

> **Wins:** Harness search amortizes across many runs. Auto-invalidation when code actually changes. **No competitor combines versioning with harness this way.**

The version graph also enables a second product line: **time-travel queries.** Code review across commits, blame-aware retrieval, regression analysis. Same graph, different workflow.

---

## The compound effect

Each layer multiplies:

```
Baseline:        100% tokens (grep + raw model)
After Layer 1:    12% tokens  (graph retrieval)
After Layer 2:     8% tokens  (compression)
After Layer 3:     6% tokens  (tuned recipe)
After Layer 4:     ~same per call, but ~free across runs (recipe memory)
```

End result: **60–85% reduction** typical, with smaller models producing flagship-quality outputs.

## What this enables

- **Run Haiku where you used to run Opus** — for routine code tasks
- **Run cheaper agents in CI** — code review, doc generation, test scaffolding
- **Build vertical agents** — once-tuned, perpetually rented across your codebase
- **Trace agent behavior across commits** — blame-aware, time-travel queries

## Designer brief

A four-layer ascending stack diagram. Each layer has its name, headline metric, and a "click for deep-dive" link. The fourth layer is highlighted differently (the moat).
