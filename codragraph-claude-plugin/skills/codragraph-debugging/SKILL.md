---
name: codragraph-debugging
description: "Use when the user is debugging a bug, tracing an error, or asking why something fails. Examples: \"Why is X failing?\", \"Where does this error come from?\", \"Trace this bug\""
---

# Debugging with CodraGraph

## When to Use

- "Why is this function failing?"
- "Trace where this error comes from"
- "Who calls this method?"
- "This endpoint returns 500"
- Investigating bugs, errors, or unexpected behavior

## Workflow

```
1. codragraph_query({query: "<error or symptom>"})            â†’ Find related execution flows
2. codragraph_context({name: "<suspect>"})                    â†’ See callers/callees/processes
3. READ codragraph://repo/{name}/process/{name}                â†’ Trace execution flow
4. codragraph_cypher({query: "MATCH path..."})                 â†’ Custom traces if needed
```

> If "Index is stale" â†’ run `npx codragraph analyze` in terminal.

## Checklist

```
- [ ] Understand the symptom (error message, unexpected behavior)
- [ ] codragraph_query for error text or related code
- [ ] Identify the suspect function from returned processes
- [ ] codragraph_context to see callers and callees
- [ ] Trace execution flow via process resource if applicable
- [ ] codragraph_cypher for custom call chain traces if needed
- [ ] Read source files to confirm root cause
```

## Debugging Patterns

| Symptom              | CodraGraph Approach                                          |
| -------------------- | ---------------------------------------------------------- |
| Error message        | `codragraph_query` for error text â†’ `context` on throw sites |
| Wrong return value   | `context` on the function â†’ trace callees for data flow    |
| Intermittent failure | `context` â†’ look for external calls, async deps            |
| Performance issue    | `context` â†’ find symbols with many callers (hot paths)     |
| Recent regression    | `detect_changes` to see what your changes affect           |

## Tools

**codragraph_query** â€” find code related to error:

```
codragraph_query({query: "payment validation error"})
â†’ Processes: CheckoutFlow, ErrorHandling
â†’ Symbols: validatePayment, handlePaymentError, PaymentException
```

**codragraph_context** â€” full context for a suspect:

```
codragraph_context({name: "validatePayment"})
â†’ Incoming calls: processCheckout, webhookHandler
â†’ Outgoing calls: verifyCard, fetchRates (external API!)
â†’ Processes: CheckoutFlow (step 3/7)
```

**codragraph_cypher** â€” custom call chain traces:

```cypher
MATCH path = (a)-[:CodeRelation {type: 'CALLS'}*1..2]->(b:Function {name: "validatePayment"})
RETURN [n IN nodes(path) | n.name] AS chain
```

## Example: "Payment endpoint returns 500 intermittently"

```
1. codragraph_query({query: "payment error handling"})
   â†’ Processes: CheckoutFlow, ErrorHandling
   â†’ Symbols: validatePayment, handlePaymentError

2. codragraph_context({name: "validatePayment"})
   â†’ Outgoing calls: verifyCard, fetchRates (external API!)

3. READ codragraph://repo/my-app/process/CheckoutFlow
   â†’ Step 3: validatePayment â†’ calls fetchRates (external)

4. Root cause: fetchRates calls external API without proper timeout
```
