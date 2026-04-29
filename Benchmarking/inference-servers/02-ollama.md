# Ollama — Easy-Start Inference Server

Ollama is the lowest-friction way to serve a code LLM locally. Not the fastest, not the most flexible — but you can be running benchmarks in 5 minutes.

## When to pick Ollama over vLLM

- **You're iterating** — Ollama starts in seconds; vLLM in minutes
- **You want CPU fallback** — Ollama runs CPU-only when GPU is busy/missing
- **You're on a small GPU** (8–12 GB) — Ollama loads quantized GGUF models efficiently
- **You're on Windows + WSL2** — Ollama installs more cleanly than vLLM

## When to pick vLLM instead

- **Final benchmark sweep** — vLLM has 2–4× the throughput
- **Multi-tenant or concurrent benchmarks** — Ollama is single-stream
- **You need AWQ/GPTQ/FP8** — Ollama is GGUF-only
- **You need long contexts (>32k)** — vLLM handles this better

## Install

### Linux / WSL2

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### macOS

```bash
brew install ollama
```

### Windows native

Download from ollama.com. Note: **prefer WSL2 + Linux install** for benchmarking. Native Windows Ollama works but isolation is awkward.

## Pull a model

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:32b      # ~20 GB; needs 24+ GB VRAM
ollama pull deepseek-coder-v2:16b  # MoE; ~10 GB active
ollama pull llama3.3:70b           # ~40 GB; needs 48+ GB VRAM
```

The `:7b` `:32b` etc. tags map to specific quantizations Ollama selects (usually Q4_K_M). To pin an exact quant:

```bash
ollama pull qwen2.5-coder:7b-instruct-q5_K_M
```

## Run

Ollama auto-starts a server on `localhost:11434`:

```bash
ollama serve  # if not already running

# Verify
curl http://localhost:11434/api/tags
# Lists pulled models
```

## OpenAI compatibility

Ollama exposes an OpenAI-compatible endpoint at `http://localhost:11434/v1`:

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder:7b",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 50
  }'
```

This means codragraph-harness's `OpenAIInferenceProvider` works directly.

## Wiring to codragraph-harness

```ts
import { OpenAIInferenceProvider } from "codragraph-harness/inference";

const inference = new OpenAIInferenceProvider({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",  // ignored; client requires non-empty
  defaultModel: "qwen2.5-coder:7b",
});
```

For the bench CLI:

```bash
npm run benchmark -- \
  --inference openai \
  --inference-base-url http://localhost:11434/v1 \
  --model qwen2.5-coder:7b \
  ...
```

## Performance tuning

Ollama is single-stream by default. For our benchmarks (which fire many requests), this is the bottleneck.

```bash
# Allow concurrent requests
export OLLAMA_NUM_PARALLEL=4

# Allow more KV cache
export OLLAMA_KV_CACHE_TYPE=q8_0  # quantized KV; saves memory
export OLLAMA_FLASH_ATTENTION=1   # faster attention

# Restart
ollama serve
```

Concrete tradeoff: `OLLAMA_NUM_PARALLEL=4` quadruples throughput but quadruples KV memory. On a 24 GB card running a 7B model, you have headroom; on 12 GB, leave it at 1.

## Quantization choice

GGUF formats Ollama selects (in order of size, larger = more accurate):

- `q3_K_M` — smallest; meaningful quality drop
- `q4_K_M` — default; ~95% quality of FP16
- `q5_K_M` — 97–98% quality; ~25% bigger
- `q6_K` — 99% quality
- `q8_0` — basically FP16; same memory as FP16

For benchmark consistency, **always use the same quant tier across models** (recommend Q5_K_M for 7B-class, Q4_K_M for 32B+). Document in the workload's `env.json`.

## Health check

```bash
curl http://localhost:11434/api/tags
# Lists models
curl http://localhost:11434/api/show -d '{"name": "qwen2.5-coder:7b"}'
# Model details (quant, parameters)
```

## Limits / pitfalls

- **No tensor parallelism.** A 70B model on Ollama runs on ONE GPU; you can't split across GPUs. Use vLLM or llama.cpp's `--main-gpu` workaround for that.
- **Single-stream by default.** Set `OLLAMA_NUM_PARALLEL` to enable concurrency.
- **KV cache resets between conversations** unless you reuse the `context` parameter. Our harness does NOT reuse context across tasks (each task is independent), so this is fine.
- **No fine-grained control over sampling.** Ollama exposes `temperature`, `top_p`, `top_k`, `seed`, and stop sequences. That's enough for our benchmarks but less than vLLM's full sampling param surface.

## Quick benchmark sanity check

After pulling a model and starting the server:

```bash
cd Benchmarking/scripts
npm run benchmark -- \
  --workload codebase-qa \
  --treatments baseline-grep \
  --models qwen-coder-7b-ollama \
  --runs 1 \
  --tasks 5 \                  # only first 5 tasks; ~30 sec total
  --output ./results/smoke-test/
```

If that completes and writes a `results/smoke-test/run.json`, your setup is healthy. Now run the full sweep.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Error: model X not found` | `ollama pull X` first |
| Throughput is single-stream regardless of OLLAMA_NUM_PARALLEL | Confirm env var is set in the SAME shell that started `ollama serve` |
| GPU not used (CPU 100%) | Check `ollama serve` logs for "GPU" mention; if missing, driver / CUDA broken |
| OOM on big quants | Try smaller quant (`q4_K_M` instead of `q5_K_M`) or smaller model |
| 50% speed of expected | Probably model is partially CPU-offloaded. Check `nvidia-smi` during inference. |
