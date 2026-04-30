---
name: codragraph-gh-pr-workflow
description: "Use for any pull-request workflow via GitHub CLI — create draft, convert ready, request review, address comments, check CI, merge with the right strategy, manage stacked PRs. Examples: \"open a PR\", \"draft PR\", \"merge this PR\", \"check PR status\", \"address review comments\", \"stacked PRs\""
---

# Pull Request Workflow with `gh`

## When to Use

- "Open a PR for this branch."
- "Convert this draft to ready-for-review."
- "Check the status of my PRs."
- "Merge PR #N — which strategy should I use?"
- "Address review comments and push fixes."
- "I have stacked PRs — how do I manage them?"

## Lifecycle commands

### Open

```bash
# After pushing your branch:
gh pr create --title "feat: …" --body "…" --reviewer @teammate
gh pr create --draft                              # ship as draft
gh pr create --fill                               # use the most recent commit message
gh pr create --base main --head my-branch         # explicit base/head

# Multi-line body (HEREDOC) — preferred for real PRs:
gh pr create --title "feat: X" --body "$(cat <<'EOF'
## Summary
- Bullet 1
- Bullet 2

## Test plan
- [ ] Unit
- [ ] Integration
- [ ] Manual repro of the bug
EOF
)"
```

### Inspect

```bash
gh pr list                                        # PRs in this repo (yours by default)
gh pr list --state all --author "@me"             # all your PRs ever
gh pr status                                      # PRs needing attention (created by you, requesting your review)
gh pr view <N>                                    # one PR's metadata
gh pr view <N> --comments                         # include review comments
gh pr diff <N>                                    # raw diff
gh pr checks <N>                                  # CI status per check
```

### Update

```bash
# Push fixes to the same branch:
git push                                          # PR auto-updates

# Convert draft <-> ready:
gh pr ready <N>                                   # draft → ready-for-review
gh pr ready --undo <N>                            # ready → draft

# Edit metadata:
gh pr edit <N> --title "…" --add-reviewer @teammate --add-label "bug"
```

### Address review comments

```bash
# Pull the conversation:
gh pr view <N> --comments

# Push your fixes (same branch):
git add <files> && git commit -m "address review: <topic>"
git push

# Mark conversations resolved (UI only, no CLI flag) or reply:
gh pr comment <N> --body "fixed in <new-sha>"
```

### Merge

| Strategy | When | gh command |
|---|---|---|
| **Squash** | One logical change, want one commit on main | `gh pr merge <N> --squash --delete-branch` |
| **Rebase** | Multiple already-tidy commits, no merge bubble | `gh pr merge <N> --rebase --delete-branch` |
| **Merge commit** | Long-running release branch, preserve topology | `gh pr merge <N> --merge --delete-branch` |
| **Auto-merge** | Merge as soon as CI green + reviews approved | `gh pr merge <N> --auto --squash --delete-branch` |

See `codragraph-git-rebase-vs-merge` for the decision rule. Default to
**squash** for typical feature PRs.

### Close / reopen

```bash
gh pr close <N> --comment "superseded by #<other>"
gh pr reopen <N>
```

## Stacked PR pattern (`gh pr` with branches that depend on each other)

When PR #2 depends on PR #1's branch, point #2's base at #1's branch:

```bash
git switch feat/step-1
gh pr create --base main --title "feat: step 1"

git switch -c feat/step-2 feat/step-1
# … edit …
git push -u origin feat/step-2
gh pr create --base feat/step-1 --title "feat: step 2 (depends on #N)"

# When step-1 merges, automatically retarget step-2 to main:
gh pr edit <step-2-pr> --base main
```

## Why CodraGraph helps here

The PR review GitHub Action (codragraph-pr-review) ALREADY automates the
diff-comment side. As an author, you should ALSO run impact locally
before requesting review — it catches the "I forgot to update a caller"
class of problem that a reviewer is most likely to flag:

```bash
codragraph_detect_changes({scope: "compare", base_ref: "main"})
# → list of changed symbols + affected execution flows

# For each non-trivial changed symbol:
codragraph_impact({target: "<symbol>", direction: "upstream"})
# → d=1 callers. Are they all updated in the PR?
```

If d=1 callers exist OUTSIDE your PR diff, that's the breakage waiting
to happen. Either update them or document the migration path before
review.

## Author checklist before requesting review

```
- [ ] Branch rebased onto main (or merged main in, if shared)
- [ ] CI green: gh pr checks <N>
- [ ] codragraph_detect_changes — confirm scope is what you intended
- [ ] codragraph_impact on each public symbol you changed — d=1 callers updated
- [ ] PR title is conventional (feat: / fix: / docs: / etc.)
- [ ] PR body has Summary + Test plan
- [ ] Reviewers and labels set
- [ ] gh pr ready <N> if it was draft
```

## Reviewer checklist (if you're reviewing)

```
- [ ] Pull the diff: gh pr diff <N> | less
- [ ] Use codragraph-pr-review skill: detect_changes + impact + context
- [ ] Run tests locally: gh pr checkout <N> && npm test
- [ ] Approve / request-changes / comment via gh pr review <N>
```

```bash
gh pr review <N> --approve --body "LGTM. Verified the impact graph clean."
gh pr review <N> --request-changes --body "…"
gh pr review <N> --comment --body "…"

# Inline comments require the GitHub UI (gh CLI doesn't support them yet).
```

## Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Created PR from main | "There isn't anything to compare" | Push to a feature branch first |
| Wrong base | PR shows commits from main | `gh pr edit <N> --base <correct-base>` |
| Squash-merged a stacked PR's parent | Child PR shows 0 commits | `git rebase main` on child, force-push |
| `gh pr merge --auto` without branch protection | Merges immediately, not on green | Configure branch-protection rules first |
| Closing instead of merging | Commits don't land on main | `gh pr merge` not `gh pr close` |
