# Storage And Retrieval

CodraGraph should give agents useful code context without making the index feel
larger than the project itself. This guide explains what lives under
`.codragraph/`, how BM25 and embeddings interact, and what agents should do
when an index grows too large.

## Current Storage Layout

```text
<repo>/.codragraph/
  cgdb           LadybugDB graph database
  cgdb.wal       write-ahead log
  cgdb.lock      single-writer lock
  meta.json      last commit, index stats, compression, embedding counts
  heap-profiles/ optional debug artifacts from profile-heap
```

The global repo registry lives outside the project:

```text
~/.codragraph/registry.json
```

Do not edit these files by hand. If they are corrupt, use the recovery commands
in this guide and [RUNBOOK.md](RUNBOOK.md).

## Retrieval Tiers

| Tier | Storage cost | What works | When to use |
|---|---:|---|---|
| Graph + BM25 only | Lowest | Symbol lookup, relationships, impact, context, BM25 keyword search | Default for most repos and first indexes. |
| Graph + BM25 + compressed bodies | Lower than default bodies | Same graph tools; BM25 narrows to indexed metadata when content is compressed | Large repos where disk matters more than full body FTS. |
| Graph + BM25 + embeddings | Highest | Hybrid BM25/vector search via reciprocal rank fusion | Use only when semantic/vector retrieval is required. |

BM25 does not require embeddings. Agents should not turn on `--embeddings`
just to make query/search work.

## Embeddings Policy

Embeddings are opt-in:

```powershell
npx @codragraph/cli analyze --embeddings
```

Use embeddings when:

- The user explicitly asks for semantic/vector search.
- The repo already has useful vectors and the user wants to preserve them.
- A workflow depends on semantic fallback rather than exact, graph, or BM25
  search.

Avoid embeddings when:

- This is a first pass on a large repo.
- The user's complaint is disk usage, install time, or Windows setup stalls.
- `.codragraph/meta.json` reports `stats.embeddings` as `0`.
- The repo has more than the current embedding node limit; analyze may skip
  embedding generation for very large graphs.

If vectors already exist, plain `analyze` can drop them. Preserve them with:

```powershell
npx @codragraph/cli analyze --embeddings
```

If disk usage is the problem, ask the user before intentionally removing an
existing vector index.

## Compression Policy

Use compression before vectors when users complain about `.codragraph` size:

```powershell
npx @codragraph/cli analyze --compress brotli
```

Use zstd only on Node 22.15 or newer:

```powershell
npx @codragraph/cli analyze --compress zstd
```

Notes:

- `--compress zstd` requires Node 22.15 or newer.
- Compression reduces stored source body size.
- MCP, HTTP, embeddings, `context`, and `impact` read logical decoded content.
- BM25/FTS is narrower when body content is compressed; graph search remains
  correct.

If a workflow relies on full-text search inside function bodies, use:

```powershell
npx @codragraph/cli analyze --compress none
```

## Inspect Index Size

Start with the CLI status command:

```powershell
npx @codragraph/cli status
```

It reports `.codragraph` size, embedding count, and compression mode without
scanning the whole repo. Treat `500 MB` as a warning threshold: inspect the
index and storage policy, but do not delete anything without approval.

PowerShell:

```powershell
Get-ChildItem -Force .codragraph | Select-Object Name,Length,Mode
Get-ChildItem -Recurse -Force .codragraph | Measure-Object Length -Sum
Get-Content .codragraph/meta.json
```

Bash/zsh:

```sh
du -sh .codragraph
find .codragraph -maxdepth 2 -type f -print
cat .codragraph/meta.json
```

When reporting size to a user, include:

- Total `.codragraph` size.
- Whether `heap-profiles/` exists.
- `stats.embeddings` from `meta.json`.
- `compress` from `meta.json`, if present.
- Whether `cgdb.wal` is unusually large.

All `npx @codragraph/cli ...` commands in this guide have the same Bun form:
`bunx @codragraph/cli ...`.

## Size Recovery

For a large but working index:

1. Inspect `.codragraph` size and `meta.json`.
2. If `heap-profiles/` exists, ask whether those debug artifacts can be
   removed.
3. Re-analyze with compression and no embeddings:

```powershell
npx @codragraph/cli analyze --compress brotli
```

4. If the repo previously had embeddings and the user needs them, re-run with:

```powershell
npx @codragraph/cli analyze --embeddings --compress brotli
```

For a corrupt index:

1. Stop `codragraph serve`, MCP sessions, and other analyze processes for the
   repo.
2. Try a full rebuild without cleanup:

```powershell
npx @codragraph/cli analyze --force --compress brotli
```

3. If the graph still reports WAL checksum corruption, ask before cleanup:

```powershell
npx @codragraph/cli clean --force
npx @codragraph/cli analyze --compress brotli
```

Do not edit `cgdb`, `cgdb.wal`, or `cgdb.lock` directly.

## Desired Storage Roadmap

The current CLI has coarse switches: embeddings on/off and compression
on/off. The desired modular behavior for large repos is more granular:

- `--max-index-bytes <size>`: stop or degrade gracefully before exceeding a
  user budget.
- `--embedding-budget <count|bytes>`: embed only the most useful symbols.
- `--embed-scope changed|features|hot|all`: choose whether vectors cover recent
  changes, feature clusters, high-fanout symbols, or the full graph.
- Content-addressed body storage: deduplicate identical snippets and generated
  code blocks.
- Graphstore compaction/doctor command: detect large WAL files, checksum
  errors, and stale snapshots, then recommend a safe recovery path.
- Query batching: reduce serial per-symbol lookups after BM25/vector ranking.
- Resource governor: cap CPU, DB, and IO parallelism so indexing is faster
  without overwhelming user machines.

Until those controls exist, agents should default to graph + BM25, use
compression for large repos, and enable embeddings only when the user needs
semantic retrieval.
