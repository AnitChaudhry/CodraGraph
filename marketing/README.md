# Codragraph — Marketing Content

All public-facing content for the Codragraph platform. Drop these into the website CMS, social schedulers, sales decks, and onboarding docs.

## Folder layout

```
marketing/
├── website/        Section-by-section copy for the marketing site
├── use-cases/      10 deep-dive use cases — show, don't tell
└── social-media/   LinkedIn, Twitter, Instagram content
```

## Core messaging (what every piece must reinforce)

**The pitch in one line:** *Smaller models, flagship outputs — your agent gets the right 4k tokens, not the wrong 32k.*

**The four layers (always in this order):**
1. **Indexing** — graph-aware retrieval over your code (16 languages, MCP-native)
2. **Compression** — LLM-aware token compression (defensive bound, ~30–50% on context)
3. **Harness** — auto-tuned per-task context-and-prompting recipes (the agent self-improves)
4. **Versioned graph** — content-addressed snapshots; powers two distinct wins:
   - **(a) Time-travel queries** — code review, blame-aware retrieval, regression analysis
   - **(b) Recipe memory** — the moat: harness recipes tagged against codebase fingerprint

**The moat (lead with this in any deep-dive):** Codragraph **remembers what worked**. The harness doesn't re-tune from scratch every task — it bootstraps from the closest known-good recipe for your repo's current snapshot. Recipes age out only when the relevant subgraph actually changes. No competitor stacks versioning + harness this way.

**Headline numbers (use as positioning, not benchmarks):**
- **60–85% token reduction** typical for retrieval-heavy agent workflows
- Cleaner, more focused outputs from smaller models
- Haiku and GPT-5.5-mini punch above their weight — flagship-quality outputs at a fraction of cost

**Inference targets named in copy:** Claude Code, Codex, OpenCode, Cursor, Aider, plus any inference provider via SDK.

## Tone

- **Honest, not hype.** Headline claims are believable to engineers who'd actually use this. No "10× everything" marketing speak.
- **Specific over vague.** "60–85% token reduction" beats "massive savings."
- **Show the architecture.** Engineers buy when they see the diagram.
- **Acknowledge the giants.** We don't pretend Sourcegraph, Cursor, Copilot don't exist; we explain where Codragraph fits next to them.

## What to NEVER claim

- Specific benchmark numbers we haven't run (e.g. "we beat GPT-4 by X% on SWE-bench")
- That smaller models match flagship models on hard reasoning (they match on **routine code tasks with the right context**)
- Production deployments that don't exist yet
- Trademark conflicts (don't say "the only knowledge graph for code" — Sourcegraph exists)

## Status

- 2026-04-29: initial copy written
- Phases 1, 1.5, 3 shipped. Phases 4 (versioned graph), 2 (dashboard), 5 (org features) in development.
- Pre-launch — no infra exists yet. Adjust CTAs once GitHub/npm/site are live.
