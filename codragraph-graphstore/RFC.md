# RFC — codragraph-graphstore (Phase 4)

| Field | Value |
|---|---|
| Status | Complete (2026-04-29) — three-way merge, semantic diff, gc all shipped |
| Phase | 4 of 5 (Dolt-like versioned graph) |
| Author | Anit Chaudhary |
| Built in parallel with | Phase 3 (swarm) — separate session |
| Approach | Hybrid: keep LadybugDB as runtime backend, add CAS layer alongside |

## 1. Goals

Phase 4 establishes the foundation for capability #3 of the CodraGraph product
(versioned code graph). Specifically:

1. **Content-addressed snapshots** of the knowledge graph — each
   `codragraph analyze` produces an immutable, sha256-rooted snapshot
   that can be diffed, branched, merged, and time-travelled.
2. **Branches & commits** with Git-shaped semantics (refs/heads/<name>,
   HEAD pointer, parents) so users can build mental models from prior
   tools.
3. **Structural diff** — added/removed/modified nodes & edges by table
   between any two snapshots.
4. **Hybrid storage** — LadybugDB stays the runtime query backend
   (every existing Cypher / MCP / CLI path is unchanged); historical
   snapshots are queryable by materializing them back into a fresh
   ephemeral lbug.
5. **Engine-agnostic core** — the graphstore package itself does not
   depend on `@ladybugdb/core`; it's wired to the live database via a
   thin adapter inside `codragraph/`.

Shipped end-to-end as of 2026-04-29:

- ✅ Content-addressed snapshots, branches, commits.
- ✅ Structural diff (added/removed/modified by table).
- ✅ **Three-way merger**: real row-level merge with conflict detection
  (`modified-on-both-sides`, `modified-vs-deleted`,
  `added-on-both-sides-with-different-content`). Fast-forward and
  already-up-to-date paths handled; clean merges write a new snapshot
  to CAS and return its id; conflicts short-circuit the write.
- ✅ **Semantic diff**: classifies modifiedSymbols into
  signature/visibility/body/location/metadata, surfaces added/removed
  exported APIs, surfaces added/removed Processes.
- ✅ **Branch delete + mark-and-sweep gc** with a `--dry-run` mode.
- ✅ **Full CLI**: `log`, `branch list/create/delete`, `diff [--semantic]`,
  `commit -m`, `checkout [--materialize]`, `materialize --into`,
  `merge`, `blame`, `gc [--dry-run]`.
- ✅ **MCP**: 7 tools (`graphstore_log/branches/diff/semantic_diff/merge/gc/blame_symbol`),
  3 resources (`codragraph://repo/{name}/graphstore/{log,branches,head}`),
  5 prompts (`review_recent_changes`, `inspect_change_history`,
  `compare_branches`, `resolve_merge`, `cleanup_graphstore`).

Deferred (genuinely out of scope, not the same as "stubbed"):

- Chunked Merkle-tree manifests for 100k+-row tables (the Snapshot
  references manifest by id, so chunking is a non-breaking extension —
  wait until a real repo bites the per-table-record limit).
- CSV-based bulk loader for `materialize` (current per-row CREATE works
  fine below ~50k rows; profile-guided optimization later).
- The moat hook: versioned recipe memory in `codragraph-harness` keyed
  on `(snapshot_id, task_family, recipe_id)`. This is the Phase 3 ×
  Phase 4 integration that turns versioning into token savings; lands
  in a follow-up session.

## 2. Package layout

