# Quantization Guide

When you can't fit the FP16 model on your GPU, quantization shrinks the weights at minor accuracy cost. Here's how to pick.

## TL;DR

- **AWQ-int4** for vLLM/TGI — best quality at 4-bit, fast inference
- **Q5_K_M GGUF** for llama.cpp/Ollama — sweet spot for 7B-class
- **Q4_K_M GGUF** for llama.cpp when memory is tight
- **GPTQ-int4** if AWQ isn't available for your model
- **FP8** on H100 only — near-FP16 quality, half memory
- **Q8 / FP16** when you have headroom — for headline numbers

## Quantization formats

### AWQ (Activation-aware Weight Quantization)
4-bit, vLLM/TGI native. Lower perplexity than naive int4 because AWQ preserves the most-activation-correlated weights at higher precision.

- Files: usually one big `.safetensors` per model on HuggingFace
- Run: `--quantization awq` in vLLM/TGI
- Quality: ~98% of FP16 perplexity for 7B+; ~96% for 1B–3B
- Speed: similar to FP16 on A100; 2× faster than GPTQ

### GPTQ (post-training)
4-bit, older but widely available. Slightly lower quality than AWQ at same bitwidth.

- Files: `.safetensors` with GPTQ metadata
- Run: `--quantization gptq` in vLLM/TGI
- Quality: ~96% of FP16 perplexity
- Speed: slower than AWQ in vLLM; comparable in some configs

### GGUF (llama.cpp's native format)
Fine-grained quantizations. Most flexible.

| Quant | Bits/weight (effective) | Quality vs FP16 | When |
|---|---|---|---|
| Q8_0 | 8.5 | 99.5% | Want near-FP16, not as much memory savings |
| Q6_K | 6.6 | 99% | Better than Q5, smaller than Q8 |
| Q5_K_M | 5.7 | 97–98% | Sweet spot for 7B-class |
| Q5_K_S | 5.5 | 97% | Slightly smaller than Q5_K_M |
| Q4_K_M | 4.85 | 95–96% | Default for most use cases |
| Q4_K_S | 4.6 | 94–95% | Slightly smaller than Q4_K_M |
| Q3_K_M | 3.91 | 90–93% | Tight memory; visible quality drop |
| Q3_K_S | 3.5 | 88–91% | Real quality drop |
| IQ4_XS | 4.25 | 95% | Newer quantization, good quality at low bits |
| IQ3_XS / IQ2_S | 3.0 / 2.3 | 85–90% | Fits big models on small GPUs; usable but lossy |

### FP8 (E4M3 or E5M2)
8-bit floating point, native on H100. Roughly half the memory of FP16, ~99% the quality.

- Run: `--quantization fp8` in vLLM
- Hardware: H100 only (Ampere A100 doesn't support FP8 acceleration)
- Quality: indistinguishable from FP16 in practice

### bitsandbytes (NF4 / 8-bit)
Quantize-on-load via the bitsandbytes library. Convenient but slower than pre-quantized formats.

- Run: `--quantization bitsandbytes` in vLLM/TGI
- Quality: NF4 is ~95% of FP16; 8-bit is ~99%
- Speed: 30–50% slower than AWQ at same bitwidth (due to dequant overhead)
- When: a model only ships in FP16 on HF and there's no AWQ/GPTQ version

## Model size → quantization choice

### 1.5B–3B
Don't quantize. They fit at FP16 in ~3–7 GB. Quantization gain is marginal; quality cost is real.

### 7B
- **24 GB GPU**: FP16 (use the full thing)
- **16 GB GPU**: AWQ or Q5_K_M
- **12 GB GPU**: Q4_K_M
- **8 GB GPU**: IQ4_XS

### 13B
- **40 GB GPU**: FP16
- **24 GB GPU**: AWQ
- **16 GB GPU**: Q4_K_M
- **<16 GB**: Q3_K_M (visible quality drop)

### 32B
- **80 GB GPU**: FP16
- **40 GB GPU**: AWQ or Q5_K_M
- **24 GB GPU**: Q4_K_M (tight; lower context)
- **<24 GB**: skip; too small

### 70B
- **2× 80 GB GPU**: FP16 with tensor parallelism
- **80 GB GPU**: AWQ or GPTQ-int4
- **48 GB GPU**: Q4_K_M (tight)
- **<48 GB**: IQ3_M or skip

## Reproducibility implications

**Different quantizations of the same model are NOT the same model for benchmarking purposes.**

If your headline number says "Qwen2.5-Coder-7B at 73% token reduction", the env.json must say which quantization. A headline that compares "Qwen-Coder-7B AWQ" against "Claude Haiku" is fair. A headline that mixes "Qwen-Coder-7B Q3_K_M" (lossy) against "Claude Haiku FP-equivalent" is misleading.

**Recommendation:** for the headline benchmark sweep, use these consistent quants:

| Tier | Quant |
|---|---|
| Tiny (≤3B) | FP16 |
| Small (7B) | AWQ if vLLM, else Q5_K_M |
| Mid (32B) | AWQ if vLLM, else Q4_K_M |
| Large (70B) | AWQ-INT4 |

This gives a fair comparison. Document the choice in `env.json`.

## Speed vs quality tradeoff

Roughly, every step DOWN in quantization (Q5 → Q4 → Q3):
- Saves ~25% memory
- Adds ~5–10% inference speed (less dequant work? actually slightly slower for some quants — depends on hardware)
- Costs ~1–3 perplexity points

For benchmark fidelity, **never go below Q4_K_M** unless you're explicitly studying low-bit quantization effects.

## Pre-quantized model hubs to know

- **Bartowski** (HF user) — high-quality GGUFs across many models
- **TheBloke** — older but extensive GGUF + AWQ + GPTQ collection
- **Hugging-Quants** — official quantizations from HF org (Llama 3.x AWQ etc.)
- **Qwen / DeepSeek** — official quantizations from the model authors

When pinning a benchmark, prefer official > Hugging-Quants > Bartowski > TheBloke (in roughly that order of trust).

## Sanity-check after loading

For each new (model, quant) combination, run a quick perplexity check before the full benchmark:

```bash
# Quick smoke test — 5 tasks, single run
npm run benchmark -- \
  --workload codebase-qa \
  --treatments baseline-grep \
  --models qwen-coder-7b-awq \
  --tasks 5 --runs 1 \
  --output ./results/smoke-quant-test/
```

If accuracy on the 5-task smoke is reasonable (>40% on Codebase Q&A baseline), the quant is healthy. If accuracy collapses to near-zero, the quant file may be corrupt — re-download.
