# codragraph-codex-integration

OpenAI Codex CLI integration for CodraGraph. Enriches every Codex tool
call with graph-aware context (callers, impact, process participation)
so Codex doesn't blindly grep its way through the codebase.

## Install

```sh
# 1) Install the codragraph CLI
npm install -g codragraph
codragraph setup

# 2) Install this integration globally
npm install -g codragraph-codex-integration

# 3) Merge codex.config.template.json into your Codex config
#    (Codex picks up hooks + MCP servers from there)
codragraph-codex-integration install
```

## What it does

- **Pre-tool hook**: when Codex is about to Grep / Glob / Read / Bash,
  the hook calls `codragraph augment <pattern>` and prepends the graph
  context to Codex's next prompt.
- **Post-edit hook**: after Edit / Write, runs `codragraph detect-changes`
  to flag whether the index needs refreshing.
- **MCP server**: registers `codragraph mcp` as a Codex MCP server so
  Codex can query/cypher/impact directly.

## Configuration

API keys live in `~/.codragraph/config.json` — the unified file the CLI,
harness, and web app all use.

```sh
codragraph config set openai --api-key sk-...
```

## License

Apache-2.0
