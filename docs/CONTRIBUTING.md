# Contributing to CodraGraph

How to propose changes, run checks locally, and open pull requests.

## License

This project is distributed under the [PolyForm Noncommercial License 1.0.0](../LICENSE), inherited from its upstream project (see [NOTICE](../NOTICE)). By contributing, you agree your contributions are licensed under the same terms unless stated otherwise.

## Where to discuss

- **Issues & feature ideas:** use the project's issue tracker once a hosting location is set up.
- **Community:** see the support section in the root [README.md](../README.md).

## Development setup

1. Clone the repository.
2. Install workspace dependencies from the repo root: `npm install`
3. **CLI / MCP package:** `npm --prefix packages/core run build`
4. **Web UI (if needed):** `npm --prefix apps/web run build`
5. Run tests as described in [TESTING.md](TESTING.md).

The documented commands are written to work in Windows PowerShell,
macOS bash/zsh, and Linux shells. Prefer `npm --prefix <package> <script>`
from the repository root instead of shell-specific `cd dir && ...` chains
when sharing commands in docs, issues, or PRs.

## Branch and pull requests

- Use short-lived branches off the default branch of the repo you are targeting.
- **PR titles MUST follow the conventional-commit format** — `pr-labeler.yml` enforces this on every PR and auto-applies the matching label so release notes group the change correctly.
- **PR description:** what changed, why, how to verify (commands), and any risk or rollback notes.

### Pull request titles

Format: `<type>[(scope)][!]: <subject>`

Allowed types and the release-notes section each one lands in (defined in `.github/release.yml`):

| Type | Label applied | Release-notes section |
|------|---------------|-----------------------|
| `feat` | `enhancement` | 🚀 Features |
| `fix` | `bug` | 🐛 Bug Fixes |
| `perf` | `performance` | 🏎️ Performance |
| `refactor` | `refactor` | 🔄 Refactoring |
| `test` | `test` | 🧪 Tests |
| `ci` | `ci` | 👷 CI/CD |
| `build` / `deps` | `dependencies` | 📦 Dependencies |
| `docs` | `documentation` | (grouped under Other Changes unless a Docs section is added) |
| `chore` / `revert` | `chore` | (excluded from release notes) |

Append `!` to the type (e.g. `feat(api)!: drop /v1 endpoint`) or include `BREAKING CHANGE:` in the PR body to flag a breaking change — the labeler then adds the `breaking` label and the 💥 Breaking Changes section is rendered first.

Examples:

```text
feat(web): add smart chat scroll
fix(extractors): resolve silent contract mis-resolution
perf: avoid O(n²) traversal in heritage walker
chore(deps): bump vitest to 3.0.0
ci: standardize workflow concurrency
```

Commits within a PR may use any style — only the **merged PR title** shows up in release notes, so that's the one the convention applies to.

## Before you open a PR

- [ ] Tests pass for the packages you touched, for example `npm --prefix packages/core test` or `npm --prefix apps/web test`.
- [ ] Typecheck passes: `npm --prefix packages/core exec tsc -- --noEmit` and `npm --prefix apps/web exec tsc -- -b --noEmit`.
- [ ] No secrets, tokens, or machine-specific paths committed.
- [ ] Documentation updated if behavior or public CLI/MCP contract changes.
- [ ] Pre-commit hook runs clean (`.husky/pre-commit` — formatting via lint-staged + typecheck for staged packages; tests run in CI only).

## Code review

Maintainers may request changes for correctness, tests, performance, or consistency with existing patterns. Keeping diffs focused makes review faster.

## GitHub Actions — Concurrency Convention

Every workflow under `.github/workflows/` MUST declare a top-level `concurrency:` block using this convention:

