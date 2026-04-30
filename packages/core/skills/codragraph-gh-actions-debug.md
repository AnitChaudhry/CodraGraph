---
name: codragraph-gh-actions-debug
description: "Use when a GitHub Actions workflow fails, needs to be re-run, dispatched manually, or inspected. Covers `gh run` for inspecting/rerunning runs, `gh workflow` for triggering, secrets, and the most common failure modes. Examples: \"why did CI fail\", \"rerun this workflow\", \"dispatch a workflow manually\", \"debug GitHub Action\", \"set GitHub secret\""
---

# GitHub Actions Debugging with `gh`

## When to Use

- "CI failed on my PR — show me why."
- "Rerun the failed jobs only."
- "Dispatch a workflow manually with custom inputs."
- "Add or rotate a secret."
- "Cancel a hung workflow run."

## Lifecycle commands

### List / inspect runs

```bash
gh run list                                       # most recent runs
gh run list --workflow ci.yml                     # one workflow's runs
gh run list --branch my-feature --status failure  # failed runs on a branch
gh run list --json conclusion,databaseId,headBranch,name --jq '.[] | select(.conclusion=="failure")'

gh run view <run-id>                              # run summary + jobs
gh run view <run-id> --log                        # FULL logs (verbose)
gh run view <run-id> --log-failed                 # only the failed steps' logs
gh run view <run-id> --json jobs --jq '.jobs[] | {name, conclusion}'
```

If you don't know the run id:

```bash
# Most recent run on current branch:
gh run view --branch "$(git branch --show-current)"

# Most recent failed run anywhere:
gh run list --status failure --limit 1 --json databaseId --jq '.[0].databaseId'
```

### Re-run

```bash
gh run rerun <run-id>                             # rerun the WHOLE run
gh run rerun <run-id> --failed                    # only the failed jobs
gh run rerun <run-id> --job <job-id>              # only one specific job
gh run rerun <run-id> --debug                     # enable runner debug logging
```

`--failed` is the right default for "I think the failure was flaky."

### Cancel / delete

```bash
gh run cancel <run-id>                            # cancel an in-progress run
gh run delete <run-id>                            # remove from history (rare)
gh run watch <run-id>                             # tail the run live
```

### Manual dispatch (workflow_dispatch)

For workflows with `on: workflow_dispatch:`:

```bash
gh workflow list                                  # which workflows are dispatchable
gh workflow run <workflow-name-or-id>             # run on default branch
gh workflow run ci.yml --ref my-branch            # run on a specific branch
gh workflow run deploy.yml --field environment=staging --field version=1.7.0
```

Re-list runs to see the dispatched one:

```bash
gh run list --workflow ci.yml --limit 5
```

### Secrets and variables

```bash
# Repo-scope secrets:
gh secret list
gh secret set ANTHROPIC_API_KEY --body "sk-…"
gh secret set ANTHROPIC_API_KEY < ~/api-key.txt    # from file
gh secret delete OLD_KEY

# Repo-scope variables (non-secret):
gh variable list
gh variable set DEPLOY_REGION --body "us-east-1"

# Environment-scope (e.g., production):
gh secret set MY_KEY --env production --body "…"
```

## Why CodraGraph helps here

When a workflow YAML changes break CI, treat the workflow as code: the
PR review Action's structural diff doesn't help (Actions aren't TS/Python),
but two CodraGraph patterns DO help:

1. **Find the symbol the workflow invokes** — many workflows call into
   the codebase (`npm test`, `npx my-cli`, `python scripts/foo.py`).
   Trace what each step actually executes:

```
codragraph_query({query: "<command the action runs, e.g. 'analyze repo'>"})
→ which CLI handler / script the workflow ends up running
```

2. **After a CI break, diff against the last green run's commit** — was
   it a code change or a workflow YAML change?

```
gh run list --workflow ci.yml --status success --limit 1 --json headSha
→ <last-green-sha>

codragraph diff <last-green-sha> HEAD --semantic
→ if structural diff is empty, the break is in YAML / env / runner — not code
```

## Failure-mode triage

| Symptom | Likely cause | Where to look |
|---|---|---|
| `npm install` fails on Linux only | Native deps need apt packages | Add `apt-get install` step or use a different runner |
| Tests pass locally, fail in CI | Env diff (Node version, locale, timezone) | Compare runner env vs local; add `node-version` matrix |
| Workflow re-runs with no code change still fail | Flaky test or external service | `gh run rerun --failed --debug` and read the debug logs |
| Action can't see secret | Secret scope mismatch | `gh secret list` per env / repo / org; secrets don't leak across environments |
| Pull-request workflow can't write | Default `GITHUB_TOKEN` is read-only on PRs from forks | Switch to `pull_request_target` (with care) or PAT-based action |

## Debugging steps that actually work

```bash
# 1. Re-run with debug:
gh run rerun <run-id> --failed --debug

# 2. Tail the live run:
gh run watch <run-id>

# 3. Pull only the failed step's logs:
gh run view <run-id> --log-failed | less

# 4. If you need full context, download artifacts:
gh run download <run-id>
ls ./

# 5. To enable verbose runner logs without re-running, set repo secrets:
gh secret set ACTIONS_RUNNER_DEBUG --body "true"
gh secret set ACTIONS_STEP_DEBUG --body "true"
# (re-run the workflow to pick these up)
```

## Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| `--debug` doesn't show extra logs | Repo doesn't have the debug secrets set | Set `ACTIONS_STEP_DEBUG=true` repo secret |
| Workflow doesn't appear in dispatch list | Missing `on: workflow_dispatch:` | Add the trigger to the workflow YAML |
| Inputs to dispatch silently ignored | Type mismatch or missing `inputs:` block | Re-check the workflow YAML's `inputs:` schema |
| Re-run doesn't pick up your fix | Re-run uses the SAME commit; you need a NEW push for the new code | Push a fix; or use `--debug` if you want runner-level debugging only |
| Secrets leaked in logs | Used `${{ secrets.X }}` in a `run:` step that echoes | Use env: with secret values; never echo |
```
