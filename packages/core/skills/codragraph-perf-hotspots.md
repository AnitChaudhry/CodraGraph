---
name: codragraph-perf-hotspots
description: "Use to identify likely performance hot paths from the call graph — top-N callees of entry points, fan-out functions, recursive cycles, and where to focus profiling effort. NOT a profiler — a structural pre-screen that narrows where to actually run a profiler. Examples: \"find perf hotspots\", \"hot paths\", \"top callees\", \"where should I profile\", \"functions called by every handler\""
---

# Performance Hotspot Pre-Screen with CodraGraph

## When to Use

- "Where should I focus my profiler?"
- "Which functions are on every request path?"
- "Find fan-out points — functions called from many places."
- "Are there recursive call cycles?"
- "List top N callees of the API request handler."

## What this skill IS and ISN'T

CodraGraph builds a **static call graph** — it knows who *can* call
whom, not who *did* call whom in production. So this skill identifies
**structural hot path candidates**, not measured hotspots.

Use it as a **pre-screen** for actual profiling: "given my structural
hot path candidates, the profiler should focus here first." If you have
profiler data (pprof, flamegraphs, OpenTelemetry traces), CodraGraph
turns the names from that data into actionable callgraph context.

## Workflow

```
1. Identify entry points:
   codragraph_query({query: "request handler endpoint route main"})
   → top entry-point candidates

2. For each entry point, get top N callees ordered by depth-1 fan-in:
   codragraph_cypher({query: `
     MATCH (caller)-[:CALLS]->(callee)
     WHERE callee.label = 'Function'
     RETURN callee.name, count(DISTINCT caller) AS in_degree
     ORDER BY in_degree DESC
     LIMIT 20
   `})
   → callees called from many places = on many paths = candidate hot spots

3. Cross-cut with processes:
   READ codragraph://repo/{name}/processes
   → functions appearing in MANY processes ARE on the hot path by definition

4. Recursive cycle detection:
   codragraph_cypher({query: `
     MATCH path = (n)-[:CALLS*2..6]->(n)
     RETURN n.name, length(path) AS cycle_len
     ORDER BY cycle_len ASC
     LIMIT 10
   `})
   → unbounded recursion = potential perf cliff under specific inputs

5. With profiler output, translate names back to context:
   For each top-N name from your flamegraph/pprof:
     codragraph_context({name: "<sym>"})
     → "this function is on N execution flows; called by M sites"
```

## Hot-path heuristics

| Signal | Meaning |
|---|---|
| Function called from > 10 distinct callers | High fan-in → optimize once, win everywhere |
| Function appearing in > 5 processes | On many request paths → request-time critical |
| Cycle of length 2-3 in CALLS edges | Mutual recursion — may overflow under depth |
| `await` chain of length > 8 in one process | Sequential I/O — candidate for parallelism |
| Function under cluster `database` / `network` | I/O-bound; profile network and DB calls separately |

## Checklist

```
- [ ] List entry points (codragraph_query for handlers/routes/main)
- [ ] Top-N callees by in-degree (Cypher)
- [ ] Cross-reference with processes (functions in many flows = hot)
- [ ] Cycle detection
- [ ] If profiler data exists, codragraph_context for each top hot symbol
- [ ] Prioritize: request-path + high in-degree + I/O-bound = first to optimize
```

## Example: "Find the hot paths in our HTTP handler chain"

```
1. codragraph_query({query: "express router handler"})
   → 28 handler functions

2. codragraph_cypher({query: `
     MATCH (caller)-[:CALLS]->(callee)
     WHERE callee.label = 'Function'
     RETURN callee.name, count(DISTINCT caller) AS in_degree
     ORDER BY in_degree DESC LIMIT 10
   `})
   → top in-degree callees:
     - logRequest (28)         ← every handler calls this
     - getCurrentUser (22)
     - db.query (18)           ← I/O bound
     - cache.get (15)
     - serializeJson (28)      ← every handler calls this

3. READ codragraph://repo/CodraGraph/processes
   → 5 processes; getCurrentUser appears in 4 of 5

4. codragraph_context({name: "getCurrentUser"})
   → 22 callers, calls db.query (cache miss path) and cache.get
   → STRONGLY recommend: profile getCurrentUser first.
   → Win-rate per opt: 22 callers × cache miss rate × DB latency.
```

## Output Format

```markdown
## Perf Pre-Screen: <scope>

### Top hot-path candidates (structural)
| Function | In-degree | Processes | I/O type | Note |
|---|--:|--:|---|---|
| getCurrentUser | 22 | 4 | DB + cache | profile first |
| db.query | 18 | 5 | DB | hot for write paths |
| serializeJson | 28 | 5 | CPU | every handler — micro-opt territory |

### Cycles detected
- `processStep ↔ enqueueRetry` — depth 2 cycle, unbounded under failure conditions

### Profiler integration plan
1. Collect pprof / flamegraph / OTEL trace under representative load
2. Top-N hottest functions from profile → run codragraph_context on each
3. Cross-reference with this static pre-screen
4. Optimize where structural & measured hot paths overlap
```
