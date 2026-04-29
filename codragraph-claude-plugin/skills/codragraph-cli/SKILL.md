---
name: codragraph-cli
description: "Use when the user needs to run CodraGraph CLI commands like analyze/index a repo, check status, clean the index, generate a wiki, or list indexed repos. Examples: \"Index this repo\", \"Reanalyze the codebase\", \"Generate a wiki\""
---

# CodraGraph CLI Commands

All commands work via `npx` â€” no global install required.

## Commands

### analyze â€” Build or refresh the index

```bash
npx codragraph analyze
```

Run from the project root. This parses all source files, builds the knowledge graph, writes it to `.codragraph/`, and generates CLAUDE.md / AGENTS.md context files.

| Flag | Effect |
|------|--------|
| `--force` | Force full re-index even if up to date |
| `--embeddings` | Enable embedding generation for semantic search (off by default) |

**When to run:** First time in a project, after major code changes, or when `codragraph://repo/{name}/context` reports the index is stale.

### status â€” Check index freshness

```bash
npx codragraph status
```

Shows whether the current repo has a CodraGraph index, when it was last updated, and symbol/relationship counts. Use this to check if re-indexing is needed.

### clean â€” Delete the index

```bash
npx codragraph clean
```

Deletes the `.codragraph/` directory and unregisters the repo from the global registry. Use before re-indexing if the index is corrupt or after removing CodraGraph from a project.

| Flag | Effect |
|------|--------|
| `--force` | Skip confirmation prompt |
| `--all` | Clean all indexed repos, not just the current one |

### wiki â€” Generate documentation from the graph

```bash
npx codragraph wiki
```

Generates repository documentation from the knowledge graph using an LLM. Requires an API key (saved to `~/.codragraph/config.json` on first use).

| Flag | Effect |
|------|--------|
| `--force` | Force full regeneration |
| `--model <model>` | LLM model (default: minimax/minimax-m2.5) |
| `--base-url <url>` | LLM API base URL |
| `--api-key <key>` | LLM API key |
| `--concurrency <n>` | Parallel LLM calls (default: 3) |
| `--gist` | Publish wiki as a public GitHub Gist |

### list â€” Show all indexed repos

```bash
npx codragraph list
```

Lists all repositories registered in `~/.codragraph/registry.json`. The MCP `list_repos` tool provides the same information.

## After Indexing

1. **Read `codragraph://repo/{name}/context`** to verify the index loaded
2. Use the other CodraGraph skills (`exploring`, `debugging`, `impact-analysis`, `refactoring`) for your task

## Troubleshooting

- **"Not inside a git repository"**: Run from a directory inside a git repo
- **Index is stale after re-analyzing**: Restart Claude Code to reload the MCP server
- **Embeddings slow**: Omit `--embeddings` (it's off by default) or set `OPENAI_API_KEY` for faster API-based embedding
