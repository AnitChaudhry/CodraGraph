<!-- version: 1.6.0 -->
<!-- Last updated: 2026-04-20 -->

Last reviewed: 2026-04-20

**Project:** CodraGraph · **Environment:** dev · **Maintainer:** repository maintainers (see GitHub)

## Scope

| Boundary | Rule |
|----------|------|
| **Reads** | `codragraph/`, `codragraph-web/`, `eval/`, plugin packages, `.github/`, `.codragraph/`, docs. |
| **Writes** | Only paths required for the change; keep diffs minimal. Update lockfiles when deps change. |
| **Executes** | `npm`, `npx`, `node` under `codragraph/` and `codragraph-web/`; `uv run` for Python under `eval/`; documented CI/dev workflows. |
| **Off-limits** | Real `.env` / secrets, production credentials, unrelated repos, destructive git ops without confirmation. |

## Model Configuration

- **Primary:** Use a named model (e.g. Claude Sonnet 4.x). Avoid `Auto` or unversioned `latest` when reproducibility matters.
- **Notes:** The CodraGraph CLI indexer does not call an LLM.

## Execution Sequence (complex tasks)

For multi-step work, state up front:
1. Which rules in this file and **[GUARDRAILS.md](GUARDRAILS.md)** apply (and any relevant Signs).
2. Current **Scope** boundaries.
3. Which **validation commands** you will run (`cd codragraph && npm test`, `npx tsc --noEmit`).

On long threads, *"Remember: apply all AGENTS.md rules"* re-weights these instructions against context dilution.

## Claude Code hooks

**PreToolUse** hooks can block tools (e.g. `git_commit`) until checks pass. Adapt to this repo: `cd codragraph && npm test` before commit.

## Context budget

Commands and gotchas live under **Repo reference** below and in **[CONTRIBUTING.md](CONTRIBUTING.md)**. If always-on rules grow, split into **`.cursor/rules/*.mdc`** (globs). **Cursor:** project-wide rules in `.cursor/index.mdc`. **Claude Code:** load `STANDARDS.md` only when needed.

## Reference docs

