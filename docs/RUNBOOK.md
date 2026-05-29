# Runbook — CodraGraph

Short, copy-paste operations for **local development**, **MCP**, and **CI**. Commands are written to work in Windows PowerShell, macOS bash/zsh, and Linux shells.

## Prerequisites

- **Node.js** ≥ 20 (`apps/web/package.json` `engines`).  
- **Git** (analyze requires a git repository).  
- From repo root, install and build the CLI package:

```bash
npm install
npm --prefix packages/core run build
```

With Bun:

```bash
bun install
bun run --filter @codragraph/cli build
```

Use `npx @codragraph/cli ...` or `bunx @codragraph/cli ...` from any path after global/published install. When developing from the repo root with a local build, use `npm --prefix packages/core exec codragraph -- ...` or `node packages/core/dist/cli/index.js ...`.

---

## Index out of date / “stale” tools

**Symptom:** MCP or resources warn the index is behind `HEAD`, or results don’t reflect recent commits.

Claude/Codex hooks only report this state. They do not start background
analysis and do not open LadybugDB for write; run the CLI explicitly when fresh
graph context matters for the current task.

**Fix (from the target repo root):**

```bash
npx @codragraph/cli analyze
```

On current builds, `analyze` first checks the previous indexed commit. If the
new commit only touched generated agent context, lockfiles, or ignored assets,
it reuses the existing graph and updates metadata instead of paying the full
parse/load cost. Source files, Markdown/MDX graph docs, language config, and
add/delete/rename/copy path changes stay rebuild-relevant so graph file,
folder, and documentation surfaces do not go stale.

**Force full rebuild** (same commit but suspect corruption or changed ignore rules):

```bash
npx @codragraph/cli analyze --force
```

**Check status:**

```bash
npx @codragraph/cli status
```

**List what MCP knows about:**

```bash
npx @codragraph/cli list
```

---

## Embeddings

**First time with vectors** (slower, more disk/RAM):

```bash
npx @codragraph/cli analyze --embeddings
```

**Important:** If you already had embeddings, **always** pass `--embeddings` on later analyzes, or they can be dropped. See `stats.embeddings` in `.codragraph/meta.json` (0 means none).

**Large repos:** Analyze may skip or limit embedding work when node counts are very high; watch CLI output.

For disk-space decisions, see [STORAGE_AND_RETRIEVAL.md](STORAGE_AND_RETRIEVAL.md). BM25 and graph search work without embeddings, so do not enable vectors as a default recovery step.

---

## MCP: no repos / empty tools

**Symptom:** `CodraGraph: No indexed repos yet` on stderr when starting MCP.

**Fix:** In each project you want indexed:

```bash
npx @codragraph/cli analyze /path/to/repo
```

Restart the editor MCP session if needed. The server **refreshes the registry lazily**; new analyzes are picked up without necessarily reinstalling MCP.