- **Group key** starts with `${{ github.workflow }}` so no two workflows can collide on the same group name. The discriminator that follows is chosen per event shape:
  - Branch/tag scope: `${{ github.workflow }}-${{ github.ref }}`
  - Per-PR scope (for `issue_comment`, `pull_request_review*`, `pull_request` meta events): `${{ github.workflow }}-${{ github.event.pull_request.number || github.event.issue.number }}`
  - `workflow_run` scope (e.g. `ci-report.yml`): `${{ github.workflow }}-${{ github.event.workflow_run.pull_requests[0].number || format('{0}/{1}', github.event.workflow_run.head_repository.full_name, github.event.workflow_run.head_branch) }}` — the fork fallback must be stable across reruns (never `workflow_run.id`, which is per-run-unique and defeats serialization).
  - Global single-slot (manual dispatch utilities): `${{ github.workflow }}`
  - **Reusable workflows invoked via `workflow_call`:** do NOT use `${{ github.workflow }}` in the group key — in called-workflow context its evaluation is ambiguous and can resolve to the caller's name, which would deadlock against the caller's own group. Use a hardcoded literal prefix and a `github.event_name`-aware expression that falls through to `github.run_id` for reusable invocations (see `ci.yml` for the canonical form). Approved literal prefixes: `CI-` (`ci.yml`) and `docker-build-push-` (`docker.yml`). The `check-workflow-concurrency.py` validation script must be updated whenever a new approved literal prefix is added.
  - **Merge queue (`merge_group`)**: when this event is added, use `${{ github.workflow }}-${{ github.event.merge_group.head_ref }}` with `cancel-in-progress: false` (every queue entry is a distinct ref; never cancel).
- **`cancel-in-progress` policy:**

  | Event | `cancel-in-progress` | Why |
  |-------|----------------------|-----|
  | `pull_request` CI run | `true` | New push supersedes old run |
  | `push` to `main` | `false` | Every main commit gets validated |
  | Tag push (`v*` publish) | `false` | Never cancel mid-publish |
  | `push` to `main` for release-candidate | `false` | Never cancel mid-RC publish |
  | `workflow_dispatch` (release/publish) | `false` | Manual runs are intentional |
  | `workflow_run` (sticky-comment reports) | `false` | Serialize, don't race |
  | Per-PR bot workflows (`@claude`, review) | `false` | Serialize comments per PR |
  | PR-meta re-checks (pr-description-check) | `true` | Cheap, latest wins |
  | Single-slot utilities (triage sweep) | `true` | Latest dispatch supersedes |

- For workflows that serve multiple events at once (e.g. `ci.yml` handles `pull_request`, `push`, and `workflow_call`), make `cancel-in-progress` event-aware:

  ```yaml
  concurrency:
    group: ${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: ${{ github.event_name == 'pull_request' }}
  ```

- When adding a new workflow, copy the concurrency block from an existing workflow of the same event shape.

## AI-assisted contributions

If you use coding agents, follow project context files (e.g. `AGENTS.md`, `CLAUDE.md`) and avoid drive-by refactors unrelated to the issue. Prefer incremental, test-backed changes.

## Releases

`NPM Release` (`.github/workflows/npm-release.yml`) is the production publish
path for public packages. It runs a cross-platform validation matrix on
Ubuntu, macOS, and Windows before the publish job is allowed to start.

Trigger it in one of two ways:

- Push a `v*` tag from the release commit, for example `v2.1.2`.
- Run the workflow manually with `publish=true` when maintainers need to
  republish missing packages or verify the release path.

The workflow publishes from Ubuntu only, after:

- dependency installation succeeds with npm on all three operating systems
- publishable workspaces build in dependency order
- graphstore, harness, org, web, and non-Windows CLI unit tests pass
- `npm pack --dry-run` succeeds for CLI, SDK, graphstore, harness, compress,
  org, Claude plugin, and Codex integration

The npm credential must live in the repository secret `NPM_TOKEN`; never commit
an `.npmrc` with an auth token. The publish step is idempotent: it checks
`npm view <package>@<version>` first and skips packages that already exist on
npm. Tag releases also create or update GitHub release notes.

To verify after publishing:

```bash
npm view @codragraph/cli version
npm view @codragraph/sdk version
npm view @codragraph/cli dist-tags
```
