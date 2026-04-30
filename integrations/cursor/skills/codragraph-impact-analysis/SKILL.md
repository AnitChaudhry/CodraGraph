---
name: codragraph-impact-analysis
description: Analyze blast radius before making code changes
---

# Impact Analysis with CodraGraph

## When to Use
- "Is it safe to change this function?"
- "What will break if I modify X?"
- "Show me the blast radius"
- "Who uses this code?"
- Before making non-trivial code changes
- Before committing â€” to understand what your changes affect

## Workflow

```
1. codragraph_impact({target: "X", direction: "upstream"})  â†’ What depends on this
2. READ codragraph://repo/{name}/processes                   â†’ Check affected execution flows
3. codragraph_detect_changes()                               â†’ Map current git changes to affected flows
4. Assess risk and report to user
```

> If "Index is stale" â†’ run `npx @codragraph/cli analyze` in terminal.

## Checklist

```
- [ ] codragraph_impact({target, direction: "upstream"}) to find dependents
- [ ] Review d=1 items first (these WILL BREAK)
- [ ] Check high-confidence (>0.8) dependencies
- [ ] READ processes to check affected execution flows
- [ ] codragraph_detect_changes() for pre-commit check
- [ ] Assess risk level and report to user
```

## Understanding Output

| Depth | Risk Level | Meaning |
|-------|-----------|---------|
| d=1 | **WILL BREAK** | Direct callers/importers |
| d=2 | LIKELY AFFECTED | Indirect dependencies |
| d=3 | MAY NEED TESTING | Transitive effects |

## Risk Assessment

| Affected | Risk |
|----------|------|
| <5 symbols, few processes | LOW |
| 5-15 symbols, 2-5 processes | MEDIUM |
| >15 symbols or many processes | HIGH |
| Critical path (auth, payments) | CRITICAL |

## Tools

**codragraph_impact** â€” the primary tool for symbol blast radius:
```
codragraph_impact({
  target: "validateUser",
  direction: "upstream",
  minConfidence: 0.8,
  maxDepth: 3
})

â†’ d=1 (WILL BREAK):
  - loginHandler (src/auth/login.ts:42) [CALLS, 100%]
  - apiMiddleware (src/api/middleware.ts:15) [CALLS, 100%]

â†’ d=2 (LIKELY AFFECTED):
  - authRouter (src/routes/auth.ts:22) [CALLS, 95%]
```

**codragraph_detect_changes** â€” git-diff based impact analysis:
```
codragraph_detect_changes({scope: "staged"})

â†’ Changed: 5 symbols in 3 files
â†’ Affected: LoginFlow, TokenRefresh, APIMiddlewarePipeline
â†’ Risk: MEDIUM
```

## Example: "What breaks if I change validateUser?"

```
1. codragraph_impact({target: "validateUser", direction: "upstream"})
   â†’ d=1: loginHandler, apiMiddleware (WILL BREAK)
   â†’ d=2: authRouter, sessionManager (LIKELY AFFECTED)

2. READ codragraph://repo/my-app/processes
   â†’ LoginFlow and TokenRefresh touch validateUser

3. Risk: 2 direct callers, 2 processes = MEDIUM
```
