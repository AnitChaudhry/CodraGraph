# Use Case 07 — Cross-Repo Dependency Tracking

## The job

> "We have 18 microservices. If I change the contract on `auth-service.checkPermission`, which other services break?"

Cross-repo impact is the hardest dependency-tracking problem. Each service's CI is isolated; each repo's tools assume one repo. The team finds out about breakage in production.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| Sourcegraph (multi-repo) | Cross-repo search | Substring search; doesn't extract gRPC / OpenAPI contracts |
| Backstage | Service catalog | High-level metadata; no symbol-level impact |
| OpenAPI / Protobuf tooling | Compatibility checks | Limited to API-shape; misses internal-service-call breakage |
| Custom CI integration | Team-built | Brittle, repo-specific |

## What Codragraph does differently

**Cross-repo groups** are a first-class concept in Codragraph.

Configure a `group.yaml` listing the repos in your microservices estate:

```yaml
name: payments-platform
repos:
  - name: auth-service
    path: ../auth-service
  - name: billing-service
    path: ../billing-service
  - name: notifications-service
    path: ../notifications-service
```

Then Codragraph's contract bridge:
1. **Extracts contracts** from each repo (HTTP route handlers, gRPC services, exported tool definitions)
2. **Maps consumer-side calls** — which services call which other services
3. **Cross-links** at the symbol level when types align

Now `codragraph_impact target="auth-service.checkPermission" repo="@payments-platform"` returns:

```
Cross-repo impact (group: payments-platform):

In auth-service (origin):
  3 internal callers (LOW — refactor-safe within service)

In billing-service:
  1 consumer in src/handlers/charge.ts (HIGH)
  Method called via gRPC client; breaking change if signature changes.

In notifications-service:
  2 consumers in src/notify-on-perm-change.ts (MEDIUM)
  Read .userId from response; renaming that field would break.

Stale Contract Registry: NO. Last sync: 2 hours ago.
```

## The before / after

**Before:** The team has a "platform team" channel. Someone proposes a contract change. 6 senior engineers from 3 services jump in to assess impact. Discussion goes 2 days. One service still misses a consumer; production page on Saturday.

**After:** `codragraph group_sync` runs in CI nightly. Engineer proposes change → `codragraph_impact` against the group → gets a stratified list across 18 repos → updates the 4 affected services in the same PR. Production stays up.

## Why the moat matters here

Microservice coordination is **continuous and high-stakes**. The same kind of cross-repo impact question gets asked 50–500 times across the year. Versioned recipe memory means the harness's "cross-service impact" recipe gets battle-tested across hundreds of these queries — and stays valid until your group structure changes (new service, removed service).

The Contract Registry itself is versioned alongside the graph. Each commit produces a snapshot; the bridge keeps both per-repo indexes and the cross-link graph fresh.

## Sample CI integration

```yaml
# .github/workflows/cross-repo-impact.yml
- name: Codragraph cross-repo impact
  run: |
    npx codragraph group_sync --name payments-platform
    npx codragraph impact \
      --target ${{ env.CHANGED_SYMBOL }} \
      --repo @payments-platform \
      --fail-on-risk HIGH
```

Block merges that introduce HIGH-risk cross-repo changes.

## Honest limit

Codragraph picks up **statically declared** contracts (HTTP routes, gRPC service definitions, tRPC procedure exports, OpenAPI specs in source). Services that communicate via dynamically-built URLs or message-bus topics need additional configuration. The contract bridge is best-effort — combine with runtime telemetry for full coverage.
