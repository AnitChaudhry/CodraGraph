# Changelog

All notable changes to CodraGraph will be documented in this file.

## [Unreleased]

## [2.1.5] - 2026-05-29

### Added

- `codragraph analyze` now refreshes `.codragraph/structure/`, a compact
  what/why/how/when/where agent memory pack with branch/index state,
  bounded history, `state.json`, and SQLite seed SQL.

### Changed

- Direct graph CLI commands now resolve the indexed repo under the current
  working directory and fail clearly when the cwd is unindexed, instead of
  silently falling back to another registered repo.
- Analyzer worker parsing uses smaller sub-batches and progress-reset idle
  timeouts, including the worker flush/finalize phase, to reduce false
  sequential fallback on large repositories.
- Claude and Codex hooks stay read-only in the agent hot path: no background
  analyze, no `detect-changes`, and no package-runner install/fetch from hooks.
- Workspace packages, web app, and integrations bumped to `2.1.5`.

### Fixed

- Generated `.codragraph/structure/` files are ignored by the indexer so agent
  memory does not feed back into future graph rebuild decisions.
- Codex hook augmentation now reads graph context from stderr or stdout.

## [2.1.4] - 2026-05-28

### Added

- Public distribution export now derives package versions from workspace
  manifests, so the generated public README, install snippets, tarball names,
  and checksum manifest stay aligned with the release version.

### Changed

- `codragraph analyze` now reuses an existing graph when the indexed commit
  changes but only non-index-impacting files changed, such as generated agent
  context, lockfiles, or ignored binary assets.
- Public documentation exports include the full docs tree, package README
  mirrors, branding, downloadable package tarballs, and an end-to-end public
  README rather than only source package artifacts.
- Workspace packages, web app, and integrations bumped to `2.1.4`.

### Fixed

- `analyze --embeddings` and compression changes now force a rebuild when the
  existing index does not contain the requested storage layer.
- The analyzer no longer reuses metadata when the LadybugDB graph files are
  missing.
- Windows-heavy unit tests have larger child-process budgets for source CLI
  startup paths.

### Changed
- Migrated from KuzuDB to LadybugDB v0.15 (`@ladybugdb/core`, `@ladybugdb/wasm-core`)
- Renamed all internal paths from `kuzu` to `cgdb` (storage: `.codragraph/kuzu` → `.codragraph/cgdb`)
- Added automatic cleanup of stale KuzuDB index files
- LadybugDB v0.15 requires explicit VECTOR extension loading for semantic search

## [1.5.3] - 2026-04-01

### Added

