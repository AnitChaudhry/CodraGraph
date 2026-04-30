---
name: codragraph-onboarding
description: "Use when a developer is new to a codebase and needs a guided walkthrough — entry points, functional areas, key flows, where to start contributing. Examples: \"I'm new to this repo\", \"where do I start\", \"give me a tour\", \"onboard me to this codebase\", \"what does this project do\""
---

# Codebase Onboarding with CodraGraph

## When to Use

- "I'm new to this codebase. Where do I start?"
- "Give me a tour of this project."
- "What does each part of this repo do?"
- "I want to fix a bug in `<area>` — what should I read first?"
- "I'm picking this project back up after 6 months."

## Why CodraGraph helps here

A README tells you what the project *does*. Reading source top-down tells
you nothing for the first hour. CodraGraph already grouped your code into
**Leiden communities** during analyze — these are the natural functional
areas of the codebase, derived from the call graph rather than directory
structure. Pair them with the detected execution flows (Processes) and you
get a guided tour: each cluster is a "module", each process is a "story
running through it."

## Workflow

```
1. READ codragraph://repo/{name}/context
   → repo-level overview: file count, language mix, last index time

2. READ codragraph://repo/{name}/clusters
   → all functional areas (auth, payments, ingestion, …) with cohesion %
     and dominant directories

3. For each top-3 cluster (by symbol count):
   READ .claude/skills/generated/<cluster-kebab-name>/SKILL.md (if --skills was run)
   OR
   codragraph_query({query: "<cluster label>"})
   → entry points, key files, member symbols

4. READ codragraph://repo/{name}/processes
   → all detected execution flows (named processes that span the graph)

5. For each process:
   READ codragraph://repo/{name}/process/<processName>
   → step-by-step trace: which symbol calls which next

6. Pick a cluster the user wants to dig into:
   codragraph_context({name: "<entry point of that cluster>"})
   → callers + callees, full picture of the entry point
```

> If `.claude/skills/generated/` is empty, run `codragraph analyze --skills`
> first to materialize per-community guides. They make onboarding
> dramatically faster.

## Checklist

```
- [ ] Repo overview (context resource)
- [ ] List clusters (clusters resource)
- [ ] Read top 3-5 cluster skills or query each cluster label
- [ ] List processes
- [ ] Walk top 2-3 processes step-by-step
- [ ] Pick one entry point and run context for the deep dive
- [ ] Summarize: "Here's the map. Start at <X> for <task>."
```

## Tour Structure

| Stage | Tool | Output |
| --- | --- | --- |
| Map | `clusters` resource | "10 functional areas, dominant: auth, ingestion, web" |
| Themes | per-community SKILL.md | Each area's purpose, key files, entry points |
| Stories | `processes` resource | "5 flows: SignupFlow, IngestPipeline, …" |
| Trace | `process/{name}` resource | Step-by-step call sequence |
| Deep dive | `context` | Pick one symbol, see all sides |

## Example: "I'm new to CodraGraph itself, where do I start?"

```
1. READ codragraph://repo/CodraGraph/context
   → 4325 symbols, 10556 relationships, 300 flows. TypeScript primary.

2. READ codragraph://repo/CodraGraph/clusters
   → Top clusters: ingestion (1240 symbols), graphstore (340), cli (290),
     mcp (220), languages (180)

3. READ .claude/skills/generated/ingestion/SKILL.md
   → Entry points: runFullAnalysis, IngestionPipeline.run
   → Key files: packages/core/src/core/ingestion/

4. READ codragraph://repo/CodraGraph/processes
   → Top flows: AnalyzeFlow, McpQueryFlow, GraphstoreCommitFlow

5. READ codragraph://repo/CodraGraph/process/AnalyzeFlow
   → 12 steps from CLI invocation through Phase 4 snapshot

6. codragraph_context({name: "runFullAnalysis"})
   → orchestrator that takes (repoPath, options, hooks) and runs the pipeline.
   → Called by: analyzeCommand (CLI), eval-server, augment hook

Tour result: "Start at runFullAnalysis (packages/core/src/core/run-analyze.ts).
That's the orchestrator. The 12-stage pipeline lives under
src/core/ingestion/. Phase 4 graphstore is in src/core/graphstore/."
```

## Output Format

```markdown
## Codebase Tour: <repo>

### Project shape
- N symbols across M files. Primary languages: …
- N functional areas (clusters), M execution flows.

### Functional areas
1. **<cluster>** — <symbolCount> symbols, dominant `src/<dir>/`. Purpose: …
2. ...

### Key flows
- **AnalyzeFlow** — 12 steps. Entry: `<symbol>`.
- ...

### Recommended starting point for "<task>"
Read `<file>:<line>` (`<symbol>`). It's the orchestrator for <area>.
Once you understand it, walk the <flow> to see the whole story.
```
