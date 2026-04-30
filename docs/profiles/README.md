# Heap Profile Capture (RFC 0002 Phase 0)

CodraGraph ships an opt-in V8 heap-snapshot recorder for `codragraph
analyze`. This is the data-collection step from
[RFC 0002 — heap-pressure: profile first, then decide](../rfc/0002-heap-pressure-profile-first.md).
Don't act on the snapshots until enough fixtures are profiled to spot the
real retained-set contributors.

## How to capture

```bash
# Set the env var, run analyze normally. The CLI writes a v8 heap
# snapshot at every phase boundary into <repo>/.codragraph/heap-profiles/.
CODRAGRAPH_HEAP_PROFILE=1 codragraph analyze --no-setup

# Output: per-phase .heapsnapshot files
ls -lh .codragraph/heap-profiles/
# 1714521234123-walking_files.heapsnapshot      120 MB
# 1714521245789-parsing_files.heapsnapshot      640 MB
# 1714521268901-resolving_calls.heapsnapshot  1024 MB
# 1714521282345-detecting_communities.heapsnapshot  890 MB
# ...
```

Each file is named `<unix-ms-timestamp>-<phase>.heapsnapshot`. They're
sorted chronologically by filename so you can step through analyze in
order.

## How to read

1. Open Chrome (or any Chromium-based browser).
2. DevTools → **Memory** tab.
3. Click **Load** (paperclip / file icon).
4. Select a `.heapsnapshot` file.
5. Switch to **Comparison** mode and load the next phase's snapshot to
   see allocations between phases.

Sort by **Retained Size** descending, filter to user code (exclude
`(closure)`, `system / *`, V8 internals). The top-N constructors are
your candidates for §4.4 of the RFC.

## What to look for

Per the RFC's decision matrix:

| Top retained-set constructor | Likely mitigation |
|---|---|
| `Tree` (from `tree-sitter`) | Streaming-discard ASTs after symbol extraction |
| `KnowledgeGraph` / `SymbolNode` arrays | Stream-flush partial graph to LadybugDB |
| symbol body strings (`String` instances) | Body compression (RFC 0001 Phase 2) |
| Float32Array / Float64Array | Streaming embeddings to disk |
| `UndirectedGraph` (from graphology) | Tune Leiden working memory |

Open a follow-up RFC or update RFC 0002 §4.4 with measurements once
you have data from at least three fixtures.

## Costs

- Each `v8.writeHeapSnapshot()` pauses the analyze process while V8
  walks the heap. Expect 2–5 seconds per snapshot on a 4–6 GB heap.
- Snapshots are large (~RAM size), often 100MB–2GB each.
- Disk fills fast — each phase produces one snapshot, so a single
  `analyze` run can write 5–10 GB of profile data.

Don't enable this in production or CI — it's a maintainer/dev tool.

## Cleanup

The snapshots are stored under `.codragraph/heap-profiles/`. Delete
them when done:

```bash
rm -rf .codragraph/heap-profiles/
```

Or add the path to `.gitignore` so the files never accidentally land in
a commit.

## Related

- [RFC 0002 — heap-pressure profile first](../rfc/0002-heap-pressure-profile-first.md)
- [RFC 0001 — in-graph body compression](../rfc/0001-in-graph-body-compression.md)
  (one possible Phase 2 mitigation, depending on profile data)