- **TypeScript/JavaScript MethodExtractor config** — shared extraction config covering abstract methods, visibility modifiers, async/override keywords, decorators, rest/optional/destructured parameters, and return types (#588) — @compound-ai

### Fixed

- **Azure OpenAI compatibility** — use `max_completion_tokens` instead of deprecated `max_tokens` (newer models reject `max_tokens`); skip `temperature` for Azure provider (some models reject non-default values) (#618)
- **Simplified Azure interactive setup** — 3 prompts (endpoint, deployment, key) instead of 7 (#618)
- **Wiki HTML viewer script injection** — escape `</script>` in embedded JSON so LLM-generated markdown no longer breaks the viewer (#618)
- Ensure import rewrites survive npm publish lifecycle

## [1.4.0] - 2026-03-13

### Added

- **Language-aware symbol resolution engine** with 3-tier resolver: exact FQN → scope-walk → guarded fuzzy fallback that refuses ambiguous matches (#238) — @magyargergo
- **Method Resolution Order (MRO)** with 5 language-specific strategies: C++ leftmost-base, C#/Java class-over-interface, Python C3 linearization, Rust qualified syntax, default BFS (#238) — @magyargergo
- **Constructor & struct literal resolution** across all languages — `new Foo()`, `User{...}`, C# primary constructors, target-typed new (#238) — @magyargergo
- **Receiver-constrained resolution** using per-file TypeEnv — disambiguates `user.save()` vs `repo.save()` via `ownerId` matching (#238) — @magyargergo
- **Heritage & ownership edges** — HAS_METHOD, OVERRIDES, Go struct embedding, Swift extension heritage, method signatures (`parameterCount`, `returnType`) (#238) — @magyargergo
- **Language-specific resolver directory** (`resolvers/`) — extracted JVM, Go, C#, PHP, Rust resolvers from monolithic import-processor (#238) — @magyargergo
- **Type extractor directory** (`type-extractors/`) — per-language type binding extraction with `Record<SupportedLanguages, Handler>` + `satisfies` dispatch (#238) — @magyargergo
- **Export detection dispatch table** — compile-time exhaustive `Record` + `satisfies` pattern replacing switch/if chains (#238) — @magyargergo
- **Language config module** (`language-config.ts`) — centralized tsconfig, go.mod, composer.json, .csproj, Swift package config loaders (#238) — @magyargergo
- **Optional skill generation** via `npx codragraph analyze --skills` — generates AI agent skills from KuzuDB knowledge graph (#171) — @zander-raycraft
- **First-class C# support** — sibling-based modifier scanning, record/delegate/property/field/event declaration types (#163, #170, #178 via #237) — @Alice523, @benny-yamagata, @jnMetaCode
- **C/C++ support fixes** — `.h` → C++ mapping, static-linkage export detection, qualified/parenthesized declarators, 48 entry point patterns (#163, #227 via #237) — @Alice523, @bitgineer
- **Rust support fixes** — sibling-based `visibility_modifier` scanning for `pub` detection (#227 via #237) — @bitgineer
- **Adaptive tree-sitter buffer sizing** — `Math.min(Math.max(contentLength * 2, 512KB), 32MB)` (#216 via #237) — @JasonOA888
- **Call expression matching** in tree-sitter queries (#234 via #237) — @ex-nihilo-jg
- **DeepSeek model configurations** (#217) — @JasonOA888
- 282+ new unit tests, 178 integration resolver tests across 9 languages, 53 test files, 1146 total tests passing

### Fixed

- Skip unavailable native Swift parsers in sequential ingestion (#188) — @Gujiassh
- Heritage heuristic language-gated — no longer applies class/interface rules to wrong languages (#238) — @magyargergo
- C# `base_list` distinguishes EXTENDS vs IMPLEMENTS via symbol table + `I[A-Z]` heuristic (#238) — @magyargergo
- Go `qualified_type` (`models.User`) correctly unwrapped in TypeEnv (#238) — @magyargergo
- Global tier no longer blocks resolution when kind/arity filtering can narrow to 1 candidate (#238) — @magyargergo

### Changed

- `import-processor.ts` reduced from 1412 → 711 lines (50% reduction) via resolver and config extraction (#238) — @magyargergo
- `type-env.ts` reduced from 635 → ~125 lines via type-extractor extraction (#238) — @magyargergo
- CI/CD workflows hardened with security fixes and fork PR support (#222, #225) — @magyargergo

## [1.3.11] - 2026-03-08

### Security

- Fix FTS Cypher injection by escaping backslashes in search queries (#209) — @magyargergo

### Added

- Auto-reindex hook that runs `codragraph analyze` after commits and merges, with automatic embeddings preservation (#205) — @L1nusB
- 968 integration tests (up from ~840) covering unhappy paths across search, enrichment, CLI, pipeline, worker pool, and KuzuDB (#209) — @magyargergo
- Coverage auto-ratcheting so thresholds bump automatically on CI (#209) — @magyargergo
- Rich CI PR report with coverage bars, test counts, and threshold tracking (#209) — @magyargergo
- Modular CI workflow architecture with separate unit-test, integration-test, and orchestrator jobs (#209) — @magyargergo

### Fixed

- KuzuDB native addon crashes on Linux/macOS by running integration tests in isolated vitest processes with `--pool=forks` (#209) — @magyargergo
- Worker pool `MODULE_NOT_FOUND` crash when script path is invalid (#209) — @magyargergo

### Changed

- Added macOS to the cross-platform CI test matrix (#208) — @magyargergo

## [1.3.10] - 2026-03-07

### Security

- **MCP transport buffer cap**: Added 10 MB `MAX_BUFFER_SIZE` limit to prevent out-of-memory attacks via oversized `Content-Length` headers or unbounded newline-delimited input
- **Content-Length validation**: Reject `Content-Length` values exceeding the buffer cap before allocating memory
- **Stack overflow prevention**: Replaced recursive `readNewlineMessage` with iterative loop to prevent stack overflow from consecutive empty lines
- **Ambiguous prefix hardening**: Tightened `looksLikeContentLength` to require 14+ bytes before matching, preventing false framing detection on short input
- **Closed transport guard**: `send()` now rejects with a clear error when called after `close()`, with proper write-error propagation

### Added

- **Dual-framing MCP transport** (`CompatibleStdioServerTransport`): Auto-detects Content-Length (Codex/OpenCode) and newline-delimited JSON (Cursor/Claude Code) framing on the first message, responds in the same format (#207)
- **Lazy CLI module loading**: All CLI subcommands now use `createLazyAction()` to defer heavy imports (tree-sitter, ONNX, KuzuDB) until invocation, significantly improving `codragraph mcp` startup time (#207)
- **Type-safe lazy actions**: `createLazyAction` uses constrained generics to validate export names against module types at compile time
- **Regression test suite**: 13 unit tests covering transport framing, security hardening, buffer limits, and lazy action loading

### Fixed

- **CALLS edge sourceId alignment**: `findEnclosingFunctionId` now generates IDs with `:startLine` suffix matching node creation format, fixing process detector finding 0 entry points (#194)
- **LRU cache zero maxSize crash**: Guard `createASTCache` against `maxSize=0` when repos have no parseable files (#144)

### Changed

- Transport constructor accepts `NodeJS.ReadableStream` / `NodeJS.WritableStream` (widened from concrete `ReadStream`/`WriteStream`)
- `processReadBuffer` simplified to break on first error instead of stale-buffer retry loop

## [1.3.9] - 2026-03-06

### Fixed

- Aligned CALLS edge sourceId with node ID format in parse worker (#194)

## [1.3.8] - 2026-03-05

### Fixed

- Force-exit after analyze to prevent KuzuDB native cleanup hang (#192)
