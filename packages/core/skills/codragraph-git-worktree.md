---
name: codragraph-git-worktree
description: "Use when working on multiple branches in parallel without re-cloning, juggling a long-running branch alongside hotfixes, or running CI/build on one branch while editing another. Covers `git worktree` setup, conventions, and gotchas. Examples: \"work on two branches at once\", \"git worktree\", \"hotfix without losing my context\", \"avoid stash-juggling\""
---

# Parallel Branches with `git worktree`

## When to Use

- "I'm in the middle of something and need to do a hotfix on main."
- "I want CI to run on one branch while I edit another."
- "I have N agents working on N branches simultaneously."
- "I'm sick of `git stash` between branch switches."

## The idea

A *worktree* is a separate working directory backed by the same git
repository. One `.git/`, many checkouts. Switching between branches no
longer requires re-running build / re-installing deps / re-warming editor
indexes — you just `cd` to a different directory.

## Setup

```bash
# From inside your existing repo (e.g. ~/code/myrepo):
git worktree add ../myrepo-hotfix main          # check out 'main' at ../myrepo-hotfix
git worktree add ../myrepo-feat-x feat/x        # check out feat/x at ../myrepo-feat-x

# List all worktrees:
git worktree list
# → /home/anit/code/myrepo            abc1234 [feature/foo]
# → /home/anit/code/myrepo-hotfix     def5678 [main]
# → /home/anit/code/myrepo-feat-x     fed9876 [feat/x]

# Each is a real working directory. cd into it; git commands operate on its
# checked-out branch automatically.
cd ../myrepo-hotfix
git status                                       # → on branch 'main'
```

## Conventions that scale

```
~/code/
├── myrepo/                # main worktree (your "primary" branch's checkout)
├── myrepo-hotfix/         # for emergency fixes off main
├── myrepo-pr-143/         # parking a PR for review
└── myrepo-bisect/         # dedicated to long-running bisects
```

Or co-locate inside the primary repo as siblings under `.worktrees/`:

```bash
mkdir -p .worktrees
git worktree add .worktrees/hotfix main
echo ".worktrees/" >> .gitignore                # don't index worktrees as files
```

## Removing worktrees

```bash
git worktree remove ../myrepo-hotfix
# or, if the directory was already deleted manually:
git worktree prune
```

## Why CodraGraph helps here

Each worktree gets its own working directory but shares the `.git/`. This
matters for indexing: CodraGraph indexes `.codragraph/` in the working
directory, so each worktree gets its OWN index. That's actually useful:

```bash
# Two worktrees, two independent CodraGraph indexes.
cd ~/code/myrepo                                  # primary, on feature/foo
codragraph analyze                                # index of feature/foo

cd ~/code/myrepo-hotfix                           # worktree, on main
codragraph analyze                                # index of main

# Now you can run cross-worktree impact analysis:
codragraph_query({repo: "myrepo", query: "auth"})        # primary index
codragraph_query({repo: "myrepo-hotfix", query: "auth"}) # main's index
```

This is especially handy for **migration tracking** (compare a
long-running migration branch's structural state to current main without
checking out and re-indexing repeatedly).

## Pitfalls

| Pitfall | What happens | Fix |
|---|---|---|
| Same branch checked out in two worktrees | git refuses; only one worktree per branch | Use a different branch in the second worktree (or `--detach`) |
| Worktree dir deleted manually (no `worktree remove`) | git still tracks it as live | `git worktree prune` |
| Hooks / config differ across worktrees | Worktrees share `.git/` but each has its own `.git/info/` and per-worktree config | Use `git config --worktree` for per-worktree settings |
| Editor's "open repo" features confused | VS Code sometimes treats each worktree as its own repo | Open each worktree as a separate workspace; this is actually correct |
| `npm install` in every worktree | Slow, duplicated `node_modules` | Use pnpm with shared store, or yarn berry's PnP |

## Variants

```bash
# Detached HEAD worktree (no branch — useful for inspecting old commits):
git worktree add --detach ../myrepo-old <commit-sha>

# Lock a worktree (prevents `worktree prune` from cleaning it):
git worktree lock ../myrepo-old

# Move a worktree:
git worktree move ../myrepo-old ../myrepo-archive
```

## Checklist

```
- [ ] Created worktree with a clear directory name and the right branch
- [ ] Confirmed `git worktree list` shows all expected entries
- [ ] Per-worktree CodraGraph index where relevant (codragraph analyze in each)
- [ ] Editor opened per worktree (separate workspace each)
- [ ] When done: git worktree remove <path> (or rm + git worktree prune)
```

## Example: "I need to ship a hotfix without losing my WIP"

```bash
# Currently on feature/big-refactor, 8 uncommitted files, half-broken.

# 1. Create a worktree for the hotfix off main
git worktree add ../myrepo-hotfix main

# 2. cd over and do the work
cd ../myrepo-hotfix
git switch -c hotfix/null-pointer
# ... edit, test, commit ...
git push -u origin hotfix/null-pointer
gh pr create --title "..." --body "..."
gh pr merge --squash --delete-branch

# 3. Clean up the worktree
cd ../myrepo
git worktree remove ../myrepo-hotfix

# 4. Continue your refactor as if nothing happened
git status                                       # still 8 uncommitted files, intact
```
