# Bugs Review

Validated on 2026-04-29 against the current dirty worktree. This file is a
review report only; it does not apply fixes.

## Critical - runtime crashes, broken setup, or false release safety

### 1. CLI setup writes broken MCP commands to user IDE configs

- Severity: Critical
- Files: `packages/core/src/cli/setup.ts:36`, `packages/core/src/cli/setup.ts:70`,
  `packages/core/src/cli/setup.ts:75`, `packages/core/src/cli/setup.ts:91`,
  `packages/core/src/cli/setup.ts:93`
- Related tests that currently lock the bug in:
  `packages/core/test/unit/setup.test.ts:76`,
  `packages/core/test/unit/setup.test.ts:91`,
  `packages/core/test/unit/setup.test.ts:189`,
  `packages/core/test/unit/setup-codex.test.ts:64`,
  `packages/core/test/unit/setup-codex.test.ts:79`
- User impact: `codragraph setup` can generate MCP entries that do not launch in
  Claude, Cursor, Codex, OpenCode, or Windsurf.
- Evidence: `@codragraph/cli` is the npm package name, but the executable is
  `codragraph` (`packages/core/package.json:35-37`). `resolveCodragraphBin()`
  checks `which @codragraph/cli` / `where @codragraph/cli`, so the direct binary
  path is missed. The fallback config still uses `npx -y codragraph@latest mcp`,
  while the docs now say the package is `@codragraph/cli`.
- Fix: check for `codragraph`, not `@codragraph/cli`; use
  `npx -y @codragraph/cli@latest mcp` in all generated configs. Update tests to
  expect the scoped package and the executable name. Consider changing the Codex
  MCP server label from `@codragraph/cli` to `codragraph` for readability.

### 2. Codex integration installs an MCP server with a literal `${HOME}` path

- Severity: Critical
- Files: `integrations/codex/codex.config.template.json:21`,
  `integrations/codex/bin/install.mjs:21-32`,
  `packages/core/src/storage/repo-manager.ts:281`,
  `packages/core/src/core/group/storage.ts:10`
- User impact: after `codragraph-codex`, the MCP server can read
  `CODRAGRAPH_HOME=${HOME}/.codragraph` literally instead of the user's real
  home directory. CodraGraph then looks in the wrong global registry/group
  directory and may report no indexed repositories even when the user has
  analyzed projects.
- Evidence: the installer only substitutes the `${CODRAGRAPH_PLUGIN_ROOT}`
  plugin-root placeholder, not `${HOME}`. A
  local substitution check left the value as `${HOME}/.codragraph`, while the
  expected value on a Windows machine is `%USERPROFILE%\.codragraph`. CodraGraph uses
  `process.env.CODRAGRAPH_HOME` directly when it is present.
- Fix: substitute `${HOME}` during install, omit `CODRAGRAPH_HOME` from the
  generated Codex config so the CLI falls back to `os.homedir()`, or teach
  CodraGraph to expand `~`/`${HOME}` safely before using the env var.

### 3. Preflight can report success after failed checks

- Severity: Critical
- File: `scripts/preflight.sh:28-45`
- User impact: a failed `npm ci`, format check, lint run, build, or test can be
  hidden by the trailing `tail`, allowing the script to print
  `ALL CHECKS PASSED` before push.
- Evidence: the script uses `set -e`, but not `pipefail`. In bash, the pipeline
  exit code is the exit code of `tail`, not the failed command on the left.
- Fix: enable `set -euo pipefail` in both shell contexts. To keep short logs,
  capture command output to a temp file, preserve the original exit code, print
  `tail`, then exit with the original status.

## High - user-facing broken installs, overwritten config, or bad samples

### 4. Installer overwrites existing Codex hooks

- Severity: High
- File: `integrations/codex/bin/install.mjs:45-48`
- User impact: users who already configured `hooks.preToolUse` or
  `hooks.postToolUse` lose those hook definitions when they run
  `codragraph-codex`.
- Evidence: the merge is shallow at the event-key level:
  `hooks: { ...(existing.hooks ?? {}), ...template.hooks }`. A simulation with
  an existing `preToolUse` showed the CodraGraph template replacing it entirely,
  while unrelated sibling hook keys survived.
- Fix: if Codex supports multiple hooks for the same event, merge at that shape.
  If it supports only one command per event, detect conflicts and prompt/warn
  instead of silently overwriting. Add a temp-config test that proves unrelated
  and same-event user hooks are preserved or explicitly blocked.

