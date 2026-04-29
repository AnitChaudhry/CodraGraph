# Runbook — CodraGraph

Short, copy-paste operations for **local development**, **MCP**, and **CI**. Commands assume a Unix shell; on Windows use Git Bash or equivalent paths.

## Prerequisites

- **Node.js** ≥ 20 (`codragraph-web/package.json` `engines`).  
- **Git** (analyze requires a git repository).  
- From repo root, install and build the CLI package:

```bash
cd codragraph
npm install
npm run build
```

Use `npx codragraph …` from any path after global/published install, or `node dist/cli/index.js …` when developing from `codragraph/` with a local build.

---

## Index out of date / “stale” tools

**Symptom:** MCP or resources warn the index is behind `HEAD`, or results don’t reflect recent commits.

**Fix (from the target repo root):**

```bash
npx codragraph analyze
```

**Force full rebuild** (same commit but suspect corruption or changed ignore rules):

```bash
npx codragraph analyze --force
```

**Check status:**

```bash
npx codragraph status
```

**List what MCP knows about:**

```bash
npx codragraph list
```

---

## Embeddings

**First time with vectors** (slower, more disk/RAM):

```bash
npx codragraph analyze --embeddings
```

**Important:** If you already had embeddings, **always** pass `--embeddings` on later analyzes, or they can be dropped. See `stats.embeddings` in `.codragraph/meta.json` (0 means none).

**Large repos:** Analyze may skip or limit embedding work when node counts are very high; watch CLI output.

---

## MCP: no repos / empty tools

**Symptom:** `CodraGraph: No indexed repos yet` on stderr when starting MCP.

**Fix:** In each project you want indexed:

```bash
cd /path/to/repo
npx codragraph analyze
```

Restart the editor MCP session if needed. The server **refreshes the registry lazily**; new analyzes are picked up without necessarily reinstalling MCP.

**Symptom:** Wrong repo when multiple are indexed — pass `repo` on tools or use `list_repos` first.

---

## Clean slate (corrupt or huge `.codragraph`)

**Current repo only** (prompts for confirmation):

```bash
npx codragraph clean
```

**Skip confirmation:**

```bash
npx codragraph clean --force
```

**All registered repos:**

```bash
npx codragraph clean --all --force
```

Then re-run `npx codragraph analyze` (and `--embeddings` if you need vectors).

---

## Local bridge for the web UI

```bash
cd codragraph
npx codragraph serve
# default http://127.0.0.1:4747 — see serve --help for port/host
```

Use when the browser UI should talk to **local** indexed repos instead of WASM-only mode.

---

## CLI equivalents of MCP tools

Useful for debugging without an editor:

```bash
cd codragraph
npx codragraph query "authentication flow" --repo MyRepo
npx codragraph context SomeSymbol --repo MyRepo
npx codragraph impact SomeSymbol --direction upstream --repo MyRepo
npx codragraph cypher "MATCH (n) RETURN count(n) LIMIT 1" --repo MyRepo
```

---

## CI failures (contributors)

Orchestrator: `.github/workflows/ci.yml`.

| Job | Typical local repro |
|-----|---------------------|
| **quality** | `cd codragraph && npx tsc --noEmit` |
| **unit-tests** | `cd codragraph && npx vitest run test/unit` |
| **integration** | `cd codragraph && npx vitest run test/integration` (see workflow matrix for groups) |
| **e2e** | Triggered when `codragraph-web/` changes; `cd codragraph-web && E2E=1 npx playwright test` (requires `codragraph serve` + `npm run dev`) |

**Note:** Pushes that touch only certain markdown paths may be skipped by `paths-ignore` in CI — see workflow file for exact patterns.

---

## Memory / analyze crashes

Analyze re-execs Node with a **large old-space heap** when needed (`analyze.ts`). If you still OOM on huge repos, close other processes, avoid `--embeddings` for a first pass, or analyze a smaller path if supported by your workflow.

---

## LadybugDB / lock errors

Only one process should open a repo’s `.codragraph/lbug` store at a time. If MCP and a second `analyze` run conflict, stop one process, then retry `analyze` or restart MCP.

---

## Where to dig deeper

- Architecture overview: [ARCHITECTURE.md](ARCHITECTURE.md)  
- Agent safety rules: [GUARDRAILS.md](GUARDRAILS.md)  
- Tests: [TESTING.md](TESTING.md)
