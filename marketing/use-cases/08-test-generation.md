# Use Case 08 — Test Generation with Real Context

## The job

> "Generate tests for this function — that match the patterns in our existing test suite."

LLMs generate tests today. Most of those tests don't match the team's conventions, miss the right edge cases, and use mocks the project doesn't actually use.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| Copilot | Inline test stubs | Generic; doesn't match project conventions |
| Cursor "generate tests" | Whole-file context | Often hallucinates project setup; ignores existing mock patterns |
| Manual prompting | "Look at file X for example, then generate" | Token-heavy, error-prone; the dev does the work the agent should |
| Codium / similar | Test-focused agents | Improving but still generic; no graph awareness |

## What CodraGraph does differently

The graph knows your project's testing conventions. CodraGraph's test-generation recipe pulls:

1. **The function under test** — `codragraph_context` for callers, callees, types
2. **Sibling test files** — `codragraph_query "test for similar function"` to find conventions
3. **Project's mock patterns** — which mocking library, what scaffolding
4. **Test fixtures already used** — reuse existing fixtures vs reinventing
5. **Coverage gaps** — which branches of the function aren't already exercised

The agent gets all this in ~3k structured tokens. Generated tests look like the rest of the suite.

## The before / after

**Before:** Cursor generates a test that uses `jest.fn()` for mocking — your project uses `vitest` with `vi.fn()`. Test fails on import. You debug for 5 minutes, fix the convention manually, repeat for the next function.

**After:** CodraGraph's recipe sees vitest in the project, sees the existing mock helpers in `tests/helpers/mocks.ts`, and generates a test that imports from that helper. Test runs first try. Looks like a teammate wrote it.

## Why the moat matters here

Test generation runs **continuously** — every PR, every new function. The recipe for "generate test in our style" gets used hundreds of times. Versioned recipe memory keeps the recipe consistent until your testing approach changes (e.g. you migrate from jest to vitest, or adopt property-based testing). At that point the recipe naturally re-tunes against the new patterns.

## Sample agent prompt

```
You: Generate tests for src/services/payment.ts:processCharge — match our suite's style.

Claude (using harness_run with the test-gen recipe):
   Found 3 sibling test files using vitest + @testing-library:
     - tests/services/auth.test.ts (similar shape)
     - tests/services/notification.test.ts
     - tests/services/__helpers__/mocks.ts (your project's mock helpers)

   Found 4 branches in processCharge:
     1. valid charge → success
     2. expired card → CardExpiredError
     3. insufficient funds → InsufficientFundsError
     4. provider timeout → retry-then-fail flow

   Generated: tests/services/payment.test.ts
     - import { mockStripeClient } from "./__helpers__/mocks"   ← project pattern
     - 4 test cases (one per branch)
     - Reuses USER_FIXTURE from auth.test.ts
     - Uses vi.useFakeTimers() for timeout case (consistent with auth.test.ts:103)
```

## Coverage-aware mode

`codragraph_query` plus the test-relationship graph means CodraGraph knows which symbols *don't have inbound CALLS from /test/* directories — coverage gaps as a graph property. The harness can prioritize generating tests for the symbols that need them most.

## Honest limit

Tests CodraGraph generates only test what's *visible in the graph*. Property-based, fuzz, or chaos tests need human design. Tests for hard-to-spec behavior (UI rendering, race conditions) still benefit from human authorship. CodraGraph is best at unit/integration tests for typed business logic.