### 5. SDK README documents an export that does not exist

- Severity: High
- Files: `packages/sdk/README.md:25`,
  `packages/sdk/README.md:66`, `packages/sdk/src/graph.ts:8-21`
- User impact: users copying the SDK quick start hit an immediate
  `LocalGraphClient` import/property error.
- Evidence: runtime validation of `packages/sdk/dist/graph.js` showed only
  `HttpGraphClient` is exported. Source `packages/sdk/src/graph.ts` also only
  re-exports `HttpGraphClient`, while the README calls
  `new graph.LocalGraphClient(...)` and imports `LocalGraphClient` from
  `@codragraph/sdk/graph`.
- Fix: either re-export `LocalGraphClient` from `@codragraph/sdk/graph`, or
  change the README to document only the currently supported exported surface.

### 6. SDK README uses async inference factory without `await`

- Severity: High
- Files: `packages/sdk/README.md:32`,
  `packages/harness/src/inference/index.ts:76-79`
- User impact: the README passes a `Promise<InferenceProvider>` into
  `harness.search()` where an `InferenceProvider` is expected.
- Evidence: `makeInferenceProvider()` is declared `async` and runtime
  validation returned `promise`.
- Fix: update the sample to create `const inference = await
  harness.makeInferenceProvider("claude")` before calling `search()`.

### 7. Web onboarding still tells users to install/run the old package

- Severity: High
- File: `apps/web/src/components/OnboardingGuide.tsx:204`,
  `apps/web/src/components/OnboardingGuide.tsx:267`
- User impact: production onboarding still shows `npx codragraph@latest serve`
  and `npm install -g codragraph && codragraph serve`, while the package rename
  work points users to `@codragraph/cli`.
- Evidence: docs were changed to scoped installs, but the user-facing web
  onboarding strings were not.
- Fix: change production onboarding to `npx @codragraph/cli@latest serve` and
  `npm install -g @codragraph/cli && codragraph serve`.

### 8. Runtime error advice still points to the old package

- Severity: High
- File: `packages/core/src/cli/analyze.ts:389-400`
- User impact: when install/dependency errors happen, the CLI tells users to
  reinstall or run `codragraph@latest`, which contradicts the package rename and
  may keep them stuck in the same failure loop.
- Evidence: the suggestions still say `npm install -g codragraph@latest`,
  `npx codragraph@latest analyze`, and similar old names.
- Fix: update runtime recovery text to `@codragraph/cli@latest` while keeping
  the executable examples as `codragraph` after install.

### 9. Claude plugin hook misses the direct binary and falls back to npx

- Severity: High for performance, Medium for correctness
- File: `integrations/claude/hooks/codragraph-hook.js:117`,
  `integrations/claude/hooks/codragraph-hook.js:128`
- User impact: every PreToolUse/PostToolUse can take the slower `npx` path even
  when `codragraph` is globally installed. This can add latency and may exceed
  hook timeouts on cold caches.
- Evidence: the hook checks `which @codragraph/cli` / `where @codragraph/cli`.
  That is the package name, not the executable. The fallback
  `npx -y @codragraph/cli ...` is valid, so this is usually a performance
  regression rather than a total crash.
- Fix: check for `codragraph`; spawn `codragraph.cmd` on Windows and
  `codragraph` elsewhere.

## Medium - publish hygiene, fragile APIs, and follow-up blockers

### 10. Codex installer error message names a command that does not exist

- Severity: Medium
- File: `integrations/codex/bin/install.mjs:40`
- User impact: if `~/.codex/config.json` is invalid JSON, the recovery message
  tells users to rerun `@codragraph/codex install`. The published bin is
  `codragraph-codex`.
- Fix: change the message to `codragraph-codex`.

### 11. New Codex bin is not represented in the current workspace install state

- Severity: Medium
- Files: `integrations/codex/package.json:19-21`,
  `package-lock.json:113-123`
- User impact: local/dev installs can miss the new `codragraph-codex` binary
  until install metadata is refreshed. In this checkout, `node_modules/.bin`
  contains `codragraph` and `packages/harness`, but not `codragraph-codex`.
- Evidence: `package.json` now declares `"codragraph-codex": "bin/install.mjs"`,
  but the lockfile package entry for `integrations/codex` does not
  include a `bin` block.
- Fix: refresh `package-lock.json` with scripts disabled if needed, and verify a
  fresh `npm ci` creates `node_modules/.bin/codragraph-codex`.

### 12. Tests still assert broken setup output

