# Use Case 05 — Onboarding New Engineers

## The job

> "I just joined the team. What's the architecture? Where's auth? What does this acronym mean?"

Onboarding eats senior engineering time. The new hire spends two weeks scrolling Slack and `git log`, the senior engineer spends two weeks answering the same questions they answered for the last three hires.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| README + onboarding docs | Static, written once, drifts | Out of date within 3 months |
| Code search (Sourcegraph, GitHub) | Find files | Doesn't synthesize; new hire still has to read |
| Asking teammates on Slack | High-quality context | Doesn't scale; senior time is expensive |
| Backstage / TechDocs | Service catalog | Helps for org-level overview; doesn't help "where does login flow start?" |

The friction: **structural knowledge of a codebase isn't in any one document.** It's in the call graph, the process flow, the directory layout, the test fixtures.

## What Codragraph does differently

Codragraph generates structural answers from the graph:

- `codragraph_query "authentication"` returns the **execution flows** related to auth, ranked by relevance
- Each flow lists the symbols involved and the file paths
- `codragraph context` on any symbol gives the new hire callers, callees, and the broader process

Instead of reading 30 files to learn how login works, the new hire asks the agent and gets:

```
"login" relates to 3 execution flows in this repo:

1. PROCESS: user-login (entry point: src/api/login.ts:loginRoute)
   Steps: request → validateBody → checkCredentials → issueToken → setCookie → respond
   Files involved: api/login.ts, services/auth.ts, db/users.ts, lib/jwt.ts

2. PROCESS: oauth-callback (entry point: src/api/oauth.ts:callbackRoute)
   ...

3. PROCESS: refresh-token (entry point: src/api/refresh.ts)
   ...
```

The new hire reads 3 process descriptions instead of 30 files. Onboarding goes from weeks to days.

## The before / after

**Before:** New hire opens 50 files in their first week. Asks "where does login start?" three times in different threads. Senior engineer answers the same question for the fourth time this quarter.

**After:** New hire installs Codragraph day one. Asks the agent "explain how login works in this codebase". Gets a structural answer with file paths, then opens those files with full context for *why* they're important.

## Why the moat matters here

Onboarding is a **bursty, repetitive workload**. Five new hires over the year; each asks the same 30 architectural questions in their first month. The harness's onboarding-recipe handles all 150 questions with one tuned pipeline. Recipe memory means the recipe stays sharp until your architecture meaningfully changes — which is exactly when you'd want it to re-tune anyway.

## Sample new-hire workflow

Day 1:
```bash
git clone <repo>
cd <repo>
npx codragraph analyze .
npx codragraph setup
```

Day 1 afternoon, in Cursor / Claude Code:
```
"Walk me through the architecture of this codebase. Start with the entry points
 and trace the major flows."
```

Day 2:
```
"Where would I add a new authentication strategy (e.g. magic link)? Show me the
 existing patterns I should follow."
```

Codragraph's graph + harness gives the new hire structural answers their senior teammates would otherwise have to type out.

## Bonus: AGENTS.md / CLAUDE.md auto-generation

After every `codragraph analyze`, Codragraph regenerates `AGENTS.md` and `CLAUDE.md` with up-to-date architecture summaries. New hires reading those get accurate, current docs without anyone manually maintaining them.

## Honest limit

Codragraph documents the **what**, not the **why**. Architectural decisions ("we picked Postgres because of audit-log requirements") still need to be written down by humans. Codragraph generates structural docs; ADRs are still on you.
