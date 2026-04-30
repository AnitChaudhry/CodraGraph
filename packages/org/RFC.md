# RFC — packages/org (Phase 5)

| Field | Value |
|---|---|
| Status | Scaffold landed (2026-04-29) |
| Phase | 5 of 5 (Org features) |
| Author | Anit Chaudhary |
| Unblocked by | 2026-04-29 relicense to Apache-2.0 |
| Approach | Scaffold first, RFC second (per AskUserQuestion 2026-04-29) |

## 1. Goals

Phase 5 establishes the foundation for running CodraGraph as a hosted /
multi-customer product. The OSS stack stays unchanged; this layer
sits *above* it and is opt-in for deployments that need it.

Specifically:

1. **Multi-tenant data scoping** — the same server can host many orgs
   without leaking data across them, with traversal-safe paths and an
   AsyncLocalStorage tenant context.
2. **Pluggable SSO** — provider-agnostic `SsoProvider` contract, with
   an in-process test stub. OIDC and SAML reference impls land as
   follow-ups; integrators may also wire in a hosted IdP (Auth0, Clerk,
   WorkOS) without modifying this package.
3. **Role-based access control** — `viewer < member < admin < owner`
   with a default policy covering the core CodraGraph resources
   (repos, recipes, graphstore, audit, org admin).
4. **Tamper-evident audit log** — every privileged action records an
   append-only event whose id is the sha256 of its canonical JSON.
   Re-hashing verifies; mutation breaks the id check by construction.

Out of scope for the MVP scaffold (deferred):

- OIDC client implementation (see §6).
- SAML implementation (interface only).
- Server integration (codragraph's `serve` does not yet require
  `withTenant` on its handlers — that's a breaking change for existing
  users; lands behind a feature flag in a follow-up).
- Per-seat license-key enforcement (the `Org.plan` field is recorded
  but not consulted; gating belongs upstream of this package).
- Org registry storage adapter (FS, Postgres). Out of scope; deployers
  pick their own.

## 2. Package layout

```
packages/org/
├── package.json                     v0.1.0; PolyForm-Noncommercial → Apache-2.0
├── tsconfig.json                    ESM, NodeNext, strict + noUncheckedIndexedAccess
├── vitest.config.ts                 test runner config
├── README.md                        user-facing intro
├── RFC.md                           this doc
├── src/
│   ├── index.ts                     aggregated public surface
│   ├── types.ts                     OrgId, UserId (branded), Org, User, Membership, Role, Plan
│   ├── tenancy/
│   │   ├── context.ts               AsyncLocalStorage TenantContext, withTenant, requireTenant
│   │   └── path.ts                  tenantStorageRoot + tenantSubpath with traversal guards
│   ├── rbac/
│   │   ├── roles.ts                 ROLE_HIERARCHY (strictly ordered), roleAtLeast()
│   │   └── check.ts                 PermissionPolicy, checkPermission, requirePermission, DEFAULT_POLICY
│   ├── audit/
│   │   ├── event.ts                 AuditEvent, buildAuditEvent (id = sha256(canonical JSON)), verifyAuditEvent
│   │   ├── interface.ts             AuditLogger contract — append-only, sync, tamper-evident
│   │   └── cas-log.ts               CasAuditLogger using graphstore CAS + day-bucketed jsonl index; orgScopedLogger
│   └── auth/
│       ├── interface.ts             SsoProvider, AuthorizeInput/Result, CallbackInput, UserClaim
│       └── in-memory.ts             InMemorySsoProvider (test stub) with state CSRF + replay defenses
└── test/
    ├── types.test.ts                Branded id constructors
    ├── tenancy-context.test.ts      sync + async + nested context behavior
    ├── tenancy-path.test.ts         Path traversal refusal
    ├── rbac.test.ts                 Role ordering, default policy, fail-closed default
    ├── audit-cas-log.test.ts        End-to-end through FsContentAddressedStore + filtering + durability
    └── auth-in-memory.test.ts       Authorize / callback round-trip, CSRF, replay, unknown subject
```

## 3. Contracts

### 3.1 OrgId / UserId (branded)

```ts
type OrgId = string & { readonly [orgIdBrand]: true };
type UserId = string & { readonly [userIdBrand]: true };
```

