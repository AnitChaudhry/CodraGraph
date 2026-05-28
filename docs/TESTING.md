# Testing — CodraGraph

How we structure tests and which commands to run locally and in CI.

## Packages

| Package        | Path           | Runner   | Notes                          |
| -------------- | -------------- | -------- | ------------------------------ |
| CLI + MCP core | `packages/core/`    | Vitest   | Primary test surface in CI     |
| Web UI         | `apps/web/`| Vitest   | Unit/component tests           |
| Web UI E2E     | `apps/web/`| Playwright | Run when changing UI flows   |

## Commands (local)

From repository root, unless noted:

**`codragraph` (CLI / library)**

```bash
npm install
npm --prefix packages/core run build
npm --prefix packages/core test                    # full suite: vitest run
npm --prefix packages/core run test:unit           # unit only: vitest run test/unit
npm --prefix packages/core run test:integration    # integration suite
npm --prefix packages/core run test:coverage
npm --prefix packages/core exec tsc -- --noEmit    # typecheck (matches CI)
```

Bun equivalents:

```bash
bun install
bun run --filter @codragraph/cli build
bun run --filter @codragraph/cli test
bun run --filter @codragraph/cli test:unit
bun run --filter @codragraph/cli test:integration
bun run --filter @codragraph/cli test:coverage
```

**`apps/web`**

```bash
npm install
npm --prefix apps/web test                         # unit tests (vitest)
npm --prefix apps/web exec tsc -- -b --noEmit      # typecheck (matches CI)
npm --prefix apps/web run test:coverage
npm --prefix apps/web run test:e2e                 # Playwright (requires codragraph serve + npm --prefix apps/web run dev)
```

Bun equivalents:

```bash
bun run --filter codragraph-web test
bun run --filter codragraph-web build
bun run --filter codragraph-web test:coverage
bun run --filter codragraph-web test:e2e
```

For Bun typecheck parity, use the build scripts: `@codragraph/cli build`
runs `tsc` through the package build, and `codragraph-web build` runs
`tsc -b` before Vite.

These command forms work in Windows PowerShell, macOS bash/zsh, and Linux
shells. Prefer `npm --prefix <package> <script>` or
`bun run --filter <workspace> <script>` in docs and PRs so copied commands do
not depend on a specific shell's directory-change syntax.

## Pre-commit hook

A husky pre-commit hook (`.husky/pre-commit`) runs automatically on every `git commit`:

1. **Formatting** — `lint-staged` runs prettier on staged files
2. **`apps/web/` files staged** → `tsc -b --noEmit`
3. **`packages/core/` files staged** → `tsc --noEmit`

Tests do **not** run in the pre-commit hook — they run in CI (`.github/workflows/ci.yml`) only.

Skip with `git commit --no-verify` (use sparingly).

## Test categories

- **Unit** — Pure logic, parsers, graph/query helpers; fast; no network.
- **Integration** — Real combinations (filesystem, MCP wiring, larger pipelines) as already organized under `packages/core/test/integration`.
- **Eval-style / golden sets** — For agent- or classification-style behavior, keep labeled inputs and expected outputs (JSON or table-driven tests) and run them in CI when relevant.
- **E2E (web)** — Critical user paths only; prefer `data-testid` attributes for stable selectors. Tests run against real backend (`codragraph serve`) and Vite dev server.

## Performance metrics (targets)

Set targets to match team expectations, then tune to this repo’s CI reality:

| Metric              | Target (initial) | Notes                                      |
| ------------------- | ---------------- | ------------------------------------------ |
| Unit coverage       | Align with CI    | CI runs Vitest with coverage in `codragraph` |
| Unit wall time      | Fast PR feedback | Use `vitest run test/unit` for tight loop  |
| Integration duration| &lt; few minutes | Guard heavy tests with env flags if needed |

## Regression testing

Re-run the full relevant suite when:

- Prompt or agent-behavior documentation changes (if tests encode behavior)
- Model or embedding-related code paths change
- Graph schema, query contracts, or MCP tool shapes change
- Dependencies with parsing or runtime impact upgrade

## CI integration

GitHub Actions (`.github/workflows/ci.yml`) orchestrate:

- **`lint`** — prettier format check and eslint lint.
- **`typecheck`** — dependency-ordered package builds plus web typecheck.
- **`test`** — workspace tests across Linux, macOS, and Windows where supported.
- **`bun-compat`** — Bun install/build/test smoke for package-manager parity.
- **`build`** — publishable package build gate after typecheck, tests, and Bun smoke.

Local checks before pushing:

```bash
npm --prefix packages/core exec tsc -- --noEmit
npm --prefix packages/core test
npm --prefix apps/web exec tsc -- -b --noEmit
npm --prefix apps/web test
```

The pre-commit hook runs formatting plus affected typechecks. It does not run the
full tests above, so run the relevant `npm --prefix ... test` command before
opening a PR that changes runtime behavior.

## User acceptance / beta (optional)

For staged releases or UI betas: deploy to a staging environment, collect structured feedback, watch errors and latency, then iterate before a wider release.
