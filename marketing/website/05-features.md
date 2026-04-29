# Features

## Section title

**Everything in one stack. No gluing tools together.**

## Capabilities

### 🧭 Graph-aware code intelligence
- 16 languages: TypeScript, JavaScript, Python, Go, Rust, Java, C#, C++, C, Ruby, PHP, Swift, Kotlin, Dart, COBOL, Markdown
- 44 node types, 21 relationship types — typed graph, not stringly-typed search
- Hybrid BM25 + vector search via Reciprocal Rank Fusion
- Cross-repo groups: query across multiple indexed projects with `repo: "@<group>"`

### 🗜️ LLM-aware compression
- Semantic compression that preserves facts and constraints
- Tunable aggressiveness: `min` / `balanced` / `max` policies
- Provider-agnostic — works with any LLM via the SDK

### 🤖 Auto-tuned harness
- Three-role swarm: **Explorer** (broad mutations), **Exploiter** (refinement), **Critic** (pre-eval gate)
- Multi-objective Pareto frontier: accuracy ↑, tokens ↓, latency ↓
- Hybrid termination: max-N + plateau detection + token / time / cost budgets
- Provider-agnostic InferenceProvider — Claude, OpenAI/Codex, OpenCode, or your own

### 📜 Versioned knowledge graph
- Content-addressed snapshots (sha256-rooted, Dolt-like)
- Branches, commits, three-way merges on graph state
- Diff queries: "what changed between commit A and B in the relevant subgraph?"
- **Recipe memory:** harness recipes tagged against snapshot, auto-reused when subgraph unchanged

### 🔌 Five distribution surfaces
- **MCP stdio** — Claude Code, Cursor, OpenCode, Codex
- **MCP over HTTP** — hosted / network scenarios
- **HTTP API** on port 4747 — web UIs, dashboards
- **CLI** — `npx codragraph` for everything
- **npm SDK** — `codragraph-sdk` programmatic access

### 🔐 Local-first by default
- Indexing runs on your machine
- LadybugDB graph stored at `.codragraph/`
- BYO API key for inference providers — keys never touch our servers
- Air-gapped deployments supported

### 🧪 Built-in evaluation
- 100+ hand-labeled Codebase Q&A tasks shipping with the harness
- LLM-judge with substring fallback for paraphrase-tolerant scoring
- Per-task traces persisted for audit

### 🪝 Agent integration polish
- Auto-generated `AGENTS.md` and `CLAUDE.md` after indexing
- Pre-commit hooks for impact analysis (`codragraph_impact` before edit)
- Stale-index warnings when `lastCommit` differs from HEAD

## Comparison table (side-by-side feel)

| | Codragraph | Sourcegraph / Cody | Cursor | Copilot Chat |
|---|---|---|---|---|
| Local-first | ✅ | ❌ (cloud) | ⚠️ partial | ❌ |
| Code-as-graph | ✅ | ✅ | ❌ | ❌ |
| Auto-tuned harness | ✅ | ❌ | ❌ | ❌ |
| Versioned recipes | ✅ | ❌ | ❌ | ❌ |
| Compression layer | ✅ | ❌ | ❌ | ❌ |
| MCP-native | ✅ | ⚠️ partial | ❌ | ❌ |
| Works with any LLM | ✅ | ⚠️ | ❌ (Anthropic-tied) | ❌ (OpenAI-tied) |
| Open core | ✅ | ⚠️ | ❌ | ❌ |

## Designer brief

A grid of 8 feature cards (one per capability above). Each card: icon, headline, two-line body. The "Versioned knowledge graph" card has a "★ moat" badge.
