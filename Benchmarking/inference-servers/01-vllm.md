# vLLM — Production-Grade Inference Server

vLLM is the recommended inference server for our benchmarks. Highest throughput, OpenAI-compatible endpoint, broad model support, well-maintained.

## Why vLLM

- **OpenAI-compatible**: codragraph-harness's `OpenAIInferenceProvider` works as-is by setting `baseURL` to vLLM's endpoint
- **PagedAttention**: 2–4× higher throughput than naive transformer serving
- **Continuous batching**: requests don't wait — they get scheduled into in-flight batches
- **Quantization native**: AWQ, GPTQ, FP8 supported out of the box
- **Tensor parallelism**: scale to multiple GPUs without changing code

## Quick start (Docker)

The `Benchmarking/docker/docker-compose.yaml` uses vLLM by default. To run standalone:

```bash
docker run --gpus all -d \
  --name vllm \
  -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -e HUGGING_FACE_HUB_TOKEN=hf_xxx \
  vllm/vllm-openai:latest \
    --model Qwen/Qwen2.5-Coder-7B-Instruct \
    --gpu-memory-utilization 0.9 \
    --max-model-len 32768
```

That's it. After ~2–3 min, `curl http://localhost:8000/v1/models` returns the loaded model.

## Native install (without Docker)

```bash
# Inside a fresh venv
pip install vllm

# Run server
vllm serve Qwen/Qwen2.5-Coder-7B-Instruct \
  --gpu-memory-utilization 0.9 \
  --max-model-len 32768 \
  --port 8000
```

Requires CUDA 12.1+, PyTorch 2.4+. Pip handles dependencies.

## Pinning to a specific model revision

For reproducibility (see `REPRODUCIBILITY.md`), pin to a HuggingFace commit SHA:

```bash
docker run ... vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-Coder-7B-Instruct \
  --revision 7c8e6c7e9c8b6e5e4f3d2c1b0a9e8d7c6b5a4938  # example sha
```

Look up SHAs on HuggingFace's "Files and versions" tab.

## Memory tuning per model size

| Model | GPU | VLLM args |
|---|---|---|
| Qwen2.5-Coder-1.5B | RTX 3060 12GB | `--gpu-memory-utilization 0.85 --max-model-len 16384` |
| Qwen2.5-Coder-7B (FP16) | RTX 4090 24GB | `--gpu-memory-utilization 0.9 --max-model-len 32768` |
| Qwen2.5-Coder-7B (AWQ) | RTX 4060 Ti 16GB | `--quantization awq --gpu-memory-utilization 0.9 --max-model-len 16384` |
| Qwen2.5-Coder-32B (AWQ) | RTX 4090 24GB | `--quantization awq --gpu-memory-utilization 0.92 --max-model-len 8192` |
| Qwen2.5-Coder-32B (FP16) | A100 80GB | `--gpu-memory-utilization 0.9 --max-model-len 32768` |
| Llama-3.3-70B (Q4 / GPTQ) | A100 80GB | `--quantization gptq --gpu-memory-utilization 0.92 --max-model-len 8192` |
| Llama-3.3-70B (FP16) | 2× A100 80GB | `--tensor-parallel-size 2 --gpu-memory-utilization 0.9 --max-model-len 16384` |

If you OOM on startup, lower `--gpu-memory-utilization` (try 0.85, 0.8) or `--max-model-len`.

## Wiring to codragraph-harness

vLLM exposes an OpenAI-compatible `/v1/chat/completions` endpoint. The `OpenAIInferenceProvider` in `codragraph-harness/src/inference/openai.ts` works directly:

```ts
import { OpenAIInferenceProvider } from "codragraph-harness/inference";

const inference = new OpenAIInferenceProvider({
  baseURL: "http://localhost:8000/v1",
  apiKey: "EMPTY",  // vLLM doesn't enforce; required by OpenAI client
  defaultModel: "Qwen/Qwen2.5-Coder-7B-Instruct",
});
```

