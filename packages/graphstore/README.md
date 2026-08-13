# @codragraph/graphstore

Dolt-like content-addressed versioning for the CodraGraph knowledge graph.

> Your codebase has git history. Your agent's understanding of it should too.

This package adds a versioning layer underneath the existing LadybugDB-backed query path. Each `codragraph analyze` produces an immutable, content-addressed snapshot of the knowledge graph, including FeatureCluster nodes and their feature membership/dependency edges. Branches, merges, and structured diffs operate on those snapshots; querying a historical snapshot materializes it back into an ephemeral LadybugDB so the existing Cypher/MCP surface keeps working unchanged.

## Status

Developer preview. Capabilities:

- [x] Content-addressed object store (FsCAS)
- [x] Snapshot serializer (graph rows → CAS)
- [x] Snapshot materializer (CAS → fresh LadybugDB)
- [x] Branches (filesystem refs)
- [x] Commits + log
- [x] Structural diff (added/removed nodes & edges by table)
- [x] Semantic diff — signature / visibility / body / location / metadata classification
- [x] Three-way merge with conflict detection
- [x] Mark-and-sweep gc

## Layout

```
src/
├── types.ts                  Branded ObjectId, Snapshot, Commit, Branch, GraphDiff
├── cas/
│   ├── interface.ts          ContentAddressedStore { put, get, has, list }
│   └── fs-cas.ts             Filesystem CAS — .codragraph/graphstore/objects/<aa>/<rest>
├── snapshot/
│   ├── row-source.ts         RowSource / RowSink — abstract over LadybugDB
│   ├── serializer.ts         Walk RowSource → emit Snapshot
│   └── materializer.ts       Read Snapshot → write rows into RowSink
├── history/
│   ├── commit.ts             createCommit, readCommit
│   ├── branch.ts             createBranch, listBranches, getHead, setHead, HEAD
│   └── log.ts                walkCommits backward
├── diff/
│   ├── structural.ts         Diff between two Snapshot ids
│   └── semantic.ts           Higher-level diff with change classification
└── merge/
    └── three-way.ts          LCA-based three-way merge with conflict detection
```

## Quick start

Most users get graphstore through `@codragraph/cli`; install this package
directly only when you want to embed content-addressed graph versioning in
your own tool.

```ts
import { FsCAS } from "@codragraph/graphstore/cas";
import { serializeSnapshot, materializeSnapshot } from "@codragraph/graphstore/snapshot";
import { createCommit, getHead, setHead } from "@codragraph/graphstore/history";
import { diffSnapshots } from "@codragraph/graphstore/diff";

const cas = new FsCAS({ root: ".codragraph/graphstore" });

// Take a snapshot
const snapshot = await serializeSnapshot({ source: cgdbRowSource, cas });
const commit = await createCommit({
  cas,
  snapshot: snapshot.id,
  parents: [],
  author: { name: "anit", email: "anit@example.com" },
  message: "initial index",
});
await setHead({ root: ".codragraph/graphstore", branch: "main", commit: commit.id });

// Diff two snapshots
const diff = await diffSnapshots({ cas, from: snapA.id, to: snapB.id });
```

## License

PolyForm Noncommercial License 1.0.0. You may use, modify, and redistribute
this package for noncommercial purposes only — personal projects, study,
research, and charitable, educational, or government use. Commercial use is
not permitted. See the LICENSE and NOTICE files shipped with this package.
