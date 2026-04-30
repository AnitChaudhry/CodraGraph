---
name: codragraph-notebook-context
description: "Use when working with notebook-heavy projects (Jupyter, Databricks, Colab, Marimo) where each notebook contains long pipelines of cells, and the user needs to navigate, summarize, or refactor across them. Examples: \"what do these notebooks do\", \"summarize this analysis pipeline\", \"refactor cells from this notebook into modules\", \"data analysis project tour\""
---

# Notebook-Heavy Project Navigation with CodraGraph

## When to Use

- "What's in these notebooks?"
- "Summarize the analysis pipeline across `<notebook>.ipynb`"
- "Help me refactor a notebook into a proper module"
- "What functions defined in notebooks does the production code call?"
- "Audit the data analyses in this project"

## Why CodraGraph helps here

Data-science / analytics projects often have 80%% of the logic inside
`.ipynb` files: top-level imports, helper functions, ad-hoc transforms.
CodraGraph indexes Python (the most common notebook language) and treats
notebook-derived code as first-class graph content. That means `query`,
`context`, and `impact` work on notebook-defined symbols just like
production-code symbols, so you can navigate a 30-cell notebook the same
way you'd navigate a typical module.

## Workflow

```
1. List notebook-derived symbols:
   codragraph_cypher({query: `
     MATCH (n)
     WHERE n.filePath ENDS WITH '.ipynb'
     RETURN n.filePath, n.name, labels(n)[0] AS label
     ORDER BY n.filePath, n.startLine
   `})
   → every function/class defined inside any notebook

2. For each notebook of interest:
   codragraph_query({query: "<notebook concept, e.g. 'monthly retention'>"})
   → top-ranked symbols across notebooks (process-grouped)

3. codragraph_context({name: "<notebook function>"})
   → callers (other notebooks? production?) and callees (libraries used)

4. Cross-notebook reuse check:
   codragraph_impact({target: "<helper>", direction: "upstream"})
   → if multiple notebooks call the same helper, that's a refactor candidate
     (extract into a shared module)

5. Production / notebook bridge:
   codragraph_cypher({query: `
     MATCH (caller)-[:CALLS]->(target)
     WHERE NOT caller.filePath ENDS WITH '.ipynb'
       AND target.filePath ENDS WITH '.ipynb'
     RETURN caller.filePath, target.filePath, target.name
   `})
   → production code calling into notebooks (usually a bug — flag it)
```

> Notebooks export when wrapped in nbconvert / papermill / databricks-cli.
> CodraGraph parses the `.ipynb` JSON and treats each code cell as part of
> the file's symbol space.

## Checklist

```
- [ ] Cypher query for all symbols with .ipynb file paths
- [ ] Group by notebook → see total symbol count per notebook
- [ ] query for the analysis topic to find top-ranked symbols
- [ ] context on key notebook helpers
- [ ] impact upstream on cross-notebook helpers → refactor candidates
- [ ] Cypher for production-code → notebook calls (bridge audit)
```

## Refactor Signals

| Signal | What to do |
| --- | --- |
| Same helper defined in 3+ notebooks | Extract into a shared `.py` module |
| Notebook function called from production code | Move to production module; notebook should re-import |
| Notebook with > 30 distinct symbols | Likely needs to be split (or graduated to a module) |
| Notebook calling another notebook | Strong refactor signal — extract the shared part |

## Example: "Summarize the customer-churn analyses in notebooks/"

```
1. codragraph_cypher({
     query: `MATCH (n) WHERE n.filePath STARTS WITH 'notebooks/'
              AND n.filePath ENDS WITH '.ipynb'
              RETURN n.filePath, count(n) AS symbols
              ORDER BY symbols DESC`
   })
   → 4 notebooks: churn_baseline.ipynb (28 symbols),
                  churn_features.ipynb (35 symbols),
                  churn_model.ipynb (22 symbols),
                  churn_eval.ipynb (12 symbols)

2. codragraph_query({query: "customer churn cohort"})
   → top symbols across the 4 notebooks, grouped by detected processes

3. codragraph_context({name: "compute_cohort_retention"})
   → defined in: churn_features.ipynb
   → called by: churn_model.ipynb, churn_eval.ipynb (TWO notebooks)
   → REFACTOR CANDIDATE — extract into src/churn/cohort.py

4. codragraph_cypher for production → notebook calls
   → 1 hit: scripts/daily_churn_report.py imports from churn_eval.ipynb ⚠
   → Production should not depend on a notebook. Extract.

Findings:
- 97 total symbols across 4 notebooks
- 1 multi-notebook helper (compute_cohort_retention) → extract to module
- 1 production → notebook bridge (daily_churn_report) → flag as tech debt
```

## Output Format

```markdown
## Notebook Tour: `notebooks/`

### Notebooks
| Notebook | Symbols | Purpose (top-3 symbols) |
| --- | --- | --- |
| churn_baseline.ipynb | 28 | baseline_churn_rate, … |
| churn_features.ipynb | 35 | compute_cohort_retention, … |
| churn_model.ipynb | 22 | train_churn_classifier, … |
| churn_eval.ipynb | 12 | evaluate_churn_model, … |

### Refactor candidates
1. `compute_cohort_retention` — used in 2 notebooks → extract to `src/churn/cohort.py`
2. ...

### Bridge audits
- ⚠ `scripts/daily_churn_report.py` imports from `churn_eval.ipynb` —
  production should not depend on a notebook.
```
