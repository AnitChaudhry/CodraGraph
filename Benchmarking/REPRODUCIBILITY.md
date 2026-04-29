# Reproducibility

Numbers in a benchmark report are only useful if a third party can reproduce them. This file documents what we capture and pin so anyone can rerun the same configuration months later and get the same answer (modulo provider-side drift).

## What gets captured per run

Every run writes an `env.json` snapshot to `results/<run-id>/env.json`:

```jsonc
{
  "runId": "2026-04-29-qwen-coder-7b-codebase-qa-codragraph-swarm-tuned",
  "timestamp": "2026-04-29T18:42:11.503Z",
  "git": {
    "thinqmesh-codra-sha": "abc123...",
    "branch": "main",
    "dirty": false
  },
  "node": {
    "version": "v22.14.0",
    "platform": "linux-x64"
  },
  "host": {
    "os": "Ubuntu 24.04 LTS",
    "kernel": "6.8.0",
    "cpu": "AMD EPYC 7763 64-Core",
    "ram_gb": 128,
    "gpus": [
      {
        "name": "NVIDIA A100 80GB PCIe",
        "driver": "550.54.15",
        "cuda": "12.4",
        "memory_gb": 80
      }
    ]
  },
  "inferenceServer": {
    "kind": "vllm",
    "version": "0.6.3",
    "model": {
      "id": "Qwen/Qwen2.5-Coder-7B-Instruct",
      "revision": "<huggingface_commit_sha>",
      "quantization": "none",
      "max_context": 32768
    },
    "args": "--gpu-memory-utilization 0.9 --max-model-len 32768"
  },
  "codragraph": {
    "version": "0.1.0",
    "graph_snapshot_id": "sha256:def456...",
    "indexed_repo_sha": "abc123...",
    "harness_recipe_id": "graph-aware-rerank-v3"
  },
  "workload": {
    "id": "codebase-qa",
    "version": "v1",
    "task_count": 105,
    "split": "test (tasks 81–105)"
  },
  "seeds": [42, 1337, 8675309],
  "providers": {
    "judge": {
      "name": "claude-haiku-4-5-20251001",
      "endpoint": "https://api.anthropic.com"
    }
  }
}
```

## Pinned model versions

**Anthropic / OpenAI** — pin the dated model id (`claude-haiku-4-5-20251001`, not `claude-haiku-latest`). Anthropic and OpenAI route `latest` to whatever they've deployed; pinned ids stay stable longer.

**HuggingFace** — pin to the model's commit SHA on the Hub. The `inferenceServer.model.revision` field captures it. vLLM accepts `--revision <sha>` to force the load.

**Quantizations** — Q4_K_M, Q5_K_M, AWQ-int4 are not deterministic across producer tools. Always note WHO produced the GGUF/AWQ file (e.g., `bartowski/Qwen2.5-Coder-7B-Instruct-GGUF`, `Qwen/Qwen2.5-Coder-7B-Instruct-AWQ`). Different quants of the same model can be 1–3 pts apart on accuracy.

## Seeds

Every run uses three seeds: `42`, `1337`, `8675309`. Documented seed-set means re-runs are deterministic per (provider, model, sampling-config).

Caveats:
- **Closed-API providers don't honor seeds reliably.** Anthropic and OpenAI document seed support but the underlying inference cluster routing makes runs non-deterministic in practice. Treat closed-API runs as noisy; rely on the 3-run mean.
- **vLLM honors seed** for greedy decoding (`temperature=0`). For non-zero temperature, vLLM's seed maps to its sampler; deterministic if `--enforce-eager` is set.
- **Ollama** — same as vLLM caveat.
- **TGI** — supports `seed` in the request body.

## Repository state

Every benchmark run captures:
- The thinqmesh-codra repo SHA
- Whether the working tree was dirty (uncommitted changes)
- The indexed target repo SHA (the repo we ran codragraph against, e.g. codragraph itself when self-benchmarking)

Dirty runs are marked. They're not invalid, but they can't be perfectly reproduced.

## Graph snapshot pinning

When Phase 4 ships:
- The graph state used by a benchmark run is a content-addressed snapshot (`graph_snapshot_id`).
- The snapshot is durable — re-runs against the same snapshot get the same retrieval results.
- Recipe cache is keyed off the snapshot id, so `codragraph-recipe-cached` treatment is deterministic per snapshot.

## Workload versioning

`workloads/<id>.json` files are versioned. The 105-task Codebase Q&A is `v1`. Any change → bump version (e.g. `v1.1` for additions, `v2` for breaking changes). Old runs against `v1` stay valid; new runs against `v2` are incomparable to v1 numbers without a re-baseline.

## Reproducing a run from `env.json`

```bash
# 1. Provision matching hardware (or document the difference)
#    → see env.json's host section

# 2. Check out the same repo SHA
git checkout abc123

# 3. Boot the same inference server with the same args
docker compose up -d vllm
#    (env.json's inferenceServer block has the model id, revision, args)

# 4. Re-index against the same target repo SHA
cd /workspace/repo && git checkout def456
docker compose run --rm codragraph npx codragraph analyze .

# 5. (Phase 4) Restore the graph snapshot
docker compose run --rm codragraph npx codragraph checkout sha256:def456...

# 6. Re-run with the same seeds
cd Benchmarking/scripts
npm run benchmark -- --env-file ../results/<run-id>/env.json --reproduce
```

The `--reproduce` flag tells the runner to mirror every captured detail and refuse to start if there's a drift it can't satisfy (e.g. wrong model loaded, dirty repo, mismatched workload version).

## What we DON'T pin

- **Cloud provider availability.** A100 capacity disappears regularly on RunPod / Lambda. Reproductions may need a different provider.
- **Hugging Face Hub URL liveness.** If a model is removed from the Hub, the benchmark can't run. Mirror critical model files to your own S3/GCS for long-term reproducibility.
- **Closed-API price/performance.** Anthropic and OpenAI change pricing and model performance silently. Numbers from 6 months ago may not match today's runs against the "same" model id.

## Data we keep durably

- `results/` directory in this repo (gitignored except for representative outputs)
- For headline-claim runs only: copies pushed to a cold-storage S3 bucket (post-launch)

## Soft commitments

- Headline claims in marketing copy must link to a `results/<id>/` folder containing the env.json + summary.json that produced the number.
- Major version bumps to codragraph-harness or codragraph-graphstore trigger a re-benchmark before release.
- The "60–85% token reduction" claim is a hypothesis until at least 3 (model × workload) cells in the matrix have published results in this folder.