**HTTP MCP:** The mounted HTTP MCP endpoint is `/api/mcp` and uses the MCP StreamableHTTP protocol. Do not probe invented REST routes such as `/api/mcp/tools/list`; use an MCP client or CLI equivalents. For REST health, use:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:4747/api/info' -TimeoutSec 10
```

`/api/info` returns version, Node version, launch context, and MCP route guidance. See [AI_AGENT_CLI_GUIDE.md](AI_AGENT_CLI_GUIDE.md).

**Symptom:** Wrong repo when multiple are indexed — pass `repo` on tools or use `list_repos` first.

---

## Clean slate (corrupt or huge `.codragraph`)

Before cleanup, inspect the index and prefer a forced re-analyze when possible:

```bash
npx @codragraph/cli status
npx @codragraph/cli analyze --force
```

For large but working indexes, prefer compression before deletion:

```bash
npx @codragraph/cli analyze --compress brotli
```

Use `--compress zstd` only on Node 22.15 or newer.

**Current repo only** (preview; rerun with `--force` to delete):

```bash
npx @codragraph/cli clean
```

**Skip confirmation:**

```bash
npx @codragraph/cli clean --force
```

**All registered repos:**

```bash
npx @codragraph/cli clean --all --force
```

Then re-run `npx @codragraph/cli analyze` (and `--embeddings` if you need vectors).

Agents must ask before `clean --force`, `clean --all --force`, or deleting `.codragraph/` manually.

---

## Local bridge for the web UI

```bash
npx @codragraph/cli serve
# default http://127.0.0.1:4747 — see serve --help for port/host/web mode
```

Use when the browser UI should talk to **local** indexed repos instead of WASM-only mode.
The installed CLI serves the bundled dashboard from the same local server.
Use `npx @codragraph/cli serve --web hosted` when the user wants to open the
hosted dashboard and connect it back to the local API.

---

## CLI equivalents of MCP tools

Useful for debugging without an editor:

```bash
npx @codragraph/cli query "authentication flow" --repo MyRepo
npx @codragraph/cli context SomeSymbol --repo MyRepo
npx @codragraph/cli feature-clusters --repo MyRepo
npx @codragraph/cli feature-context Settings --repo MyRepo
npx @codragraph/cli context-pack Settings --repo MyRepo
npx @codragraph/cli cluster-impact Settings --direction both --repo MyRepo
npx @codragraph/cli impact SomeSymbol --direction upstream --repo MyRepo
npx @codragraph/cli cypher "MATCH (n) RETURN count(n) LIMIT 1" --repo MyRepo
```

---

## CI failures (contributors)

Orchestrator: `.github/workflows/ci.yml`.

| Job | Typical local repro |
|-----|---------------------|
| **quality** | `npm --prefix packages/core exec tsc -- --noEmit` |
| **unit-tests** | `npm --prefix packages/core exec vitest -- run test/unit` |
| **integration** | `npm --prefix packages/core exec vitest -- run test/integration` (see workflow matrix for groups) |
| **e2e** | Triggered when `apps/web/` changes; `npm --prefix apps/web exec playwright -- test` (requires `codragraph serve` + `npm --prefix apps/web run dev`) |

**Note:** Pushes that touch only certain markdown paths may be skipped by `paths-ignore` in CI — see workflow file for exact patterns.

---

## Memory / analyze crashes

Analyze re-execs Node with a **large old-space heap** when needed (`analyze.ts`). If you still OOM on huge repos, close other processes, avoid `--embeddings` for a first pass, or analyze a smaller path if supported by your workflow.

If the worker pool reports an idle sub-batch timeout or falls back to
sequential parsing, lower the worker message size and extend the idle window:

```powershell
$env:CODRAGRAPH_WORKER_SUB_BATCH_SIZE = "100"
$env:CODRAGRAPH_WORKER_IDLE_TIMEOUT_MS = "180000"
npx @codragraph/cli analyze
```

The timeout is reset by parser progress, so use it as a stuck-worker guard, not
as a total analyze duration limit.

---

## LadybugDB / lock errors

Only one process should open a repo’s `.codragraph/cgdb` store at a time. If MCP and a second `analyze` run conflict, stop one process, then retry `analyze` or restart MCP.

---

## WAL checksum corruption

If you see WAL checksum corruption, stop overlapping processes, try `npx @codragraph/cli analyze --force`, and only use `clean --force` after user approval. Do not edit `cgdb`, `cgdb.wal`, or lock files by hand.

---

## Reserved Cypher labels

If raw graphstore/Cypher queries fail on labels such as `Union`, quote the label:

```bash
npx @codragraph/cli cypher 'MATCH (n:`Union`) RETURN n' --repo MyRepo
```

Generated graphstore reads should quote labels automatically in current builds. If an older CLI emits `MATCH (n:Union) RETURN n`, upgrade/retry before changing repo data.

---

## Where to dig deeper

- Architecture overview: [ARCHITECTURE.md](ARCHITECTURE.md)  
- Agent safety rules: [GUARDRAILS.md](GUARDRAILS.md)  
- AI agent CLI contract: [AI_AGENT_CLI_GUIDE.md](AI_AGENT_CLI_GUIDE.md)
- Storage and retrieval policy: [STORAGE_AND_RETRIEVAL.md](STORAGE_AND_RETRIEVAL.md)
- Tests: [TESTING.md](TESTING.md)
