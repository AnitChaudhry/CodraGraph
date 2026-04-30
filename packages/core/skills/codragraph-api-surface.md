---
name: codragraph-api-surface
description: "Use when the user wants to enumerate the public API of a package or codebase, understand what's exported, audit breaking change risk, or compare API shapes across versions. Examples: \"what's our public API\", \"list exports\", \"API surface\", \"what would break if I remove X\", \"document the public interface\""
---

# API Surface Audit with CodraGraph

## When to Use

- "What's the public API of this package?"
- "List every exported function / class / type"
- "What would break if I remove or rename `<symbol>`?"
- Pre-release API freeze audit
- Generating API documentation from the graph
- Comparing API surface across versions (with `codragraph diff --semantic`)

## Why CodraGraph helps here

Reading every `index.ts` / `__init__.py` / `mod.rs` by hand misses re-exports
and framework-magic exports (Next.js page routes, decorators, registered
plugins). CodraGraph's `isExported` property is computed by language-aware
export detection — covers default exports, named re-exports, `__all__`,
`pub use`, etc., consistently across all 16 supported languages.

## Workflow

```
1. codragraph_cypher({query: `
     MATCH (n) WHERE n.isExported = true
     RETURN labels(n)[0] AS table, n.name, n.filePath, n.id
     ORDER BY table, n.filePath, n.name
   `})
   → every exported symbol, grouped by table

2. For each high-traffic export:
   codragraph_impact({target: "<name>", direction: "upstream"})
   → who depends on it (within this repo)

3. For cross-repo audits (multi-repo group):
   codragraph_impact({repo: "@<group>", target: "<name>", direction: "upstream"})
   → blast radius across every group member

4. Compare across versions:
   codragraph diff <baseline> <head> --semantic --json
   → addedAPIs / removedAPIs / classifiedModifications
   → produces a versioned changelog of what your public surface gained / lost
```

> Pair with `codragraph-pr-review` skill when reviewing a PR that touches
> exported symbols — the impact-across-group check is the difference between
> "breaks our consumers" and "internal refactor."

## Checklist

```
- [ ] Cypher query for n.isExported = true
- [ ] Group by file or by community (Leiden cluster)
- [ ] For each non-trivial export, run impact upstream
- [ ] If the package is in a group, run impact with repo: "@group" too
- [ ] Compare with previous release: codragraph diff <prev-tag> HEAD --semantic
- [ ] Flag exports with no documented consumers — candidates for visibility
      reduction (export → internal)
```

## Example: "What's our public API?"

```
1. codragraph_cypher({
     query: `MATCH (n) WHERE n.isExported = true
              RETURN labels(n)[0] AS table, n.name, n.filePath`
   })
   → 47 exports: 22 Function, 12 Class, 8 Interface, 5 Constant

2. Top-level functions:
   - createClient (src/index.ts) ← 14 callers
   - fetchUser (src/api.ts)      ← 6 callers
   - validate (src/utils.ts)     ← 1 internal caller only ⚠ over-exported

3. codragraph_impact({target: "validate", direction: "upstream"})
   → d=1: only formatPayload (same package). No external consumers.
   → Recommend: drop the `export` keyword. Internal-only.

4. Compare with v1.5.3 release:
   codragraph diff v1.5.3 HEAD --semantic
   → +3 added APIs, -1 removed API (mappings.toCamelCase), ~2 modified
   → Removed API is a SemVer major bump.
```

## Output Format

```markdown
## API Surface: <package>

### Exports (47 total)
| Symbol | Table | File | Callers (internal) | Notes |
|--------|-------|------|-------------------:|-------|
| createClient | Function | src/index.ts | 14 | core entry |
| validate | Function | src/utils.ts | 1 | over-exported, suggest internal |
| ...

### Diff vs <previous-tag>
- **Added (3):** `subscribe`, `unsubscribe`, `EventBus`
- **Removed (1):** `toCamelCase` ⚠ SemVer major
- **Modified (2):** `createClient` (param 3→4), `fetchUser` (return type)

### Recommendations
- Reduce visibility on 4 over-exported internals
- Document the 3 new APIs in the release notes
- The removed `toCamelCase` requires a major version bump
```
