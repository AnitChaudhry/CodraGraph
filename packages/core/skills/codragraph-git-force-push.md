---
name: codragraph-git-force-push
description: "Use when the user is about to force-push, recovering after someone else force-pushed, or asking whether it's safe. Covers --force vs --force-with-lease, recovery from a bad force-push, and the rules for shared vs personal branches. Examples: \"force push\", \"is force push safe\", \"someone overwrote my work\", \"git push rejected\", \"--force-with-lease\""
---

# Force Push — When, How, and Recovery

## When to Use

- "Can I force push to this branch?"
- "Git is rejecting my push, is force the answer?"
- "Someone force-pushed and lost my commits — help."
- "What's the difference between --force and --force-with-lease?"

## The rules

1. **Never `--force` on a shared branch** without coordinating. You will
   silently overwrite collaborators' commits. Their reflogs save them; their
   patience does not.
2. **Always prefer `--force-with-lease`** over `--force`. It refuses the
   push if the remote has commits you haven't seen — i.e. someone pushed
   while you were rebasing.
3. **Never force on `main` / `master` / `release/*`** unless you're recovering
   from a documented incident with explicit sign-off. Branch protection
   should make this impossible; if it's possible, fix the protection rule.
4. **Force-pushing your OWN feature branch** after a rebase is normal and
   expected. Just use `--force-with-lease`.

## Decision tree

```
Is the branch protected on the remote?
├─ yes → STOP. Don't force. Open a PR or get an admin to lift protection
│        for a documented operation.
└─ no → Is anyone else committing to this branch?
        ├─ yes → STOP. Coordinate. They'll lose work if you force.
        └─ no → Have you fetched the latest remote tip?
                ├─ no  → git fetch first, then `git push --force-with-lease`
                └─ yes → `git push --force-with-lease` is safe.
```

## --force vs --force-with-lease

```bash
# DANGEROUS: overwrites whatever is on the remote, no matter what.
git push --force

# SAFER: only succeeds if the remote tip matches what you last fetched.
# If anyone pushed in the meantime, this aborts.
git push --force-with-lease

# EVEN SAFER: explicitly require the remote SHA to be what you expect.
git push --force-with-lease=<branch>:<expected-sha>
```

> Make `--force-with-lease` your default by aliasing:
> `git config --global alias.fwl 'push --force-with-lease'`

## Recovery: someone force-pushed and lost your work

Your local clone has the original commits in its reflog. You haven't lost
anything as long as you haven't run `git gc --prune=now` AND your reflog
is still intact (default 90-day expiry).

```bash
# 1. Find the lost commit on YOUR machine
git reflog show <branch>
# → look for "<branch>@{N}: ... before force push" or your last commit

# 2. Inspect it
git show <sha>
git log <sha> --oneline -20

# 3a. If they overwrote with rubbish: reset your branch to your old tip
#     (this re-creates the divergence; coordinate before re-pushing)
git checkout <branch>
git reset --hard <sha-from-reflog>

# 3b. If they had legitimate changes you also want to keep: cherry-pick
#     YOUR lost commits onto their version
git checkout <branch>
git pull              # accept their version
git cherry-pick <your-lost-sha-1> <your-lost-sha-2> ...

# 4. Push back (with --force-with-lease to avoid the same problem)
git push --force-with-lease
```

If the only copy of the lost commits was on the remote (no local clone),
the recovery options are:

- GitHub: contact GitHub Support — they retain dangling commits for ~30 days.
- Self-hosted GitLab/Gitea: server-side reflog (if enabled) or a backup.

## Recovery: I force-pushed something I shouldn't have

If you JUST did it and have a terminal where the previous local state still
exists:

```bash
git reflog                     # find the previous tip
git reset --hard <previous-sha>
git push --force-with-lease    # restore the remote
```

If you've already moved on locally:

```bash
git fetch origin
git reflog show origin/<branch>
# → look for the line BEFORE the force push you just did
git reset --hard <recovered-sha>
git push --force-with-lease
```

## Why CodraGraph helps here

After a force-push (yours or theirs), `codragraph diff` against the
recovered SHA tells you EXACTLY what structural changes were undone or
reapplied — so you can verify nothing important got lost in the
recovery:

```bash
codragraph diff <recovered-sha> HEAD --semantic
# If addedAPIs / removedAPIs reveals work that should still be present,
# the recovery is incomplete — go back to the reflog and pick more.
```

## Checklist (before any --force / --force-with-lease)

```
- [ ] Branch is NOT protected on the remote
- [ ] Branch is NOT main / master / release/*
- [ ] You're the only one committing to it (git log <branch> | grep -c Author)
- [ ] You've git-fetched recently (so --force-with-lease has fresh info)
- [ ] Using --force-with-lease, NEVER bare --force
- [ ] If recovering: verified the recovered SHA via codragraph diff
```

## Pitfalls

| Pitfall | What goes wrong | Avoidance |
|---|---|---|
| `git push -f` on shared branch | collaborators' commits silently gone | --force-with-lease + check `git log <branch>` for other authors first |
| `--force-with-lease` after `git fetch` | lease check passes against the freshly-fetched tip — no protection | run lease BEFORE the fetch, or specify the expected SHA explicitly |
| Force-push during CI run | CI race conditions, half-deployed states | wait for CI to finish, then force |
| Forgetting reflog can save you | panic | reflogs default to 90 days; check `git reflog` before destroying anything |
