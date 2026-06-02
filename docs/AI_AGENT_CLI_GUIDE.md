# AI Agent CLI Guide

This guide is the command contract for AI agents using CodraGraph. If an
agent is unsure what to run, it should follow this file instead of inventing
CLI commands, HTTP routes, cleanup steps, or recovery procedures.

Related docs:

- [RUNBOOK.md](RUNBOOK.md) - copy-paste recovery commands
- [GUARDRAILS.md](GUARDRAILS.md) - safety rules and repeated failure signs
- [STORAGE_AND_RETRIEVAL.md](STORAGE_AND_RETRIEVAL.md) - index size, BM25, vectors
- [ARCHITECTURE.md](ARCHITECTURE.md) - system layout and graph schema

## Agent Rules

1. Start with read-only checks: `codragraph status`, `codragraph list`,
   `npx @codragraph/cli status`, `bunx @codragraph/cli status`, MCP
   `list_repos`, `.codragraph/structure/README.md`, or
   `codragraph://repo/{name}/context`.
2. Do not run destructive cleanup without explicit user approval. This includes
   `codragraph clean --force`, `codragraph clean --all --force`, deleting
   `.codragraph/`, deleting `~/.codragraph/registry.json`, or editing DB/WAL
   files by hand.
3. Do not enable embeddings by default. BM25 and graph search work without
   vectors. Use `--embeddings` only when the user asks for semantic/vector
   search or an existing index already has embeddings that must be preserved.
4. Do not start multiple `codragraph analyze` processes for the same repo. One
   writer should own `.codragraph/cgdb` at a time.
5. Editor hooks must stay read-only and bounded. They may run `augment` or
   cheap git/meta checks (`HEAD` versus `.codragraph/meta.json`, or
   `git diff --quiet`), but they must not run `analyze`, `detect-changes`,
   `clean`, or any DB-writing command.
6. For REST health checks, call `/api/info`. Do not probe MCP internals with
   invented routes such as `/api/mcp/tools/list`.
7. Do not use find-and-replace for symbol renames. Use the MCP `rename` tool
   with `dry_run: true`, then review graph edits versus text-search edits.
8. Before editing shared symbols, run MCP `impact` upstream when graph tools are
   available. Before committing, run MCP `detect_changes` when graph tools are
   available.
9. Report the exact command that failed and the exact error. Do not hide MCP,
   LadybugDB, parser, native-binding, or PowerShell errors behind "try again."

## Command Decision Tree

| Situation | Safe first command | Notes |
|---|---|---|
| Need to know whether the repo is indexed | `npx @codragraph/cli status` | Read-only. |
| Need to know what repos MCP can see | `npx @codragraph/cli list` or MCP `list_repos` | Pass `repo` on later tools when more than one repo is listed. |
| First index or stale index | `npx @codragraph/cli analyze` | Run from the target repo root unless passing an explicit path. |
| Same commit, suspect stale generated data | `npx @codragraph/cli analyze --force` | Does not require deleting `.codragraph/`. |
| New commit touches source, docs, renames, large diffs, or topology-only files | `npx @codragraph/cli analyze` | Smart analyze patches changed file-scoped graph rows and recomputes global communities/processes/FeatureClusters. |
| New commit touches package/config/ignore inputs | `npx @codragraph/cli analyze` | Smart analyze refreshes all file-scoped rows, then recomputes global context. |
| New commit touches only generated agent files, lockfiles, or ignored assets | `npx @codragraph/cli analyze` | Smart analyze reuses the existing graph and advances metadata when indexed inputs did not change. |
| Existing index has vectors and the user wants to keep them | `npx @codragraph/cli analyze --embeddings` | Check `.codragraph/meta.json` for `stats.embeddings`. |
| Large repo, first pass | `npx @codragraph/cli analyze --compress brotli` | Use `--compress zstd` only on Node 22.15 or newer. Avoid `--embeddings`. |
| Corrupt or huge index after user approves reset | `npx @codragraph/cli clean --force` then `npx @codragraph/cli analyze` | Add `--embeddings` only if vectors are required. |
| Local web/API bridge needed | `npx @codragraph/cli serve` | Serves the bundled dashboard and API at `http://127.0.0.1:4747`. |
| Hosted dashboard should control local repo | `npx @codragraph/cli serve --web hosted` | API stays local; open the hosted web UI and connect it to `http://127.0.0.1:4747`. |
| Need REST server health | `Invoke-RestMethod -Uri 'http://127.0.0.1:4747/api/info' -TimeoutSec 10` | Returns version, Node version, launch context, and MCP route guidance. |
| Need custom graph query | `npx @codragraph/cli cypher "MATCH (n) RETURN count(n) LIMIT 1" --repo MyRepo` | Read schema first when possible. |

