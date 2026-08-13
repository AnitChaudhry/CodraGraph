# @codragraph/org

Multi-tenant orgs, SSO, RBAC, and tamper-evident audit logging for the
CodraGraph platform.

This is **Phase 5** of the CodraGraph roadmap: the org-features layer
that turns the local-first OSS into something that can be operated for
multiple teams or customers under one server.

Use this package when you are wrapping the local-first `@codragraph/cli`
indexing workers, FeatureCluster context packs, and graphstore snapshots in
tenant, RBAC, and audit boundaries for a hosted or enterprise deployment.

## What's in here

| Module | What it does |
|---|---|
| `tenancy` | `withTenant` / `requireTenant` AsyncLocalStorage scoping. Path helpers that refuse to escape the org root. |
| `rbac` | `viewer < member < admin < owner`. Default policy covers repos, FeatureCluster context packs/impact, graphstore, recipes, audit, and org administration; integrators extend by composing additional entries. |
| `audit` | Append-only, tamper-evident log. Each event is a content-addressed object (sha256 of canonical JSON = the id). Re-hashing verifies. Re-uses `@codragraph/graphstore`'s CAS for storage. |
| `auth` | Provider-agnostic `SsoProvider` interface. Includes `InMemorySsoProvider` for tests. OIDC and SAML reference impls land in follow-ups. |

## Install

```bash
npm install @codragraph/org
```

## Quick start

```ts
import {
  CasAuditLogger,
  DEFAULT_POLICY,
  checkPermission,
  makeOrgId,
  makeUserId,
  withTenant,
} from "@codragraph/org";
import { FsCAS } from "@codragraph/graphstore/dist/cas/fs-cas.js";

const cas = new FsCAS({ root: "/var/codragraph/cas" });
const audit = new CasAuditLogger(cas, "/var/codragraph/audit");

await withTenant({ orgId: makeOrgId("org_acme") }, async () => {
  if (!checkPermission(DEFAULT_POLICY, "member", "repo.analyze")) return;
  // ... do work ...
  await audit.record({
    ts: new Date().toISOString(),
    orgId: makeOrgId("org_acme"),
    actor: { kind: "user", userId: makeUserId("user_alice") },
    action: "repo.analyze",
    resource: { type: "repo", id: "demo" },
    result: "success",
  });
});
```

## License

PolyForm Noncommercial License 1.0.0. You may use, modify, and redistribute
this package for noncommercial purposes only — personal projects, study,
research, and charitable, educational, or government use. Commercial use is
not permitted. See the LICENSE and NOTICE files shipped with this package.
