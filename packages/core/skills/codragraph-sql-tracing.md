---
name: codragraph-sql-tracing
description: "Use when finding where SQL queries are constructed in code, tracing which functions execute a given query, auditing query patterns, or finding the call sites of a stored procedure. Examples: \"where is this SELECT defined\", \"who calls this query\", \"find all SQL in the auth module\", \"trace this stored procedure call\""
---

# SQL Query Tracing with CodraGraph

## When to Use

- "Where is the query for `<table>` constructed?"
- "Which functions execute `<sql snippet>`?"
- "Find all SQL string literals in `<area>`."
- Auditing query patterns (N+1, missing indexes, etc.) before optimization
- Tracing a stored-procedure call from production logs back to the caller

## Why CodraGraph helps here

SQL queries are usually plain string literals — the language-server knows
nothing about them, but `query` over the index plus `cypher` against the
graph can find them, and `context` / `impact` can trace who calls the
enclosing function. This works equally well for raw SQL strings, query
builders (Knex, SQLAlchemy, Diesel), and ORM-generated queries that
include a recognizable identifier.

## Workflow

```
1. codragraph_query({query: "SELECT FROM <table>"})
   OR
   codragraph_query({query: "<unique substring of the SQL>"})
   → symbols whose body contains the SQL fragment

2. For each candidate function:
   codragraph_context({name: "<function>"})
   → see who calls it (the actual query-execution site)

3. codragraph_impact({target: "<function>", direction: "upstream"})
   → blast radius: every caller of the SQL-executing function

4. For ORM / query-builder users:
   codragraph_query({query: "<table>.find OR <table>.where"})
   → find ORM calls that compile to SQL touching the table

5. Categorize: reads vs writes, hot paths vs cold paths
```

> CodraGraph indexes the *source* of the query, not the *executed* SQL.
> Dynamically built queries (`f"SELECT * FROM {table}"`) require both a
> string-literal search AND a check on the variable's binding via `context`.

## Checklist

```
- [ ] query for the SQL substring or table name
- [ ] context on each candidate function
- [ ] impact upstream on the executor → who calls it from the application
- [ ] Filter for ORM call patterns separately if relevant
- [ ] Group results: read paths vs write paths, hot vs cold paths
- [ ] Flag any query with no test reach (cross-ref with codragraph-test-coverage)
```

## SQL Patterns to Search

| Pattern | Search query |
| --- | --- |
| Raw string SELECT | `"SELECT FROM users"` (with table name) |
| Query builder (Knex) | `.from('users').where` |
| ORM (SQLAlchemy) | `session.query(User)` |
| Stored procedure call | `CALL sp_name` or `EXEC sp_name` |
| Migration | `CREATE TABLE` / `ALTER TABLE` |

## Example: "Find every place we read from the `audit_log` table"

```
1. codragraph_query({query: "FROM audit_log"})
   → 5 symbols:
     - getAuditByUser (src/admin/audit.ts)
     - getAuditByAction (src/admin/audit.ts)
     - exportAuditCSV (src/admin/audit.ts)
     - countRecentAuditEntries (src/dashboard/health.ts)
     - debugAuditDump (src/scripts/debug.ts)

2. codragraph_query({query: "auditLog.find OR auditLog.where"})
   → 0 (we're using raw SQL, not an ORM)

3. codragraph_context({name: "getAuditByUser"})
   → callers: AuditController.show, AuditController.export
   → callees: db.query, parseAuditRow

4. codragraph_impact({target: "getAuditByUser", direction: "upstream"})
   → d=1: AuditController.show (admin UI), AuditController.export (CSV download)
   → d=2: AdminRouter (HTTP layer)

Findings: 5 read sites in 3 files. All go through AuditController. The
debug script reads with no auth — flag for review.

5. Cross-reference with codragraph-test-coverage:
   - getAuditByUser: covered by AuditController.test
   - debugAuditDump: NO TESTS, NO AUTH ⚠
```

## Output Format

```markdown
## SQL Trace: `audit_log` (reads)

### Read sites
| Function | File | Caller chain | Test reach |
|----------|------|--------------|------------|
| getAuditByUser | src/admin/audit.ts | Controller → Router | ✓ |
| getAuditByAction | src/admin/audit.ts | Controller → Router | ✓ |
| exportAuditCSV | src/admin/audit.ts | Controller → Router | ✗ |
| countRecentAuditEntries | src/dashboard/health.ts | HealthCheck → cron | ✗ |
| debugAuditDump | src/scripts/debug.ts | (no auth?) ⚠ | ✗ |

### Hot path
`AuditController` is the gateway for 3 of 5 read sites. Optimizations
that route through it benefit the most.

### Risks
- `debugAuditDump` has no auth and no tests. Investigate.
```
