# CodraGraph PR Review Action

> ⚠️ **Requires `@codragraph/cli ≥ 1.7.0`.** This action depends on three CLI
> flags introduced in 1.7.0: `analyze --no-setup`, `diff --semantic --json`,
> and the graphstore `headCommit` write to `.codragraph/meta.json`. With an
> earlier CLI the action hard-fails on the analyze step. Pin
> `codragraph-version` (input below) if your repo needs a specific version.

Posts a structural-diff comment on every PR using `codragraph diff --semantic
--json`. Two modes:

- **`deterministic`** (default, free) — pure structural diff: removed APIs,
  added APIs, modified signatures, added/removed execution flows. No LLM
  calls. Sticky comment updates on every push.
- **`review`** (opt-in, paid) — same as deterministic, plus calls Anthropic
  with the diff JSON to generate a richer human-readable review (risk
  justification, likely d=1 callers, what's probably missing). Falls back
  to deterministic if the API call fails.

This is the **automation side** of PR review. The interactive side
(`codragraph-pr-review` skill) lets a human ask Claude to review a PR using
the same MCP tools — both can run on the same PR.

## Quick start

```yaml
# .github/workflows/codragraph-pr-review.yml
name: CodraGraph PR Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: AnitChaudhry/CodraGraph/.github/actions/codragraph-pr-review@main
        with:
          mode: deterministic
```

## LLM-augmented mode

```yaml
      - uses: AnitChaudhry/CodraGraph/.github/actions/codragraph-pr-review@main
        with:
          mode: review
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          # Optional: anthropic-model: claude-opus-4-7
```

## Inputs

| Input | Required | Default | Notes |
|-------|----------|---------|-------|
| `mode` | no | `deterministic` | `deterministic` or `review`. |
| `anthropic-api-key` | when `mode=review` | — | Use a repo secret, never hardcode. |
| `anthropic-model` | no | `claude-sonnet-4-6` | Any Anthropic model id. |
| `codragraph-version` | no | `latest` | npm dist-tag or exact version of `@codragraph/cli`. |
| `comment-marker` | no | `<!-- codragraph-pr-review -->` | HTML marker the action looks for to update its sticky comment. |
| `github-token` | no | `github.token` | Needs `pull-requests: write`. |

## What the comment looks like

> ## CodraGraph PR Review — Structural Diff
>
> **Risk:** MEDIUM
>
> **Base:** `abc1234…`  **Head:** `def5678…`
>
> ### Summary
>
> | Change | Count |
> |--------|------:|
> | Removed APIs | 2 |
> | Modified | 5 |
> | Added flows | 1 |
>
> ### ⚠️ Removed APIs
> - `validatePayment` (Function)
> - `PaymentInputV1` (Class)
>
> ### Modified symbols
> | Symbol | Table | Changes |
> |--------|-------|---------|
> | `…` | Function | params 3→4 |

In `review` mode, an additional `### Review notes` section appears above the
summary with risk justification, likely callers affected, and what's
probably missing.

## How it works

1. Checkout with full history (`fetch-depth: 0`).
2. Install `@codragraph/cli` globally on the runner.
3. `git checkout <base-sha>` → `codragraph analyze --no-setup`.
4. Read `.codragraph/meta.json#headCommit` → save as `BASE_COMMIT`.
5. `git checkout <head-sha>` → `codragraph analyze --no-setup`.
6. Read `.codragraph/meta.json#headCommit` → save as `HEAD_COMMIT`.
7. `codragraph diff "$BASE_COMMIT" "$HEAD_COMMIT" --semantic --json > diff.json`.
8. Render Markdown via `format-comment.mjs`.
9. (review mode only) Pipe through `llm-review.mjs` for the augmented version.
10. Post or update a sticky comment matched by `comment-marker`.

## Cost guidance

- `deterministic` mode: pure compute. Action minutes only.
- `review` mode: one Anthropic API call per PR push, with a compacted diff
  (top 30 added/removed APIs, top 50 modifications). Typical PR ≈ $0.02–$0.10
  depending on diff size and chosen model. Use a smaller model
  (`claude-haiku-4-5-20251001`) for high-volume repos.

## Caveats

- The action runs `codragraph analyze` twice per PR — once for base, once for
  head. On a 50k-LoC repo this is ~30s + ~30s plus the cli install (~30s cold).
  Budget ~2 minutes per PR push.
- If your repo's tree-sitter native deps don't build on `ubuntu-latest`,
  pin `codragraph-version` to a known-working release.
- The graphstore lives in `.codragraph/` on the runner; it's ephemeral per
  job. Re-runs re-index from scratch.
