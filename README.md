<p align="center">
  <img src="./branding/codragraph-logo.png" alt="CodraGraph" width="120" height="120" />
</p>

<h1 align="center">CodraGraph</h1>

<p align="center">
  Graph-powered code intelligence for AI agents — index any codebase,
  query via MCP or CLI, version it like git, and auto-tune the harness
  per task family.
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-green.svg" />
  <img alt="Status" src="https://img.shields.io/badge/status-developer%20preview-orange.svg" />
</p>

---

## Why CodraGraph

Raw text search is fast but blind. CodraGraph precomputes a
**knowledge graph** (44 node types, 21 relationship types, 16 languages)
so AI agents can ask *"what breaks if I change this?"* and get a real
answer instead of grepping their way through.

Four capabilities ship together:

1. **Token savings** — graph-aware retrieval + content-addressed
   compression. *Use the right 4k tokens, not the wrong 32k.*
2. **Dynamic harness** — auto-tuned per-task harnesses with Pareto
   search over (accuracy, tokens, latency). *Your agent self-improves
   on your tasks.*
3. **Versioned code graph** — Dolt-shaped content-addressed snapshots,
   structured diffs, branches, three-way merge. *Your codebase has git
   history; your agent's understanding should too.*
4. **Agent swarm** — multi-agent orchestration with explorer / exploiter
   / critic roles communicating via a shared filesystem.

## Install

```sh
npm install -g codragraph
codragraph setup
codragraph analyze .
codragraph serve   # → http://localhost:4747
```

For the full package matrix (SDK, graphstore-only, harness-only, IDE
plugins) see [INSTALL.md](./INSTALL.md).

## At a glance

```sh
codragraph analyze .                 # build the knowledge graph
codragraph query "auth flow"         # semantic + graph search
codragraph context authenticate      # 360° view of a symbol
codragraph impact authenticate       # blast-radius analysis
codragraph log                       # versioned-graph commit history
codragraph diff main feature         # structural diff between branches
codragraph blame fn:authenticate     # when did the graph last change?
codragraph merge feature             # three-way merge of code graphs
```

```sh
codragraph-harness swarm-search \
  --task ./tasks.json \
  --task-family codebase-qa \
  --use-cache       # reuse cached recipe if the graph hasn't changed
```

## Web dashboard

`codragraph serve` mounts a local web app at `http://localhost:4747`:

- **Overview** — repo stats, recent commits, top recipes, capability cards
- **Graph** — Sigma.js explorer with chat / file-tree / code panels
- **Projects** — cross-repo group view (provider→consumer contracts,
  linked repos, sync status)
- **History** — branch picker, commit list, structural + semantic diff
  with breakage-signal callouts (removed APIs, modified signatures,
  visibility changes)
- **Recipes** — versioned harness-recipe browser, click any card to see
  the harness body / scores / provenance
- **⌘K command palette** — jump to any section, repo, commit, or recipe

## API keys

All packages share one config file at `~/.codragraph/config.json`:

```sh
codragraph config set claude   --api-key sk-ant-...
codragraph config set openai   --api-key sk-...
codragraph config list
```

Resolution order: code-level option → config file → env var
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY`, …).

## Packages

| Package | Use case |
|---|---|
| [`codragraph`](./codragraph) | CLI + MCP + HTTP API + indexer |
| [`codragraph-sdk`](./codragraph-sdk) | Programmatic surface (graph, harness, graphstore, recipes, compress) |
| [`codragraph-graphstore`](./codragraph-graphstore) | Versioned-graph store on its own |
| [`codragraph-harness`](./codragraph-harness) | Auto-tuned harness search + recipe memory |
| [`codragraph-compress`](./codragraph-compress) | Graph-aware compression |
| [`codragraph-claude-plugin`](./codragraph-claude-plugin) | Claude Code plugin |
| [`codragraph-cursor-integration`](./codragraph-cursor-integration) | Cursor IDE integration |
| [`codragraph-codex-integration`](./codragraph-codex-integration) | OpenAI Codex CLI integration |

## License

[Apache-2.0](./LICENSE) — use, modify, and redistribute commercially.