- Severity: Medium
- Files: `packages/core/test/unit/setup.test.ts:76-94`,
  `packages/core/test/unit/setup.test.ts:189-192`,
  `packages/core/test/unit/setup-codex.test.ts:64-82`
- User impact: after fixing setup generation, the test suite will fail unless
  these expectations are updated. This blocks the real fix from landing cleanly.
- Evidence: tests assert `codragraph@latest` and Codex server name
  `@codragraph/cli`.
- Fix: update tests alongside the setup change to expect
  `@codragraph/cli@latest` and the selected server label.

### 13. Wildcard workspace dependencies are unbounded

- Severity: Medium
- Files:
  `packages/core/package.json:62`,
  `packages/graphstore/package.json:66`,
  `packages/harness/package.json:58-59`,
  `packages/compress/package.json:48-49`,
  `packages/sdk/package.json:67-70`,
  `packages/org/package.json:66-67`
- User impact: published packages can accept any future sibling major version,
  increasing the chance of incompatible dependency combinations for consumers.
- Evidence: local `npm pack` inspection for `@codragraph/harness@0.1.1` kept
  `"@codragraph/cli": "*"` and `"@codragraph/shared": "*"` in the packed
  package. That means the risk is unbounded resolution, not permanent pinning to
  publish-time sibling versions.
- Fix: replace `*` with intentional compatible ranges, for example `^1.6.3` for
  `@codragraph/cli` and matching `^0.1.1` / `^1.0.0` sibling ranges where
  appropriate.

### 14. Codex setup uses a shell option that is likely unnecessary on Windows

- Severity: Medium
- File: `packages/core/src/cli/setup.ts:403-408`
- User impact: wrapping `execFile('codex', ...)` with `shell: true` on Windows
  can change lookup and quoting behavior. It is also inconsistent with the
  stated pattern elsewhere that avoids shell mode for real binaries.
- Fix: prefer direct `execFile` without shell, or explicitly resolve
  `codex.cmd`/`codex` before invoking.

### 15. SDK README relies on a deep CLI wildcard export

- Severity: Medium
- Files: `packages/sdk/README.md:19`,
  `packages/core/package.json:25-33`,
  `packages/harness/src/graph/local-client.ts:11`
- User impact: the README imports `LocalBackend` from
  `@codragraph/cli/mcp/local/local-backend`. This works today because the CLI
  package exposes a broad `"./*"` export map, but SDK consumers will break if
  the CLI export map is tightened.
- Fix: provide a stable SDK-level or CLI-level public export for the backend, or
  label the deep import as provisional developer-preview API.

## Stale references to track separately

- `.mcp.json:6` still uses `codragraph@latest`.
- `integrations/claude/.mcp.json:5` and multiple
  `integrations/claude/skills/**/mcp.json` files still use
  `codragraph@latest`.
- `integrations/claude/hooks/codragraph-hook.js:240`,
  `packages/core/hooks/claude/codragraph-hook.cjs:242`, generated skills, and
  several runbooks still say `npx codragraph analyze`. Some of these may be
  acceptable CLI shorthand, but `npx codragraph@latest` and
  `npm install -g codragraph` references should be treated as stale package
  names.

## Verified false alarms and corrected claims

- `@codragraph/cli` missing `@codragraph/shared` as a runtime dependency:
  verified false alarm. `packages/core/scripts/build.js:3-12` and
  `packages/core/scripts/build.js:47-90` build `packages/shared`, copy it into
  `packages/core/dist/_shared`, and rewrite bare `@codragraph/shared` imports to
  relative paths.
- `@codragraph/codex` needs `"type": "module"`: verified false alarm. The
  installer is `.mjs`, while the hook is CommonJS and uses `require()`. Adding
  package-level `"type": "module"` would break the hook unless it were renamed
  or rewritten.
- Wildcard dependencies are pinned to publish-time sibling versions: corrected.
  `npm pack` showed plain `"*"` ranges stay as `"*"`. The real issue is
  unbounded future resolution, not permanent pinning.

## Recommended fix order

1. Fix setup-generated MCP commands and their tests.
2. Fix the Codex `${HOME}` env bug and hook-overwrite behavior.
3. Fix preflight `pipefail` so CI simulation is trustworthy.
4. Fix SDK README/export mismatch and async sample.
5. Update stale package-name strings in web onboarding, runtime error advice,
   plugin templates, and generated config tests.
6. Replace wildcard sibling dependency ranges before the next publish.
