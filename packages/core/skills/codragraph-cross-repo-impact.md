---
name: codragraph-cross-repo-impact
description: "Use when assessing the blast radius of a change that crosses repository boundaries — a shared library used by multiple services, a contract / protobuf / OpenAPI schema consumed by N consumers, a microservices change. Examples: \"what services consume X\", \"cross-repo blast radius\", \"will this break the consumers\", \"who depends on this contract\""
---

# Cross-Repo Impact Analysis with CodraGraph

## When to Use

- "What other repos consume `<symbol>` from this one?"
- "If I change this gRPC method / OpenAPI route / protobuf message, what breaks?"
- "Cross-repo blast radius for `<change>`"
- Microservices architecture: assessing a contract change
- Shared-library author: deciding if a function is safe to remove

## Why CodraGraph helps here

CodraGraph's **groups** (sets of related repos sharing a `group.yaml`)
maintain a Contract Registry — provider/consumer rows for every cross-repo
reference (gRPC service / method, OpenAPI route, protobuf message). The
group-mode `impact` walks both the local call graph AND the contract
bridges, so a single call returns the blast radius across every member
repo. You don't need to re-run impact in each consumer separately.

## Workflow

```
1. Identify the group:
   codragraph_group_list({})
   → list of groups + their member repos

2. Confirm the symbol exists in the producer repo:
   codragraph_context({repo: "<producerRepo>", name: "<symbol>"})

3. Run group-mode impact:
   codragraph_impact({repo: "@<group>", target: "<symbol>", direction: "upstream"})
   → d=1 callers spanning every group member
     (in-repo callers + contract-bridge consumers)

4. Inspect the Contract Registry to see provider/consumer rows directly:
   READ codragraph://group/<groupName>/contracts
   → list of contracts touching the symbol or its API

5. Check group-status / staleness:
   READ codragraph://group/<groupName>/status
   → which member repos haven't been re-indexed recently
     (stale members produce stale impact results)

6. Surface the worst-case consumer:
   any consumer not updated since the schema change = potential breakage
```

> If any member repo's index is stale, group-mode impact may underreport.
> Re-analyze stale members before relying on the results.

## Checklist

```
- [ ] group_list to confirm the group exists and the producer is a member
- [ ] context on the symbol in the producer repo
- [ ] Group-mode impact upstream
- [ ] Inspect Contract Registry for provider/consumer rows
- [ ] Check group/status for stale members; re-analyze if needed
- [ ] List affected consumer repos by impact depth
- [ ] Recommend coordinated PRs across consumers (if breaking)
```

## When to Use Which Tool

| Question | Tool |
| --- | --- |
| "Which repos are in my group?" | `group_list` |
| "What contracts cross between member A and member B?" | Contract Registry resource |
| "If I change this provider method, what breaks?" | Group-mode `impact` |
| "Are all consumers up to date with the latest provider commit?" | `group/<name>/status` resource |
| "What's the structural diff between last release and now in repo X?" | Per-repo `diff --semantic` |

## Example: "Will renaming `getUserProfile` break my microservices?"

```
1. codragraph_group_list({})
   → group "platform": [user-service, web-app, mobile-bff, admin-portal]

2. codragraph_context({repo: "user-service", name: "getUserProfile"})
   → exported gRPC method in user.proto, defined in user-service

3. codragraph_impact({repo: "@platform", target: "getUserProfile", direction: "upstream"})
   → d=1 callers (across the group):
       - web-app/src/api/userClient.ts (CALLS via grpc-web)
       - mobile-bff/internal/user.go (CALLS via grpc.NewClient)
       - admin-portal/src/services/users.tsx (CALLS via grpc-web)
   → 3 consumer repos depend on this method by exact name.

4. READ codragraph://group/platform/contracts
   → user.UserService.getUserProfile: provider=user-service,
     consumers=[web-app, mobile-bff, admin-portal]

5. READ codragraph://group/platform/status
   → web-app last indexed 2 hours ago ✓
   → mobile-bff last indexed 3 days ago ⚠ (might miss recent callers)
   → admin-portal last indexed 1 month ago ⚠⚠ (re-analyze first!)

6. Recommendation:
   - HIGH-RISK rename. 3 consumer repos must change in lockstep.
   - Re-index admin-portal before trusting the d=1 list.
   - Coordinated PR sequence:
     1. Add new method (getUserProfileV2) in user-service
     2. Migrate web-app, mobile-bff, admin-portal to V2
     3. Remove getUserProfile in user-service after all consumers ship
   - Alternative: keep both, deprecate old, drop in next major.
```

## Output Format

```markdown
## Cross-Repo Impact: `<symbol>` in `<producer-repo>` (group `@<group>`)

### Consumers (d=1)
| Repo | Caller | Path | Notes |
| --- | --- | --- | --- |
| web-app | userClient.ts | grpc-web | active |
| mobile-bff | internal/user.go | grpc native | active |
| admin-portal | services/users.tsx | grpc-web | last indexed 1mo ago ⚠ |

### Contracts touching this symbol
- `user.UserService.getUserProfile` (provider: user-service)

### Staleness
Re-analyze `admin-portal` before trusting these results.

### Recommended migration sequence
1. Add `getUserProfileV2` alongside the old method
2. Migrate consumers to V2 (separate PRs per repo)
3. Remove old method after all consumers ship
```
