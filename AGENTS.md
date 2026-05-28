<!-- version: 1.7.0 -->
<!-- Last updated: 2026-05-25 -->

Last reviewed: 2026-05-25

**Project:** CodraGraph · **Environment:** dev · **Maintainer:** repository maintainers (see GitHub)

## Scope

| Boundary | Rule |
|----------|------|
| **Reads** | `packages/core/`, `apps/web/`, `eval/`, plugin packages, `.github/`, `.codragraph/`, docs. |
| **Writes** | Only paths required for the change; keep diffs minimal. Update lockfiles when deps change. |
| **Executes** | `npm`, `npx`, `bun`, `bunx`, `node` under `packages/core/` and `apps/web/`; `uv run` for Python under `eval/`; documented CI/dev workflows. |
| **Off-limits** | Real `.env` / secrets, production credentials, unrelated repos, destructive git ops without confirmation. |

## Model Configuration

- **Primary:** Use a named model (e.g. Claude Sonnet 4.x). Avoid `Auto` or unversioned `latest` when reproducibility matters.
- **Notes:** The CodraGraph CLI indexer does not call an LLM.

## Execution Sequence (complex tasks)

For multi-step work, state up front:
1. Which rules in this file and **[GUARDRAILS.md](docs/GUARDRAILS.md)** apply (and any relevant Signs).
2. Current **Scope** boundaries.
3. Which **validation commands** you will run (`npm --prefix packages/core test`, `npm --prefix packages/core exec tsc -- --noEmit`).

On long threads, *"Remember: apply all AGENTS.md rules"* re-weights these instructions against context dilution.

## Claude Code hooks

**PreToolUse** hooks can block tools (e.g. `git_commit`) until checks pass. Adapt to this repo: `npm --prefix packages/core test` before commit.

## Context budget

Commands and gotchas live under **Repo reference** below and in **[CONTRIBUTING.md](docs/CONTRIBUTING.md)**. If always-on rules grow, split into **`.cursor/rules/*.mdc`** (globs). **Cursor:** project-wide rules in `.cursor/index.mdc`. **Claude Code:** load `STANDARDS.md` only when needed.

