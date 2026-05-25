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

Use `npx @codragraph/cli ...` from any path after global/published install, or `npm --prefix packages/core exec codragraph -- ...` when developing from the repo root with a local build.

---

## Index out of date / “stale” tools

**Symptom:** MCP or resources warn the index is behind `HEAD`, or results don’t reflect recent commits.

**Fix (from the target repo root):**

```bash
npx @codragraph/cli analyze
```

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

---

## MCP: no repos / empty tools

**Symptom:** `CodraGraph: No indexed repos yet` on stderr when starting MCP.

**Fix:** In each project you want indexed:

```bash
npx @codragraph/cli analyze /path/to/repo
```

Restart the editor MCP session if needed. The server **refreshes the registry lazily**; new analyzes are picked up without necessarily reinstalling MCP.

**Symptom:** Wrong repo when multiple are indexed — pass `repo` on tools or use `list_repos` first.

---

## Clean slate (corrupt or huge `.codragraph`)

**Current repo only** (prompts for confirmation):

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

---

## Local bridge for the web UI

```bash
npx @codragraph/cli serve
# default http://127.0.0.1:4747 — see serve --help for port/host
```

Use when the browser UI should talk to **local** indexed repos instead of WASM-only mode.

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

---

## LadybugDB / lock errors

Only one process should open a repo’s `.codragraph/cgdb` store at a time. If MCP and a second `analyze` run conflict, stop one process, then retry `analyze` or restart MCP.

---

## Where to dig deeper

- Architecture overview: [ARCHITECTURE.md](ARCHITECTURE.md)  
- Agent safety rules: [GUARDRAILS.md](GUARDRAILS.md)  
- Tests: [TESTING.md](TESTING.md)
