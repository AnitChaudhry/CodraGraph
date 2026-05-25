# RFC 0002 — Heap-Pressure Mitigation: Profile First, Then Decide

| Status | Draft (review) |
|---|---|
| Tracks task | `[DESIGN] #10 — Compress to relieve heap pressure during analyze` |
| Author | Thinqmesh Technologies |
| Created | 2026-04-30 |
| Owner | repository maintainers |

> The original ask was "use compression to reduce the 8GB heap requirement
> during analyze on big monorepos." This RFC argues for **profiling
> before implementing.** Building compression into the streaming pipeline
> on a hunch is exactly the path that ships expensive code that doesn't
> move the metric. Don't write compression code until profile data
> proves bodies/strings are actually the heap hog.

## 1. Problem

`codragraph analyze` on large monorepos hits the V8 default heap limit.
The current workaround is `analyze.ts:ensureHeap()` which re-execs with
`--max-old-space-size=8192`. This works but:

- 8 GB is excessive for most users; it's a sledgehammer.
- On constrained CI runners (`ubuntu-latest` with 7GB available), the
  re-exec can OOM.
- Users on 16GB laptops feel the heap warm-up.

Proposed mitigation: compress some intermediate buffer to reduce
retained-set size during the pipeline.

## 2. Why this RFC exists

The mitigation might be the right one. It might also be the wrong one.
**We don't know yet** because no one has profiled where the heap actually
goes during analyze. Possible hot spots, in rough order of plausibility:

1. **Tree-sitter AST nodes** — every parsed file produces an AST that
   stays in memory until call extraction completes. For 16 languages
   with rich grammars, ASTs are surprisingly heavy.
2. **The graph itself** — `KnowledgeGraph` holds all nodes + edges in
   memory until snapshot time. For a 500k-symbol repo, node objects
   alone could be 1–2 GB.
3. **Symbol body strings** — kept in graph nodes; the original target
   of the compression idea.
4. **Embedding vectors** — only when `--embeddings` is on; 768-dim
   float32 = 3KB per symbol; 500k symbols = ~1.5 GB.
5. **Community-detection working memory** — Leiden processor builds
   adjacency structures in TypedArrays.
6. **Process tracing** — DFS over the call graph, retains visited sets.
7. **BM25 indexer** — postings lists for FTS.

If the dominant cost is (1) or (2) or (4), compressing strings does
nothing. If it's (3), compression helps. **We need data to know which.**

## 3. Goals & non-goals

**Goals**
- Establish a reproducible profile of analyze heap usage on small,
  medium, and large fixture repos.
- Identify the top-3 retained-set contributors by phase.
- Make a data-driven decision: compress strings, refactor AST handling,
  stream-flush graph nodes, drop something, etc.
- Publish profile artifacts in `docs/profiles/` so future regressions
  are detectable.

**Non-goals**
- Implementing compression in the streaming pipeline. That's downstream
  of this RFC's findings.
- Dropping the 8GB re-exec. The re-exec can stay as a safety net.
- Optimizing analyze's CPU time. This is a memory-only audit.

## 4. Profiling plan

### 4.1 Fixture set

Pick representative repos at three sizes:

