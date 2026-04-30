---
name: codragraph-migration-tracking
description: "Use when tracking the progress of a phased refactor or migration (renaming an API, swapping a library, moving from class- to functional-components, deprecating a flag). Examples: \"how far is the migration\", \"what's left to migrate\", \"track this refactor\", \"are we done with the move from X to Y\", \"is the migration done\""
---

# Migration Progress Tracking with CodraGraph

## When to Use

- "How far along is the migration from `<old>` to `<new>`?"
- "What's left to migrate / refactor / deprecate?"
- "Are we done with `<old API>`?"
- Coordinating a phased refactor across many PRs
- Reporting migration status to stakeholders

## Why CodraGraph helps here

Migrations span dozens of PRs and weeks. Without a structural index, the
question "are we done?" reduces to grep-and-eyeball. CodraGraph's versioned
graphstore lets you snapshot the codebase at the start of the migration,
then diff against today to see exactly what's converted and what isn't.
Pair with `cypher` to count remaining instances of the old pattern.

## Workflow

```
1. Establish baseline (once, at migration start):
   codragraph commit -m "migration baseline: pre-X-removal"
   codragraph branch create migration-baseline
   → captures the structural state for later comparison

2. Count remaining old-API call sites today:
   codragraph_cypher({query: `
     MATCH (n)-[:CALLS]->(target)
     WHERE target.name = '<oldFunction>'
     RETURN n.filePath, count(n) AS callers
     ORDER BY callers DESC
   `})
   → "27 callers in 14 files still using <oldFunction>"

3. Diff against the baseline to see structural progress:
   codragraph diff migration-baseline HEAD --semantic --json
   → look at removedAPIs (old surface gone), addedAPIs (new surface added),
     classifiedModifications (signatures swapped)

4. Assess flows still touching the old API:
   codragraph_impact({target: "<oldFunction>", direction: "upstream"})
   → list of remaining callers grouped by depth

5. Suggest the next batch of files to migrate (highest caller-count first)
```

> If `migration-baseline` doesn't exist, you skipped step 1 — fall back to
> the earliest commit in `codragraph log` as a baseline (less precise but
> usable).

## Checklist

```
- [ ] Establish a baseline (branch / tagged commit) at migration start
- [ ] Cypher count of remaining old-API references
- [ ] codragraph diff baseline HEAD --semantic for structural progress
- [ ] impact upstream on the old API → list of remaining callers
- [ ] Group remaining work by file → suggest next batch
- [ ] Report: "<N>%% of <total> call sites converted. <K> files remaining."
```

## Migration Patterns This Catches

| Pattern | Cypher hint |
| --- | --- |
| API rename (foo → bar) | `MATCH ()-[:CALLS]->(n) WHERE n.name = 'foo' RETURN n.filePath, count(*)` |
| Library swap (lodash → native) | Filter on `filePath` for files still importing the old library |
| Class → functional component | Match by `n.label = 'Class'` in the relevant directory |
| Feature flag removal | Cypher for string literals matching the flag name |
| Type-system migration (any → typed) | `MATCH (n) WHERE n.returnType = 'any' OR n.returnType IS NULL` |

## Example: "Track our migration from `validatePaymentV1` to `validatePaymentV2`"

```
1. (Baseline established 3 months ago: codragraph branch migration-v2-start)

2. codragraph_cypher({query: `
     MATCH (caller)-[:CALLS]->(target)
     WHERE target.name STARTS WITH 'validatePayment'
     RETURN target.name, count(caller) AS callers
   `})
   → validatePaymentV1: 8 callers
   → validatePaymentV2: 31 callers

3. codragraph diff migration-v2-start HEAD --semantic
   → addedAPIs: validatePaymentV2 (and 4 helpers)
   → classifiedModifications: 23 functions migrated from V1 to V2
   → removedAPIs: 0 (V1 still exported)

4. codragraph_impact({target: "validatePaymentV1", direction: "upstream"})
   → d=1 callers (still on V1):
       - legacyCheckout (src/legacy/checkout.ts)
       - webhookV1 (src/webhooks/v1.ts)
       - … 6 more

Report: 79%% migrated (31 / 39 callers). 8 callers in 3 files remaining.
Next batch: src/legacy/checkout.ts (5 callers in one file).
```

## Output Format

```markdown
## Migration Progress: <name>

### Baseline
`migration-baseline` (3 months ago, before refactor started)

### Current state
- **Converted:** 31 / 39 call sites (79%%)
- **Remaining:** 8 callers in 3 files
- **Old API surface:** still exported (cannot remove yet)
- **New API surface:** stable (4 helpers added)

### Remaining work
| File | Old-API callers | Notes |
| --- | --- | --- |
| `src/legacy/checkout.ts` | 5 | one batch |
| `src/webhooks/v1.ts` | 2 | tied to legacy webhook contract |
| ... | ... | ... |

### Done criteria
- 0 remaining callers
- removedAPIs in `codragraph diff` includes `validatePaymentV1`
```