- **[ARCHITECTURE.md](ARCHITECTURE.md)**, **[CONTRIBUTING.md](CONTRIBUTING.md)**, **[GUARDRAILS.md](GUARDRAILS.md)**
- **Call-resolution DAG (legacy path):** See ARCHITECTURE.md § Call-Resolution DAG. Typed 6-stage DAG inside the `parse` phase; language-specific behavior behind `inferImplicitReceiver` / `selectDispatch` hooks on `LanguageProvider`. Shared code in `codragraph/src/core/ingestion/` must not name languages. Types: `codragraph/src/core/ingestion/call-types.ts`.
- **Scope-resolution pipeline (RFC #909 Ring 3):** See ARCHITECTURE.md § Scope-Resolution Pipeline. Replaces the legacy DAG for languages in `MIGRATED_LANGUAGES` (currently Python). A language plugs in by implementing `ScopeResolver` (`scope-resolution/contract/scope-resolver.ts`) and registering it in `SCOPE_RESOLVERS`. CI parity gate runs BOTH paths per migrated language on every PR.
- **Cursor:** `.cursor/index.mdc` (always-on); `.cursor/rules/*.mdc` (glob-scoped). Legacy `.cursorrules` deprecated.
- **CodraGraph:** skills in `.claude/skills/codragraph/`; MCP rules in `codragraph:start` block below.

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-04-20 | 1.6.0 | Added scope-resolution pipeline pointer (RFC #909 Ring 3); Python migrated to registry-primary. |
| 2026-04-19 | 1.5.0 | Cross-repo impact (#794): `impact`/`query`/`context` accept `repo: "@<group>"` + `service`. Removed `group_query`/`group_contracts`/`group_status` MCP tools; added `codragraph://group/{name}/contracts` and `codragraph://group/{name}/status` resources. |
| 2026-04-16 | 1.4.0 | Fixed: web UI description, pre-commit behavior, MCP tools (7->16), added codragraph-shared, removed stale vite-plugin-wasm gotcha. |
| 2026-04-13 | 1.3.0 | Updated CodraGraph index stats after DAG refactor. |
| 2026-03-24 | 1.2.0 | Fixed codragraph:start block duplication. |
| 2026-03-23 | 1.1.0 | Updated agent instructions, references, Cursor layout. |
| 2026-03-22 | 1.0.0 | Initial structured header and changelog. |

---

<!-- codragraph:start -->
# CodraGraph — Code Intelligence

Indexed as **CodraGraph** (4325 symbols, 10556 relationships, 300 execution flows). Use MCP tools to understand code, assess impact, and navigate safely.

> If any tool warns the index is stale, run `npx @codragraph/cli analyze` first.

## Always Do

- **MUST run impact analysis before editing any symbol.** `codragraph_impact({target: "symbolName", direction: "upstream"})` — report blast radius to the user.
- **MUST run `codragraph_detect_changes()` before committing** — verify only expected symbols and flows are affected.
- **MUST warn the user** if impact returns HIGH or CRITICAL risk.
- Explore unfamiliar code with `codragraph_query({query: "concept"})` (process-grouped, ranked) instead of grepping.
- Full context on a symbol: `codragraph_context({name: "symbolName"})`.

## When Debugging

1. `codragraph_query({query: "<error or symptom>"})` — find related execution flows
2. `codragraph_context({name: "<suspect function>"})` — callers, callees, process participation
3. `READ codragraph://repo/CodraGraph/process/{processName}` — trace flow step by step
4. Regressions: `codragraph_detect_changes({scope: "compare", base_ref: "main"})`

## When Refactoring

- **Rename:** `codragraph_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Graph edits are safe; text_search edits need manual review.
- **Extract/Split:** `codragraph_context` (incoming/outgoing refs) then `codragraph_impact` (upstream callers) before moving code.
- **After any refactor:** `codragraph_detect_changes({scope: "all"})` to verify scope.

## Never Do

- Edit a symbol without running `codragraph_impact` first.
- Ignore HIGH/CRITICAL risk warnings.
- Rename with find-and-replace — use `codragraph_rename`.
- Commit without `codragraph_detect_changes()`.
- Add language-specific behavior to shared ingestion code (`codragraph/src/core/ingestion/`) — use a `LanguageProvider` hook. Seeing `provider.mroStrategy === 'xxx'` or an import from `languages/xxx.ts` in shared code means stop and add a hook.

## Tools Quick Reference

| Tool | When to use | Example |
|------|-------------|---------|
| `list_repos` | Discover indexed repos | `codragraph_list_repos({})` |
| `query` | Find code by concept | `codragraph_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `codragraph_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `codragraph_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `codragraph_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `codragraph_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `codragraph_cypher({query: "MATCH ..."})` |
| `api_impact` | Pre-change API route impact | `codragraph_api_impact({route: "/api/users", method: "GET"})` |
| `route_map` | Route → handler → consumer map | `codragraph_route_map({})` |
| `tool_map` | MCP/RPC tool definitions | `codragraph_tool_map({})` |
| `shape_check` | Response shape vs consumer access | `codragraph_shape_check({route: "/api/users"})` |
| `group_list` | List repo groups | `codragraph_group_list({})` |
| `group_sync` | Rebuild group Contract Registry | `codragraph_group_sync({name: "myGroup"})` |
| `query` (group mode) | Cross-repo search in a group (RRF-merged) | `codragraph_query({repo: "@myGroup", query: "auth"})` |
| `context` (group mode) | 360° view across all member repos | `codragraph_context({repo: "@myGroup", name: "validateUser"})` |
| `impact` (group mode) | Cross-repo blast radius via Contract Bridge | `codragraph_impact({repo: "@myGroup", target: "X", direction: "upstream"})` |

> Group mode: pass `repo: "@<groupName>"` to fan out across all member repos, or `repo: "@<groupName>/<memberPath>"` to target a single member (path keys from `group.yaml`). Optional `service: "<monorepo/path>"` filters by service root. Group-level state (contracts, staleness) lives in the resources table below — there are **no** `group_query` / `group_context` / `group_impact` / `group_contracts` / `group_status` MCP tools.
>
> For a full walkthrough of setting up a group across multiple repos that communicate over gRPC, see [docs/guides/microservices-grpc.md](docs/guides/microservices-grpc.md).

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `codragraph://repo/CodraGraph/context` | Codebase overview, index freshness |
| `codragraph://repo/CodraGraph/clusters` | All functional areas |
| `codragraph://repo/CodraGraph/processes` | All execution flows |
| `codragraph://repo/CodraGraph/process/{name}` | Step-by-step execution trace |
| `codragraph://group/{name}/contracts` | Group Contract Registry (provider/consumer rows + cross-links) |
| `codragraph://group/{name}/status` | Per-member index + Contract Registry staleness report |

## Self-Check Before Finishing

1. `codragraph_impact` was run for all modified symbols
2. No HIGH/CRITICAL warnings were ignored
3. `codragraph_detect_changes()` confirms expected scope
4. All d=1 dependents were updated

## Keeping the Index Fresh

```bash
npx @codragraph/cli analyze              # basic refresh
npx @codragraph/cli analyze --embeddings # preserve embeddings
```

Check `.codragraph/meta.json` `stats.embeddings` (0 = none). Running without `--embeddings` deletes existing vectors.

> Claude Code: PostToolUse hook handles this after `git commit` and `git merge`.

## CLI Skills

| Task | Skill file |
|------|-----------|
| Architecture / "How does X work?" | `.claude/skills/codragraph/codragraph-exploring/SKILL.md` |
| Blast radius / "What breaks?" | `.claude/skills/codragraph/codragraph-impact-analysis/SKILL.md` |
| Debugging / "Why is X failing?" | `.claude/skills/codragraph/codragraph-debugging/SKILL.md` |
| Refactoring | `.claude/skills/codragraph/codragraph-refactoring/SKILL.md` |
| Tools/resources/schema reference | `.claude/skills/codragraph/codragraph-guide/SKILL.md` |
| CLI commands (index, status, clean, wiki) | `.claude/skills/codragraph/codragraph-cli/SKILL.md` |

<!-- codragraph:end -->

## Repo reference

### Packages

| Package | Path | Purpose |
|---------|------|---------|
| **CLI/Core** | `codragraph/` | TypeScript CLI, indexing pipeline, MCP server. Published to npm. |
| **Web UI** | `codragraph-web/` | React/Vite thin client. All queries via `codragraph serve` HTTP API. |
| **Shared** | `codragraph-shared/` | Shared TypeScript types and constants. |
| Claude Plugin | `codragraph-claude-plugin/` | Static config for Claude marketplace. |
| Cursor Integration | `codragraph-cursor-integration/` | Static config for Cursor editor. |
| Eval | `eval/` | Python evaluation harness (Docker + LLM API keys). |

### Running services

```bash
cd codragraph && npm run dev                 # CLI: tsx watch mode
cd codragraph-web && npm run dev             # Web UI: Vite on port 5173
npx @codragraph/cli serve                         # HTTP API on port 4747 (from any indexed repo)
```

### Testing

**CLI / Core (`codragraph/`)**
- `npm test` — full vitest suite (~2000 tests)
- `npm run test:unit` — unit tests only
- `npm run test:integration` — integration (~1850 tests). LadybugDB file-locking tests may fail in containers (known env issue).
- `npx tsc --noEmit` — typecheck

**Web UI (`codragraph-web/`)**
- `npm test` — vitest (~200 tests)
- `npm run test:e2e` — Playwright (7 spec files; requires `codragraph serve` + `npm run dev`)
- `npx tsc -b --noEmit` — typecheck

**Pre-commit hook** (`.husky/pre-commit`): formatting (prettier via lint-staged) + typecheck for staged packages. Tests do **not** run in pre-commit — CI only.

### Gotchas

- `npm install` in `codragraph/` triggers `prepare` (builds via `tsc`) and `postinstall` (patches tree-sitter-swift, builds tree-sitter-proto). Native bindings need `python3`, `make`, `g++`.
- `tree-sitter-kotlin` and `tree-sitter-swift` are optional — install warnings expected.
- ESLint configured via `eslint.config.mjs` (TS, React Hooks, unused-imports). No `npm run lint` script; use `npx eslint .`. Prettier runs via lint-staged. CI checks both in `ci-quality.yml`.
