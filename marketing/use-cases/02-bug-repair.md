# Use Case 02 — Bug Repair (Test-Driven)

## The job

> "This test is failing. Find and fix the bug."

The benchmark task. SWE-bench territory. Every agent vendor wants to be best at this.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| Cursor agent | Runs grep, reads files, edits | Often pulls 50k+ tokens of context; flagship-model dependent |
| Aider | Whole-file context with the model | Token-bloated for medium codebases; no impact awareness |
| Claude Code | Same MCP loop | Without graph tools, falls back to grep — burns context fast |
| Devin / Cognition | End-to-end agent | Cloud, expensive, opaque |
| Hand-coded SWE-bench harnesses | Task-tuned, repo-specific | Brittle; rebuilt per repo |

## What CodraGraph does differently

The harness layer is **made for this**. The bug-repair task family has a ready-made pipeline:

1. **Triage** — `codragraph_query` on the failing test name and error message → 3–8 candidate symbols
2. **Context** — `codragraph_context` on each candidate → callers, callees, processes
3. **Impact** — `codragraph_impact` on the suspected root → understand blast radius before editing
4. **Edit** — proposed minimal diff
5. **Re-run test** — pass / fail signal closes the loop

The auto-tuned harness (Phase 3 swarm) finds the right counts — how many candidates to triage, how deep to go on context, when to stop investigating and start editing — for *your* codebase. Not a generic SWE-bench recipe; your recipe.

## The before / after

**Before:** Cursor pulls 12 open files plus grep matches into 60k tokens, runs a flagship model, edits, sometimes fixes, sometimes breaks an unrelated test. ~$1.50 per attempt.

**After:** CodraGraph harness runs the recipe — 5–8k tokens of surgically retrieved context, smaller model proposes edit, impact analysis runs first, broken-elsewhere risk surfaced before commit. ~$0.10 per attempt.

## Why the moat matters here

Bug repair is the **highest-leverage use case for recipe memory**. Once the harness finds the winning recipe for your repo's bug-repair flow, it gets reused on every subsequent failing test. The recipe survives across hundreds of bug fixes, only invalidating when the codebase's structural patterns shift (new framework, major refactor).

Real example: imagine your repo has 200 failing-test debugging sessions per quarter. The harness search costs $80 once. Recipe memory means runs 2–200 are *free* (just inference cost). Without versioning, you'd burn $80 every analyze cycle. With versioning: amortized to ~$0.40/run.

## Sample agent prompt

```
You: tests/auth.test.ts::it("rejects expired tokens") is failing.
     Stack trace: TypeError: Cannot read property 'exp' of undefined at line 47.
     Fix it.

Claude (using harness_run with the bug-repair recipe):
   Triage: codragraph_query found 4 candidate symbols related to "expired" + "token".
   Context: validateToken in src/auth/token.ts is the most likely root.
   Impact: changing validateToken affects 6 sites; 4 are in test fixtures.
   Proposed edit: src/auth/token.ts:47 — add null guard before .exp access.
   Predicted blast: only the failing test should change behavior.
   Apply? [y/N]
```

## Honest limit

Bug repair on hard reasoning bugs (concurrency, weird state machines) still benefits from flagship models. We help the model find the right files; we don't make it smarter. **CodraGraph's win here is reducing token waste on the 70% of bugs that are local — not solving the 30% that require novel insight.**