`makeOrgId` / `makeUserId` are the only sanctioned constructors and
validate against a strict regex (`org_<chars>` / `user_<chars>`,
≤64 alphanumerics with `_` and `-`). The brand prevents the type
system from confusing the two and from accepting raw strings at
public API boundaries.

### 3.2 TenantContext

```ts
interface TenantContext {
  readonly orgId: OrgId;
  readonly userId?: UserId;
  readonly ip?: string;
  readonly userAgent?: string;
}

withTenant<T>(ctx: TenantContext, fn: () => T): T   // sync or async
getTenant(): TenantContext | undefined
requireTenant(): TenantContext   // throws NoTenantContextError
```

Nested `withTenant` REPLACES the parent context — there is no merging.
A nested handler that intends to act as a different tenant must be
explicit; callers that want to keep the parent fields spread
`getTenant()` into the new ctx themselves.

### 3.3 Tenant storage paths

```ts
tenantStorageRoot(storageRoot, orgId): string  // <root>/orgs/<orgId>
tenantSubpath(storageRoot, orgId, ...segments): string
```

Both go through `path.resolve` + `path.relative` and refuse anything
that escapes the tenant root, even if the OrgId brand was bypassed
(deserialization, hand-crafted state). The check is defense-in-depth.

### 3.4 RBAC

```ts
type Role = "owner" | "admin" | "member" | "viewer";
type Permission = `${string}.${string}`;

interface PermissionPolicy {
  readonly minRole: ReadonlyMap<Permission, Role>;
  readonly defaultMinRole?: Role;
}

checkPermission(policy, actorRole, permission): boolean
requirePermission(policy, actorRole, permission): void  // or PermissionDeniedError
```

`DEFAULT_POLICY` covers `repo.*`, `recipe.*`, `graphstore.*`,
`org.*`, and `audit.read`. Permissions not in the map default to
the policy's `defaultMinRole` (default: `owner`). **Fail closed.**

### 3.5 AuditEvent

```ts
interface AuditEvent {
  id: ObjectId;            // sha256:<hex>
  schemaVersion: 1;
  type: "audit-event";
  ts: string;              // ISO 8601
  orgId: OrgId;
  actor: AuditActor;       // "user" | "api-key" | "system"
  action: string;          // "<resource>.<verb>"
  resource: AuditResource;
  result: "success" | "failure";
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}
```

`id` is `sha256:<hex>` over the canonical JSON of the event sans `id`.
Anyone with access to the bytes can verify integrity without trusting
the storage layer — `verifyAuditEvent(e)` is `true` iff re-hashing the
body produces `e.id`.

### 3.6 AuditLogger

```ts
interface AuditLogger {
  record(input: AuditEventInput): Promise<AuditEvent>;
  list(filter?: AuditListFilter): AsyncIterable<AuditEvent>;
}
```

Implementations MUST be append-only, tamper-evident, and synchronous
(`record` resolves only when the bytes are durable — no in-memory
buffering). `CasAuditLogger` is the reference impl: each event is one
CAS object; a per-day jsonl index file lists ids in append order.
`orgScopedLogger(logger, orgId)` returns a wrapper that injects the
active org's id on every call.

### 3.7 SsoProvider

```ts
interface SsoProvider {
  readonly name: string;
  readonly type: "oidc" | "saml" | "stub";
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
  callback(input: CallbackInput): Promise<UserClaim>;
}
```

`authorize` returns a `redirectUrl` and an opaque `state` the server
must round-trip back to `callback` for CSRF defense. `callback`
returns a `UserClaim` (subject + email + verified + optional name).
The codragraph server uses `subject` to look up or create the
matching `User` record.

`InMemorySsoProvider` is a test stub: register users by subject, "log
them in" by passing the subject in `callback.params`. Production wires
in OIDC or SAML.

## 4. Storage layout (per tenant)

```
<storageRoot>/
└── orgs/
    └── <orgId>/
        ├── audit/
        │   ├── cas/             # graphstore-style content-addressed objects
        │   │   └── objects/<aa>/<rest>.json
        │   └── log/
        │       └── index/YYYY-MM-DD.jsonl   # event ids in append order
        ├── repos/...            # codragraph repo storage (existing)
        └── recipes/...          # harness recipe store (existing)
```

