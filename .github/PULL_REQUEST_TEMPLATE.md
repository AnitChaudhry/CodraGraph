<!--
  Thanks for contributing to CodraGraph! Please fill the sections below
  so reviewers can give you fast, focused feedback.
-->

## What

<!-- 1–3 sentences. Describe the user-visible change. Not the implementation. -->

## Why

<!-- The problem this solves. Link the issue number if there is one (e.g. "Closes #42"). -->

## Affected packages

<!-- Tick all that apply. -->

- [ ] `codragraph` (CLI / MCP / server)
- [ ] `codragraph-sdk`
- [ ] `codragraph-graphstore`
- [ ] `codragraph-harness`
- [ ] `codragraph-compress`
- [ ] `codragraph-shared`
- [ ] `codragraph-web` (dashboard)
- [ ] `codragraph-claude-plugin`
- [ ] `codragraph-cursor-integration`
- [ ] `codragraph-codex-integration`
- [ ] Repo-wide tooling (CI, scripts, license, docs)

## How tested

<!--
  Replace each "—" with the actual command + result.
  Example:
    npm test --workspace codragraph-graphstore   → 56/56 pass
    npx tsc --noEmit                              → clean
    Manual: `codragraph analyze .` on a fresh repo → graph builds
-->

- [ ] `npm test` for affected workspaces — _result:_
- [ ] `tsc --noEmit` per affected package — _result:_
- [ ] CLI / dashboard manual smoke test — _what + result:_
- [ ] CI green (auto-checked when you push)

## Breaking changes

<!--
  - Public API change in any published package?
  - Added a new required option?
  - Renamed a CLI flag, env var, or config field?
  If yes, describe the migration path. If no, write "None."
-->

## Reviewer notes

<!-- Anything the reviewer should look at first / specific feedback you want / known follow-ups. Optional. -->
