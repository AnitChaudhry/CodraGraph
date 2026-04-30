---
name: codragraph-gh-issue-workflow
description: "Use for issue management via GitHub CLI — create, triage, label, assign, link to PRs, manage projects (v2), close with reason. Examples: \"open an issue\", \"triage issues\", \"add labels\", \"link this PR to issue\", \"close issue\", \"manage GitHub projects\""
---

# Issue Workflow with `gh`

## When to Use

- "Open an issue for this bug."
- "Triage the open issues — sort by labels / priority."
- "Link this PR to issue #42 so it auto-closes on merge."
- "Add this issue to my project board."
- "Bulk-relabel old issues."

## Lifecycle commands

### Create

```bash
# Quick create:
gh issue create --title "…" --body "…" --label bug --assignee "@me"

# Multi-line body via HEREDOC:
gh issue create --title "Auth times out after 30s" --body "$(cat <<'EOF'
## Repro
1. Login as user X
2. Wait 30s
3. Click anywhere

## Expected
Session refresh transparent.

## Actual
Hard logout with no warning.

## Environment
- App version: …
- Browser: …
EOF
)"

# From a template (.github/ISSUE_TEMPLATE/<x>.md):
gh issue create --template bug_report.md
```

### List / search / view

```bash
gh issue list                                     # open issues
gh issue list --state all --limit 100             # everything
gh issue list --label "bug,priority:high"          # filter
gh issue list --search "in:title auth"             # full-text in title/body
gh issue list --assignee "@me"                    # assigned to you

gh issue view <N>                                 # one issue
gh issue view <N> --comments                      # include comments
gh issue status                                   # issues needing your attention
```

### Triage / edit

```bash
gh issue edit <N> --add-label "bug,needs-repro" --add-assignee @teammate
gh issue edit <N> --remove-label "stale" --milestone "v1.7.0"
gh issue comment <N> --body "Cannot repro. Could you share <X>?"
gh issue pin <N>                                  # pin to top of issues page
gh issue unpin <N>
gh issue lock <N>                                 # freeze further comments
gh issue unlock <N>
```

### Link issues to PRs

GitHub auto-closes the issue when a PR with `Closes #N` / `Fixes #N` /
`Resolves #N` in the body merges. From the CLI:

```bash
gh pr create --body "$(cat <<'EOF'
Fixes #42.

## Summary
…
EOF
)"
```

For sub-issues / dependencies (no auto-close, just visual link):

```
Related: #43, #44
Blocks: #50
```

### Close / reopen

```bash
# State reasons (GitHub Issue State Reasons API):
gh issue close <N> --reason completed             # default
gh issue close <N> --reason "not planned"         # won't fix
gh issue close <N> --reason duplicate --comment "duplicate of #M"

gh issue reopen <N>
```

## Triage workflow (recurring)

A weekly / per-stand-up triage pass:

```bash
# 1. Surface issues with no labels (the worst offender):
gh issue list --search "no:label" --limit 50

# 2. Surface "needs repro" stale-bait:
gh issue list --label "needs-repro" \
  --search "updated:<$(date -u -d '14 days ago' +%Y-%m-%d)" --limit 50

# 3. Bulk-label or bulk-close (loop with gh):
for n in $(gh issue list --label "needs-repro" \
  --search "updated:<$(date -u -d '30 days ago' +%Y-%m-%d)" \
  --json number --jq '.[].number'); do
  gh issue close "$n" --reason "not planned" \
    --comment "Closing for inactivity. Reopen with a fresh repro."
done
```

## Projects (v2)

GitHub Projects v2 is the modern board. The CLI has first-class support
via `gh project`:

```bash
gh project list --owner <org-or-user>
gh project view <number> --owner <org>            # full board contents
gh project item-add <project-number> --owner <org> --url <issue-url>
gh project item-edit --id <item-id> --field-id <fid> --single-select-option-id <oid>
```

Adding from issue context (one-liner):

```bash
gh project item-add <pn> --owner <org> --url $(gh issue view <N> --json url --jq .url)
```

## Why CodraGraph helps here

When triaging a bug, jump straight from issue text to the suspect code:

```
1. gh issue view 42 --comments
   → "validateUser fails for users with X"

2. codragraph_query({query: "validateUser X"})
   → suspect symbols ranked

3. codragraph_context({name: "validateUser"})
   → callers + callees + processes

4. codragraph_impact({target: "validateUser", direction: "upstream"})
   → which flows are affected — confirms the bug's blast radius

5. Comment on the issue with concrete next steps:
   gh issue comment 42 --body "Fix likely in src/auth/validate.ts:42 …"
```

Combine with the `codragraph-debugging` skill for full bug-investigation
workflow.

## Pitfalls

| Pitfall | Fix |
|---|---|
| Issue body forgets the repro | Always include "Repro / Expected / Actual / Env" in the template |
| Closing without a reason | Use `--reason "not planned"` so the state is searchable |
| Linking to PR via `#N` only | Use `Fixes #N` in PR body — that's what triggers auto-close |
| Bulk-relabeling without a `--dry-run` | gh has no built-in dry run; do `gh issue list` first to preview |
| Mixing v1 boards (deprecated) and v2 | New automation: only `gh project` (v2). Old `gh project` v1 commands removed in CLI 2.20+ |
```
