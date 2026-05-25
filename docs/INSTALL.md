<p align="center">
  <img src="../branding/codragraph-logo.png" alt="CodraGraph" width="80" height="80" />
</p>

# Installing CodraGraph

CodraGraph ships as a small set of npm packages plus three AI-IDE
plugins (Claude Code, Cursor, OpenAI Codex CLI). Pick the install path
that matches your use case.

## Quick start (most users)

```sh
# CLI + MCP server + web dashboard
npm install -g @codragraph/cli
codragraph setup
codragraph analyze .
codragraph serve   # → http://localhost:4747
```

> The package on npm is `@codragraph/cli`; the binary it installs is
> `codragraph`. Use the scoped name when installing, the short name
> when invoking.

That gives you the analyzer, the MCP server, the local HTTP API, and
the bundled web dashboard. Everything else is optional.

## The package matrix

All public packages below ship under Apache-2.0. The license permits
personal, internal, commercial, hosted, and redistributed use; paid
CodraGraph offerings are for managed service/support rather than license
restrictions.

| Package | What you get | Install command |
|---|---|---|
| **`@codragraph/cli`** | CLI, MCP server, HTTP API, indexer, web dashboard, FeatureCluster context packs | `npm install -g @codragraph/cli` |
| **`@codragraph/sdk`** | Programmatic API on top of CLI-indexed repos — graph, harness, graphstore, recipes, compress | `npm install @codragraph/sdk` |
| **`@codragraph/graphstore`** | Just the versioned-graph store (snapshots / branches / diffs / merge) | `npm install @codragraph/graphstore` |
| **`@codragraph/harness`** | Auto-tuned harness search + swarm + recipe memory | `npm install @codragraph/harness` |
| **`@codragraph/compress`** | Graph-aware compression library | `npm install @codragraph/compress` |
| **`@codragraph/org`** | Tenant/RBAC/audit helpers for hosted deployments | `npm install @codragraph/org` |

> `@codragraph/shared` is internal-only (TypeScript types).

## AI-IDE plugins

| IDE | Package | Install |
|---|---|---|
| **Claude Code** | `@codragraph/claude-plugin` | `claude plugins install codragraph` *(once published to Anthropic's marketplace)* — or `claude plugins install file://path/to/integrations/claude` |
| **Cursor** | `integrations/cursor` | Drop the directory into `.cursor/` of your repo; hooks register automatically |
| **OpenAI Codex CLI** | `@codragraph/codex` | `npm install -g @codragraph/codex` then run `codragraph-codex` to wire the hooks + MCP server into `~/.codex/config.json` |

All three plugins are thin glue — they delegate to the `codragraph` CLI
+ MCP server. You need `@codragraph/cli` installed first.

## Decision tree

- **I want an AI agent to use CodraGraph for my repo** → install `@codragraph/cli` + the plugin matching your IDE.
- **I'm building my own agent / tool / dashboard on top** → install `@codragraph/sdk`. Sub-namespaces let you depend on only what you use:
  - `import { graph } from '@codragraph/sdk/graph'`
  - `import { graphstore } from '@codragraph/sdk/graphstore'`
  - `import { harness } from '@codragraph/sdk/harness'`
  - `import { recipes } from '@codragraph/sdk/recipes'`
  - `import { compress } from '@codragraph/sdk/compress'`
- **I just need versioning over a property graph (no AI / no CLI)** → install `@codragraph/graphstore` directly.
- **I want to auto-tune harnesses for my own task family** → install `@codragraph/harness`. It carries its own CLI: `codragraph-harness search ...` and `codragraph-harness swarm-search ...`
- **I want token-savings compression for an LLM pipeline** → install `@codragraph/compress`.
- **I want hosted / enterprise boundaries** → install `@codragraph/org` alongside CLI workers and graphstore.

## How packages compose

`@codragraph/cli` is the root of the end-to-end workflow: it indexes repos,
creates FeatureCluster packs, serves MCP/HTTP, and registers local repos. Add
other packages only when you need their layer:

| Add this | When |
|---|---|
| `@codragraph/sdk` | Your own agent or dashboard needs to query indexed repos programmatically |
| `@codragraph/harness` | You want to optimize prompts/retrieval over a task family |
| `@codragraph/compress` | You want to compress feature context before it reaches an LLM |
| `@codragraph/graphstore` | You want graph snapshots, diffs, branches, and blame |
| `@codragraph/org` | You want tenant, RBAC, and audit layers around the local-first stack |

## API keys (BYO)

All packages share one config file at `~/.codragraph/config.json`.
Set provider keys with the CLI:

```sh
codragraph config set claude   --api-key sk-ant-...
codragraph config set openai   --api-key sk-...
codragraph config set opencode --base-url http://localhost:4096
codragraph config list
```

Resolution order for any provider key:

1. Code-level option (`new ClaudeInferenceProvider({ apiKey: '...' })`)
2. `~/.codragraph/config.json` → `providers[<name>]`
3. Legacy flat fields in the same file (when `provider` matches)
4. Env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY`, …)

The web dashboard's Settings panel reads + writes the same file via the
local server, so changes you make in one surface show up in the others.

## License

Every public package ships under **Apache-2.0**. You can use, modify,
host, redistribute, and bundle CodraGraph commercially. Keep the license
and attribution notices required by Apache-2.0. See [LICENSE](../LICENSE).
