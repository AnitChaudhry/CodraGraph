# @codragraph/claude-plugin

Claude Code plugin that gives Claude **graph-aware** context for every edit.
Before each Grep / Glob / Bash invocation, the CodraGraph hook surfaces
the blast-radius, callers, and process participation for symbols Claude
is about to touch. Claude can also load FeatureCluster packs for product
areas like Settings, Auth, AI, or Billing, so it does not have to grep blindly.

## Install

```sh
# Install the codragraph CLI first
npm install -g @codragraph/cli
# or: bun add -g @codragraph/cli --trust
codragraph setup

# Then add the plugin to Claude Code
claude plugins install integrations/claude
```

## What's in the box

- **Hooks**: PreToolUse + PostToolUse on Grep/Glob/Bash → run a
  side-channel CodraGraph query and prepend the result to Claude's
  context.
- **Feature context**: `feature_clusters` and `feature_context` expose
  focused files, line ranges, dependencies, and flows for one product area.
- **Skills**: 7 skill packs Claude can invoke directly:
  - `codragraph-impact-analysis` — what breaks if I change this?
  - `codragraph-pr-review` — review a diff with full graph context
  - `codragraph-refactoring` — coordinated multi-file edits
  - `codragraph-exploring` — orient in a new codebase
  - `codragraph-debugging` — trace a bug back to its root
  - `codragraph-guide` — generate ARCHITECTURE.md from the graph
  - `codragraph-cli` — invoke any codragraph CLI command from chat

## Configuration

API keys live in `~/.codragraph/config.json` — the same file the CLI
uses. Set them with:

```sh
codragraph config set claude --api-key sk-ant-...
codragraph config set openai --api-key sk-...
```

## License

Apache-2.0. You can use, modify, redistribute, bundle, and host this
integration commercially, subject to the Apache-2.0 notice and attribution
requirements.