The `audit/cas` and `audit/log` paths are deliberately separate:
nothing in the spec says the audit CAS has to be the same physical
store as the graphstore CAS. Deployers can point them at the same
directory if they want unified storage, or at S3 + EBS if they want
hot/cold tiers.

## 5. Decisions & rationale

| Decision | Why |
|---|---|
| AsyncLocalStorage for tenant context | Standard Node primitive; survives async hops without parameter threading. Avoids the "did we forget to pass orgId" class of cross-tenant bugs. |
| Replace, don't merge, on nested `withTenant` | Explicit > magical. A handler that wants to keep parent fields spreads `getTenant()` itself. |
| Branded ids with regex constructors | Public API boundaries can't accept raw strings; serialization paths can't bypass validation. |
| sha256 of canonical JSON for audit id | Re-uses the graphstore pattern. Re-hashing verifies — no separate signing key, no trust in the storage layer. |
| Day-bucketed jsonl index | Listing for a date range is O(days), not O(events). Archival by day is trivial (rsync the file). |
| RBAC: 4 roles, hardcoded order | Real-world deployments need ~4. More roles = more confusion. Custom policies extend permissions, not roles. |
| Fail closed on unknown permission | Adding a new resource type doesn't accidentally grant access. |
| In-memory SSO stub ships in core | Tests can exercise the full auth flow without a real IdP. Keeps the OIDC/SAML reference impls optional. |
| Reuse graphstore CAS for audit | Both are content-addressed append-only stores. One implementation, two consumers. |
| packages/org depends on packages/graphstore + packages/shared | Avoids the circular import; the engine packages stay independent of the org layer. |

## 6. Open follow-ups

1. **OIDC reference implementation** — `OidcProvider` using a minimal
   fetch-based authorization-code-with-PKCE flow. Don't pull in a
   heavy client library; integrators who want one (passport, openid-
   client) can write their own provider.
2. **SAML reference implementation** — assertion verification, X.509
   cert handling, NameID claim extraction. Significantly more
   surface area; lands after OIDC.
3. **Session store** — once an `SsoProvider` returns a `UserClaim`,
   the server needs to persist a session. Pluggable: in-memory,
   cookie+JWT, Redis. Belongs in this package since the contract is
   uniform across providers.
4. **codragraph server integration** — add a feature flag
   `CODRAGRAPH_REQUIRE_AUTH=1`. When set, every API handler in
   `packages/core/src/server/api.ts` runs inside `withTenant` derived
   from a session cookie or API key. Existing local-first deployments
   stay unaffected.
5. **OrgRegistry storage adapter** — a place to actually persist the
   `Org`, `User`, `Membership` records. FS adapter (single-node
   deployments) and Postgres adapter (multi-node) are obvious targets.
6. **MCP audit hook** — wire the existing MCP tool dispatcher to call
   `audit.record` on every tool invocation. Currently there is no
   audit trail of MCP calls; should be a one-line change in
   `packages/core/src/mcp/local/local-backend.ts` once the integration
   feature flag lands.
7. **Per-tenant rate limiting** — natural extension; the tenant
   context already carries everything a rate limiter needs.
8. **Org-scoped recipe store** — `packages/harness`'s
   `FsRecipeStore` currently writes to a single `recipes/` directory.
   Once tenant context is wired through the harness, the path can be
   rerooted to `<tenantStorageRoot>/recipes/`.

## 7. Phase order

| Phase | Scope | Status |
|---|---|---|
| 1   | Harness in TS                                | Shipped |
| 1.5 | Port packages/compress to TS               | Shipped |
| 3   | Swarm — multiple proposers in parallel       | Shipped |
| 4   | Dolt-like versioned graph                    | Shipped |
| 2   | Dashboard MVP in apps/web              | Shipped |
| 5   | **Org features (THIS RFC)**                  | **Scaffold landed 2026-04-29** |

## 8. Test counts (initial)

| File | Count |
|---|---|
| `types.test.ts` | 4 |
| `tenancy-context.test.ts` | 5 |
| `tenancy-path.test.ts` | 4 |
| `rbac.test.ts` | 9 |
| `audit-cas-log.test.ts` | 8 |
| `auth-in-memory.test.ts` | 5 |
| **Total** | **35** |