```
codragraph-graphstore/
├── package.json                v0.1.0; author Anit Chaudhary; Apache-2.0
├── tsconfig.json               ESM, NodeNext, strict + noUncheckedIndexedAccess
├── vitest.config.ts            test runner config
├── README.md                   user-facing intro
├── RFC.md                      this doc
├── src/
│   ├── index.ts                aggregated public surface
│   ├── types.ts                ObjectId, Snapshot, Commit, Branch, GraphDiff
│   ├── cas/
│   │   ├── interface.ts        ContentAddressedStore { put, get, has, list }
│   │   └── fs-cas.ts           Filesystem impl, 2-char fan-out, atomic writes
│   ├── snapshot/
│   │   ├── row-source.ts       RowSource / RowSink interfaces
│   │   ├── serializer.ts       Walk RowSource → emit Snapshot
│   │   └── materializer.ts     Read Snapshot → write rows into RowSink
│   ├── history/
│   │   ├── commit.ts           createCommit, readCommit
│   │   ├── branch.ts           createBranch, listBranches, getHead, setHead, HEAD
│   │   └── log.ts              walkCommits (BFS), findLowestCommonAncestor
│   ├── diff/
│   │   ├── structural.ts       diffSnapshots → GraphDiff
│   │   └── semantic.ts         Stub for Phase 4.5 (routes to structural)
│   └── merge/
│       └── three-way.ts        LCA-based fast-forward; needs-merge for divergent
└── test/
    ├── types.test.ts           ObjectId branding + canonical JSON
    ├── cas.test.ts             FsCAS roundtrip, dedup, fan-out, list
    ├── branch.test.ts          refs/heads, HEAD, path-traversal guards
    ├── log.test.ts             walkCommits, LCA edge cases
    ├── snapshot.test.ts        Stable hashing, materialize roundtrip, diff
    └── merge.test.ts           Fast-forward, already-up-to-date, needs-merge
```

## 3. Contracts

### 3.1 ObjectId

Branded `sha256:<64-hex>` string. `makeObjectId` mints from a raw digest;
`parseObjectId` validates at trust boundaries. Branding prevents arbitrary
strings from being treated as object ids by the type system.

### 3.2 Snapshot / SnapshotManifest

The Snapshot is a small reference object (`{ schemaVersion, type,
manifestId, createdAt, indexedRepoCommit? }`); its own hash is the
identity returned to callers. The bulk of the data lives in the
SnapshotManifest, a separate CAS object — this layering supports
future chunking without changing the Snapshot wire shape.

```ts
interface SnapshotManifest {
  schemaVersion: 1;
  type: "snapshot-manifest";
  nodeTables: Record<string, TableManifest>;
  edges: TableManifest;
}
interface TableManifest {
  rowCount: number;
  rows: Record<string, ObjectId>; // logical id → CAS id of the row object
}
```

### 3.3 Commit / Branch

```ts
interface Commit {
  schemaVersion: 1;
  type: "commit";
  snapshot: ObjectId;
  parents: ObjectId[];           // [], [p], or [a, b] for merge
  author: { name, email };
  ts: string;                    // ISO 8601
  message: string;
}
interface Branch {
  name: string;
  head: ObjectId;                // commit id
  createdAt: string;             // filesystem birthtime, ISO 8601
}
```

### 3.4 GraphDiff

```ts
interface GraphDiff {
  from: ObjectId; to: ObjectId;
  addedNodes:   Record<string, ObjectId[]>; // by table
  removedNodes: Record<string, ObjectId[]>;
  addedEdges:   ObjectId[];
  removedEdges: ObjectId[];
  modifiedSymbols: Array<{
    table: string; id: string;
    fromHash: ObjectId; toHash: ObjectId;
  }>;
}
```

## 4. Algorithm — serialize / materialize

**Serialize** (`src/snapshot/serializer.ts`):

```
for each node table T in source.listNodeTables():
    for each row r in source.streamNodeTable(T):
        rowId ← cas.put(canonicalJSON(r))
        nodeTables[T].rows[r.id] ← rowId
        nodeTables[T].rowCount++
for each edge r in source.streamEdges():
    rowId ← cas.put(canonicalJSON(r))
    edges.rows[`${r.from}|${r.type}|${r.to}`] ← rowId
manifestId ← cas.put(canonicalJSON({ nodeTables, edges }))
snapshotId ← cas.put(canonicalJSON({ manifestId, createdAt, ... }))
return snapshotId
```

Determinism: every step uses canonical JSON (sorted keys); two equal
graphs produce byte-for-byte identical bytes through every layer →
identical sha256 → identical snapshot id. This is what makes the
content-addressing invariant load-bearing.

**Materialize** (`src/snapshot/materializer.ts`) is the inverse: read
the manifest, fetch every row from CAS, replay into a `RowSink` in
batches. The sink encapsulates whatever bulk-loading dance the
underlying engine prefers (LadybugDB likes CSV + COPY).

