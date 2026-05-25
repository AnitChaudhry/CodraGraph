# Pricing

## Section title

**Open core. BYO key. No tiers until you need them.**

## Body

CodraGraph is open-source under Apache-2.0. The full platform is free to download, run locally, and use for any purpose — personal, commercial, or anything in between.

You bring your own LLM API key (Anthropic, OpenAI, etc.). **Your keys never touch our servers.** Your code never leaves your machine.

---

## Plans

### 🛠 Open core — Free

For solo developers, students, OSS maintainers, evaluators.

- All 4 layers — graph, compression, harness, versioning
- All 6 packages on npm (`codragraph`, `packages/harness`, `packages/sdk`, `packages/compress`, `packages/graphstore`, `packages/shared`)
- All 5 distribution surfaces — MCP, MCP-over-HTTP, HTTP API, CLI, SDK
- Local-first — your code never leaves your machine
- Community support via GitHub Discussions

**Limit:** none. Apache-2.0 lets you use, modify, fork, embed, or even rehost CodraGraph itself. The paid tiers below exist because they're more convenient than self-hosting, not because the OSS forbids commercial use.

---

### 🏢 Team — *(Coming Q3, after Phase 5 ships)*

For engineering teams who want shared, managed infra.

- Hosted CodraGraph server with team auth (SSO)
- Centralized recipe memory across team members
- Per-developer usage analytics
- Audit logs for compliance
- SOC 2 (planned)
- Priority support

**Pricing:** per-seat monthly, scales with repo count. Beta partners get year-1 discount. *Join the waitlist.*

---

### 🏛 Enterprise — *(Custom)*

For organizations that want self-hosted with white-glove support.

- Self-hosted Docker / Helm
- Integration with your SSO + secrets manager
- Custom inference provider adapters (in-house models, etc.)
- Dedicated solutions engineer
- SLA, security review, on-call
- Custom support, security, and procurement terms

*Contact sales.*

---

## Why BYO key

We're not in the inference business. Anthropic, OpenAI, and the model vendors do that better and cheaper than any middleware ever could.

What we sell: **the layer that makes their models 30× cheaper to use.** CodraGraph routes your tokens, but the tokens are billed to you by your model provider directly.

This means:
- We can't see your prompts or your code.
- Your model bill stays predictable.
- Switching providers (Claude → OpenAI → OpenCode) is a config change, not a migration.
- You get the rate you negotiated with your model vendor.

---

## License clarification

**Apache License 2.0** lets you:
- ✅ Use CodraGraph internally at your company
- ✅ Build OSS or commercial products that bundle CodraGraph
- ✅ Rehost CodraGraph as a paid service (the license permits it)
- ✅ Modify the source and ship your own fork

There are no usage restrictions. The Team and Enterprise tiers are for teams
who'd rather pay than self-host; they are service offerings, not license gates.

The open-source code remains Apache-2.0 across every public package. Managed
plans are service/support offerings on top of the same permissive core.

## Designer brief

3 pricing cards side by side. Open Core is featured (highlighted border). Team and Enterprise have "Coming soon" / "Talk to us" CTAs.
