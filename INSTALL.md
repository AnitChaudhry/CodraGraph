<p align="center">
  <img src="./branding/codragraph-logo.png" alt="CodraGraph" width="80" height="80" />
</p>

# Installing CodraGraph

CodraGraph ships as a small set of npm packages plus three AI-IDE
plugins (Claude Code, Cursor, OpenAI Codex CLI). Pick the install path
that matches your use case.

## Quick start (most users)

```sh
# CLI + MCP server + web dashboard
npm install -g codragraph
codragraph setup
codragraph analyze .
codragraph serve   # → http://localhost:4747
```

That gives you the analyzer, the MCP server, the local HTTP API, and
the bundled web dashboard. Everything else is optional.

## The package matrix

| Package | What you get | Install command |
|---|---|---|
| **`codragraph`** | CLI, MCP server, HTTP API, indexer | `npm install -g codragraph` |
| **`codragraph-sdk`** | Programmatic API (no CLI) — graph, harness, graphstore, recipes, compress | `npm install codragraph-sdk` |
| **`codragraph-graphstore`** | Just the versioned-graph store (snapshots / branches / diffs / merge) | `npm install codragraph-graphstore` |
| **`codragraph-harness`** | Auto-tuned harness search + swarm + recipe memory | `npm install codragraph-harness` |
| **`codragraph-compress`** | Graph-aware compression library | `npm install codragraph-compress` |

> `codragraph-shared` is internal-only (TypeScript types).

## AI-IDE plugins

| IDE | Package | Install |
|---|---|---|
| **Claude Code** | `codragraph-claude-plugin` | `claude plugins install codragraph` *(once published to Anthropic's marketplace)* — or `claude plugins install file://path/to/codragraph-claude-plugin` |
| **Cursor** | `codragraph-cursor-integration` | Drop the directory into `.cursor/` of your repo; hooks register automatically |
| **OpenAI Codex CLI** | `codragraph-codex-integration` | `npm install -g codragraph-codex-integration` then merge `codex.config.template.json` into `~/.codex/config.json` |

All three plugins are thin glue — they delegate to the `codragraph` CLI
+ MCP server. You need `codragraph` installed first.

## Decision tree

- **I want an AI agent to use CodraGraph for my repo** → install `codragraph` + the plugin matching your IDE.
- **I'm building my own agent / tool / dashboard on top** → install `codragraph-sdk`. Sub-namespaces let you depend on only what you use:
  - `import { graph } from 'codragraph-sdk/graph'`
  - `import { graphstore } from 'codragraph-sdk/graphstore'`
  - `import { harness } from 'codragraph-sdk/harness'`
  - `import { recipes } from 'codragraph-sdk/recipes'`
  - `import { compress } from 'codragraph-sdk/compress'`
- **I just need versioning over a property graph (no AI / no CLI)** → install `codragraph-graphstore` directly.
- **I want to auto-tune harnesses for my own task family** → install `codragraph-harness`. It carries its own CLI: `codragraph-harness swarm-search …`
- **I want token-savings compression for an LLM pipeline** → install `codragraph-compress`.

## API keys (BYO)

All five packages share one config file at `~/.codragraph/config.json`.
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
and redistribute commercially. See [LICENSE](./LICENSE).
