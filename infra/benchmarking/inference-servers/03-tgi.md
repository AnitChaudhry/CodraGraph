# Text Generation Inference (TGI) — HuggingFace's Server

TGI is HuggingFace's production inference server. Comparable to vLLM in feature set; sometimes wins on specific model architectures.

## When to pick TGI over vLLM

- **Specific model architectures TGI supports better** (some Mistral / Mixtral configs)
- **You're already on HuggingFace's stack** — TGI integrates cleanly with HF Inference Endpoints
- **You want the official HuggingFace tooling** for guardrails, safe-tensors loading, etc.

For our benchmark sweep, vLLM is generally faster on the models we use. TGI is documented here as an alternative if vLLM has trouble loading a specific model.

## Install (Docker, recommended)

```bash
docker run --gpus all -d \
  --name tgi \
  -p 8080:80 \
  -v ~/data:/data \
  -e HUGGING_FACE_HUB_TOKEN=hf_xxx \
  ghcr.io/huggingface/text-generation-inference:2.4 \
    --model-id Qwen/Qwen2.5-Coder-7B-Instruct \
    --max-input-tokens 16384 \
    --max-total-tokens 32768
```

Note the port is `8080` by default (vLLM uses `8000`).

## OpenAI compatibility

TGI's OpenAI-compatible endpoint is at `/v1/chat/completions`:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tgi",
    "messages": [{"role": "user", "content": "Test"}],
    "max_tokens": 50
  }'
```

The `model` field is ignored — TGI serves whichever model was loaded at startup.

## Wiring to packages/harness

```ts
const inference = new OpenAIInferenceProvider({
  baseURL: "http://localhost:8080/v1",
  apiKey: "tgi",
  defaultModel: "tgi",  // model field is ignored by TGI
});
```

## Quantization

TGI supports:
- **bitsandbytes** (`--quantize bitsandbytes` or `--quantize bitsandbytes-nf4`)
- **GPTQ** (`--quantize gptq` — model must be pre-quantized on HF)
- **AWQ** (`--quantize awq`)
- **EETQ** (`--quantize eetq` — TGI-native)

```bash
docker run ... ghcr.io/huggingface/text-generation-inference:2.4 \
  --model-id TheBloke/Qwen2.5-Coder-32B-Instruct-AWQ \
  --quantize awq
```

## Tensor parallelism

```bash
docker run --gpus '"device=0,1"' ... ghcr.io/huggingface/text-generation-inference:2.4 \
  --model-id meta-llama/Llama-3.3-70B-Instruct \
  --num-shard 2
```

`--num-shard` = number of GPUs to split across.

## Throughput tuning

```bash
docker run ... ghcr.io/huggingface/text-generation-inference:2.4 \
  --model-id Qwen/Qwen2.5-Coder-7B-Instruct \
  --max-input-tokens 16384 \
  --max-total-tokens 32768 \
  --max-batch-prefill-tokens 8192 \
  --max-concurrent-requests 64 \
  --waiting-served-ratio 1.2
```

`--max-concurrent-requests 64` allows 64 in-flight at once. Tune to your VRAM.

## Performance vs vLLM (rough)

On A100 80GB, 7B model:

- TGI single-stream: ~120 tok/s
- vLLM single-stream: ~140 tok/s
- TGI 16-concurrent aggregate: ~2,000 tok/s
- vLLM 16-concurrent aggregate: ~2,500 tok/s

vLLM wins by ~15–25% on most workloads. TGI catches up on specific model+quant combos.

## Health check

```bash
curl http://localhost:8080/health
curl http://localhost:8080/info
# Returns model id, quantization, device info
```

## When you'd use TGI

We'd use TGI if:
1. A model loads in TGI but fails in vLLM (rare, but happens with new architectures)
2. We want to run on HuggingFace Inference Endpoints (TGI is the engine there)
3. We want EETQ quantization specifically (TGI-only)

For our default sweep, vLLM is the call.