Use `bunx @codragraph/cli ...` as the Bun equivalent for each `npx @codragraph/cli ...` command.

Direct graph commands such as `query`, `context`, `impact`, `cypher`,
`feature-clusters`, `context-pack`, and `detect-changes` default to the
indexed repo under the current working directory. If the cwd is not indexed,
they must fail with "Current repository is not indexed" instead of falling
back to some other repo in the global registry. Pass `--repo <name>` or
`--repo @<group>` when intentionally querying a different repo.

`analyze` is incremental at the graph level: if the previous index is on the
current schema, normal source edits, renames, large diffs, and topology-only
files patch the changed file-scoped rows instead of loading a new database from
scratch. Package/config/ignore inputs refresh all file-scoped rows because
they can affect import or indexing semantics. After either mutation path,
global communities, execution flows, and FeatureCluster packs are recomputed.
If the new commit changed only generated agent context, lockfiles, or ignored
assets, smart analyze reuses the existing graph and advances metadata. Use
`--force` when you need to rebuild generated graph data despite an unchanged
commit.

Every analyze or smart-reuse pass also refreshes `.codragraph/structure/`.
Agents should read that folder for the pre-seeded what/why/how/when/where
orientation, branch/index state, bounded analyze history, and
`agent-memory.sql` SQLite seed before inventing their own local memory format.

## Analyze Performance Knobs

Do not tune these by default. Use them only when the user reports analyzer
stalls, worker fallback, or memory pressure and a normal `analyze` still
fails.

```powershell
$env:CODRAGRAPH_WORKER_SUB_BATCH_SIZE = "100"
$env:CODRAGRAPH_WORKER_IDLE_TIMEOUT_MS = "180000"
npx @codragraph/cli analyze
```

`CODRAGRAPH_WORKER_SUB_BATCH_SIZE` limits how many files are sent to a worker
in one message. Smaller values reduce peak memory on large repos. The default
is 250.

`CODRAGRAPH_WORKER_IDLE_TIMEOUT_MS` is an idle timer, not a wall-clock limit.
Worker progress resets it, so slow-but-moving parses should continue instead
of falling back to sequential parsing. The default is 120000.

## Monorepo Source CLI

When working inside the CodraGraph monorepo and running the TypeScript CLI from
source, use the root scripts:

```powershell
npm run codragraph:source -- detect-changes --scope staged
npm run codragraph:source -- detect-changes --scope unstaged
npm run codragraph:source -- detect-changes --scope all
npm run codragraph:detect-staged
```

Do not run this from the repo root:

```powershell
npm --prefix packages/core exec tsx src/cli/index.ts detect-changes --scope staged
```

That form lets `tsx` resolve `src/cli/index.ts` from the root directory on some
npm/Windows combinations, so it fails before the CLI can run. If you need to
call `tsx` directly from the root, use the explicit path:

```powershell
npx tsx packages/core/src/cli/index.ts detect-changes --scope staged
npx tsx packages/core/src/cli/index.ts detect-changes --scope all
```

## MCP Over HTTP

The HTTP MCP endpoint is:

```text
POST /api/mcp
```

