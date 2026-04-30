---
name: codragraph-supply-chain-audit
description: "Use to audit external dependency risk — which packages does the codebase actually use, where are the deepest integration points (a single dep used across N modules is high-blast-radius), what would break if a dep was removed. Examples: \"audit dependencies\", \"supply chain risk\", \"what would break if I drop X\", \"deep dep usage\", \"vendor in or replace\""
---

# Supply Chain / Dependency Audit with CodraGraph

## When to Use

- "Which deps are used the most?"
- "What would actually break if I removed `<package>`?"
- "Find deps imported in only 1-2 places (cheap to replace)."
- "Which deps are deeply integrated and risky to change?"
- "Pre-vendor audit: should I vendor `<dep>` to lock the version?"
- "Post-CVE: which of our code paths reach this vulnerable function?"

## Why CodraGraph helps here

`npm ls` / `pip list` / `go.sum` tell you which packages are *installed*.
CodraGraph tells you where they're *imported and called* — which is the
real measure of how integrated a dep is. Pair with `impact` for "what
breaks if this dep changes" and you have a much sharper risk picture
than pure dependency-tree analysis.

## Workflow

```
1. List external dependency import sites:
   codragraph_cypher({query: `
     MATCH (n)-[:IMPORTS]->(dep)
     WHERE dep.isExternal = true OR dep.id STARTS WITH 'package:'
     RETURN dep.id, dep.name, count(DISTINCT n) AS importers
     ORDER BY importers DESC
   `})
   → per-package import counts

2. For each high-import package, find which symbols call into it:
   codragraph_cypher({query: `
     MATCH (caller)-[:CALLS]->(target)
     WHERE target.filePath CONTAINS 'node_modules/<pkg>'
        OR target.id STARTS WITH 'package:<pkg>:'
     RETURN caller.name, caller.filePath, count(*) AS calls
     ORDER BY calls DESC
   `})
   → per-package call sites; high-call-site = deeply integrated

3. Identify shallow deps (cheap-to-replace):
   - 1-2 importers → easy to swap out
   - usage limited to one cluster → bounded blast radius

4. Identify deep deps (high replacement cost):
   - imported across many clusters → cross-cutting
   - referenced in critical processes → request-path criticality

5. CVE-specific: given a vulnerable function name from the advisory,
   find which of YOUR symbols reach it:
   codragraph_impact({target: "<vulnerableFn>", direction: "upstream"})
   → only paths through this function are actually exposed
```

## Risk categorization

| Category | Signal | Action |
|---|---|---|
| **Trivial** | 1-2 importers, one cluster | Easy to replace; consider native impl |
| **Local** | Many importers in 1-2 clusters | Wrap behind a façade for future swap |
| **Cross-cutting** | Importers spread across most clusters | Treat as core infra; vendor if licensing allows |
| **Critical** | In every request-path process | Pin version, monitor CVEs, plan migration before EOL |
| **Vulnerable now** | Reachable code path to a known-CVE function | Patch / replace ASAP |

## CVE response workflow

```
1. CVE published: "<package> <vulnerable-fn> allows X"

2. Quick check: do we even reach the vulnerable function?
   codragraph_query({query: "<vulnerable-fn>"})
   → list of call sites in YOUR code

3. For each call site, walk upstream:
   codragraph_impact({target: "<our-caller>", direction: "upstream"})
   → which entry points / processes reach the vulnerable code

4. If 0 reachable paths → not exposed. Patch when convenient.
5. If reachable from request-path → patch ASAP, communicate scope.
6. If reachable from internal-only paths → patch in the next maintenance window.
```

## Checklist

```
- [ ] Cypher: per-package importer + caller counts
- [ ] Categorize each top-N package: trivial / local / cross-cutting / critical
- [ ] For deep deps: identify a façade boundary if one exists / propose one
- [ ] CVE list cross-check: any current advisories against our deps?
- [ ] For each open advisory: codragraph_impact on the vulnerable function
- [ ] Output: ranked deps with risk tier + replaceability cost
```

## Example: "Should I replace lodash with native?"

```
1. codragraph_cypher for lodash imports:
   → 47 importers across all 8 clusters
   → Cross-cutting category.

2. codragraph_cypher for lodash calls:
   → top-called: _.get (78), _.isEmpty (54), _.cloneDeep (32),
     _.debounce (12), 25 other functions ≤ 5 calls each

3. Replacement cost analysis:
   - _.get → optional chaining `?.` (47 sites)
   - _.isEmpty → custom helper (3 lines)
   - _.cloneDeep → structuredClone() (Node 17+)
   - _.debounce → keep (lodash version is well-tuned, native lacks)
   - 25 long-tail functions → ~75 individual replacement decisions

4. Decision matrix:
   - High-frequency simple ones: easy native swap (saves 70%% of bundle hit)
   - _.debounce: keep lodash for this one (or use a 50-line single-purpose dep)
   - Long-tail: case-by-case during routine refactors

5. Migration plan:
   - Phase 1: replace _.get / _.isEmpty / _.cloneDeep (top 3 = ~200 call sites)
   - Phase 2: revisit long-tail in next major refactor
   - Phase 3: keep lodash only if _.debounce's replacement isn't ready
```

## Output Format

```markdown
## Supply Chain Audit: <scope>

### Top deps by integration depth
| Package | Importers | Call sites | Clusters touched | Tier |
|---|--:|--:|--:|---|
| react | 142 | 380 | 4 | critical |
| lodash | 47 | 220 | 8 | cross-cutting |
| date-fns | 12 | 45 | 3 | local |
| classnames | 4 | 9 | 2 | local |
| md5 | 1 | 1 | 1 | trivial |

### Replacement candidates
- `md5` — 1 call site, ~5 lines of native crypto. Trivial removal.
- `lodash` — replace top 3 functions for 70%% of usage; keep for `_.debounce`.

### CVE exposure
- 0 active advisories matching code paths reachable from request handlers.

### Recommended next step
1. Drop `md5` (5-line PR).
2. Phase-1 lodash slim-down (~200 sites; can be incremental).
```
