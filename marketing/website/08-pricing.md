# Pricing

## Section title

**Open core. BYO key. No tiers until you need them.**

## Body

Codragraph is open-source under PolyForm-Noncommercial. The full platform is free to download, run locally, and use for personal and non-commercial work.

You bring your own LLM API key (Anthropic, OpenAI, etc.). **Your keys never touch our servers.** Your code never leaves your machine.

---

## Plans

### 🛠 Open core — Free

For solo developers, students, OSS maintainers, evaluators.

- All 4 layers — graph, compression, harness, versioning
- All 6 packages on npm (`codragraph`, `codragraph-harness`, `codragraph-sdk`, `codragraph-compress`, `codragraph-graphstore`, `codragraph-shared`)
- All 5 distribution surfaces — MCP, MCP-over-HTTP, HTTP API, CLI, SDK
- Local-first — your code never leaves your machine
- Community support via GitHub Discussions

**Limit:** non-commercial use only (per PolyForm-Noncommercial license). Internal use at your company is fine; reselling Codragraph or hosting it as a paid service is not.

---

### 🏢 Team — *(Coming Q3, after Phase 5 ships)*

For engineering teams who want shared, managed infra.

- Hosted Codragraph server with team auth (SSO)
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
- Custom license terms

*Contact sales.*

---

## Why BYO key

We're not in the inference business. Anthropic, OpenAI, and the model vendors do that better and cheaper than any middleware ever could.

What we sell: **the layer that makes their models 30× cheaper to use.** Codragraph routes your tokens, but the tokens are billed to you by your model provider directly.

This means:
- We can't see your prompts or your code.
- Your model bill stays predictable.
- Switching providers (Claude → OpenAI → OpenCode) is a config change, not a migration.
- You get the rate you negotiated with your model vendor.

---

## License clarification

**PolyForm-Noncommercial-1.0.0** lets you:
- ✅ Use Codragraph internally at your company (commercial or not)
- ✅ Build OSS or commercial products that *use* Codragraph as a dependency for your own work
- ❌ Resell or rehost Codragraph itself as a paid service

For SaaS / hosted offerings of your own that bundle Codragraph, talk to us — we issue commercial licenses.

## Designer brief

3 pricing cards side by side. Open Core is featured (highlighted border). Team and Enterprise have "Coming soon" / "Talk to us" CTAs.
