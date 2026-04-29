# llama.cpp — CPU + GPU Hybrid

For when you don't have enough VRAM and need to offload some layers to CPU. Slower than vLLM/TGI but works on hardware they refuse to load.

## When to pick llama.cpp

- **Tight VRAM** (8–12 GB) and want to run a 13B or 32B model
- **CPU-only** server (no GPU at all)
- **You need exotic quantization** — Q3_K_S, IQ2_XXS, etc.
- **Mac M-series** — llama.cpp has Metal acceleration; vLLM doesn't run on Mac

## When NOT to use llama.cpp for benchmarking

- **Final headline numbers** — speed varies wildly with offload split. vLLM is the apples-to-apples target.
- **Concurrent benchmarks** — llama.cpp's `-np` (parallel) feature is less mature than vLLM's continuous batching

## Install

```bash
# Linux / WSL2 / macOS — build from source for best perf
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make GGML_CUDA=1  # for NVIDIA; use METAL=1 for Mac
```

Or pre-built Docker:

```bash
docker pull ghcr.io/ggerganov/llama.cpp:server-cuda
```

## Get a GGUF model

llama.cpp uses the GGUF format. Most popular models have GGUF versions on HuggingFace:

```bash
# Use huggingface-cli to download
pip install huggingface_hub
huggingface-cli download \
  bartowski/Qwen2.5-Coder-7B-Instruct-GGUF \
  Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf \
  --local-dir ./models
```

Common GGUF quants for benchmarking:

| Quant | Size (7B) | Quality | Speed |
|---|---|---|---|
| Q8_0 | 7.7 GB | Near-FP16 | Fast (best for "small enough to fit FP-equivalent") |
| Q5_K_M | 5.0 GB | 97–98% | Fast |
| Q4_K_M | 4.4 GB | 95–96% | Fastest |
| Q3_K_M | 3.7 GB | 90–93% | Fast |
| IQ2_XS | 2.4 GB | 85–88% | Slower (more compute per token to dequantize) |

**Recommendation for our bench:** Q5_K_M for the 7B tier; Q4_K_M for 32B+.

## Run the server

```bash
./llama-server \
  --model ./models/Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf \
  --port 8080 \
  --host 0.0.0.0 \
  --ctx-size 32768 \
  --n-gpu-layers 999 \         # offload all to GPU; reduce if VRAM-constrained
  --threads 8 \                 # CPU threads for non-offloaded layers
  --parallel 4                  # concurrent slots
```

`--n-gpu-layers 999` means "offload everything possible". If OOM:

```bash
# Try lower offload — keep some layers on CPU
./llama-server ... --n-gpu-layers 28 ...
# or for a 7B with 32 layers, 28 = mostly GPU
```

## OpenAI compatibility

llama.cpp's server has an OpenAI-compatible endpoint:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "test"}],
    "max_tokens": 50
  }'
```

`model` field is ignored. The loaded model is implicit.

## Wiring to codragraph-harness

```ts
const inference = new OpenAIInferenceProvider({
  baseURL: "http://localhost:8080/v1",
  apiKey: "llamacpp",
  defaultModel: "ignored",
});
```

## Performance characteristics

On RTX 4090 24GB, Qwen2.5-Coder-7B Q5_K_M, all-on-GPU:
- ~80 tok/s single-stream
- ~250 tok/s aggregate (4 concurrent)

Same model on RTX 3060 12GB with 28/32 layers GPU + 4 layers CPU:
- ~25 tok/s single-stream
- ~50 tok/s aggregate (4 concurrent)

The CPU offload halves throughput for each layer left on CPU. Avoid offload if you can fit fully on GPU.

## Mac M-series

```bash
make METAL=1
./llama-server --model ... --port 8080 --ctx-size 32768
```

Metal acceleration is fast on M2 Pro / Max / Ultra. Ballpark: M2 Max 96GB runs Qwen2.5-Coder-32B Q4 at ~25 tok/s.

## When to combine llama.cpp with cloud GPU

If your local GPU is small but you have a powerful CPU and lots of RAM, the offload-friendly llama.cpp lets you run mid-size models you couldn't otherwise. But for benchmarks you actually want to publish, **rent a cloud GPU** (`hardware/02-cloud-providers.md`) and use vLLM. Reproducibility and apples-to-apples comparisons are easier.

## Health check

```bash
curl http://localhost:8080/health
curl http://localhost:8080/props  # model + sampler config
```

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `failed to load model` | GGUF file corrupt or wrong format | Re-download; verify SHA |
| `cuBLAS error: out of memory` | `--n-gpu-layers` too high | Lower offload count |
| Server slow even with `--parallel 4` | GPU layers exhausted; layers spilling to CPU | Use a smaller quant or smaller model |
| Different output every run with same seed | Sampler config mismatch — set `--temperature 0 --seed 42` |
