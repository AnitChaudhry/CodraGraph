# @codragraph/codex

OpenAI Codex CLI integration for CodraGraph. Enriches every Codex tool
call with graph-aware context (callers, impact, process participation)
so Codex doesn't blindly grep its way through the codebase.

## Install

```sh
# 1) Install the codragraph CLI
npm install -g @codragraph/cli
codragraph setup

# 2) Install this integration globally
npm install -g @codragraph/codex

# 3) Wire it into Codex. Merges the bundled hooks into ~/.codex/config.json
#    (substituting the absolute install path so Codex finds the hook script)
#    and registers an mcpServer entry whose launcher is platform-correct:
#    `codragraph mcp` on macOS/Linux, `cmd /c codragraph mcp` on Windows
#    (Node 22's spawn can't launch `.cmd` shims directly).
codragraph-codex
```

> The `codragraph-codex` command is idempotent — re-run it after upgrades.
> A sidecar `~/.codex/.codragraph-managed.json` tracks which entries the
> installer owns, so user-managed hooks/mcpServers are never overwritten.

## What it does

- **Pre-tool hook**: when Codex is about to Grep / Glob / Read / Bash,
  the hook calls `codragraph augment <pattern>` and prepends the graph
  context to Codex's next prompt.
- **Post-edit hook**: after Edit / Write, runs `codragraph detect-changes`
  to flag whether the index needs refreshing.
- **MCP server**: registers a `codragraph` Codex MCP server (launching
  `codragraph mcp`, or `cmd /c codragraph mcp` on Windows) so Codex can
  call query / context / impact / cypher directly.

## Configuration

API keys live in `~/.codragraph/config.json` — the unified file the CLI,
harness, and web app all use.

```sh
codragraph config set openai --api-key sk-...
```

## License

Apache-2.0
