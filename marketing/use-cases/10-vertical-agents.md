# Use Case 10 — Building Vertical AI Agents

## The job

> "I want to build a coding-domain agent for [security audits / compliance checks / SDK migrations / framework upgrades / test coverage gaps]. Where do I start?"

Most agentic AI products today are general-purpose. The next wave is vertical — specialized agents that ship a 10× outcome on one specific job. Building those agents is hard.

## What exists today

| Tool | What it gives you | What you still build |
|---|---|---|
| LangChain / LlamaIndex | RAG building blocks | Code-aware retrieval, harness, evals, deployment |
| OpenAI Assistants / Custom GPTs | Hosted agent shell | All the retrieval intelligence, custom behavior |
| LangGraph / AutoGen / CrewAI | Multi-agent orchestration | Task-specific tuning, recipe management, code awareness |
| Anthropic SDK + manual loop | Total control | Everything from scratch |

The pattern: every "build a coding agent" startup spends months reinventing graph indexing, retrieval, harness tuning, and prompt engineering. Months that should be spent on the *vertical*, not the plumbing.

## What Codragraph does differently

Codragraph is a **platform**, not an agent. You build the vertical agent on top.

The 4-layer stack handles all the plumbing:

```ts
import { graph, harness, compress, swarm } from "codragraph-sdk";

class SecurityAuditAgent {
  async audit(repoPath: string) {
    // Layer 1+2: graph retrieval + compression
    const surfaces = await graph.query({
      query: "endpoints that don't validate input",
      repo: repoPath,
    });

    // Layer 3+4: harness with versioned recipes
    const result = await swarm.swarmSearch({
      tasks: surfaces.results.map(s => ({
        id: s.name,
        question: `Is ${s.name} vulnerable to SQL injection?`,
        repo: repoPath,
      })),
      seeds: [/* your security-tuned seeds */],
      explorer: new swarm.ExplorerRole({ /* security-focused guidance */ }),
      exploiter: new swarm.ExploiterRole({ /* */ }),
      critic: new swarm.LlmCriticRole({ inference: this.haiku }),
      termination: [
        swarm.maxIterations(20),
        swarm.paretoPlateau(5),
      ],
      // ... your scoring logic for security findings
    });

    return result.frontier; // Pareto-optimal recipes for security audit
  }
}
```

What you ship: the **vertical-specific knowledge** (which patterns to look for, scoring rubric, output format). What Codragraph ships: indexing, retrieval, compression, harness orchestration, recipe memory.

## Verticals already viable on Codragraph

- **Security audit agents** — find injection patterns, missing validation, exposed secrets
- **Compliance scanners** — GDPR, PCI, HIPAA — code-level rule matching with audit trail
- **SDK migration agents** — automate v1→v2 upgrades for popular libraries
- **Framework upgrade agents** — Express→Fastify, Pages Router→App Router
- **Performance audit agents** — find N+1 queries, blocking I/O in async paths
- **Accessibility scanners** — find a11y violations with context-aware fixes
- **Test coverage agents** — find untested branches, generate prioritized tests
- **API breaking-change agents** — ship-blocking checks in CI
- **Doc generation agents** — generate and maintain living docs
- **Onboarding agents** — repo-specific tutors for new hires

Each is a startup-sized opportunity. Codragraph makes the platform cost zero so you can focus on the wedge.

## The before / after

**Before:** A vertical AI startup spends 4–6 months building graph retrieval, eval harness, recipe management, and deployment infra before shipping any product. By then, two competitors launched.

**After:** Same startup uses Codragraph for the platform layer. Spends 3–4 weeks on the vertical-specific knowledge and prompts. Ships v1 in month 2. Iterates faster than competitors who reinvented plumbing.

## Why the moat matters here

This is where versioned recipe memory pays off **biggest**. Your vertical agent runs the same kind of analysis across thousands of customer repos. The harness finds the right recipe per repo type — but you don't pay for re-search on every repo. The version graph indexes the recipe space; new repos bootstrap from the closest known winner.

Concrete: a security audit agent built on Codragraph, deployed to 100 customer repos, runs 10× cheaper than the same agent built on raw RAG + LangChain — because recipe memory amortizes the harness search across all 100 deployments.

## Sample vertical pitch

> "Codragraph is the AWS for code-aware AI agents.
>  You bring the vertical knowledge. We bring the platform.
>  Ship in weeks, not quarters."

## Honest limit

Codragraph is best for verticals that lean on **structural code understanding**. Verticals that need runtime telemetry (production error analysis, real-user-monitoring AI) need other infra — observability, log analysis. Codragraph is the static-analysis half of agentic AI; the other half is observability, and that's a separate product.
