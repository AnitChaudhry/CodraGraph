---
name: codragraph-project-switcher
description: "Use when the user works across many parallel projects and needs to switch context, find which repo a symbol is in, list all indexed projects, or run a query against a specific repo without ambiguity. Examples: \"what projects am I working on\", \"switch to repo X\", \"which of my repos has function Y\", \"list my repositories\""
---

# Multi-Project / Vibecoding Context Switcher

## When to Use

- "What projects do I have indexed?"
- "Switch to my `<project>` repo for this query."
- "Which of my repos has the `<symbol>` function?"
- "Run this query across all my repos."
- Solo dev juggling 4+ side projects with different agents
- Picking up a project after weeks away

## Why CodraGraph helps here

CodraGraph maintains a global registry of every indexed repo at
`~/.codragraph/registry.json`. Every MCP tool accepts a `repo` parameter
to disambiguate. So switching context isn't "open a new editor / cd into
the project / re-orient your agent" — it's just passing `repo: "<name>"`
to the next call. Combine with **groups** (multiple repos that share
contracts) and you get cross-repo queries with one call.

## Workflow

```
1. List every indexed repo:
   codragraph_list_repos({})
   → name, path, file count, last analyze time

2. (Optional) List groups (sets of related repos):
   codragraph_group_list({})
   → group name + member repos

3. Query against a specific repo:
   codragraph_query({repo: "<name>", query: "<concept>"})
   → answers come from that repo only

4. Find which repo has a symbol you remember:
   For each repo from list_repos:
     codragraph_query({repo: "<name>", query: "<remembered name>"})
   → first hit identifies the repo

5. For cross-repo questions (group-mode):
   codragraph_query({repo: "@<group>", query: "<concept>"})
   → fans out across every group member, RRF-merges results
```

> If `list_repos` returns nothing, the user has no indexed projects yet.
> Run `codragraph analyze` in each project once to register them.

## Checklist

```
- [ ] list_repos to see what's indexed
- [ ] group_list to see related-repo groups
- [ ] Pick the right repo (or group) for the question
- [ ] Pass repo: "<name>" or repo: "@<group>" to subsequent calls
- [ ] If a project isn't indexed yet, suggest the user run analyze in it
- [ ] Mention staleness ("repo X last indexed 12 days ago — re-analyze?")
```

## Multi-Project Patterns

| Situation | What to do |
| --- | --- |
| Switching from one solo project to another | `list_repos` → pick → all subsequent tools take `repo: "<name>"` |
| "Did I solve this in another repo?" | `query` over each repo, look for matching symbols |
| Shared library used by multiple repos | Define a group (group.yaml); use `repo: "@<group>"` |
| Resuming a project after weeks | Check staleness (`list_repos` last-indexed timestamps); re-analyze if old |

## Example: "Switch me to my SaaS side project and find the auth code"

```
1. codragraph_list_repos({})
   → 4 indexed repos:
     - codragraph (~/code/codragraph, 4325 symbols, indexed 2 hours ago)
     - my-saas (~/projects/my-saas, 1180 symbols, indexed 3 days ago)
     - portfolio (~/code/portfolio, 240 symbols, indexed 2 weeks ago)
     - data-eda (~/notebooks/data-eda, 95 symbols, indexed 1 month ago)

2. codragraph_query({repo: "my-saas", query: "authentication login session"})
   → top 5 symbols in my-saas, none in other repos

3. codragraph_context({repo: "my-saas", name: "validateSession"})
   → callers: requireAuth, refreshToken (both in my-saas)

4. (Optional) Reminder: my-saas was indexed 3 days ago — fine for navigation
   but if I just made commits, run `cd ~/projects/my-saas && codragraph analyze`
   to refresh.

Switched. Subsequent queries default to my-saas now.
```

## Output Format

```markdown
## Project Switch: → `<repo>`

### Available projects
1. **<repo-1>** — N symbols, last indexed Xh ago
2. **<repo-2>** — M symbols, last indexed Yd ago (stale?)
3. ...

### Active for this conversation
`<chosen-repo>` (path: `<path>`).

### Staleness note
Last indexed `<duration>` ago. Re-analyze if recent commits matter.

### Quick links
- `query` already scoped to this repo
- For cross-repo: pass `repo: "@<group>"` instead
```