| Size | Symbol count | Repo |
|---|---|---|
| Small | ~5k | `packages/shared` (this monorepo's package) |
| Medium | ~50k | A public mid-size TypeScript project (e.g. Astro core) |
| Large | ~500k | A public large monorepo (e.g. NixOS/nixpkgs subset, or eval/SWE-bench fixture) |

Snapshot the exact commit SHA of each so the profile is reproducible.

### 4.2 Capture method

Run `analyze` under V8 heap profiling:

```bash
node --max-old-space-size=12288 \
     --inspect-brk=0.0.0.0:9229 \
     --heap-prof \
     --heap-prof-interval=131072 \
     --heap-prof-name=analyze-medium \
     --heap-prof-dir=docs/profiles/raw \
  ./packages/core/dist/cli/index.js analyze --no-setup <fixture>
```

For each fixture: capture a heap snapshot at each phase boundary
(phase boundaries are already callbacks via `runFullAnalysis({onProgress})`):

```ts
// packages/core/src/core/run-analyze.ts (instrumentation only — temporary)
onProgress: (phase, percent, message) => {
  if (process.env.CODRAGRAPH_HEAP_PROFILE && PHASE_BOUNDARIES.has(phase)) {
    const snap = require('v8').writeHeapSnapshot(
      path.join(profileDir, `${phase}-${Date.now()}.heapsnapshot`),
    );
    console.error(`heap snapshot at ${phase}: ${snap}`);
  }
};
```

### 4.3 Analysis

Open each `.heapsnapshot` in Chrome DevTools (Memory tab → Load).
Compute:

- **Retained set size** at each phase boundary.
- **Top-N constructors** by retained size (filter to user code; exclude
  V8 internals).
- **Delta between adjacent phases** — what got allocated; what got freed.

Capture the top-10 constructors per phase per fixture in
`docs/profiles/<fixture>-<phase>.md`.

### 4.4 Decision matrix

After profiling, the RFC author updates this table with measured numbers
and the decision falls out:

| If dominant retained-set contributor is… | Then ship… |
|---|---|
| Tree-sitter ASTs (>40% retained set) | Streaming-discard ASTs after extraction; don't keep the tree once symbols are extracted |
| `KnowledgeGraph` node objects | Stream-flush partial graphs to LadybugDB during ingestion; don't hold all of it in RAM |
| Symbol body strings (>30% retained set) | Body compression in-memory (per RFC 0001's `bodyEncoding`) extended to ingestion |
| Embedding vectors | Stream embeddings to disk; never hold all 768-dim arrays simultaneously |
| Adjacency / typed arrays in community processor | Tune Leiden iteration to avoid the worst-case adjacency build |
| Mix of multiple sources <20% each | No single big win; stop here, accept the 8GB re-exec |

## 5. Why we DON'T just ship compression

Three reasons:

1. **Compressing strings does nothing if strings aren't the bottleneck.**
   See §2 — multiple plausible bottlenecks dominate the body-string story.
2. **Compression has CPU cost.** Brotli/zstd encode-on-allocation in the
   hot ingestion loop measurably slows analyze. If it doesn't buy
   meaningful retained-set reduction, that's pure regression.
3. **The user-facing fix (smaller heap requirement) requires not just
   reducing peak memory but knowing *when* it peaks.** Compression
   reduces *steady-state* memory; the OOM risk is in *peak* memory.
   Profiling tells us if peak and steady-state coincide.

## 6. Profiling deliverable

Each fixture × phase produces a row in:

```
docs/profiles/heap-profile-{fixture}-{date}.md

  Phase            Retained (MB)  Top-1                   Top-2                   Top-3
  --------------   -------------  ----------------------  ----------------------  ----------------------
  parse            2031           tree-sitter Tree (54%)  Buffer (12%)            FunctionExtractor (8%)
  resolve-imports  1840           KnowledgeGraph (38%)    SymbolNode bodies (24%) ImportResolver (10%)
  resolve-calls    2210           KnowledgeGraph (45%)    CallProcessor (18%)     LookupTable (9%)
  community        1120           UndirectedGraph (60%)   Leiden working (30%)    -
  ...
```

Plus a 1-page summary RFC update with the decision.

## 7. Decision needed from maintainers

1. Approve the profiling effort (estimated 2-3 days for the runs +
   analysis on a non-Windows machine where vitest works — the Windows
   environment used in this session has known testing issues, see
   memory `feedback_windows_vitest`).
2. Approve the fixture choices (small / medium / large).
3. Pre-commit to using the decision matrix as the criterion for what
   ships next, rather than going with the original "compress strings"
   intuition.

## 8. Risk of skipping this RFC

If the heap-pressure RFC ships without profiling and the implementation
turns out to target the wrong layer:

- 1-2 weeks of engineering on streaming compression yields no measured
  heap reduction.
- Users see no improvement; the 8GB re-exec is still there.
- Reverting is awkward because the change touches the hot path.
- Reputation for the package suffers.

Skipping the profile to "just ship something" is a classic premature-
optimization trap. The 2-3 days of profiling is the correct opening
move.

## 9. Open questions

- Should we add a `--profile-heap` flag to analyze (off in production,
  on for the maintainer)?
- Where do we store the profile artifacts? `docs/profiles/` keeps them
  visible but bloats the repo on every regression run. Possibly a
  separate `codragraph-profiles` repo.
- Do we automate the profile in CI on a schedule (e.g., weekly), so
  regressions surface against a known baseline?

## 10. Next steps

1. Review and approve this RFC.
2. Implement the profiling instrumentation behind
   `CODRAGRAPH_HEAP_PROFILE=1`.
3. Run the three fixtures and produce the profile reports.
4. Update §4.4's decision matrix with real numbers.
5. Open a follow-up RFC (or update RFC 0001) with the chosen mitigation
   based on the data.
