---
name: codragraph-git-recovery
description: "Use when work appears lost — bad reset, dropped commit, blown-away stash, deleted branch, broken merge, accidental rm in tracked files. Covers reflog spelunking, stash recovery, dangling-commit revival, and what's actually unrecoverable. Examples: \"I lost my commits\", \"deleted my branch\", \"reset --hard by mistake\", \"recover work\", \"reflog\""
---

# Lost-Work Recovery Playbook

## When to Use

- "I ran `git reset --hard` and lost my work"
- "I deleted a branch — can I get it back?"
- "I dropped a stash by accident"
- "I rm'd a file and committed before I noticed"
- "Help, I think I lost everything."

## The first-aid rules

1. **STOP committing.** Every new commit pushes the lost ones further into
   the reflog. Don't `git gc`, don't clone fresh.
2. **Don't close the terminal yet.** Some recovery paths (e.g.,
   `ORIG_HEAD`) live until you run another mutating command.
3. **Reflog is your friend.** Default expiry is 90 days for reachable
   commits, 30 days for unreachable. You almost always have time.
4. **Local-only state survives EVERYTHING except** explicit `git gc
   --prune=now` and disk loss. Even `reset --hard` leaves the old SHAs
   in the reflog.

## Recovery paths by symptom

### "I ran `git reset --hard` and lost commits"

```bash
git reflog                            # newest first
# → look for "HEAD@{1}: commit: <message>" — that was you, before reset
git reset --hard HEAD@{1}             # OR the explicit SHA
```

`ORIG_HEAD` is the convenience alias for "what HEAD was before the most
recent destructive operation":

```bash
git reset --hard ORIG_HEAD            # undoes the last reset / merge / rebase
```

### "I deleted a branch (`git branch -D`) and want it back"

```bash
git reflog                            # the last entry of that branch is here
# → look for "<branch>@{N}: ..." OR walk HEAD's history to find where you were
git branch <branch> <sha>             # recreates the branch at the old tip
```

If the reflog entry for the branch is gone (rare), search dangling
commits:

```bash
git fsck --lost-found
# → "dangling commit <sha>" lines
git show <sha>                        # inspect each candidate
git branch <branch> <sha>             # restore the one you want
```

### "I dropped a stash with `stash drop` (or by accident)"

```bash
git fsck --unreachable | grep commit
# → unreachable commits include dropped stashes
git show <sha>                        # confirm it's the right stash
git stash apply <sha>                 # apply it back (or stash branch <name> <sha>)
```

### "I committed a file I shouldn't have" (no remote push yet)

```bash
git reset --soft HEAD~1               # undo the commit, keep the changes staged
git restore --staged <file>           # unstage the offending file
echo "<file>" >> .gitignore
git commit -m "<original message>"
```

If you already pushed:

```bash
git reset --soft HEAD~1
git restore --staged <file>
echo "<file>" >> .gitignore
git commit -m "<original message>"
git push --force-with-lease           # SEE codragraph-git-force-push skill
```

If the file contained secrets, `--force-with-lease` is NOT enough —
rotate the secret first, then use `git filter-repo` or BFG to scrub
history (see codragraph-git-history-rewrite).

### "I deleted a file with `rm` (NOT git rm) and haven't committed"

```bash
git restore <file>                    # restores from index
# OR if it was never tracked, you're out of luck — check editor backups / Time Machine
```

### "I have a broken merge in progress"

```bash
git merge --abort                     # cleanly back out
git rebase --abort                    # for in-progress rebase
git cherry-pick --abort               # for in-progress cherry-pick
```

If `--abort` doesn't work (rare):

```bash
git reset --merge ORIG_HEAD
```

## When recovery WON'T work

| Situation | Recoverable? |
|---|---|
| Reset --hard within last 90 days (no `gc --prune=now`) | ✓ via reflog |
| Branch deleted within last 30 days | ✓ via fsck or branch reflog |
| Stash dropped within last 30 days | ✓ via fsck |
| Untracked / unstaged files deleted with `rm` | ✗ git never saw them |
| `.git/` dir deleted | ✗ catastrophic; restore from backup or remote |
| `git gc --prune=now` after the disaster | ✗ unreachable objects gone |
| Force-pushed-over commits AND local clone gone | ✗ unless GitHub Support recovers |

## Recovery diagnostics

```bash
# What does my reflog look like?
git reflog --all --date=iso | head -50

# What dangling commits exist?
git fsck --lost-found

# What was HEAD recently?
git reflog show HEAD --date=iso | head -10

# What was BRANCH recently?
git reflog show <branch> --date=iso | head -10

# Where did this commit live? (by sha)
git branch --contains <sha>
git tag --contains <sha>
```

## Why CodraGraph helps after recovery

Recovery is mechanical (reflog → reset). The real question is "did I
actually get back what I lost?" CodraGraph's diff lets you compare:

```bash
# Compare your recovered tree to the suspected lost-work SHA:
codragraph diff <recovered-head> <reflog-candidate-sha> --semantic

# If you see addedAPIs in the candidate that aren't in your recovered HEAD,
# the recovery is incomplete — try a different reflog entry.
```

For deleted branches with no clear "right" tip:

```bash
git fsck --lost-found
# For each candidate dangling-commit SHA:
codragraph diff main <dangling-sha> --semantic
# Pick the one whose diff matches the work you remember doing.
```

## Checklist when in panic mode

```
- [ ] STOP committing / running git gc / reinstalling
- [ ] git reflog | head -30 — see what's there
- [ ] Identify the candidate SHA for the lost work
- [ ] git show <sha> to verify it's the right thing
- [ ] git reset --hard / git branch <name> <sha> / git stash apply <sha>
- [ ] codragraph diff to verify the recovery captured the real work
- [ ] Set up git config --global core.autocrlf and longer reflog expiry
      (gc.reflogExpire) for the future
```
