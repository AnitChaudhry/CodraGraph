# Use Case 06 — Refactoring Large Codebases

## The job

> "I want to rename this method, split this module, or move this class to a new package — without breaking 47 things."

Large refactors are where AI assistants fail visibly. They look helpful, run grep, edit some files, miss the dynamic-dispatch case, and ship a broken build.

## What exists today

| Tool | What it does | Where it falls short |
|---|---|---|
| IDE refactor (TS / Java / C#) | Type-aware rename | Confined to one language; brittle on dynamic patterns |
| Cursor / Aider | LLM-driven refactor | Burns context, misses cross-package effects |
| jscodeshift / facebook codemod | Template-based AST rewrites | High-effort to write codemod; no impact analysis |
| Manual + grep + faith | The default | Slow, fragile |

## What Codragraph does differently

Two purpose-built primitives for refactoring:

### `codragraph_rename`

Graph-assisted multi-file rename. Walks the call graph + import graph, generates a coherent rename plan, supports `dry_run=true` to preview before executing. Catches:
- Renames across files and packages (TypeScript: works across `import` chains)
- Methods on subclasses that need updating
- Test fixtures that hardcode the old name
- Documentation references

### `codragraph_impact` before edit

Run impact analysis BEFORE making structural changes. Get a risk-stratified list (LOW / MEDIUM / HIGH / CRITICAL) of what'll break.

The standard refactor playbook becomes:
1. `codragraph_impact target=oldName direction=upstream` — see the blast
2. Plan the migration (deprecate, update, remove)
3. `codragraph_rename old=oldName new=newName dry_run=true` — preview the diff
4. Apply
5. Run tests
6. `codragraph_detect_changes` to confirm only the expected symbols changed

## The before / after

**Before (without Codragraph):** A senior engineer plans a 4-week refactor of the auth module. Spends week 1 reading code, week 2 doing find-and-replace, week 3 fixing the things find-and-replace broke, week 4 in regression hell.

**After (with Codragraph):** Same engineer runs impact analysis day 1 (15 minutes), gets a stratified change list, plans deprecation/update/remove cycles per risk tier. Refactor completes in 1.5 weeks with zero unexpected breakages.

## Why the moat matters here

Big refactors happen once a quarter; small refactors happen every day. The "small refactor" recipe — rename, move, split, merge — is run hundreds of times across a codebase's lifetime. Versioned recipe memory keeps that recipe sharp without re-tuning. When the codebase undergoes a paradigm shift (e.g. monolith → microservices), the recipe ages out and re-tunes — exactly when you'd want it to anyway.

## Sample agent dialog

```
You: I want to split src/auth/user.ts into src/auth/user-model.ts (the User class)
     and src/auth/user-service.ts (the validation functions). What breaks?

Claude (using codragraph_impact + codragraph_context):
   File splits don't break runtime if imports update. Let me trace.

   Symbols in src/auth/user.ts:
     - class User (called by 23 sites)
     - function validateUser (called by 7 sites)
     - function refreshUserSession (called by 3 sites)
     - private function _hashPassword (called only within this file)

   Migration plan:
     1. Move User class → user-model.ts. Update 23 import statements.
     2. Move validateUser + refreshUserSession → user-service.ts. Update 10 imports.
     3. Keep _hashPassword in user-service.ts (internal use only).
     4. Delete src/auth/user.ts.

   Risks:
     - 1 dynamic import detected (src/api/lazy-routes.ts:12) — verify it points
       to the new location.
     - 0 reflection patterns detected.

   Want me to generate a codragraph_rename plan for the imports?
```

## Honest limit

Refactors that change runtime behavior (e.g., changing async semantics, swapping a sync API for async) need actual testing — Codragraph confirms what *will be called*, not whether the new implementation is *correct*. Run the test suite.
