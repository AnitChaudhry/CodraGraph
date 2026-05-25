# Use Case 04 — API Change Impact Analysis

## The job

> "I want to change `/api/users` to return `userId` instead of `id`. What breaks?"

Public APIs are the highest-blast-radius surface in any codebase. Getting impact analysis wrong here means broken consumers, paged on-call, rolled-back deploys.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| `grep "id"` | Useless — too many false positives | — |
| Sourcegraph code search | Better than grep | No structural understanding of which `id` access is *the* `id` from `/api/users` |
| TypeScript LSP | Type-aware refs | Only finds *typed* refs; misses property-access on untyped `axios.get` results |
| Manual review | Slow, error-prone | Doesn't scale |

The hard part isn't finding "uses of `id`"; it's finding **uses of the `id` returned by THIS API**. Most tools can't do that.

## What CodraGraph does differently

`codragraph_api_impact` is purpose-built for this. It combines four passes:

1. **Route map** — finds the handler for `/api/users` via `codragraph_route_map`
2. **Response shape extraction** — what fields does the handler actually return? (CodraGraph's ORM + return-type extractors).
3. **Consumer detection** — which files call `/api/users` (via fetch/axios/native client patterns)?
4. **Property-access flow** — for each consumer, which properties of the response do they access?

Result: a precise list of "consumers that read `.id` and would break if you renamed it to `.userId`."

## The before / after

**Before:** A senior engineer spends 90 minutes grepping for "users", "id", and the route path; reads each match; manually correlates which consumers read `.id`; misses one because it's accessed via destructuring inside a callback. Production breaks 3 days later.

**After:** `codragraph_api_impact route="/api/users"` returns:

```
Route: GET /api/users
Handler: src/api/users.ts:UsersController.list
Response shape: { id, name, email, createdAt }

Consumers (12):
  src/components/UserList.tsx:34 — accesses .id (USED), .name (USED)
    Risk: HIGH — direct property access, would break on rename
  src/hooks/useUsers.ts:18 — accesses .id (USED), .createdAt (USED)
    Risk: HIGH — destructured: const { id, createdAt } = await ...
  src/admin/users-table.tsx:55 — accesses .name only
    Risk: NONE — doesn't read .id
  ...

Mismatches detected:
  - src/components/UserCard.tsx:67 reads .userId — already inconsistent with API.

Suggested migration:
  1. Add .userId alongside .id in the response (deprecation period)
  2. Update 8 HIGH-risk consumers
  3. Remove .id after 2 weeks
```

That's a refactoring playbook in 15 seconds.

## Why the moat matters here

API change analysis is **the recipe most teams want and never build**. The harness can find the right combination of route extraction + property-flow analysis + consumer scoring for your codebase. Versioned recipe memory means: when your routing convention changes (e.g. you migrate from Express to Hono), the harness re-tunes; until then, every API change gets the same battle-tested analysis pipeline.

## Sample integration

In a pre-merge GH Action:

```yaml
- name: CodraGraph API impact check
  run: |
    npx codragraph api-impact --route /api/users --fail-on-risk HIGH
```

Block merges that have unacknowledged HIGH-risk consumer impact.

## Honest limit

If your consumers reach the API via dynamic patterns (string-built URLs, generic client wrappers), CodraGraph's static analysis can miss them. The graph captures what's statically inspectable. For dynamic patterns, you'll need runtime telemetry — which is a different product.