It uses the MCP StreamableHTTP protocol. A client initializes a session with a
POST, then continues with the returned MCP session id. Use an MCP-capable client
or the MCP SDK for this.

Do not call these invented REST routes:

```text
GET /api/mcp/tools/list
GET /api/mcp/resources/list
POST /api/mcp/tools/call
```

For example, this PowerShell command is an unsupported probe because that route
is not part of the server contract. Newer servers return actionable JSON with
`code: "MCP_HTTP_REST_ROUTE_UNSUPPORTED"` so PowerShell callers can recover
without guessing:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:4747/api/mcp/tools/list'
```

If an agent needs to verify the server or use graph tools from a shell, prefer
one of these:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:4747/api/info' -TimeoutSec 10
npx @codragraph/cli list
bunx @codragraph/cli list
npx @codragraph/cli query "startup flow" --repo MyRepo
bunx @codragraph/cli query "startup flow" --repo MyRepo
```

`/api/info` is the REST health/introspection route. If `/api/info` works and
`/api/mcp/tools/list` returns `MCP_HTTP_REST_ROUTE_UNSUPPORTED`, the server is
up and the probe is wrong.

If the goal is to test HTTP MCP specifically, use a real MCP client pointed at
`http://127.0.0.1:4747/api/mcp`, not ad hoc REST paths.

## Recovery Playbook

| Symptom | What to do | What not to do |
|---|---|---|
| MCP says no repos | Run `npx @codragraph/cli analyze` in the target repo, then `npx @codragraph/cli list`. | Do not reinstall random packages first. |
| Results are stale | Run `npx @codragraph/cli analyze`; add `--embeddings` only if preserving existing vectors. | Do not delete `.codragraph/` as the first step. |
| `stats.embeddings` became 0 | If vectors are required, rerun `npx @codragraph/cli analyze --embeddings`. | Do not assume semantic search is available after plain `analyze`. |
| `.codragraph` is very large | Inspect size and metadata, then prefer `analyze --compress brotli` without vectors. Use zstd only on Node 22.15 or newer. See [STORAGE_AND_RETRIEVAL.md](STORAGE_AND_RETRIEVAL.md). | Do not add `--embeddings` to "fix" disk usage. |
| WAL/checksum corruption | Stop overlapping MCP/analyze processes. Try `analyze --force`. If still corrupt, ask before `clean --force` and re-analyze. | Do not edit `cgdb`, `cgdb.wal`, or lock files by hand. |
| LadybugDB lock or database busy | Stop the extra process, then retry. | Do not run concurrent analyzes on the same repo. |
| PowerShell `/api/mcp/tools/list` returns `MCP_HTTP_REST_ROUTE_UNSUPPORTED` | Check `GET /api/info`, then use `/api/mcp` through an MCP client or use CLI equivalents. | Do not add a fake tools-list route in client docs. |
| Parser/native optional package warning | Check whether the language is optional for the repo. Capture the warning and continue if analysis succeeds. | Do not block all users on optional Swift/Kotlin/Dart parser warnings. |
| `MATCH (n:Union) RETURN n` parser error | Upgrade/retry with a CLI that quotes generated labels. For raw Cypher, use backticks: <code>MATCH (n:`Union`) RETURN n</code>. | Do not tell users to rename the node label or edit DB files. |

## Output Contract For Agents

When an agent runs CodraGraph commands for a user, it should report:

- The command it ran.
- Whether it was read-only, rebuilding, or destructive.
- The repo name/path it targeted.
- Whether embeddings were preserved, skipped, or newly generated.
- Whether compression was enabled.
- Any follow-up needed from the user before destructive cleanup.

Good summary:

```text
Ran `npx @codragraph/cli analyze --compress brotli` in D:\repo.
This rebuilt the graph without embeddings, so BM25/graph search is available
and vector search remains disabled. No cleanup command was run.
```

Bad summary:

```text
Fixed CodraGraph.
```
