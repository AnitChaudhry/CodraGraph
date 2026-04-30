<!-- version: 1.3.0 -->
<!--
  Metadata: version, last reviewed, scope, model policy, reference docs, changelog.
  Last updated: 2026-03-22
-->

Last reviewed: 2026-04-13

**Project:** CodraGraph · **Environment:** dev · **Maintainer:** repository maintainers (see GitHub)

Follow **AGENTS.md** for the canonical rules; this file adds Claude Code–specific deltas. Cursor-specific notes live only in `AGENTS.md`.

## Scope

See the **Scope** table in [AGENTS.md](AGENTS.md) for read/write/execute/off-limits boundaries. Cursor-specific workflow notes also live only in AGENTS.md.

## Model Configuration

- **Primary:** Pin per **Claude Code** / Anthropic org policy (explicit model id). Do not rely on an unversioned `latest` alias for governed workflows.
- **Fallback:** As configured in Claude Code (organization default or user override).
- **Notes:** The CodraGraph CLI analyzer does not call an LLM.

## Execution Sequence (complex tasks)

Same discipline as [AGENTS.md](AGENTS.md): before large multi-step work, state which **AGENTS.md** / **GUARDRAILS.md** rules apply, current **Scope**, and planned validation commands (`npm test`, `tsc`, etc.). When pausing, summarize progress in the chat or a **local** scratch file (do not add `HANDOFF.md` to the repo), then `/clear` and resume with that summary.

## Claude Code hooks

Prefer **PreToolUse** hooks for hard gates (e.g. tests before `git_commit`). Adapt hook commands to `packages/core/` npm scripts.

## Context budget

If always-on instructions grow, load deep conventions via conditional reads (e.g. *“When writing new code, read STANDARDS.md”*) instead of pasting long blocks here. In Cursor, prefer `.cursor/index.mdc` plus optional `.cursor/rules/*.mdc` globs (see [AGENTS.md](AGENTS.md) § Context budget).

## Reference Documentation

- **This repository:** [AGENTS.md](AGENTS.md) (Cursor + monorepo notes), [ARCHITECTURE.md](docs/ARCHITECTURE.md), [CONTRIBUTING.md](docs/CONTRIBUTING.md), [GUARDRAILS.md](docs/GUARDRAILS.md).
- **Call-resolution DAG:** See ARCHITECTURE.md § Call-Resolution DAG. Shared pipeline code in `packages/core/src/core/ingestion/` must not name languages — use `LanguageProvider` hooks instead (see AGENTS.md).
- **CodraGraph:** `.claude/skills/codragraph/`; MCP and indexed-repo rules live only in [AGENTS.md](AGENTS.md) (`codragraph:start` … `codragraph:end`). See **CodraGraph rules** below.

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-04-13 | 1.3.0 | Updated CodraGraph index stats after DAG refactor. |
| 2026-03-24 | 1.2.0 | Removed duplicated codragraph:start block and scope table; replaced with pointers to AGENTS.md. |
| 2026-03-23 | 1.1.0 | Updated agent instructions to match AGENTS.md. |
| 2026-03-22 | 1.0.0 | Added structured header and changelog. |

---

## CodraGraph rules

See the `<!-- codragraph:start --> … <!-- codragraph:end -->` block in **[AGENTS.md](AGENTS.md)** for the canonical MCP tools, impact analysis rules, and index instructions.
