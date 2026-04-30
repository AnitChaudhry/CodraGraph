---
name: codragraph-config-audit
description: "Use to audit how environment variables, config files, and feature flags are read and used across the codebase — find unused config, missing defaults, undocumented env vars, secrets read into logs. Examples: \"audit env vars\", \"unused config\", \"who reads FOO_BAR env\", \"feature flag usage\", \"config sprawl\""
---

# Configuration Audit with CodraGraph

## When to Use

- "Which env vars do we actually read?"
- "Which env vars are read but never set in deploy configs?"
- "Find the unused feature flags I can delete."
- "Who reads `STRIPE_SECRET_KEY`?"
- "Is `<config>` ever logged or sent to telemetry?"
- "Audit config sprawl before consolidating."

## Why CodraGraph helps here

Configuration enters your code through a small set of helpers:
`process.env.X`, `os.getenv("X")`, `config.get("foo.bar")`,
`featureFlags.isEnabled("flag")`. CodraGraph indexes the calls to those
helpers and the literal arguments — so a `query` for the helper plus a
`context` of each call site produces a complete picture of which keys
are read where.

## Workflow

```
1. Identify the config helpers (per-language patterns):
   codragraph_query({query: "process.env getenv ConfigService featureFlags"})
   → list of config-read helpers

2. For each helper, find every call site and its key argument:
   codragraph_cypher({query: `
     MATCH (caller)-[:CALLS]->(helper {name: 'getenv'})
     RETURN caller.name, caller.filePath
   `})
   → For richer key-extraction, read the bodies via context:
   codragraph_context({name: "<caller>", content: true})
   → look for the literal string passed to getenv()

3. Cross-check with deploy configs:
   - Read .env / .env.example / docker-compose.yml / k8s ConfigMaps
   - Build the SET of keys actually defined
   - For each key your code reads but isn't defined: undocumented env var
   - For each key defined but no code reads: dead config — delete

4. Feature-flag specific audit:
   codragraph_query({query: "featureFlags.isEnabled flag.evaluate"})
   → For each flag-read site: codragraph_impact upstream
   → Flags with no callers can be removed
   → Flags with one branch always returning true / false are stale

5. Secret-leakage check:
   codragraph_query({query: "STRIPE_SECRET DATABASE_URL API_KEY"})
   → For each match: codragraph_context to confirm the value is not
     piped to logger / tracer / metrics
```

## Audit dimensions

| Dimension | Question | CodraGraph approach |
|---|---|---|
| **Used** | Is this env var read anywhere? | `query` for the literal key |
| **Documented** | Is the key in `.env.example` / docs? | grep deploy files; subtract from used set |
| **Defaulted** | Does the read have a default? | `context` shows the surrounding code |
| **Validated** | Is the value parsed / type-checked? | `context` for `parseInt` / `URL` / Zod schema in the caller |
| **Logged** | Does the value flow to telemetry? | `impact` downstream from the read site → check telemetry helpers |
| **Stale flag** | Is the flag still toggled in production? | combine with deploy-config check |

## Feature flag lifecycle audit

```
codragraph_cypher({query: `
  MATCH (caller)-[:CALLS]->(ff {name: 'isEnabled'})
  RETURN caller.name, caller.filePath, count(*) AS uses
  ORDER BY uses DESC
`})
→ for each call site, codragraph_context to extract the flag NAME literal

# Then:
- Flag name read by 0 callers → remove
- Flag name with both branches identical → stale (always-true or always-false)
- Flag still wired in code, but config has it pinned `true` for >90 days → graduate
```

## Checklist

```
- [ ] Listed config helpers (env / config / featureFlag readers)
- [ ] Built the read-set: { key: [ call sites ] }
- [ ] Built the defined-set from deploy configs
- [ ] Diff: undocumented (in code, not in config) + dead (in config, not in code)
- [ ] Spot-check defaults / validation / secret leakage on critical keys
- [ ] Feature-flag staleness check
- [ ] Output: read map + recommended deletions / required deploy changes
```

## Example: "Audit our feature flags"

```
1. codragraph_query({query: "featureFlags.isEnabled"})
   → 47 call sites in 23 files

2. For each call site, extract the flag string (codragraph_context):
   - 'new_checkout' (12 sites)
   - 'experimental_search' (4 sites)
   - 'use_new_pricing' (8 sites)
   - 'kill_legacy_admin' (1 site)
   - 'canary_v3' (0 sites — defined in code dead)

3. Cross-check deploys:
   - 'new_checkout' set to TRUE for 100%% prod since 2026-01 (graduate it)
   - 'experimental_search' set to TRUE for 5%% prod (active experiment, keep)
   - 'use_new_pricing' set to TRUE for 100%% prod since 2026-03 (graduate)
   - 'kill_legacy_admin' set to TRUE for 100%% prod since 2026-02 (graduate)
   - 'canary_v3' not configured anywhere (truly dead)

4. Findings:
   - DELETE: 'canary_v3' (dead code, no callers, no config)
   - GRADUATE: 'new_checkout', 'use_new_pricing', 'kill_legacy_admin' →
     remove the flag check; keep the new behavior unconditionally
   - KEEP: 'experimental_search'
   - Codebase loses: 21 call sites, 1 unused flag definition
```

## Output Format

```markdown
## Config Audit: <scope>

### Env vars / config keys
| Key | Read sites | Defined? | Default? | Validated? | Notes |
|---|--:|---|---|---|---|
| DATABASE_URL | 4 | ✓ | ✗ | ✗ | add Zod parse |
| EXPERIMENTAL_FOO | 1 | ✗ | ✓ ('false') | ✓ | undocumented; either document or delete |
| ... | ... | ... | ... | ... | ... |

### Feature flags
- DELETE (no callers): canary_v3, legacy_dashboard_b
- GRADUATE (100%% production for >90 days): new_checkout, kill_legacy_admin
- KEEP (active experiment): experimental_search, ai_summarize_v2

### Secret-leak check
- 0 paths from secret reads to logger/metrics/tracer found ✓
```
