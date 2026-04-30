---
name: codragraph-observability-coverage
description: "Use to audit observability coverage — which functions / processes have logs, metrics, or distributed-trace spans, and which don't. Find the dark corners where you're flying blind. Examples: \"observability coverage\", \"unlogged code\", \"missing traces\", \"telemetry audit\", \"where are we flying blind\""
---

# Observability Coverage Audit with CodraGraph

## When to Use

- "Which functions have NO logs / metrics / traces?"
- "Audit telemetry coverage on the request path."
- "Find dark spots in my observability."
- "Are all my critical processes instrumented?"
- Post-incident review: "did we have visibility into X?"

## Why CodraGraph helps here

Telemetry calls are just function calls — `logger.info(...)`,
`tracer.startSpan(...)`, `metrics.histogram(...)`. CodraGraph's call
graph shows you exactly which symbols invoke them. Subtract those from
your full symbol set: the difference is your dark zone.

## Workflow

```
1. Identify your telemetry surface area:
   codragraph_query({query: "logger trace span metric histogram counter"})
   → list of telemetry-emitting helpers (logger.info, span.end, metrics.timing, ...)

2. For each telemetry helper, find its callers:
   codragraph_cypher({query: `
     MATCH (caller)-[:CALLS]->(t {name: '<telemetry-fn>'})
     RETURN DISTINCT caller.id, caller.name
   `})
   → "instrumented" set: every function that emits telemetry

3. Map your critical surface (processes / entry points):
   READ codragraph://repo/{name}/processes
   → request-path / job-path flows

4. Subtract: which symbols in critical processes are NOT in the
   instrumented set?
   codragraph_cypher({query: `
     MATCH (n {label: 'Function'})
     WHERE n.isEntryPoint = true
       AND NOT EXISTS {
         MATCH (n)-[:CALLS*1..3]->(t)
         WHERE t.name STARTS WITH 'logger.'
            OR t.name STARTS WITH 'tracer.'
            OR t.name STARTS WITH 'metrics.'
       }
     RETURN n.name, n.filePath
   `})
   → entry points with NO telemetry within 3 hops = dark zones

5. For each dark zone, codragraph_context to confirm and propose
   minimum-viable instrumentation (one log line + one span)
```

## Coverage tiers

| Tier | What's covered | What it tells you |
|---|---|---|
| **None** | No telemetry within 3 hops of entry point | Flying blind under load |
| **Logs only** | `logger.*` reachable but no `tracer.*` / `metrics.*` | Can debug post-hoc, can't query prod |
| **Logs + metrics** | Counters / histograms emitted | Dashboards possible |
| **Logs + metrics + traces** | Spans tied to request flow | Full observability |
| **Structured + correlated** | All three with a request_id propagated | Best — can chase one user through everything |

## Checklist

```
- [ ] Listed telemetry-emitting helpers (logger / tracer / metrics)
- [ ] Resolved their direct callers (instrumented set)
- [ ] Listed critical processes / entry points
- [ ] Subtracted: which entry points have no telemetry within 3 hops?
- [ ] For each gap, propose minimum-viable instrumentation
- [ ] Tier-rate each critical flow (None / Logs / Metrics / Traces / Correlated)
```

## Example: "Audit observability on our checkout flow"

```
1. codragraph_query({query: "checkout payment process"})
   → CheckoutFlow process: 7 steps (validateCart → reservePayment →
     captureFunds → createOrder → notifyShip → emitReceipt → done)

2. Telemetry helpers:
   - logger.info, logger.warn, logger.error
   - tracer.startSpan, span.end
   - metrics.histogram, metrics.counter

3. For each step in CheckoutFlow:
   codragraph_context({name: "<step>"})
   → check callees include any telemetry helper

   - validateCart    → logger.info ✓, tracer ✓, metrics ✗
   - reservePayment  → logger.info ✓, tracer ✓, metrics ✗
   - captureFunds    → logger.info ✓, tracer ✗, metrics ✗ ⚠
   - createOrder     → logger.info ✓, tracer ✓, metrics ✓
   - notifyShip     → ⚠ NOTHING (dark zone)
   - emitReceipt     → logger.info ✓
   - done            → logger.info ✓

4. Gaps:
   - notifyShip: entirely unobserved. Add tracer.startSpan + counter on
     success/failure. Cheapest fix to close the gap.
   - captureFunds: missing tracer span around the actual capture call.
     Add for distributed-trace correlation with payment provider.
   - validateCart, reservePayment, captureFunds: missing latency histograms.
     Add metrics.timing for each.

Tier rating: Logs ✓, Metrics partial ⚠, Traces partial ⚠, Correlated ✓
   (request_id is propagated end-to-end where instrumentation exists).
```

## Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Telemetry behind a façade | Direct caller is your `obs.log()` wrapper, not `logger.info` | Search for the wrapper too |
| Conditional logging only on errors | "Looks instrumented" but emits nothing on the happy path | Audit success paths separately |
| Telemetry in middleware, missing in handler | Edge instrumentation doesn't show handler-internal state | Check both layers |
| Excessive logging in hot loops | Coverage looks great, dashboards drown in noise | Pair with codragraph-perf-hotspots; sample logs in hot paths |
```
