# Comparison — How CodraGraph fits next to existing tools

## Section title

**You don't need to throw out your stack. Here's where CodraGraph plugs in.**

## Honest positioning

CodraGraph isn't trying to replace Sourcegraph, Cursor, Copilot, or Claude Code. It augments them. Each existing tool does something well; CodraGraph adds the layer they don't.

---

### vs. Sourcegraph / Cody
**Sourcegraph wins on:** team-scale code search, hosted UI, polished cross-repo browsing.
**CodraGraph wins on:** local-first execution (no source upload), auto-tuned harness (Sourcegraph has no equivalent), MCP-native integration with agentic editors, versioned recipe memory.

**When to use both:** Sourcegraph for human navigation, CodraGraph for agent-side context. They don't conflict.

---

### vs. Cursor / Copilot Chat
**Cursor/Copilot win on:** beautiful UX, integrated chat surface, model-tied polish.
**CodraGraph wins on:** model-agnostic (use whichever LLM you want), structural retrieval (not substring), recipe memory across sessions, works in CLI/CI/server contexts that Cursor and Copilot don't reach.

**When to use both:** Cursor as your editor, CodraGraph as the context layer Cursor's agent calls.

---

### vs. Aider
**Aider wins on:** clean CLI UX for solo developers, simple model.
**CodraGraph wins on:** structural code intelligence (Aider relies on whole-file context), versioned recipe memory, multi-language indexing (Aider relies on the model's own knowledge).

**When to use both:** Aider for the editing loop, CodraGraph for the retrieval that feeds it.

---

### vs. LangChain / LlamaIndex
**LangChain/LlamaIndex win on:** general-purpose RAG over arbitrary documents, broad ecosystem.
**CodraGraph wins on:** code is not documents — it has structure (calls, types, modules). Generic RAG misses the structural relationships that matter for code tasks. Plus: harness auto-tuning, recipe memory, MCP-native.

**When to use both:** LangChain for non-code RAG, CodraGraph for code RAG.

---

### vs. raw Claude / GPT with big context windows
**Big context wins on:** simplicity, no infra.
**CodraGraph wins on:** even with 200k context, agents can't *find* the right 4k. CodraGraph picks them. Cost: ~10× cheaper at the same accuracy. Quality: smaller models with surgical context match flagship models with grep slop on routine code tasks.

---

### vs. LLMLingua / Selective Context (compression-only tools)
**LLMLingua wins on:** model-agnostic compression algorithm research.
**CodraGraph wins on:** compression is one of four layers. Compression alone gets you ~30%; the stack gets you 60–85%. Plus the harness auto-tunes the *whole* pipeline, not just compression.

---

### vs. building your own (LangGraph / OpenAI Swarm + custom retrieval)
**Building your own wins on:** total control.
**CodraGraph wins on:** months of work compressed into one `npm install`. The harness contracts, role definitions, termination predicates, versioned recipe memory — all already designed and tested. Bring your differentiation, not your plumbing.

---

## Honest limits

- **Hard reasoning still needs flagship models.** CodraGraph helps the model find the right context — it doesn't make Haiku as smart as Opus on novel multi-step problems.
- **Phase 4 (versioned graph) is in development.** Recipe memory ships in the next release.
- **No SaaS yet.** Pre-launch, BYO infra. The OSS stays Apache-2.0; the hosted version (Phase 5) adds managed service terms and team operations.
- **The harness auto-search costs money.** Spending $50–200 to find a great recipe is worth it ONLY if the recipe is reused thousands of times — which is exactly what versioned recipe memory enables. Without it, the math is murky.

## Visual brief

A 2D positioning chart. X-axis: "code-aware ↔ generic". Y-axis: "agent-augmenting ↔ standalone tool". Plot CodraGraph in upper-right (code-aware + agent-augmenting). Other tools scatter: Sourcegraph (code-aware, mostly standalone), Cursor (less code-aware, agent-tied to one model), LangChain (generic, agent-augmenting).
