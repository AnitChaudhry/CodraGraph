# CodraGraph

**Graph-powered code intelligence for AI agents.** Index any codebase into a knowledge graph, then query it via MCP or CLI.

Works with **Cursor**, **Claude Code**, **Codex**, **Windsurf**, **Cline**, **OpenCode**, and any MCP-compatible tool.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

---

## Why?

AI coding tools don't understand your codebase structure. They edit a function without knowing 47 other functions depend on it, or which files make up a product area like Settings, Auth, AI, or Billing. CodraGraph fixes this by **precomputing every dependency, call chain, feature cluster, and relationship** into a queryable graph.

**Three commands to give your AI agent full codebase awareness.**

## Quick Start

```bash
# Index your repo (run from repo root)
npx @codragraph/cli analyze
```

That's it. This indexes the codebase, installs agent skills, registers Claude Code hooks, and creates `AGENTS.md` / `CLAUDE.md` context files â€” all in one command.

The same CLI commands work in Windows PowerShell, macOS bash/zsh, and Linux shells. Use `npx @codragraph/cli ...` for no-install runs or `codragraph ...` after a global install.

To configure MCP for your editor, run `npx @codragraph/cli setup` once â€” or set it up manually below.

`codragraph setup` auto-detects your editors and writes the correct global MCP config. You only need to run it once.

### Editor Support

| Editor | MCP | Skills | Hooks (auto-augment) | Support |
|--------|-----|--------|---------------------|---------|
| **Claude Code** | Yes | Yes | Yes (PreToolUse) | **Full** |
| **Cursor** | Yes | Yes | â€” | MCP + Skills |
| **Codex** | Yes | Yes | â€” | MCP + Skills |
| **Windsurf** | Yes | â€” | â€” | MCP |
| **OpenCode** | Yes | Yes | â€” | MCP + Skills |

> **Claude Code** gets the deepest integration: MCP tools + agent skills + PreToolUse hooks that automatically enrich grep/glob/bash calls with knowledge graph context.

### Community Integrations

