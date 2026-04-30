# Hero — Above the Fold

## Primary headline (pick one)

**Option A (recommended — leads with the win):**
# Smaller models. Flagship outputs.
### Your AI agent gets the right 4k tokens — not the wrong 32k.

**Option B (leads with the savings):**
# Cut 60–85% of your agent's tokens. Keep 100% of the answer.

**Option C (leads with the architecture):**
# A code-aware brain for every AI agent.
### Graph-indexed context. Auto-tuned harness. Versioned recipes.

## Subheadline

Codragraph is the missing context layer for agentic AI. It indexes your codebase as a graph, compresses what's left, auto-tunes the retrieval recipe per task, and remembers what worked across every commit. **Result: Claude Haiku punches at Opus weight. GPT-5.5-mini reads like GPT-5.5.** At a fraction of the cost.

Works with **Claude Code, Codex, OpenCode, Cursor, Aider** — or any inference provider you bring.

## Primary CTA

> **Get started in 60 seconds**
>
> ```bash
> npx codragraph analyze .
> npx codragraph setup     # wires MCP into Claude Code, Cursor, Codex
> ```

## Secondary CTA

> **Read the architecture →** *(links to How It Works)*
>
> **Star on GitHub →** *(post-launch)*

## Supporting trust strip

A row of "works with" logos:
- Claude Code · Codex · OpenCode · Cursor · Aider · MCP · OpenAI SDK · Anthropic SDK

## Hero visual (designer brief)

A single diagram, dead center. Three boxes stacked vertically with arrows:

```
   Your task ("fix this bug")
            ↓
  ┌─────────────────────────┐
  │   CODRAGRAPH            │
  │  ── 1. Graph retrieval  │   "right files, not all files"
  │  ── 2. Compression      │   "tighter context"
  │  ── 3. Harness recipe   │   "tuned for THIS task family"
  │  ── 4. Versioned memory │   "remembers what worked"
  └─────────────────────────┘
            ↓
     32k tokens → 4k tokens
            ↓
    Smaller model. Bigger output.
```

## Microcopy / hover details

- **"60–85% token reduction"** — typical range across retrieval-heavy agent workflows. Your savings depend on baseline; codebases that grep currently sees the most reduction.
- **"Smaller models punch above their weight"** — refers to routine code tasks (Q&A, refactors, bug repair) with surgical context. Flagship models still win on hard reasoning; we don't claim otherwise.
- **"Versioned recipes"** — the harness caches successful recipes against your code's structural fingerprint. Reuse across runs. Auto-invalidate when the relevant code changes.