## Reference docs

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**, **[CONTRIBUTING.md](docs/CONTRIBUTING.md)**, **[GUARDRAILS.md](docs/GUARDRAILS.md)**
- **[AI_AGENT_CLI_GUIDE.md](docs/AI_AGENT_CLI_GUIDE.md)** for supported agent commands and MCP HTTP behavior; **[STORAGE_AND_RETRIEVAL.md](docs/STORAGE_AND_RETRIEVAL.md)** for `.codragraph` size, embeddings, BM25, and compression policy.
- **Call-resolution DAG (legacy path):** See ARCHITECTURE.md § Call-Resolution DAG. Typed 6-stage DAG inside the `parse` phase; language-specific behavior behind `inferImplicitReceiver` / `selectDispatch` hooks on `LanguageProvider`. Shared code in `packages/core/src/core/ingestion/` must not name languages. Types: `packages/core/src/core/ingestion/call-types.ts`.
- **Scope-resolution pipeline (RFC #909 Ring 3):** See ARCHITECTURE.md § Scope-Resolution Pipeline. Replaces the legacy DAG for languages in `MIGRATED_LANGUAGES` (currently Python). A language plugs in by implementing `ScopeResolver` (`scope-resolution/contract/scope-resolver.ts`) and registering it in `SCOPE_RESOLVERS`. CI parity gate runs BOTH paths per migrated language on every PR.
- **Cursor:** `.cursor/index.mdc` (always-on); `.cursor/rules/*.mdc` (glob-scoped). Legacy `.cursorrules` deprecated.
- **CodraGraph:** skills in `.claude/skills/codragraph/`; MCP rules in `codragraph:start` block below.

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-05-25 | 1.7.0 | Added FeatureCluster context-pack guidance and cross-platform command forms. |
| 2026-04-20 | 1.6.0 | Added scope-resolution pipeline pointer (RFC #909 Ring 3); Python migrated to registry-primary. |
| 2026-04-19 | 1.5.0 | Cross-repo impact (#794): `impact`/`query`/`context` accept `repo: "@<group>"` + `service`. Removed `group_query`/`group_contracts`/`group_status` MCP tools; added `codragraph://group/{name}/contracts` and `codragraph://group/{name}/status` resources. |
| 2026-04-16 | 1.4.0 | Fixed: web UI description, pre-commit behavior, MCP tools (7->16), added packages/shared, removed stale vite-plugin-wasm gotcha. |
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
- Add language-specific behavior to shared ingestion code (`packages/core/src/core/ingestion/`) — use a `LanguageProvider` hook. Seeing `provider.mroStrategy === 'xxx'` or an import from `languages/xxx.ts` in shared code means stop and add a hook.

## Tools Quick Reference

| Tool | When to use | Example |
|------|-------------|---------|
| `list_repos` | Discover indexed repos | `codragraph_list_repos({})` |
| `query` | Find code by concept | `codragraph_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `codragraph_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `codragraph_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `codragraph_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `codragraph_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `feature_clusters` | Product/domain feature map | `codragraph_feature_clusters({limit: 25})` |
| `feature_context` | Focused files, line ranges, dependencies, flows | `codragraph_feature_context({name: "Settings"})` |
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
| `codragraph://repo/CodraGraph/feature-clusters` | Product/domain feature areas |
| `codragraph://repo/CodraGraph/feature/{name}` | Focused feature context pack |
| `codragraph://repo/CodraGraph/processes` | All execution flows |
| `codragraph://repo/CodraGraph/process/{name}` | Step-by-step execution trace |
| `codragraph://group/{name}/contracts` | Group Contract Registry (provider/consumer rows + cross-links) |
| `codragraph://group/{name}/status` | Per-member index + Contract Registry staleness report |

## Self-Check Before Finishing

1. `codragraph_impact` was run for all modified symbols
2. No HIGH/CRITICAL warnings were ignored
3. `codragraph_detect_changes()` confirms expected scope
4. All d=1 dependents were updated

For this monorepo's source CLI, run the pre-commit graph check from the repo
root as `npm run codragraph:detect-staged`. Avoid
`npm --prefix packages/core exec tsx src/cli/index.ts ...` from the root; on
Windows/npm it can resolve `src/cli/index.ts` relative to the root instead of
`packages/core/`.

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
| **CLI/Core** | `packages/core/` | TypeScript CLI, indexing pipeline, MCP server. Published to npm. |
| **Web UI** | `apps/web/` | React/Vite thin client. All queries via `codragraph serve` HTTP API. |
| **Shared** | `packages/shared/` | Shared TypeScript types and constants. |
| Claude Plugin | `integrations/claude/` | Static config for Claude marketplace. |
| Cursor Integration | `integrations/cursor/` | Static config for Cursor editor. |
| Eval | `eval/` | Python evaluation harness (Docker + LLM API keys). |

### Running services

```bash
npm --prefix packages/core run dev              # CLI: tsx watch mode
bun run --filter @codragraph/cli dev            # Bun equivalent
npm --prefix apps/web run dev                   # Web UI: Vite on port 5173
bun run --filter codragraph-web dev             # Bun equivalent
npx @codragraph/cli serve                       # HTTP API on port 4747 (from any indexed repo)
bunx @codragraph/cli serve                      # Bun equivalent
npx @codragraph/cli serve --web hosted          # Local API for hosted dashboard connection
```

Use the same command forms in Windows PowerShell, macOS bash/zsh, and Linux shells. Prefer `npm --prefix <package> <script>` or `bun run --filter <workspace> <script>` from repo root instead of `cd dir && ...` when documenting or sharing commands.

### Testing

**CLI / Core (`packages/core/`)**
- `npm --prefix packages/core test` or `bun run --filter @codragraph/cli test` — full vitest suite (~2000 tests)
- `npm --prefix packages/core run test:unit` — unit tests only
- `npm --prefix packages/core run test:integration` — integration (~1850 tests). LadybugDB file-locking tests may fail in containers (known env issue).
- `npm --prefix packages/core exec tsc -- --noEmit` — typecheck

**Web UI (`apps/web/`)**
- `npm --prefix apps/web test` or `bun run --filter codragraph-web test` — vitest (~200 tests)
- `npm --prefix apps/web run test:e2e` — Playwright (7 spec files; requires `codragraph serve` + `npm --prefix apps/web run dev`)
- `npm --prefix apps/web exec tsc -- -b --noEmit` — typecheck

**Pre-commit hook** (`.husky/pre-commit`): formatting (prettier via lint-staged) + typecheck for staged packages. Tests do **not** run in pre-commit — CI only.

### Gotchas

- `npm install` in `packages/core/` triggers `prepare` (builds via `tsc`) and `postinstall` (patches tree-sitter-swift, builds tree-sitter-proto). Bun users should use `bun install --trust` or `bun pm trust <package>` when native dependency lifecycle scripts are needed. Native bindings need `python3`, `make`, `g++`.
- `tree-sitter-kotlin` and `tree-sitter-swift` are optional — install warnings expected.
- ESLint configured via `eslint.config.mjs` (TS, React Hooks, unused-imports). No package-local `npm run lint` script; use the root `npm run lint` or `npx eslint .`. Prettier runs via lint-staged. CI checks both in `.github/workflows/ci.yml`.
