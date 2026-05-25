# Integrations — Works with what you already use

## Section title

**CodraGraph plugs in. It doesn't replace your stack.**

## Body

You've already picked an agent. CodraGraph makes it smarter.

---

### 🔵 Claude Code
**One command, you're done.**

```bash
npx codragraph setup
```

CodraGraph registers itself as an MCP server in Claude Code's config. The `codragraph_*` tools appear in your tool list immediately. Pre-commit hook setup is included.

> **Best for:** developers who want zero-config, agentic editing with structural awareness.

---

### 🟣 Cursor
**Drop the integration into `.cursor/`.**

Auto-installed via `codragraph setup`. The Cursor agent gets the same `codragraph_*` MCP tools. `.cursor/index.mdc` and `.cursor/rules/codragraph.mdc` get scaffolded automatically.

> **Best for:** teams already on Cursor who want graph-aware retrieval without switching IDE.

---

### 🟢 Codex (OpenAI)
**Native MCP — same tools, different model.**

The OpenAI Codex CLI speaks MCP. CodraGraph MCP server works without modification. Switch your harness inference provider to `openai` and the auto-tuned recipe targets Codex.

```bash
packages/harness swarm-search --inference openai --critic-inference openai ...
```

---

### 🟡 OpenCode
**Local-first agent, local-first context.**

OpenCode runs locally; CodraGraph runs locally. Combine for zero-network agentic workflows. Inference provider: `opencode`, configured via `OPENCODE_URL` env or per-call `baseURL`.

---

### 🟠 Aider
**Aider's `--mcp` flag picks up CodraGraph automatically once `codragraph setup` runs.**

---

### Custom agents (build your own)

```ts
import { graph, harness, compress } from "packages/sdk";

class MyAgent {
  async ask(question: string) {
    const ctx = await graph.context({ name: "extractedSymbol" });
    const compressed = await new compress.LlmCompressor()
      .compress(ctx.snippet, { inference: this.claude, level: "balanced" });
    return this.claude.complete({ messages: [{ role: "user", content: compressed }] });
  }
}
```

The full SDK gives you graph queries, harness search, compression, and the swarm coordinator as building blocks.

## Inference providers

Built-in adapters:

- **Claude** (Anthropic SDK) — Sonnet, Haiku, Opus
- **OpenAI** (covers Codex, GPT-4o, GPT-4.1, GPT-5.x) — pass any model id
- **OpenCode** — OpenAI-compatible, local
- **Bring-your-own** — implement the `InferenceProvider` interface (3 methods)

## Hosting

**Local-first.** Run codragraph anywhere Node 20+ runs. Your repo and graph stay on your machine.

**Self-hosted server.** Run `codragraph serve` on a shared host inside your VPC; your team's agents query it over HTTP.

**(Phase 5)** Hosted multi-tenant version for teams who want managed infra. License decision pending.

## Visual brief

A grid of 6 logos (Claude Code, Cursor, Codex, OpenCode, Aider, "Your agent") with a connecting line into a single CodraGraph block.