Or use the `OpenCodeInferenceProvider` which is preconfigured for self-hosted OpenAI-compatible servers.

For the bench CLI:

```bash
npm run benchmark -- \
  --inference openai \
  --inference-base-url http://localhost:8000/v1 \
  --model Qwen/Qwen2.5-Coder-7B-Instruct \
  ...
```

## Throughput tuning

For benchmark sweeps, you want HIGH concurrent throughput.

```bash
docker run ... vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-Coder-7B-Instruct \
  --gpu-memory-utilization 0.9 \
  --max-model-len 32768 \
  --max-num-seqs 64 \         # max concurrent requests
  --max-num-batched-tokens 8192  # tokens per iteration; tune for KV cache
```

`--max-num-seqs 64` is generally fine on A100 80GB for 7B models. Drop to 16–32 for tight VRAM scenarios. Higher = more parallelism = better sweep throughput.

## Tensor parallelism (multi-GPU)

For models that don't fit on one GPU:

```bash
docker run --gpus all ... vllm/vllm-openai:latest \
  --model meta-llama/Llama-3.3-70B-Instruct \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.9
```

Set `--tensor-parallel-size` to the number of GPUs. vLLM handles the rest.

## Quantization

| Format | When | vLLM arg |
|---|---|---|
| **AWQ** | Best quality at int4. Pre-quantized models on HF. | `--quantization awq` |
| **GPTQ** | Older but widely available pre-quantized. | `--quantization gptq` |
| **FP8** | H100 only. Near-FP16 quality, half memory. | `--quantization fp8` |
| **GGUF (Q4_K_M etc.)** | NOT supported in vLLM. Use llama.cpp / Ollama. | — |

If a model only ships in FP16, you can quantize-on-load with bitsandbytes:

```bash
docker run ... vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-Coder-32B-Instruct \
  --quantization bitsandbytes \
  --load-format bitsandbytes
```

Slower load, lower memory. AWQ is preferred when available.

## Logging / observability

```bash
docker run ... vllm/vllm-openai:latest \
  --enable-prefix-caching \           # speeds up prompt-shared workloads (huge win for our harness)
  --disable-log-requests              # quieter logs; remove for debugging
```

`--enable-prefix-caching` is a **big win** for the harness layer: many of the swarm's proposals share a long preamble (the contract + recommended-reading section). vLLM caches the KV state for shared prefixes — repeat calls with the same prefix are 30–60% faster.

## Health check

```bash
# Is it alive?
curl http://localhost:8000/health

# Loaded models
curl http://localhost:8000/v1/models

# Quick completion
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-Coder-7B-Instruct",
    "messages": [{"role": "user", "content": "Write a single-line haiku."}],
    "max_tokens": 30,
    "temperature": 0
  }'
```

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `torch.cuda.OutOfMemoryError` at startup | `--gpu-memory-utilization` too high or model too big | Lower to 0.85; check `models/01-model-matrix.md` for fit |
| `ImportError: libcuda.so.1: cannot open shared object` | Container doesn't see GPU | Check `nvidia-ctk runtime configure --runtime=docker`; use `--gpus all` |
| `403 Forbidden` from HuggingFace | Model gated, no token | Set `HUGGING_FACE_HUB_TOKEN` env var |
| Throughput drops after long runs | KV cache fragmentation | Restart vLLM between long sweeps |
| Crashes after ~hours of uptime | Driver / kernel mismatch on host | `nvidia-smi` post-crash; check dmesg |

## Performance expectations

On A100 80GB, Qwen2.5-Coder-7B-Instruct:
- ~140 tokens/sec single-stream
- ~2,500 tokens/sec aggregate (16 concurrent streams)
- Loading time: ~30 sec from disk; ~3 min if downloading

On RTX 4090, Qwen2.5-Coder-7B AWQ:
- ~90 tokens/sec single-stream
- ~700 tokens/sec aggregate (8 concurrent)

These are ballpark; actual numbers depend on prompt length, output length, and KV cache pressure. Real benchmark numbers go in `results/`.
