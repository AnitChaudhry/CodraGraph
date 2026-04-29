# Use Case 01 — Codebase Q&A

## The job

> "Where is `validateUser` called from, and what would break if I changed its signature?"

Every developer asks variants of this every day. Every agent answers it badly today.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| `grep` / `ripgrep` | Substring match | Misses indirect refs, no impact analysis, false positives |
| Cursor / Copilot Chat | Reads chunks of files | Limited to open files; no graph; expensive flagship-model context |
| Sourcegraph | Cross-repo search | Cloud roundtrip, requires upload, weak agent integration |
| Claude Code (no MCP) | Runs grep itself | Burns 30k tokens on slop, sometimes wrong |

## What Codragraph does differently

`codragraph_query` + `codragraph_context` + `codragraph_impact` — three structured calls, ~1.8k tokens of typed graph data:

```
validateUser is defined in src/auth/user.ts (Function, line 42)

Called from 7 sites (depth=1):
  src/api/login.ts:42 (CALLS, confidence 0.95)
  src/api/refresh.ts:18 (CALLS, confidence 0.95)
  src/middleware/session.ts:67 (CALLS, confidence 0.9)
  tests/auth.test.ts:103 (CALLS, confidence 1.0)
  ...

Impact of signature change (upstream depth=1, HIGH risk):
  4 caller sites in 3 files will need updates.
  2 of those are in production paths (src/api/*).
  1 is in test fixtures.

Participates in 3 execution flows: login, token-refresh, session-validation.
```

That's all the model needs. Smaller models read this fine; flagship models read it instantly.

## The before / after

**Before Codragraph:** GPT-4o reads 12 files via grep, 32k input tokens, 90 seconds, $0.16, sometimes misses an indirect reference. Smaller models like Haiku get confused by the volume.

**After Codragraph:** GPT-4o-mini gets a 1.8k structured response, 4 seconds, $0.005, deterministic. Same answer.

## Why the moat matters here

When the user asks the same kind of question again next week — "where is `refreshToken` called from?" — Codragraph **already has a recipe** tagged against your repo's current snapshot for symbol-impact questions. It reuses that recipe. No re-search, no re-thinking. The first question paid for the recipe; the next thousand questions ride it for free.

Recipes auto-invalidate only when the relevant subgraph changes — which means stable parts of your codebase get cheaper to query over time.

## Sample agent prompt (Claude Code, MCP-wired)

```
You: Trace every callsite of validateUser, then tell me which renames are safe.

Claude (using codragraph_context + codragraph_impact):
   validateUser has 7 direct callers across 5 files.
   Safe renames (renaming covered by codragraph_rename):
     - all 7 sites can be updated atomically.
   Unsafe references (potential string-only matches):
     - 1 occurrence in docs/api.md (markdown reference)
     - 0 dynamic dispatch / reflection patterns detected
   Suggest: codragraph_rename with dry_run=true to preview.
```

## Time-to-value

Install Codragraph → answer your first impact question in < 5 minutes. Save 80% of token cost on the next thousand.
