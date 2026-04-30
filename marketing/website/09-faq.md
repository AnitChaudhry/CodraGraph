# FAQ

## Section title

**Frequently asked questions.**

---

### What is Codragraph in one sentence?

**A code-aware context layer for AI agents.** It indexes your codebase as a graph, compresses retrieved context, auto-tunes per-task recipes, and remembers what worked across every commit — so your agent gets the right 4k tokens instead of the wrong 32k.

---

### How is this different from Sourcegraph?

Sourcegraph is a code search and navigation tool for humans, hosted in the cloud. Codragraph is a context layer for agents, runs locally, and includes the harness layer Sourcegraph doesn't have. They're complementary — many teams use both.

---

### How is this different from Cursor or Copilot?

Cursor and Copilot are model-tied editors. Codragraph is a model-agnostic context layer that any agent (including Cursor and Copilot, via MCP) can consume. You don't replace them; you make them smarter.

---

### Does my code leave my machine?

**No.** Indexing runs locally. The graph is stored at `.codragraph/cgdb` on your filesystem. The only network calls are the inference provider you configured (Anthropic, OpenAI, OpenCode, etc.) — and those use *your* API key on *your* terms. We never see your code or your prompts.

---

### Which languages do you support?

Sixteen: TypeScript, JavaScript, Python, Go, Rust, Java, C#, C++, C, Ruby, PHP, Swift, Kotlin, Dart, COBOL, and Markdown. Adding a language is a `LanguageProvider` implementation — community PRs welcome.

---

### Which inference providers work?

Built-in: Claude (Anthropic), OpenAI/Codex, OpenCode. Bring-your-own: implement a 3-method `InferenceProvider` interface and ship it. Most local LLM servers (Ollama, vLLM, llama.cpp server) are OpenAI-compatible and work with the OpenAI adapter.

---

### What's the catch with "60–85% token reduction"?

Three caveats:
1. **It's a typical range, not a guarantee.** Workflows that already use surgical retrieval will see less; agents that grep heavily will see more.
2. **The harness search costs tokens up front.** You're amortizing search cost across many runs. With versioned recipe memory, that amortization works automatically.
3. **Hard reasoning still needs flagship models.** We help the model find the right context, not be smarter.

---

### What is "the moat" you keep mentioning?

**Per-codebase-version recipe memory.** Each `codragraph analyze` produces a content-addressed snapshot. Each harness search produces a Pareto frontier of recipes. We tag the recipes against the snapshot. Next task: lookup the closest known-good recipe — reuse it if the relevant subgraph is unchanged, re-search if it isn't.

No competitor combines versioning + harness this way. Sourcegraph has search but no harness. LangChain has harness-ish patterns but no graph. Cursor has agents but no recipe memory. Codragraph stacks all four.

---

### Why "Codragraph" — what does it mean?

**Code + graph.** The brand was distinguished from "Codra" (a French SCADA company holding the trademark in software class 9/42) on 2026-04-29.

---

### Can I use this commercially?

Internally at your company: **yes.** Reselling Codragraph itself or hosting it as a paid service: **no, not under the open license.** Commercial license available — contact us.

---

### Where do I report issues / ask for help?

GitHub Discussions for questions, GitHub Issues for bugs. (Post-launch.)

---

### When is the hosted version available?

Phase 5 ships a managed multi-tenant version. License decision pending. Join the waitlist on the Pricing page.

---

### How do I add a new MCP tool to Codragraph?

`packages/core/src/mcp/tools.ts` declares the tool, `packages/core/src/mcp/local/local-backend.ts` dispatches it. Both are TypeScript with strict types. PR welcome.

---

### How big does my repo need to be?

Codragraph runs on repos from 100 LOC to several million. Embedding generation is opt-in and skipped for repos with > 50k nodes (a configurable cap). Chunked parsing keeps memory bounded.

---

### Does it work with monorepos?

Yes. Use **groups**: configure multiple repos in a `group.yaml`, then query with `repo: "@<groupName>"` for cross-repo impact and search.

---

### Designer brief

Accordion-style FAQ list. Top 5 questions expanded by default; rest collapsed.
