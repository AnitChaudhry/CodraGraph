---
name: codragraph-git-rebase-vs-merge
description: "Use when deciding between rebase, merge, squash-merge, or rebase-and-merge for integrating a branch — both for local catch-up (pulling main into a feature branch) and for landing a PR. Examples: \"should I rebase or merge\", \"how do I integrate main into my branch\", \"squash vs rebase merge\", \"clean up my branch history before PR\""
---

# Rebase vs Merge — A Decision Guide

## When to Use

- "How do I bring main into my feature branch?"
- "Should I squash this PR or merge it?"
- "Should I rebase before pushing?"
- "Which merge strategy do I pick on the GitHub PR button?"
- Any time you have a branch and need to combine it with another.

## The decision rule (read this first)

| Situation | Use | Why |
|---|---|---|
| Branch is **local-only**, you want it to track main | `git pull --rebase` or `git rebase main` | Keeps your local history linear; nothing has been shared yet |
| Branch is **shared** (already pushed, others may have pulled) | `git merge main` (or `--no-rebase`) | Rebase rewrites SHAs — collaborators' clones break |
| You're about to **open a PR** and want clean history | `git rebase -i main` (interactive) | Squash WIP commits, reword messages, end with N tidy commits |
| You're **landing a PR** with one logical change | **Squash-merge** on GitHub | One commit on main, clean log, PR description becomes the body |
| You're landing a PR with multiple **already-tidy** commits | **Rebase-and-merge** on GitHub | Preserves your atomic commits; no merge bubble |
| You're landing a long-running branch that **must show as a unit** | **Merge commit** on GitHub | Preserves the branch topology — useful for release branches |

If you remember nothing else: **rebase what's only yours, merge what's already shared.**

## Workflow: catching up a feature branch

```bash
# Local-only branch (fast-forward integration)
git fetch origin
git rebase origin/main          # replays your commits on top of main

# Already pushed branch (avoid SHA churn for collaborators)
git fetch origin
git merge origin/main           # creates a merge commit — collaborators stay in sync

# OR explicitly opt into rebase even on shared branches (coordinate first!)
git rebase origin/main
git push --force-with-lease     # SEE codragraph-git-force-push skill
```

## Workflow: cleaning up before opening a PR

```bash
git fetch origin
git rebase -i origin/main       # interactive — squash, fixup, reword

# Common interactive-rebase actions:
#   pick   - keep commit
#   reword - change message
#   squash - merge into previous, edit combined message
#   fixup  - merge into previous, drop this message
#   drop   - remove the commit entirely
```

## Workflow: landing a PR (GitHub UI / `gh pr merge`)

```bash
# Squash-merge — one logical change, one commit on main:
gh pr merge --squash --delete-branch

# Rebase-and-merge — preserve your N commits as N commits on main:
gh pr merge --rebase --delete-branch

# Merge commit — preserve the branch as a unit (rare; use for releases):
gh pr merge --merge --delete-branch
```

## Why CodraGraph helps here

The hardest part of choosing a strategy isn't the mechanics — it's
predicting whether your branch will conflict structurally with main.
CodraGraph's `diff --semantic` tells you exactly which APIs / signatures
changed on each side, so you can see *before* the merge whether your
branch and main both touched the same callgraph regions.

```
codragraph diff main HEAD --semantic --json | jq '.semantic'
→ added APIs / removed APIs / classified modifications on YOUR branch

codragraph diff <last-shared-ancestor> main --semantic --json | jq '.semantic'
→ what main has done since you forked
```

If both diffs touch overlapping symbols, prefer **merge** (preserves both
sides as branches you can reason about) over rebase (which re-writes your
side and may produce noisy conflicts).

## Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Rebasing a shared branch | Collaborators report "diverged history", lost commits | Merge instead; don't rebase shared branches without coordination |
| Squash-merge into long-running branch | Loses individual commit context | Use rebase-and-merge for branches that need history preserved |
| `git pull` without `--rebase` flag on a feature branch | Random merge bubbles in your branch | Set `git config --global pull.rebase true` or always `pull --rebase` on feature branches |
| Rebasing ON TOP of work in progress (uncommitted) | "Your local changes would be overwritten" | `git stash` first, rebase, `git stash pop` |

## Checklist before merging a PR

```
- [ ] CI green (lint, tests, typecheck)
- [ ] codragraph_detect_changes({scope: "compare", base_ref: "main"}) clean
- [ ] codragraph diff main HEAD --semantic — review removed APIs
- [ ] PR description matches the (would-be-squash) commit message
- [ ] Decided strategy: squash (single change) vs rebase-and-merge (multiple atomic) vs merge (release/topology)
- [ ] gh pr merge --squash --delete-branch  (or appropriate flag)
```

## Example: "Should I rebase or merge main into my 4-day-old branch?"

```
1. Check if the branch is shared:
   git config branch.<your-branch>.remote
   → "origin"  — yes, pushed.

2. Check who else might have it:
   gh api repos/{owner}/{repo}/pulls?head={your-branch} --jq '.[].user.login'
   git log origin/<your-branch>..main --oneline | head
   → no co-authors observed; just you and CI.

3. Check structural conflict potential:
   codragraph diff main <your-branch> --semantic
   → 2 added APIs, 1 modified signature
   codragraph diff <merge-base> main --semantic
   → 0 changes touching the same files
   → no structural conflict expected.

4. Decision: rebase (it's effectively local) + force-with-lease.
   git fetch origin
   git rebase origin/main
   # Resolve any conflicts file-by-file
   git push --force-with-lease

5. If structural conflict HAD been likely → merge, not rebase.
```
