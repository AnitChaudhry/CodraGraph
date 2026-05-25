# Use Case 03 — Code Review

## The job

> "Review this PR. Find bugs, regressions, and missing test coverage."

Every team wants automated code review. Most of what ships today is shallow.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| GitHub Copilot Code Review | Reads the diff | No structural awareness — misses callers affected by API changes |
| CodeRabbit | LLM review on diff + nearby files | Misses cross-package impact; expensive context |
| Reviewable / Graphite | Workflow tooling | Helps humans, doesn't generate review |
| Custom GH Actions with Claude/GPT | DIY | Burns 50k+ tokens reading PR + grep slop; brittle |

The common weakness: reviewers (human or AI) don't see the **blast radius** of a change. A 10-line edit that touches a function called from 47 sites is not a 10-line review.

## What CodraGraph does differently

`codragraph_detect_changes` + `codragraph_impact` + the indexed graph give the reviewer:

- **The actual symbols changed**, not the diff hunks
- **Their upstream/downstream blast radius** with risk levels (LOW / MEDIUM / HIGH / CRITICAL)
- **Which execution flows are affected** (via the processes graph)
- **API shape changes** flagged separately from internal refactors
- **Test coverage gaps** — symbols touched by the diff that have no inbound `CALLS` from a test file

This is **structurally honest review**, not vibe-based.

## The before / after

**Before:** GPT-4o reviews a 200-line PR with 18 files of grep context — 45k input tokens. Flags "this looks risky" without knowing which 4 production paths actually use the changed function. ~$0.30 per PR.

**After:** CodraGraph review recipe pulls the change's blast radius first (1.2k tokens of structured impact), then asks the model to focus on the 4 highest-risk callsites. ~$0.05 per PR. Catches the regression an unrelated reviewer would miss because they wouldn't know about callsite #4.

## Why the moat matters here

PR review is **continuous**. A team ships 50–200 PRs/week. The recipe for "review this kind of change in this repo" gets perfected once and rented across every subsequent PR. Versioned recipe memory means:

- The recipe stays sharp for the team's typical change patterns.
- When the codebase undergoes a major refactor (e.g. switch from Express to Hono), the recipe age-bombs out and the harness re-tunes.
- Smaller teams using CodraGraph + Haiku ship review quality that would otherwise require Opus + manual prompt engineering.

## Sample agent output

```
Reviewing PR #1247 (8 files, 142 LOC changed).

STRUCTURAL CHANGES:
  - validateUser signature changed: now accepts (user: User, ctx: AuthCtx)
    Blast radius: 7 d=1 callers. 4 are updated in this PR. ✓
    3 NOT updated:
      - tests/auth.test.ts:103 — will fail at runtime
      - src/middleware/admin-only.ts:55 — silent type error (was: User, now expected: User+ctx)
      - docs/api.md — stale signature in code sample

  - New function: extendSession()
    Coverage: zero inbound CALLS edges from /test/. No test added.

  - Refactor: token-refresh.ts split into refresh.ts + extend.ts
    Process flow "session-renewal" updated. ✓ All 3 steps verified.

OPINIONATED VERDICT:
  HIGH: 1 untracked caller will break (admin-only.ts:55)
  MEDIUM: 1 doc out of date (api.md)
  LOW: 1 missing test (extendSession)

Suggest: block merge until admin-only.ts updated.
```

## Honest limit

CodraGraph won't catch logic bugs in code you've written for the first time — it can only see what the graph captures. For pure-reasoning bugs in greenfield code, the model still has to think. We make sure it sees what to think *about*.
