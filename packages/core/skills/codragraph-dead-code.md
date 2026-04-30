---
name: codragraph-dead-code
description: "Use when the user wants to find unused code, orphan functions/classes, dead code, or symbols safe to delete. Examples: \"what's unused\", \"find dead code\", \"can I delete this function\", \"orphan symbols\", \"clean up unused exports\""
---

# Dead Code Detection with CodraGraph

## When to Use

- "What's unused in this codebase?"
- "Find dead code / orphan functions / unused exports"
- "Can I safely delete `<symbol>`?"
- Periodic cleanup before a release
- Identifying candidates for the next refactor

## Why CodraGraph helps here

Linters can find unreachable code in *one file*. CodraGraph walks the
*whole-repo* call graph, including dynamic dispatch, framework entry
points, and exports — so it can tell you a symbol is genuinely unreachable
rather than just "the linter couldn't see the caller."

The trick is to combine three signals:

1. **No incoming references** — `cypher` query for symbols with zero
   `<-[:CALLS|REFERENCES]-` edges.
2. **Not exported** — internal-only symbols are stronger candidates than
   `isExported = true` ones (which may be public API).
3. **Not in any process** — execution flows are the canonical "this is
   used" signal; symbols outside every process are extra suspect.

## Workflow

```
1. codragraph_cypher({query: `
     MATCH (n)
     WHERE NOT (n)<-[:CALLS|REFERENCES]-()
       AND NOT (n.isExported = true)
     RETURN n.id, n.name, labels(n)[0] AS label, n.filePath
     LIMIT 200
   `})
   → list of orphan candidates

2. For each candidate:
   codragraph_context({name: "<candidate>"})
   → confirm: 0 callers, 0 callees that matter, not in any process

3. Cross-check against processes:
   READ codragraph://repo/{name}/processes
   → if the symbol appears in ANY process, it's not actually dead

4. For exported orphans (potentially public API):
   codragraph_impact({target: "<symbol>", direction: "upstream"})
   → if d=1 has external callers (in another indexed repo group), keep it

5. Group by file/cluster, prioritize by file size of dead code
```

> If "Index is stale" → run `npx @codragraph/cli analyze` first. Stale
> indexes produce false-positive dead-code reports because new callers
> aren't visible.

## Checklist

```
- [ ] Cypher query for orphan symbols (no incoming edges, not exported)
- [ ] context check on each candidate (confirm 0 callers)
- [ ] Cross-reference with processes (symbols in flows are not dead)
- [ ] For exported orphans, impact across groups (cross-repo callers?)
- [ ] Group findings by file → suggest which files can lose the most code
- [ ] Flag any candidate that's a framework convention (e.g., default export
      of a Next.js page route) — those LOOK orphan but aren't
```

## Pitfalls

| Pitfall | What to do |
| --- | --- |
| Framework conventions (Next.js pages, Astro routes, Django URLs) | Check `isEntryPoint` on the node — these often score high |
| Test-only symbols | Filter `filePath CONTAINS '/test'` separately |
| Re-exported symbols | A re-export creates `REFERENCES` edges; a true orphan has none |
| Dynamic dispatch (factories, plugin systems) | Cross-check with `query` for the registration string |

## Example: "Clean up unused code in src/utils/"

```
1. codragraph_cypher({
     query: `MATCH (n) WHERE n.filePath STARTS WITH 'src/utils/'
              AND NOT (n)<-[:CALLS|REFERENCES]-()
              AND NOT (n.isExported = true)
              RETURN n.id, n.name, n.filePath`
   })
   → 7 candidates

2. codragraph_context({name: "formatLegacyDate"})
   → 0 callers, 0 callees, not in any process. Truly dead.

3. codragraph_context({name: "DEBUG_TIMER"})
   → 0 callers but called dynamically via process.env injection.
   → Keep it.

4. Final: 6 of 7 candidates safe to delete. Total: 142 LoC across 4 files.
```

## Output Format

```markdown
## Dead Code Audit: <scope>

### High-confidence (0 callers, 0 callees, not in any process)
- `formatLegacyDate` — `src/utils/date.ts:42` (12 LoC)
- ...

### Possibly dead (verify dynamic dispatch first)
- `DEBUG_TIMER` — used via env-driven hook?

### Total cleanup potential
N functions, M LoC, X files.
```
