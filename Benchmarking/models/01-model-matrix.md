# Model Matrix

The models we benchmark, why each is in the matrix, and which hardware tier they need.

## The matrix

We benchmark 5 model "tiers" × 2 categories (open + closed-source). Each cell is one published number.

| Tier | Open-source representative | Closed representative |
|---|---|---|
| **Tiny** (1–4B) | Qwen2.5-Coder-1.5B-Instruct, Llama-3.2-3B-Instruct | Claude Haiku 4.5 |
| **Small** (7–9B) | Qwen2.5-Coder-7B-Instruct, DeepSeek-Coder-V2-Lite (16B MoE / 2.4B active) | GPT-4o-mini-2024-07-18 |
| **Mid** (13–34B) | Qwen2.5-Coder-32B-Instruct (AWQ), Codestral-22B | Claude Sonnet 4.6 |
| **Large** (70B) | Llama-3.3-70B-Instruct (AWQ), DeepSeek-Coder-V2 (236B MoE / 21B active) | GPT-4o-2024-11-20, Claude Opus 4.7 |
| **Frontier** (GPT-5+ class) | — (no open peer yet) | GPT-5.5, Claude Sonnet 5 (when available) |

Closed-source models are documented for reference; running them costs API tokens. Open-source models can be self-hosted on rented GPU.

## Why each model is in the matrix

### Qwen2.5-Coder family (1.5B / 7B / 32B)
The open coding model gold standard as of 2026-04. Strong instruction-following, good MCP/tool-use behavior, available in tight quantizations. Three sizes lets us test the "smaller models punch above their weight" thesis at every scale.

### Llama-3.2-3B / Llama-3.3-70B
General-purpose open models. Llama-3.2-3B is the floor (smallest viable for codebase Q&A). Llama-3.3-70B is the flagship-class open peer to GPT-4o.

### DeepSeek-Coder-V2 (Lite + Full)
Best cost-effective open coding family. The Lite (16B MoE / 2.4B active) is incredibly cheap to serve. The full V2 (236B MoE) is for if you have an A100-80GB cluster.

### Codestral-22B
Mistral's coding model. Useful as a "neither Qwen nor Llama" data point in the mid tier.

### Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.7
The Anthropic family. Haiku is the smaller-model-with-rich-context proof point: with codragraph's stack, Haiku should hit Sonnet-class accuracy on routine code tasks at ~10× cheaper.

### GPT-4o-mini / GPT-4o / GPT-5.x
The OpenAI family. Same use as Anthropic — small/big pair lets us verify the "smaller flagship-tier" claim across model families.

## Pinned ids (use these EXACTLY for reproducibility)

```yaml
# models.yaml (read by Benchmarking/scripts/run-benchmark.ts)

models:
  qwen-coder-1_5b:
    provider: vllm
    id: Qwen/Qwen2.5-Coder-1.5B-Instruct
    revision: <sha>
    quantization: none
    max_context: 32768

  qwen-coder-7b:
    provider: vllm
    id: Qwen/Qwen2.5-Coder-7B-Instruct
    revision: <sha>
    quantization: none
    max_context: 32768

  qwen-coder-7b-awq:
    provider: vllm
    id: Qwen/Qwen2.5-Coder-7B-Instruct-AWQ
    revision: <sha>
    quantization: awq
    max_context: 32768

  qwen-coder-32b-awq:
    provider: vllm
    id: Qwen/Qwen2.5-Coder-32B-Instruct-AWQ
    revision: <sha>
    quantization: awq
    max_context: 32768

  llama-3_2-3b:
    provider: vllm
    id: meta-llama/Llama-3.2-3B-Instruct
    revision: <sha>
    quantization: none
    max_context: 131072

  llama-3_3-70b-awq:
    provider: vllm
    id: hugging-quants/Meta-Llama-3.3-70B-Instruct-AWQ-INT4
    revision: <sha>
    quantization: awq
    max_context: 131072

  deepseek-coder-v2-lite:
    provider: vllm
    id: deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct
    revision: <sha>
    quantization: none
    max_context: 163840

  codestral-22b:
    provider: vllm
    id: mistralai/Codestral-22B-v0.1
    revision: <sha>
    quantization: none
    max_context: 32768

  claude-haiku:
    provider: anthropic
    id: claude-haiku-4-5-20251001
    quantization: none
    max_context: 200000

  claude-sonnet:
    provider: anthropic
    id: claude-sonnet-4-6
    quantization: none
    max_context: 200000

  claude-opus:
    provider: anthropic
    id: claude-opus-4-7
    quantization: none
    max_context: 200000

  gpt-4o-mini:
    provider: openai
    id: gpt-4o-mini-2024-07-18
    quantization: none
    max_context: 128000

  gpt-4o:
    provider: openai
    id: gpt-4o-2024-11-20
    quantization: none
    max_context: 128000

  gpt-5_5:
    provider: openai
    id: gpt-5-5  # placeholder; pin exact dated id once GPT-5.5 ships
    quantization: none
    max_context: 200000
```

The `<sha>` placeholders need to be filled in from each model's HuggingFace "Files and versions" page. Pin once before each headline run.

## Hardware → model fit cheat sheet

| GPU | Comfortable model |
|---|---|
| RTX 3060 12GB | Qwen-Coder 1.5B / 7B-AWQ; Llama-3.2-3B |
| RTX 4090 24GB | Qwen-Coder 7B-FP16 / 32B-AWQ (tight); Llama-3.3-70B-AWQ-INT4 (just barely) |
| A100 40GB | All of above + Qwen-Coder 32B-FP16; Codestral-22B; DeepSeek-Coder-V2-Lite |
| A100 80GB | All of above + Llama-3.3-70B-AWQ comfortably; DeepSeek-V2 (full, MoE active fits) |
| H100 80GB | Same as A100-80, but ~2× faster |

## Running the matrix

```bash
# Open-source tier — needs GPU
docker compose up -d vllm  # picks model from .env
npm run benchmark -- --models qwen-coder-7b ...

# Closed-source tier — needs API keys, no GPU
ANTHROPIC_API_KEY=sk-... \
OPENAI_API_KEY=sk-... \
npm run benchmark -- --models claude-haiku,gpt-4o-mini ...
```

The bench script switches inference providers per model.

## Why we DON'T benchmark some models

| Model | Why excluded |
|---|---|
| Code Llama (any size) | Superseded by Qwen-Coder and DeepSeek-Coder; weaker on instruction following |
| StarCoder2 | Older; no longer competitive at the same size |
| GPT-3.5 | EOL'd; not a current target |
| Phi-3 | General-purpose, weaker on code-specific tasks; included only for tiny tier if needed |
| Gemini Pro / Ultra | Their MCP / tool-use support is in flux at the time of writing; we'll add Gemini once it stabilizes |

## Honest comparison limits

- **Different families have different prompt-template assumptions.** Qwen-Coder uses ChatML; Llama uses Llama-3 chat template. The bench script handles templating per provider; we trust the provider's tokenizer to format correctly.
- **Closed-API models can't be quantized.** Their cost picture is per-token; their accuracy can't be tuned by quant choice.
- **MoE models (DeepSeek-V2, Mixtral) have inconsistent memory profiles.** Active params determine speed; total params determine VRAM.
- **Frontier models change underneath us.** GPT-4o-2024-11-20 today is not GPT-4o-2024-11-20 in 6 months. The dated id is the best we can do; some drift is unavoidable.
