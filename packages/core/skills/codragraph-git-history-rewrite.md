---
name: codragraph-git-history-rewrite
description: "Use when rewriting commit history — squashing WIP commits, splitting a fat commit, removing a leaked secret, changing author info, or running git filter-repo / BFG. Covers interactive rebase, fixup/autosquash, splitting commits, and the safety rules for rewriting public history. Examples: \"squash my commits\", \"clean up history\", \"remove a leaked secret from history\", \"split this commit\", \"git filter-repo\""
---

# History Rewriting — Safely

## When to Use

- "Squash my last 5 WIP commits before opening a PR."
- "Split this giant commit into 3 logical ones."
- "Remove a leaked secret from history."
- "Change the author of past commits."
- "Drop a commit from the middle of the branch."

## The cardinal rule

**Never rewrite history that's been pushed to a shared branch.** Rewriting
public history breaks every clone that pulled it. For shared branches:
make a new commit that fixes/reverts the offending one. For your own
branch (or any branch you alone work on), rewrite freely with
`--force-with-lease`.

## Interactive rebase

```bash
git rebase -i origin/main           # rebase your branch onto main, interactively
# OR rebase the last N commits without changing the base:
git rebase -i HEAD~N
```

You get an editor with one line per commit:

```
pick   abc1234 wip: hack on auth
pick   def5678 wip: more auth
pick   fed9876 fix typo
pick   012abcd add real auth flow
```

Change `pick` to one of:

| Command | Effect |
|---|---|
| `pick` | keep the commit as-is |
| `reword` | keep the changes, edit the message |
| `edit` | pause after applying so you can `git commit --amend` or split |
| `squash` | merge into previous commit, edit combined message |
| `fixup` | merge into previous commit, drop this commit's message |
| `drop` | remove the commit entirely (its changes are gone) |
| `exec <cmd>` | run a shell command after this commit (CI-style validation per commit) |

Reorder lines to reorder commits. Save and exit; rebase replays them.

## Fixup + autosquash workflow (the cleanest pattern)

```bash
# While developing, instead of "wip" commits, mark fixups against a target:
git commit --fixup=<sha-of-target-commit>

# At the end, squash all fixups in one go:
git rebase -i --autosquash origin/main
# → all `fixup!` commits are auto-placed and pre-marked. Just save.
```

This produces a clean, atomic-commit branch ready to PR — no manual
reordering needed.

## Splitting a fat commit

```bash
git rebase -i <commit>^             # interactive rebase starting AT the fat commit
# Mark it `edit` and save.

# Now you're paused at the fat commit. Reset to its parent, keep the changes:
git reset HEAD^

# Stage and commit each logical chunk separately:
git add <files-for-part-1>
git commit -m "first logical part"
git add <files-for-part-2>
git commit -m "second logical part"
git add -A
git commit -m "third logical part"

# Resume the rebase:
git rebase --continue
```

## Removing a leaked secret from history

If a secret (API key, password, .env) was committed:

1. **Rotate the secret first.** Once it's on a public remote, treat it as
   leaked — even after history scrub.
2. **Then scrub history with `git filter-repo`** (the modern replacement
   for `filter-branch`):

```bash
# Install: pip install git-filter-repo (or pipx)

# Remove a specific file from all history:
git filter-repo --invert-paths --path path/to/leaked.env

# Or remove a string/secret from blob contents:
echo 'sk_live_abc***123==>REDACTED' > /tmp/replacements.txt
git filter-repo --replace-text /tmp/replacements.txt

# After filter-repo, the remote is forcibly out of sync. Coordinate with the
# team and force-push:
git push --force-with-lease origin --all
git push --force-with-lease origin --tags
```

Alternative: BFG (`https://rtyley.github.io/bfg-repo-cleaner/`) is
faster for large repos but more limited.

> **Important:** GitHub caches blobs even after force-push. The blob is
> still accessible by SHA URL for ~30 days unless you contact GitHub
> Support to purge. Treat the secret as compromised.

## Changing author info on past commits

```bash
# Most recent commit only:
git commit --amend --author="New Name <new@email>"

# Multiple commits with filter-repo:
git filter-repo --commit-callback '
  if commit.author_email == b"old@email":
    commit.author_email = b"new@email"
    commit.author_name = b"New Name"
'
```

## Why CodraGraph helps here

After any history rewrite, the structural diff against the pre-rewrite
state proves you didn't accidentally drop or alter functional code:

```bash
# Before rewrite: snapshot the structural state
codragraph commit -m "pre-rewrite snapshot"
git rebase -i origin/main             # do the rewrite
codragraph analyze                    # re-index after

# Confirm structural equivalence (or see exactly what differs):
codragraph diff <pre-snapshot-id> HEAD --semantic
# → Should be empty if you only rewrote messages / order.
# → If addedAPIs / removedAPIs appear, the rewrite changed semantics.
```

## Pitfalls

| Pitfall | What goes wrong | Avoidance |
|---|---|---|
| Rewriting shared branch | Collaborators' clones diverge | Only rewrite local-or-personal branches |
| `drop` instead of `fixup` | Lost changes silently | Verify with `codragraph diff` after the rebase |
| Editing during rebase, forgetting `--continue` | Stuck in detached state | `git rebase --continue` after each manual step |
| `git rebase --abort` after edits | Loses your edits | Stash before rebase if you have uncommitted work |
| `filter-branch` (legacy) | Slow, error-prone, deprecated | Use `git filter-repo` |
| Force-pushing after secret scrub without rotation | Secret still compromised | Rotate FIRST, scrub SECOND |

## Checklist before any history rewrite

```
- [ ] Branch is NOT shared (or you have explicit team coordination)
- [ ] Snapshot pre-state with `codragraph commit -m "pre-rewrite"`
- [ ] Decide: interactive rebase (small) vs filter-repo (large/secrets)
- [ ] Run the rewrite
- [ ] Re-analyze + `codragraph diff` to verify no semantic surprises
- [ ] Push with --force-with-lease
- [ ] If secrets were involved: rotate FIRST, then scrub, then push
```
