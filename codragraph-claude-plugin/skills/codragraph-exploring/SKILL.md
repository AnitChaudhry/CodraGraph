---
name: codragraph-exploring
description: "Use when the user asks how code works, wants to understand architecture, trace execution flows, or explore unfamiliar parts of the codebase. Examples: \"How does X work?\", \"What calls this function?\", \"Show me the auth flow\""
---

# Exploring Codebases with CodraGraph

## When to Use

- "How does authentication work?"
- "What's the project structure?"
- "Show me the main components"
- "Where is the database logic?"
- Understanding code you haven't seen before

## Workflow

```
1. READ codragraph://repos                          â†’ Discover indexed repos
2. READ codragraph://repo/{name}/context             â†’ Codebase overview, check staleness
3. codragraph_query({query: "<what you want to understand>"})  â†’ Find related execution flows
4. codragraph_context({name: "<symbol>"})            â†’ Deep dive on specific symbol
5. READ codragraph://repo/{name}/process/{name}      â†’ Trace full execution flow
```

> If step 2 says "Index is stale" â†’ run `npx @codragraph/cli analyze` in terminal.

## Checklist

```
- [ ] READ codragraph://repo/{name}/context
- [ ] codragraph_query for the concept you want to understand
- [ ] Review returned processes (execution flows)
- [ ] codragraph_context on key symbols for callers/callees
- [ ] READ process resource for full execution traces
- [ ] Read source files for implementation details
```

## Resources

| Resource                                | What you get                                            |
| --------------------------------------- | ------------------------------------------------------- |
| `codragraph://repo/{name}/context`        | Stats, staleness warning (~150 tokens)                  |
| `codragraph://repo/{name}/clusters`       | All functional areas with cohesion scores (~300 tokens) |
| `codragraph://repo/{name}/cluster/{name}` | Area members with file paths (~500 tokens)              |
| `codragraph://repo/{name}/process/{name}` | Step-by-step execution trace (~200 tokens)              |

## Tools

**codragraph_query** â€” find execution flows related to a concept:

```
codragraph_query({query: "payment processing"})
â†’ Processes: CheckoutFlow, RefundFlow, WebhookHandler
â†’ Symbols grouped by flow with file locations
```

**codragraph_context** â€” 360-degree view of a symbol:

```
codragraph_context({name: "validateUser"})
â†’ Incoming calls: loginHandler, apiMiddleware
â†’ Outgoing calls: checkToken, getUserById
â†’ Processes: LoginFlow (step 2/5), TokenRefresh (step 1/3)
```

## Example: "How does payment processing work?"

```
1. READ codragraph://repo/my-app/context       â†’ 918 symbols, 45 processes
2. codragraph_query({query: "payment processing"})
   â†’ CheckoutFlow: processPayment â†’ validateCard â†’ chargeStripe
   â†’ RefundFlow: initiateRefund â†’ calculateRefund â†’ processRefund
3. codragraph_context({name: "processPayment"})
   â†’ Incoming: checkoutHandler, webhookHandler
   â†’ Outgoing: validateCard, chargeStripe, saveTransaction
4. Read src/payments/processor.ts for implementation details
```
