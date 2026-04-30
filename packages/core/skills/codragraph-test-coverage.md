---
name: codragraph-test-coverage
description: "Use when the user wants to find untested code paths, audit test coverage gaps, identify functions or execution flows that have no test reach, or assess whether a refactor needs new tests. Examples: \"what isn't tested\", \"test coverage gaps\", \"which flows have no tests\", \"do I need a test for X\""
---

# Test Coverage Audit with CodraGraph

## When to Use

- "What's not tested in this codebase?"
- "Which execution flows have no test coverage?"
- "Are there tests that cover X?"
- "Do I need to add a test for this function?"
- Auditing coverage before a release / freeze
- Justifying a "needs more tests" review comment with evidence

## Why CodraGraph helps here

Line-coverage tools (jest --coverage, c8, pytest-cov) tell you *which lines
ran*. They don't tell you *which call paths an agent / engineer should be
worried about*. CodraGraph's `impact({includeTests: true})` walks the call
graph and lists every test that transitively reaches a symbol — direct or
indirect — so you can prove a flow is exercised, or prove it isn't.

## Workflow

```
1. codragraph_query({query: "<area you care about>"})        → find candidate symbols
2. For each non-trivial symbol:
   codragraph_impact({target: "<symbol>", direction: "upstream", includeTests: true})
   → returns: callers + tests that transitively reach this symbol
3. READ codragraph://repo/{name}/processes
   → list every execution flow
4. For each flow, codragraph_impact on the flow's entry point with includeTests: true
   → flows with 0 tests = real gaps
5. Summarize: which symbols and flows have no test reach
```

> If "Index is stale" → run `npx @codragraph/cli analyze` first.

## Checklist

```
- [ ] List candidate symbols (query) or take from a recent diff (detect_changes)
- [ ] Run impact({includeTests: true}) on each
- [ ] Note symbols where the test list is empty
- [ ] Cross-reference with processes — flows with no test coverage are the real risk
- [ ] Report: gaps + the cheapest test that would close each gap (entry point)
- [ ] If reviewing a PR: limit to symbols changed in the PR
```

## Example: "What's not tested in the auth area?"

```
1. codragraph_query({query: "auth validation login session"})
   → 14 symbols across 6 files

2. codragraph_impact({target: "validateSession", direction: "upstream", includeTests: true})
   → callers: requireAuth, refreshToken
   → tests: 0 (no test reaches validateSession)
   ⚠ GAP

3. codragraph_impact({target: "hashPassword", direction: "upstream", includeTests: true})
   → tests: hashPassword.test.ts [direct], auth.integration.test.ts [via signup]
   ✓ covered

4. READ codragraph://repo/CodraGraph/processes
   → 3 auth flows: SignupFlow, LoginFlow, PasswordResetFlow

5. codragraph_impact for each flow's entry point with includeTests: true
   → SignupFlow: covered (3 tests)
   → LoginFlow: covered (2 tests)
   → PasswordResetFlow: NO TESTS ⚠

Findings:
- 2 untested gaps: validateSession (symbol), PasswordResetFlow (entire flow)
- Cheapest fix: one integration test calling resetPassword end-to-end would
  close both gaps simultaneously (it's the entry point for the flow that
  also calls validateSession).
```

## Output Format

```markdown
## Test Coverage Audit: <scope>

### Gaps (no test reach)
- **[symbol]** `validateSession` — called by 2 functions, no transitive test
- **[flow]** `PasswordResetFlow` — entire flow untested

### Covered (for reference)
- `hashPassword` — direct + integration test

### Suggested fixes
1. Add integration test for `resetPassword` → covers PasswordResetFlow + validateSession
2. ...
```
