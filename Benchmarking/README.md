# Codragraph — Benchmarking

Reproducible infrastructure for measuring Codragraph's actual token-savings, latency, and accuracy claims against real workloads on real models.

> **Status (2026-04-29):** Scaffolded. The headline claim — "60–85% token reduction with smaller models matching flagship outputs" — is a hypothesis until this folder produces numbers.

## Why this exists

The marketing copy says 60–85% token reduction. The architecture supports that claim. But until we run the harness on real models against real tasks and publish the comparison, that's a hypothesis. This folder is how we make it a fact (or correct it).

## What this measures

For each `(model, workload, treatment)` triple we capture:

| Metric | What it tells us |
|---|---|
| **Input tokens** (mean, p50, p95) | Context efficiency — graph + compression payoff |
| **Output tokens** (mean, p50, p95) | Answer terseness |
| **Total tokens** | The end-to-end cost story |
| **Latency** (mean, p50, p95) | User-perceived speed |
| **Accuracy** | Correctness against ground truth (Codebase Q&A) or test-pass (bug repair) |
| **Cost** ($) | tokens × provider rate; lets us compare flagship-API vs self-hosted-GPU |
| **Frontier hits** (swarm runs only) | How many proposed harnesses survive |

## Treatment vs baseline

Three configurations per workload:

| Tag | Setup | What it isolates |
|---|---|---|
| `baseline-grep` | Model + raw filesystem tools (read_file, grep, ls). No codragraph. | What every agent does today. |
| `baseline-fullfile` | Model + read entire files when relevant. No retrieval system. | Generous baseline — "just use a big context window". |
| `codragraph-graph-only` | Model + codragraph_query/context/impact. No compression, no harness. | Layer 1's standalone payoff. |
| `codragraph-graph-compress` | + LLM-aware compression on retrieved context. | Layer 1 + Layer 2. |
| `codragraph-harness-tuned` | + auto-tuned recipe from `harness search`. | Layer 1 + 2 + 3. |
| `codragraph-swarm-tuned` | + 3-role swarm-tuned recipe. | Full stack except recipe memory. |
| `codragraph-recipe-cached` | + reuse existing recipe from versioned graph (Phase 4). | Full stack including the moat. |

The headline comparison is `baseline-grep` vs `codragraph-recipe-cached`. The honest comparison is also `baseline-fullfile` vs `codragraph-graph-compress` — answers the "doesn't a 200k context window solve this?" objection.

## Folder layout

```
Benchmarking/
├── README.md                  this file
├── METHODOLOGY.md             how we measure, what counts as accurate, statistical conventions
├── REPRODUCIBILITY.md         env capture, model pinning, seed management
├── hardware/                  GPU sizing, cloud provider guides, local Linux/WSL2 setup
├── inference-servers/         vLLM, Ollama, TGI, llama.cpp
├── models/                    Model matrix + quantization guide
├── workloads/                 Codebase Q&A, bug repair, baselines
├── docker/                    docker-compose for the full reproducible stack
├── scripts/                   TS run-benchmark + compare + report scripts
└── results/                   Output JSONs + generated reports (gitignored except README)
```

## Quickstart (cloud GPU, ~15 minutes)

```bash
# 1. Rent a GPU (RunPod / Lambda / vast.ai). See hardware/02-cloud-providers.md.
#    Recommended: 1x A100 40GB or RTX 4090 24GB. Linux + Docker pre-installed.

# 2. Clone this repo on the GPU box
git clone <repo>; cd thinqmesh-codra/Benchmarking

# 3. Pick a model and start vLLM
cd docker
cp .env.example .env
# Edit .env: set MODEL=Qwen/Qwen2.5-Coder-7B-Instruct (or other from models/01-model-matrix.md)
docker compose up -d vllm

# 4. Index a target repo (we'll use codragraph itself as the corpus)
docker compose run --rm codragraph npx codragraph analyze /workspace/repo

# 5. Run the full benchmark sweep
docker compose run --rm bench npm run benchmark -- \
  --workload codebase-qa \
  --treatments baseline-grep,codragraph-graph-only,codragraph-graph-compress,codragraph-swarm-tuned \
  --models qwen-coder-7b,gpt-4o-mini,claude-haiku \
  --runs 3 \
  --output ./results/$(date +%Y%m%d)/

# 6. Generate the report
docker compose run --rm bench npm run report -- ./results/$(date +%Y%m%d)/
```

## Quickstart (local, no Docker, fastest iteration)

```bash
# 1. Install Ollama (lightest GPU inference server)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull a model
ollama pull qwen2.5-coder:7b

# 3. From the repo root
cd Benchmarking/scripts
npm install
npm run benchmark -- \
  --workload codebase-qa \
  --treatments baseline-grep,codragraph-graph-only,codragraph-swarm-tuned \
  --models qwen-coder-7b-ollama,claude-haiku \
  --runs 1 \
  --output ./results/local-$(date +%Y%m%d)/

# 4. Report
npm run report -- ./results/local-$(date +%Y%m%d)/
```

## What "actual benchmarking" means here

Three commitments:

1. **Real models, real workloads.** No mocked LLMs, no toy datasets. Every benchmark run hits a real inference endpoint against the real 105-task Q&A set or SWE-bench-lite tasks.
2. **Reproducible.** Pinned model versions, pinned seeds, captured environment. `REPRODUCIBILITY.md` documents the lock-file pattern.
3. **Honest.** Both baselines (grep, full-file) are measured fairly. We don't gimp them. If codragraph wins, it wins on the level. If it loses on a metric, the result still ships.

## What this is NOT

- Not a TPU/specialized-accelerator setup. CUDA + nvidia-driver only.
- Not a multi-tenant SaaS evaluation harness. Single-user runs that you re-run yourself.
- Not a leaderboard play. We're measuring our own claims, not gaming public eval suites.

## Honest limits

- **Closed-API providers (Claude, OpenAI) charge per token.** A full sweep costs real money — $5–50 depending on configuration. The Docker compose targets self-hosted models specifically so the marginal cost of more runs is electricity only.
- **GPU memory bounds the model size.** A 24GB RTX 4090 can serve Qwen2.5-Coder-32B at Q4 quantization but not 70B. See `models/02-quantization-guide.md`.
- **Subprocess proposers (the swarm's Explorer / Exploiter) need Claude Code installed on the bench host.** They're agentic and write code — they're not running on the GPU. If you don't have a Claude API key, run only the non-swarm treatments.

## License

This benchmarking infrastructure inherits the monorepo's Apache-2.0 license.
