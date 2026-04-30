# Twitter / X — Launch Thread

**Format:** 8-tweet thread. Strong hook, build to the moat, end with CTA.

---

**1/8**
Your AI agent reads 30,000 tokens to answer a question that needed 4,000.

Most of those tokens are slop.

I built Codragraph to fix this. Open-sourcing it soon. Here's what it does 🧵

---

**2/8**
The standard agent loop:

→ user asks "where is X called?"
→ agent runs grep 10 times
→ pulls 12 files into context
→ flagship model wades through 32k tokens of mostly-irrelevant code
→ ~$0.16 per query

Multiply by 1000 queries/week. Quietly $$$.

---

**3/8**
Codragraph indexes your repo as a graph.

16 languages. tree-sitter. 44 node types. Local-first.

Agents call `codragraph_context(name: "X")` and get the right 1.8k tokens — callers, callees, impact, processes — typed graph data.

Same answer. ~10× fewer tokens.

---

**4/8**
But retrieval isn't enough. The next layer is auto-tuning.

Codragraph runs a swarm of 3 roles:
• Explorer (broad mutations)
• Exploiter (refinement)
• Critic (pre-eval gate)

…to find the optimal context-and-prompting recipe for each task family.

Pareto frontier on (accuracy ↑, tokens ↓, latency ↓).

---

**5/8**
Now the moat.

Each `codragraph analyze` produces a content-addressed snapshot of your knowledge graph. Dolt-like. sha256-rooted Merkle DAG.

The harness's winning recipes get tagged against that snapshot.

---

**6/8**
Next task arrives → look up the closest known-good recipe for your repo's current snapshot → reuse it if the relevant subgraph hasn't changed.

The harness pays the search cost ONCE. Recipes ride for free across thousands of runs.

Auto-invalidates only when the relevant code actually changes.

---

**7/8**
Result:

→ 60–85% fewer tokens per agent task
→ Claude Haiku producing Opus-quality outputs on routine code tasks
→ GPT-5.5-mini reading like GPT-5.5 with surgical context
→ Smaller models, flagship outputs

Works with Claude Code, Codex, Cursor, OpenCode, Aider — or any LLM via the SDK.

---

**8/8**
Open core. Local-first. BYO key.

```
npx codragraph analyze .
npx codragraph setup
```

If you're building agentic AI, this might be the layer you didn't know you needed.

DM "interested" for early access. Launching on @ProductHunt soon.

---

## Notes

- Tweet 5 is the strongest — the "moat" tweet. Keep it intact.
- Tweet 7's "60-85%" is the headline number. Keep.
- Replace `@ProductHunt` with whichever platform you actually launch on.