| Agent | Install | Source |
|-------|---------|--------|
| [pi](https://pi.dev) | `pi install npm:pi-codragraph` | [pi-codragraph](https://github.com/tintinweb/pi-codragraph) |

## MCP Setup (manual)

If you prefer to configure manually instead of using `codragraph setup`:

### Claude Code (full support â€” MCP + skills + hooks)

```bash
# macOS / Linux
claude mcp add codragraph -- npx -y @codragraph/cli@2.1.2 mcp

# Windows
claude mcp add codragraph -- cmd /c npx -y @codragraph/cli@2.1.2 mcp
```

### Codex (full support â€” MCP + skills)

```bash
codex mcp add codragraph -- npx -y @codragraph/cli@2.1.2 mcp
```

### Cursor / Windsurf

Add to `~/.cursor/mcp.json` (global â€” works for all projects):

```json
{
  "mcpServers": {
    "codragraph": {
      "command": "npx",
      "args": ["-y", "@codragraph/cli@2.1.2", "mcp"]
    }
  }
}
```

### OpenCode

Add to `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "codragraph": {
      "command": "npx",
      "args": ["-y", "@codragraph/cli@2.1.2", "mcp"]
    }
  }
}
```

## How It Works

CodraGraph builds a complete knowledge graph of your codebase through a multi-phase indexing pipeline:

1. **Structure** â€” Walks the file tree and maps folder/file relationships
2. **Parsing** â€” Extracts functions, classes, methods, and interfaces using Tree-sitter ASTs
3. **Resolution** â€” Resolves imports and function calls across files with language-aware logic
   - **Field & Property Type Resolution** â€” Tracks field types across classes and interfaces for deep chain resolution (e.g., `user.address.city.getName()`)
   - **Return-Type-Aware Variable Binding** â€” Infers variable types from function return types, enabling accurate call-result binding
4. **Clustering** â€” Groups related symbols into structural communities
5. **Processes** â€” Traces execution flows from entry points through call chains
6. **Feature clusters** â€” Builds human-facing product/domain areas with members, dependencies, and line ranges
7. **Search** â€” Builds hybrid search indexes for fast retrieval

The result is a **LadybugDB graph database** stored locally in `.codragraph/` with full-text search and semantic embeddings.

## MCP Tools

Your AI agent gets these tools automatically:

| Tool | What It Does | `repo` Param |
|------|-------------|--------------|
| `list_repos` | Discover all indexed repositories | â€” |
| `query` | Process-grouped hybrid search (BM25 + semantic + RRF) | Optional |
| `context` | 360-degree symbol view â€” categorized refs, process participation | Optional |
| `impact` | Blast radius analysis with depth grouping and confidence | Optional |
| `detect_changes` | Git-diff impact â€” maps changed lines to affected processes | Optional |
| `rename` | Multi-file coordinated rename with graph + text search | Optional |
| `feature_clusters` / `cluster_query` | Product/domain feature map for targeted context | Optional |
| `feature_context` / `cluster_context` / `context_pack` | Files, line ranges, dependencies, and flows for one feature | Optional |
| `cluster_impact` | Feature-level blast radius and safe edit surface | Optional |
| `cypher` | Raw Cypher graph queries | Optional |

> With one indexed repo, the `repo` param is optional. With multiple, specify which: `query({query: "auth", repo: "my-app"})`.

## MCP Resources

| Resource | Purpose |
|----------|---------|
| `codragraph://repos` | List all indexed repositories (read first) |
| `codragraph://repo/{name}/context` | Codebase stats, staleness check, and available tools |
| `codragraph://repo/{name}/clusters` | All functional clusters with cohesion scores |
| `codragraph://repo/{name}/feature-clusters` | Product/domain feature areas |
| `codragraph://repo/{name}/feature/{name}` | Focused feature context pack |
| `codragraph://repo/{name}/cluster/{name}` | Cluster members and details |
| `codragraph://repo/{name}/processes` | All execution flows |
| `codragraph://repo/{name}/process/{name}` | Full process trace with steps |
| `codragraph://repo/{name}/schema` | Graph schema for Cypher queries |

## MCP Prompts

| Prompt | What It Does |
|--------|-------------|
| `detect_impact` | Pre-commit change analysis â€” scope, affected processes, risk level |
| `generate_map` | Architecture documentation from the knowledge graph with simple Mermaid diagrams |

## CLI Commands

```bash
codragraph setup                   # Configure MCP for your editors (one-time)
codragraph analyze [path]          # Index a repository (or update stale index)
codragraph analyze --force         # Force full re-index
codragraph analyze --embeddings    # Enable embedding generation (slower, better search)
codragraph analyze --skip-agents-md  # Preserve custom AGENTS.md/CLAUDE.md codragraph section edits
codragraph analyze --verbose       # Log skipped files when parsers are unavailable
codragraph analyze --max-file-size 1024  # Skip files larger than N KB (default: 512, cap: 32768)
codragraph analyze --compress brotli  # Per-row body compression. Also: zstd, none.
codragraph profile-heap [path]     # Run analyze with v8 heap-snapshot instrumentation
codragraph profile-heap --no-summary  # Same, but skip the post-run RSS / heapUsed table
codragraph feature-clusters         # List product/domain feature areas
codragraph cluster-query settings   # Search product/domain feature areas
codragraph feature-context Settings # Focus files, line ranges, flows, dependencies for one feature
codragraph context-pack Settings    # Compact agent context pack for one feature
codragraph cluster-impact Settings --direction both  # Feature-level blast radius
codragraph mcp                     # Start MCP server (stdio) â€” serves all indexed repos
codragraph serve                   # Start local HTTP API + bundled web UI
codragraph serve --web hosted      # API only; connect from hosted web UI
codragraph index                   # Register an existing .codragraph/ folder into the global registry
codragraph list                    # List all indexed repositories
codragraph status                  # Show index status for current repo
codragraph clean                   # Delete index for current repo
codragraph clean --all --force     # Delete all indexes
codragraph wiki [path]             # Generate LLM-powered docs from knowledge graph
codragraph wiki --model <model>    # Wiki with custom LLM model (default: gpt-4o-mini)

# Repository groups (multi-repo / monorepo service tracking)
codragraph group create <name>                                   # Create a repository group
codragraph group add <group> <groupPath> <registryName>          # Add a repo to a group. <groupPath> is a hierarchy path (e.g. hr/hiring/backend); <registryName> is the repo's name from the registry (see `codragraph list`)
codragraph group remove <group> <groupPath>                      # Remove a repo from a group by its hierarchy path
codragraph group list [name]                                     # List groups, or show one group's config
codragraph group sync <name>                                     # Extract contracts and match across repos/services
codragraph group contracts <name>  # Inspect extracted contracts and cross-links
codragraph group query <name> <q>  # Search execution flows across all repos in a group
codragraph group status <name>     # Check staleness of repos in a group
```

## Remote Embeddings

Set these env vars to use a remote OpenAI-compatible `/v1/embeddings` endpoint instead of the local model:

```bash
# macOS/Linux bash/zsh
export CODRAGRAPH_EMBEDDING_URL=http://your-server:8080/v1
export CODRAGRAPH_EMBEDDING_MODEL=BAAI/bge-large-en-v1.5
export CODRAGRAPH_EMBEDDING_DIMS=1024          # optional, default 384
export CODRAGRAPH_EMBEDDING_API_KEY=your-key   # optional, default: "unused"
codragraph analyze . --embeddings

# Windows PowerShell
$env:CODRAGRAPH_EMBEDDING_URL = "http://your-server:8080/v1"
$env:CODRAGRAPH_EMBEDDING_MODEL = "BAAI/bge-large-en-v1.5"
$env:CODRAGRAPH_EMBEDDING_DIMS = "1024"
$env:CODRAGRAPH_EMBEDDING_API_KEY = "your-key"
codragraph analyze . --embeddings
```

Works with Infinity, vLLM, TEI, llama.cpp, Ollama, LM Studio, or OpenAI. When unset, local embeddings are used unchanged.

## Multi-Repo Support

CodraGraph supports indexing multiple repositories. Each `codragraph analyze` registers the repo in a global registry (`~/.codragraph/registry.json`). The MCP server serves all indexed repos automatically.

For one product spread across many repos, use `codragraph group ...` plus
`repo: "@<group>"` in MCP tools. `feature_clusters`, `feature_context`, and
`cluster_impact` fan out across members and include contract-aware cross-repo
cluster links when the group Contract Registry has matching provider/consumer
edges.

## Supported Languages

TypeScript, JavaScript, Python, Java, C, C++, C#, Go, Rust, PHP, Kotlin, Swift, Ruby

### Language Feature Matrix

| Language | Imports | Named Bindings | Exports | Heritage | Type Annotations | Constructor Inference | Config | Frameworks | Entry Points |
|----------|---------|----------------|---------|----------|-----------------|---------------------|--------|------------|-------------|
| TypeScript | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ |
| JavaScript | âœ“ | âœ“ | âœ“ | âœ“ | â€” | âœ“ | âœ“ | âœ“ | âœ“ |
| Python | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ |
| Java | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | â€” | âœ“ | âœ“ |
| Kotlin | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | â€” | âœ“ | âœ“ |
| C# | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ |
| Go | âœ“ | â€” | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ |
| Rust | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | â€” | âœ“ | âœ“ |
| PHP | âœ“ | âœ“ | âœ“ | â€” | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ |
| Ruby | âœ“ | â€” | âœ“ | âœ“ | â€” | âœ“ | â€” | âœ“ | âœ“ |
| Swift | â€” | â€” | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ | âœ“ |
| C | â€” | â€” | âœ“ | â€” | âœ“ | âœ“ | â€” | âœ“ | âœ“ |
| C++ | â€” | â€” | âœ“ | âœ“ | âœ“ | âœ“ | â€” | âœ“ | âœ“ |

**Imports** â€” cross-file import resolution Â· **Named Bindings** â€” `import { X as Y }` / re-export tracking Â· **Exports** â€” public/exported symbol detection Â· **Heritage** â€” class inheritance, interfaces, mixins Â· **Type Annotations** â€” explicit type extraction for receiver resolution Â· **Constructor Inference** â€” infer receiver type from constructor calls (`self`/`this` resolution included for all languages) Â· **Config** â€” language toolchain config parsing (tsconfig, go.mod, etc.) Â· **Frameworks** â€” AST-based framework pattern detection Â· **Entry Points** â€” entry point scoring heuristics

## Agent Skills

CodraGraph ships with skill files that teach AI agents how to use the tools effectively:

- **Exploring** â€” Navigate unfamiliar code using the knowledge graph
- **Debugging** â€” Trace bugs through call chains
- **Impact Analysis** â€” Analyze blast radius before changes
- **Refactoring** â€” Plan safe refactors using dependency mapping

Installed automatically by both `codragraph analyze` (per-repo) and `codragraph setup` (global).

## Requirements

- Node.js >= 20
- Git repository (uses git for commit tracking)

## Release candidates

Stable releases publish to the default `latest` dist-tag. When a pull request
with non-documentation changes merges into `main`, an automated workflow also
publishes a prerelease build under the `rc` dist-tag, so early adopters can
try in-flight fixes without waiting for the next stable cut. (Docs-only
merges are skipped.)

```bash
# Try the latest release candidate (pre-stable â€” may change at any time)
npm install -g @codragraph/cli@rc
# â€” or â€”
npx @codragraph/cli@rc analyze
```

Release-candidate versions follow the standard semver prerelease format
`X.Y.Z-rc.N`, where `X.Y.Z` is the next stable target (bumped from the
current `latest` by patch by default; `minor` or `major` when kicking off a
bigger cycle) and `N` increments per published rc. Example sequence:
`1.6.2-rc.1`, `1.6.2-rc.2`, â€¦, then once `1.6.2` ships stable,
`1.6.3-rc.1`. Stable `latest` is unaffected.

## Troubleshooting

### `Cannot destructure property 'package' of 'node.target' as it is null`

This crash was caused by a dependency URL format that is incompatible with
certain npm/arborist versions ([npm/cli#8126](https://github.com/npm/cli/issues/8126)).
It is fixed in **codragraph v1.6.2+**. Upgrade to the current workspace
version, or pin the version your team has validated:

```bash
npx @codragraph/cli@2.1.2 analyze          # no global install
# or
npm install -g @codragraph/cli@2.1.2       # upgrade a global install
```

If you still hit npm install issues after upgrading, these generic workarounds
may help:

```bash
npm install -g npm@10                # update npm within the Node 20 line
npm cache clean --force              # clear a possibly corrupt cache
```

### Installation fails with native module errors

Some optional language grammars (Dart, Kotlin, Swift) require native compilation. If they fail, CodraGraph still works â€” those languages will be skipped.

If `npm install -g @codragraph/cli` fails on native modules:

```bash
# Ensure build tools are available (Linux/macOS)
# Ubuntu/Debian: sudo apt install python3 make g++
# macOS: xcode-select --install

# Retry installation
npm install -g @codragraph/cli
```

### Analysis runs out of memory

For very large repositories:

```bash
# Increase Node.js heap size on macOS/Linux bash/zsh
NODE_OPTIONS="--max-old-space-size=16384" npx @codragraph/cli analyze

# Windows PowerShell
$env:NODE_OPTIONS = "--max-old-space-size=16384"
npx @codragraph/cli analyze

# Exclude large directories
echo "vendor/" >> .codragraphignore
echo "dist/" >> .codragraphignore
```

If you want to know **which phase** is dragging the heap up before
deciding what to mitigate, run `codragraph profile-heap`. It writes a
v8 heap snapshot at every phase boundary plus a JSONL timeline of
`process.memoryUsage()` and prints a per-phase RSS / `heapUsed` table:

```bash
codragraph profile-heap                       # writes .codragraph/heap-profiles/
# â†’ load any .heapsnapshot in Chrome DevTools â†’ Memory â†’ Load
```

Each snapshot is 100â€“500 MB, so the command is opt-in only. The JSONL
timeline is small enough to share for triage even when the snapshots
are too big.

### Index size â€” opt-in per-row compression

For repos where `.codragraph/cgdb` itself has grown large:

```bash
codragraph analyze --compress brotli   # Node â‰¥ 18, brotli quality 6
codragraph analyze --compress zstd     # Node â‰¥ 22.15, zstd level 3
codragraph analyze --compress none     # explicit default
```

`--compress` routes every node-row content field through the matching
encoder before it's written to the CSV / cgdb; readers decode
transparently via the per-row `contentEncoding` tag. With the flag
unset, the on-disk layout is byte-identical to pre-1.8 indexes. Pre-1.8
indexes auto-trigger a full re-analyze the first time a 1.8+ CLI runs
against them (one-time cost, surfaced in the analyze log).

### Large files are being skipped

By default the walker skips files larger than **512 KB** (see log line `Skipped N large files (>512KB)`). Raise the threshold via either the CLI flag or the environment variable â€” both accept a value in **KB**:

```bash
# CLI flag (takes precedence over the env var)
npx @codragraph/cli analyze --max-file-size 2048     # skip only files > 2 MB

# Environment variable on macOS/Linux bash/zsh
export CODRAGRAPH_MAX_FILE_SIZE=2048
npx @codragraph/cli analyze

# Windows PowerShell
$env:CODRAGRAPH_MAX_FILE_SIZE = "2048"
npx @codragraph/cli analyze
```

Values above **32768 KB (32 MB)** are clamped to the tree-sitter parser ceiling; invalid values fall back to the 512 KB default with a one-time warning. When an override is active, `analyze` prints the effective threshold in its startup banner (e.g. `CODRAGRAPH_MAX_FILE_SIZE: effective threshold 2048KB (default 512KB)`).

## Privacy

- All processing happens locally on your machine
- No code is sent to any server
- Index stored in `.codragraph/` inside your repo (gitignored)
- Global registry at `~/.codragraph/` stores only paths and metadata

## Web UI

CodraGraph also has a browser-based UI at [codragraph.vercel.app](https://codragraph.vercel.app) â€” 100% client-side, your code never leaves the browser.

**Local Backend Mode:** Run `codragraph serve` and open `http://localhost:4747`. The installed CLI serves the bundled dashboard from `dist/web` and does not package `apps/web/node_modules`. It auto-detects the server and shows all your indexed repos, feature clusters, dependency context, and full AI chat support. No need to re-upload or re-index. The agent's tools (Cypher queries, search, code navigation) route through the backend HTTP API automatically.

**Hosted Dashboard Mode:** Run `codragraph serve --web hosted`, then open the hosted dashboard and connect it to `http://localhost:4747`. The UI is hosted, but project data still comes from your local API.

## License

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

Permissive open source. You can use, modify, redistribute, bundle, and host
the CLI commercially, subject to the Apache-2.0 notice and attribution
requirements.