## 5. Filesystem layout (per repo)

```
<repo>/.codragraph/graphstore/
├── HEAD                              ref: refs/heads/main  | <commit-id>
├── refs/
│   └── heads/
│       └── main                      <commit-id>
└── objects/
    └── <aa>/
        └── <62-hex-chars>.json       canonical JSON of one CAS object
```

The `objects/<aa>/<rest>.json` fan-out matches Git's strategy — keeps
any single directory's entry count bounded for huge graphs.

## 6. Hook into analyze

`codragraph/src/core/run-analyze.ts` calls `recordAnalysisSnapshot` after
`loadGraphToLbug` completes. The hook is **best-effort** — wrapped in
try/catch, failures log via `callbacks.onLog` and never break the
surrounding analyze flow. Per-table query failures are folded into an
`onSkipTable` callback so the user sees which tables were missed.

`RepoMeta` extends with `currentBranch?` + `headCommit?`; both
populated only when the snapshot succeeded. Mirrored on
`RegistryEntry` so the global registry surfaces them too.

## 7. Decisions & rationale

| Decision | Why |
|---|---|
| Hybrid storage (CAS + lbug, not replace) | Preserves every existing query path; reversible if the experiment doesn't pan out |
| Filesystem CAS, not embedded DB | Git/Dolt convention is a familiar mental model; trivially backed up; future S3/remote backend is the same interface |
| TableManifest keyed by logical id | Diff needs to detect modified-in-place — flat row-hash list can't |
| Single rel manifest (no per-pair split) | Phase 4 keeps the relationship table as one logical object; the existing lbug per-label-pair CSV splitting is a load-time optimization, not a versioning concern |
| `_id` / `_label` stripped from row hashes | LadybugDB internal storage offsets must not leak into content addresses — would break dedup across snapshots |
| Three-way merge stubbed | Genuinely open-ended research; LCA + fast-forward gives 80% of the value and unblocks the dashboard's "diff against main" view |
| Best-effort analyze hook | Phase 4 is research-tagged; can't block the production analyze path on it |
| codragraph-graphstore depends on codragraph-shared, not codragraph | Avoids the circular import; shared has the table-name constants we need |

## 8. Open follow-ups

What's left is genuinely follow-up work, not Phase 4 gaps.

1. **Chunked Merkle manifests** — for repos with 100k+ symbols, a
   single `Record<id, ObjectId>` per table becomes inconvenient for
   diff. Plan: shard by id-hash prefix into a tree; non-breaking
   because the Snapshot already points at a single `manifestId`.
   Defer until a real repo hits the limit.
2. **CSV-based bulk loader for `materialize`** — current
   `LbugRowSinkForCheckout` does per-row CREATE. Fine up to ~50k rows;
   beyond that, switch to the same CSV + COPY path that `loadGraphToLbug`
   uses. Profile-guided.
3. **The moat hook (versioned recipe memory)** — store harness Pareto
   recipes keyed by `(snapshot_id, task_family, recipe_id)`. Belongs
   in `codragraph-harness` now that Phase 3 + Phase 4 are both live —
   the actual product moat (token savings via cached harness recipes
   that auto-invalidate when the relevant subgraph changes).
4. **Semantic diff: more classifiers** — `semantic-v1` covers
   signature/visibility/body/location/metadata for symbol tables and
   bucketed Processes. Future versions: API-shape contracts (parameter
   types per language), removed-from-public-export detection,
   process-membership churn.

## 9. Phase order

| Phase | Scope | Status |
|---|---|---|
| 1   | Harness in TS                                | Shipped |
| 1.5 | Port `codragraph-compress` to TS             | Shipped |
| 3   | Swarm — multiple proposers in parallel       | Shipped (parallel session) |
| 4   | **Dolt-like versioned graph (THIS RFC)**     | **Complete** — three-way merge + semantic diff + gc all shipped |
| 2   | Dashboard MVP in `codragraph-web`            | Pending (consumes Phase 4 data model) |
| 5   | Org features (multi-tenant, SSO, audit)      | Unblocked 2026-04-29 — monorepo relicensed to Apache-2.0 |
