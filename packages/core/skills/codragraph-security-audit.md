---
name: codragraph-security-audit
description: "Use for security-focused codebase audits — finding auth bypass paths, missing input validation, secrets in code, untrusted-input flow, and routes that skip auth middleware. Examples: \"security audit\", \"find auth bypass\", \"unvalidated input\", \"untrusted data flow\", \"missing authentication\""
---

# Security Audit with CodraGraph

## When to Use

- "Audit auth coverage — which routes skip the auth middleware?"
- "Find input that flows from request to SQL/template/exec without validation."
- "Find hardcoded secrets / credentials in source."
- "Trace untrusted-input flow for `<endpoint>`."
- Pre-release security pass on a PR-heavy week.

## Why CodraGraph helps here

Static-analysis tools find pattern matches; CodraGraph adds the
**call-graph**, so you can answer "*which* request handlers reach this
unsafe sink?" rather than just "this sink is unsafe somewhere." Combined
with `query` for sensitive identifier strings and `cypher` for structural
filters, you can build an audit that's far more targeted than grep.

## Workflow

```
1. Identify the boundary symbols:
   codragraph_query({query: "request handler route controller"})
   → all entry points where untrusted input arrives

2. Identify the dangerous sinks:
   codragraph_query({query: "exec spawn eval query raw_sql innerHTML"})
   → places where untrusted input becomes harmful

3. For each (handler → sink) pair, walk the call graph:
   codragraph_impact({target: "<sink>", direction: "upstream"})
   → which handlers REACH this sink?

4. For each path, look for a validator on the way:
   codragraph_context({name: "<handler>"})
   → is `validate / sanitize / escape / parse` called between handler and sink?
   → if not: candidate vulnerability

5. Cross-check against secrets:
   codragraph_cypher({query: "MATCH (n) WHERE n.body =~ '.*(?i)(api[_-]?key|secret|password|token)[ ]*=[ ]*[\\'\"][a-zA-Z0-9]{16,}.*' RETURN n"})
   → suspicious literals that look like real keys
```

## Audit Patterns

| Pattern | What to look for | CodraGraph approach |
|---|---|---|
| Auth bypass | Routes not wrapped by `requireAuth` middleware | `query` for routes; check `context` for middleware in callers |
| SQL injection | Raw query string built from request input | `query` SQL literals → `impact` upstream → flag handlers |
| XSS | Untrusted input rendered without escape | `query` `innerHTML` / `dangerouslySetInnerHTML` → impact upstream |
| Command injection | `exec` / `spawn` with concatenated input | `query` exec/spawn → impact upstream → check for shell escape |
| Open redirect | Redirect URL from request | `query` `redirect` / `Location:` → trace input source |
| Hardcoded secrets | API keys in source | `cypher` regex over `n.body` |
| Missing CSRF | State-changing routes without CSRF middleware | `query` POST / PUT / DELETE handlers → check middleware chain |

## Why "missing validator" is a great query

The graph cleanly shows the call path: `handler → … → sink`. Validators
appear in that chain or they don't. If `validateInput` / `sanitize` /
`escape` is NOT in the path between a handler and a sink, that's a
*provable* gap, not a guess.

```
codragraph_cypher({query: `
  // Find handler→sink paths that don't pass through ANY validator
  MATCH path = (handler {label: 'Function'})-[:CALLS*1..6]->(sink {label: 'Function'})
  WHERE handler.isEntryPoint = true
    AND sink.name IN ['exec', 'query', 'innerHTML', 'eval']
    AND NONE(n IN nodes(path) WHERE n.name STARTS WITH 'validate'
                                  OR n.name STARTS WITH 'sanitize'
                                  OR n.name STARTS WITH 'escape')
  RETURN handler.name, sink.name, length(path) AS hops
  ORDER BY hops ASC
`})
```

## Checklist

```
- [ ] Listed entry-point handlers (query for "handler"/"route"/"controller")
- [ ] Listed dangerous sinks (exec/query/eval/innerHTML/raw)
- [ ] Built handler→sink table; flagged paths missing validators
- [ ] Cypher scan for hardcoded-secret literal patterns
- [ ] codragraph_context on each flagged handler — confirm coverage / propose fix
- [ ] Document findings as severity-tagged report
```

## Example: "Audit which routes skip our requireAuth middleware"

```
1. codragraph_query({query: "Express router get post put delete handler"})
   → 28 route handlers across 6 router files

2. For each handler, codragraph_context({name: "<handler>"}):
   → check that callers include `requireAuth` (a known middleware function)

3. codragraph_cypher({
     query: `MATCH (handler {isEntryPoint: true})-[:CALLS]->()
              WHERE NOT EXISTS {
                MATCH (handler)<-[:CALLS]-(mw {name: 'requireAuth'})
              }
              RETURN handler.name, handler.filePath`
   })
   → 4 handlers have no requireAuth caller:
     - publicHealthCheck (intentional ✓)
     - signup, login (intentional ✓ — these CREATE auth)
     - debugDumpUser ⚠ (NOT intentional — leaks user data)

4. Findings report:
   - HIGH: debugDumpUser at src/routes/debug.ts:42
     reaches db.query → returns full user record. No auth.
     Fix: wrap with requireAuth or remove from production builds.
```

## Output Format

```markdown
## Security Audit: <scope>

### Summary
- N handlers audited
- M handler→sink paths inspected
- K validator-missing paths flagged
- Severity: 1 HIGH, 2 MEDIUM, 0 CRITICAL

### Findings

#### HIGH — debugDumpUser at src/routes/debug.ts:42
- Reachable without `requireAuth`
- Calls `db.query` with no input validation
- Returns full user record
- **Fix:** wrap with auth middleware OR strip from production builds

#### MEDIUM — …

### Hardcoded-secret scan
- 0 high-confidence matches
- 1 false-positive: example token in test fixture
```
