---
name: codragraph-git-bisect
description: "Use when hunting a regression — narrowing down which commit introduced a bug across N commits using binary search. Covers manual bisect, automated bisect with a test script, and how to combine bisect with CodraGraph context to understand the bad commit. Examples: \"find which commit broke X\", \"git bisect\", \"regression hunt\", \"automated bisect\""
---

# Regression Hunting with `git bisect`

## When to Use

- "Tests pass at commit A but fail at commit B — which commit broke it?"
- "Performance regressed somewhere in the last 200 commits."
- "Find the commit that introduced this bug."
- "Automate a bisect with my test suite."

## The principle

Bisect performs binary search over the commit graph. Given a
known-good commit (`good`) and a known-bad commit (`bad`), it picks the
midpoint, you mark it, and it halves the search space until exactly one
commit is identified. Log₂(N) tests instead of N.

## Manual workflow

```bash
# Start
git bisect start
git bisect bad <known-bad>            # often HEAD or a commit/tag
git bisect good <known-good>          # something older that worked

# Now git checks out the midpoint. Test it.
# Mark each midpoint:
git bisect bad                        # if the bug IS present
git bisect good                       # if the bug is NOT present
git bisect skip                       # if the commit can't be tested
                                      # (won't compile, broken in some other way)

# Bisect narrows down. Repeat marking until git announces:
# → "<sha> is the first bad commit"

# Done — back to your starting state:
git bisect reset
```

## Automated workflow

If you have a script that exits 0 on good and non-zero on bad, you can
fully automate:

```bash
git bisect start HEAD <known-good>
git bisect run ./scripts/repro-bug.sh
# → bisect runs the script at each midpoint; marks good/bad automatically;
#   announces the first bad commit when done
```

The script's exit codes:

```
exit 0          → mark as good
exit 1..124,    → mark as bad
   126..127
exit 125        → mark as skip (can't test this commit)
exit 128+       → abort the bisect
```

## Test-script template

```bash
#!/usr/bin/env bash
# scripts/repro-bug.sh — bisect-aware reproduction script
set -e

# 1. If this commit can't even build, skip it (don't say bad).
npm install --silent --no-audit > /dev/null 2>&1 || exit 125
npm run build > /dev/null 2>&1 || exit 125

# 2. Run the targeted test that demonstrates the bug.
if npx vitest run path/to/regression.test.ts --reporter=basic > /dev/null 2>&1; then
  exit 0    # good
else
  exit 1    # bad
fi
```

## Why CodraGraph helps here

Once bisect names the first bad commit, the next question is *why*
that commit broke things. CodraGraph's `diff --semantic` and `context`
tell you exactly what changed, structurally:

```bash
git bisect log                            # see the bisection that found it
BAD=$(git bisect log | grep "first bad commit" | awk '{print $1}')

# What changed structurally between good and bad?
codragraph diff "$BAD"^ "$BAD" --semantic
# → addedAPIs / removedAPIs / classifiedModifications

# Get full context on the modified symbols
codragraph_context({name: "<symbol from the diff>"})
```

This turns "commit X is bad" into "commit X removed/modified Y, which
broke flow Z." That's the actionable answer.

## Bisect across non-linear history

If your history has merges, bisect handles them but the midpoints are
weird (commits from sibling branches). Two helpful flags:

```bash
git bisect start --first-parent HEAD <known-good>
# → only follows the first-parent path (main line of merges).
#   Useful when feature-branch commits aren't worth testing individually.

git bisect start --no-checkout HEAD <known-good>
# → don't checkout each midpoint; instead just sets BISECT_HEAD ref.
#   Use when checkout is expensive (huge repo, slow build).
```

## Pitfalls

| Pitfall | What happens | Fix |
|---|---|---|
| Forgot to `bisect reset` after finishing | Stuck in detached state, future `git pull` weird | `git bisect reset` returns you to your branch |
| Test depends on uncommitted state | Bisect finds noise, not the real bug | Stash before bisecting; ensure script is self-contained |
| Build broken in middle of range | Every middle commit looks "bad" | Use `git bisect skip` or exit-code 125 in the auto script |
| Submodules not in sync | Wrong code being tested | Add `git submodule update --init --recursive` to the script |
| Found a "bad commit" that's a merge | Probably a transient issue or skip-worthy | Inspect the merge: `git show --first-parent <merge>` |

## Checklist

```
- [ ] Identified a clear known-good and known-bad commit
- [ ] Have a deterministic, single-command reproduction
- [ ] Repro is fast enough (<2 min ideally; bisect runs ~log₂(N) times)
- [ ] Build can complete on every commit in the range (or skip script handles it)
- [ ] Use `git bisect run <script>` for full automation
- [ ] After hit: codragraph diff <bad>^ <bad> --semantic to understand WHY
- [ ] git bisect reset before resuming work
```

## Example: "Tests started failing in the last 3 weeks"

```bash
# 1. Confirm endpoints
git checkout main && npx vitest run path/to/regression.test.ts
# → fails

git checkout v1.5.3                        # known-good 3 weeks ago
npx vitest run path/to/regression.test.ts
# → passes

# 2. Automate
git bisect start main v1.5.3
cat > /tmp/repro.sh <<'EOF'
#!/usr/bin/env bash
set -e
npm install --silent || exit 125
npx vitest run path/to/regression.test.ts --reporter=basic > /dev/null 2>&1
EOF
chmod +x /tmp/repro.sh
git bisect run /tmp/repro.sh
# → "abc1234 is the first bad commit"

# 3. Understand the bad commit
codragraph diff abc1234^ abc1234 --semantic
# → modified validateUser (parameter count 3→4)

codragraph_context({name: "validateUser"})
# → caller `loginFlow` still passes 3 args — that's the regression

# 4. Reset and fix
git bisect reset
# Patch the caller; tests pass; ship.
```
