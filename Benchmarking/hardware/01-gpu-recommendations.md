# GPU Recommendations

Which GPU you need depends on which model size you want to run. Here's the working matrix (memory ceilings are conservative — leave 2–4 GB for KV-cache and overhead).

## Model size → minimum GPU memory

| Model size | Precision | Min VRAM | KV-cache for 32k context | Realistic GPU |
|---|---|---|---|---|
| 3B | FP16 | 7 GB | +3 GB | RTX 3060 12GB / 3090 24GB |
| 7B | FP16 | 15 GB | +5 GB | RTX 3090 / 4090 24GB / A10G 24GB |
| 7B | Q5_K_M | 5.5 GB | +5 GB | RTX 4060 Ti 16GB / 3080 12GB (tight) |
| 13B | FP16 | 26 GB | +7 GB | A100 40GB / RTX 6000 Ada 48GB |
| 13B | Q4_K_M | 8 GB | +7 GB | RTX 4090 24GB |
| 32B | Q4_K_M | 19 GB | +10 GB | RTX 4090 24GB (tight) / A100 40GB |
| 32B | AWQ-int4 | 18 GB | +10 GB | RTX 4090 / A100 40GB |
| 70B | Q4_K_M | 40 GB | +14 GB | A100 80GB / 2× RTX 4090 (tensor parallel) |
| 70B | FP16 | 140 GB | +14 GB | 2× A100 80GB / 1× H100 80GB (tight w/ offload) |

## Recommended GPUs by use case

### Solo developer / hobbyist

**RTX 4090 24GB** — best price/perf for self-hosted code-LLM work.
- Comfortable for: 7B FP16, 13B Q4, 32B Q4 (with care)
- Cost: ~$1,800 USD card + ~$200/month electricity (US average)
- Tradeoff: only one user at a time; no multi-tenant serving

**RTX 3090 24GB (used)** — same VRAM, ~half the price, ~70% the throughput
- Cost: ~$700–900 USD used
- Tradeoff: noisier, hotter, blower vs open fans depending on which one you find

### Small team / startup (production benchmarking)

**1× A100 40GB** — the standard.
- Comfortable for: 13B FP16, 32B Q4 (room to breathe), 70B Q4 with offload
- Renting: $0.80–1.50/hr on RunPod, $1.10–1.90/hr on Lambda
- Owning: $8–10k used / $14–17k new
- Tradeoff: hot, loud, requires proper cooling/power

**1× A100 80GB** — when context and concurrency matter.
- Comfortable for: 32B FP16, 70B Q4 cleanly, 70B FP16 with offload
- Renting: $1.50–2.50/hr
- Best for: serving multiple concurrent benchmark sweeps or running larger context windows

### Research / serious throughput

**1× H100 80GB** — flagship.
- 4× the throughput of A100 on FP16 attention; ~2× on memory bandwidth
- Renting: $2.50–4.00/hr (limited availability, rotates between providers)
- Owning: $30k+ — not practical unless you're a lab

**2× / 4× / 8× H100** — distributed inference for 405B-class.
- Out of scope for our benchmarks (we don't expect anyone needs Llama-3.1-405B for codragraph workloads).

## What we run for codragraph benchmarks

The published numbers will use:

| Tier | GPU | Models |
|---|---|---|
| **Small models** | 1× RTX 4090 or A10G | Qwen2.5-Coder-1.5B, Llama-3.2-3B (FP16); Qwen2.5-Coder-7B (Q5_K_M) |
| **Mid models** | 1× A100 40GB | Qwen2.5-Coder-7B (FP16), DeepSeek-Coder-V2.5-Lite, Qwen2.5-Coder-32B (Q4) |
| **Large models** | 1× A100 80GB | Qwen2.5-Coder-32B (FP16), DeepSeek-Coder-V2 (Q4), Llama-3.3-70B (Q4) |
| **Closed API** | n/a | Claude Haiku 4.5, Claude Sonnet 4.6, GPT-4o-mini, GPT-4o |

## Driver / CUDA stack

vLLM and TGI need recent CUDA + matching driver:

- **CUDA 12.1+** — vLLM 0.6.x, TGI 2.4+
- **Nvidia driver 535+** for CUDA 12.1
- **Nvidia driver 550+** for CUDA 12.4 (recommended for H100 perf)

Ollama and llama.cpp work with older drivers (CUDA 11.8) but at reduced throughput.

## Verifying your setup

```bash
# 1. Driver
nvidia-smi
# Should show your GPU, driver version, CUDA version

# 2. Available memory (should match the table above)
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv

# 3. Container toolkit (for Docker GPU passthrough)
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
docker run --gpus all --rm nvcr.io/nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

If `nvidia-smi` works inside the container, you're ready.

## What if you're on Windows?

Native Windows GPU compute is limited. Two paths:

1. **WSL2 + Linux GPU passthrough** — works for vLLM, TGI, llama.cpp. See `04-windows-wsl2-setup.md`.
2. **Cloud GPU** — easiest by far. See `02-cloud-providers.md`.

Don't try to build vLLM on native Windows. It's not worth the time.

## What if you don't have a GPU at all?

You can run small models on CPU via llama.cpp:

```bash
ollama pull qwen2.5-coder:1.5b
ollama run qwen2.5-coder:1.5b
```

A 1.5B model on a modern CPU produces ~5–15 tokens/sec — usable for small benchmark sweeps but not for the full matrix. The full benchmark matrix takes hours/days on CPU; on a single A100 it takes 30–60 min per cell.

## Cost-vs-time tradeoff

Approximate full-sweep cost (105-task Codebase Q&A, 7 treatments, 5 models, 3 runs each):

| Setup | Time | Cost |
|---|---|---|
| Local RTX 4090 (own) | ~6 hr | ~$1 electricity |
| Cloud A100 80GB rental | ~3 hr | ~$5 |
| Cloud H100 80GB rental | ~1.5 hr | ~$5 |
| Closed-API only (no self-hosted) | ~1 hr | ~$15–40 |
| Mixed (self-hosted + closed API for 2 cells) | ~3 hr | ~$10 |

The published-number sweet spot is **rented A100 80GB + selected closed-API cells** — under $20 for a full headline-able sweep.
