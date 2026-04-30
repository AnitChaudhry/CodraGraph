---
name: codragraph-data-lineage
description: "Use when tracing data flow through an ETL pipeline, finding where a column or table is read/written, mapping data dependencies in a notebook-heavy or data-engineering project. Examples: \"where does this data come from\", \"trace this column\", \"data lineage for X\", \"who reads from this table\", \"what's downstream of this query\""
---

# Data Lineage with CodraGraph

## When to Use

- "Where does the `user_events` table get written?"
- "Trace the data flow that produces `daily_revenue.csv`"
- "What's downstream of this Snowflake query?"
- "Which notebook cells transform this DataFrame?"
- Auditing a data pipeline before changing a schema
- Understanding an unfamiliar ETL project

## Why CodraGraph helps here

Data pipelines often look like a graph of small functions: `extract_*`,
`transform_*`, `load_*`, `enrich_*`. Their connections are *function calls*
plus *string-literal table names* and *file paths*. CodraGraph already
captures the call graph; combining it with `query` over identifier strings
gives you data lineage at the *symbol* level, regardless of whether your
pipeline is in vanilla Python, Airflow, dbt, Pandas, PySpark, or Notebooks.

## Workflow

```
1. codragraph_query({query: "<table_or_column_name>"})
   → find every symbol that mentions the data identifier

2. For each candidate symbol:
   codragraph_context({name: "<symbol>"})
   → see callers (who triggers this read/write) and callees (what it depends on)

3. Walk the producer side (downstream → upstream):
   codragraph_impact({target: "<load function>", direction: "upstream"})
   → trace back to where the data originates

4. Walk the consumer side (upstream → downstream):
   codragraph_impact({target: "<extract function>", direction: "downstream"})
   → trace forward to every transform / sink that depends on it

5. READ codragraph://repo/{name}/process/<pipeline-flow>
   → the canonical step-by-step flow if CodraGraph detected this as a process

6. Build the lineage diagram: source → transform stages → sink
```

> CodraGraph is graph-aware, not SQL-aware: it sees a string literal that
> *looks* like a table name, but doesn't parse SQL semantics. For mature SQL
> lineage tooling (column-level resolution), pair with `codragraph-sql-tracing`
> skill and a SQL parser like sqlglot.

## Checklist

```
- [ ] query for the table/column/file identifier
- [ ] context on each candidate to map producers vs consumers
- [ ] impact upstream on the load/sink function
- [ ] impact downstream on the extract/source function
- [ ] Cross-reference with processes for canonical pipeline flows
- [ ] Render the lineage as: source → transform_1 → transform_2 → sink
```

## Identifier Patterns to Search

| Layer | Search hints |
| --- | --- |
| File-based source | filename, path fragments (`raw_events.parquet`) |
| Database table | bare table name + `FROM table_name` |
| Column / field | column name in conjunction with the table name |
| API endpoint | URL path or function name (`fetchUserEvents`) |
| Event topic / queue | topic name (`user.signup.v2`) |

## Example: "Where does daily_revenue.csv come from?"

```
1. codragraph_query({query: "daily_revenue"})
   → 4 symbols:
     - write_daily_revenue (src/etl/daily.py)
     - read_daily_revenue (src/dashboards/finance.py)
     - DailyRevenueRow (src/schemas/types.py)
     - daily_revenue_dag (airflow/dags/finance_etl.py)

2. codragraph_context({name: "write_daily_revenue"})
   → callers: daily_revenue_dag (Airflow task)
   → callees: aggregate_orders, attach_currency_rates, format_csv_row

3. codragraph_impact({target: "aggregate_orders", direction: "upstream"})
   → reads from: orders_raw, returns_raw (both tables)

4. codragraph_impact({target: "read_daily_revenue", direction: "downstream"})
   → consumed by: finance_dashboard.render(), revenue_alerts.check()

5. READ codragraph://repo/CodraGraph/process/DailyRevenueETL
   → 6 steps:
       fetch_orders → fetch_returns → aggregate_orders →
       attach_currency_rates → format_csv_row → write_daily_revenue

Lineage:
  orders_raw, returns_raw  (DB tables)
       ↓
  fetch_orders + fetch_returns  (extract)
       ↓
  aggregate_orders → attach_currency_rates → format_csv_row  (transform)
       ↓
  daily_revenue.csv  (sink)
       ↓
  finance_dashboard, revenue_alerts  (consumers)
```

## Output Format

```markdown
## Data Lineage: <data-asset>

### Sources
- `orders_raw` (DB)
- `returns_raw` (DB)

### Pipeline (DailyRevenueETL flow, 6 steps)
1. `fetch_orders` — reads `orders_raw`
2. `fetch_returns` — reads `returns_raw`
3. `aggregate_orders` — joins, sums by day
4. `attach_currency_rates` — enriches with FX
5. `format_csv_row` — schema-conforming serialization
6. `write_daily_revenue` — writes `daily_revenue.csv`

### Consumers
- `finance_dashboard` (renders chart)
- `revenue_alerts` (threshold checks)

### Risk if `<schema/source>` changes
- 6 transform stages depend on it
- 2 consumers depend on the output schema
```
