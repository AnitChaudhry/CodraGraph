# Cloud GPU Providers

For benchmarks that take hours and produce throwaway VMs. We don't need persistent infrastructure — rent → benchmark → tear down.

## The shortlist (as of 2026-04)

| Provider | Best for | Pricing notes | Caveats |
|---|---|---|---|
| **RunPod** | Quick iteration, single A100/4090 | $0.80–1.50/hr A100 40GB; $0.40–0.70/hr 4090 | Capacity rotates; "Community" tier cheaper but less reliable |
| **Lambda Labs** | Serious benchmarks, easy setup | $1.10/hr A100 40GB; $1.99/hr A100 80GB; $2.49/hr H100 | On-demand only — get-it-when-it's-there |
| **vast.ai** | Cheapest A100/H100 spot | ~$0.50–1.20/hr A100 40GB; varies wildly | Marketplace — verify host reliability score |
| **CoreWeave** | Long-running serious workloads | $2.00+/hr A100 80GB | Min commitment, sales-led |
| **Modal** | Serverless GPU functions | $1.10/sec H100 (auto-shutoff) | No persistent state by default |
| **Together.ai** | API-based GPU model serving | Per-token pricing on hosted models | Doesn't help if you need the GPU itself |

## Recommended workflow per provider

### RunPod (recommended for first benchmark)

1. Sign in → Pods → Deploy
2. Pick: **RTX 4090 24GB** ($0.40/hr, "Community Cloud") or **A100 80GB** ($1.50/hr, "Secure Cloud")
3. Template: **PyTorch 2.4 + CUDA 12.4** (search "pytorch")
4. Container disk: 50 GB (model weights eat space)
5. Volume disk: 0 (we don't need persistence)
6. Click Deploy → wait ~60s → connect via Web Terminal

```bash
# Inside the pod
git clone https://github.com/<your-fork>/thinqmesh-codra
cd thinqmesh-codra/Benchmarking
docker compose up -d vllm
# Wait ~3 min for model download + load
# Then run the benchmark (see scripts/run-benchmark.ts usage)
```

When done: **Terminate pod**. Otherwise you keep paying.

### Lambda Labs

1. Cloud → On-Demand → Launch Instance
2. Region: closest to you for low latency
3. Instance: **1× A100 40GB** or **1× A100 80GB**
4. Storage: 100 GB filesystem (default)
5. SSH key: upload yours
6. Click Launch → wait ~90s

```bash
# SSH in
ssh ubuntu@<lambda-ip>
git clone https://github.com/<your-fork>/thinqmesh-codra
cd thinqmesh-codra/Benchmarking

# CUDA + nvidia-driver pre-installed by Lambda. Just install Docker if needed.
sudo apt update && sudo apt install -y docker-compose-plugin

# Run
docker compose up -d vllm
docker compose run --rm bench npm run benchmark -- --workload codebase-qa ...
```

Tear down via the dashboard.

### vast.ai

1. Browse → filter by GPU model (e.g., "RTX 4090 24GB")
2. **Sort by `dlperf` (deep-learning performance)** descending
3. Pick a host with reliability score > 95% and a recent uptime
4. Choose template: `pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime` or similar
5. Rent → SSH in
6. Same workflow as Lambda

Watch for: hosts with low reliability are cheaper but the pod can disappear mid-run.

### Modal (serverless — best for sweeps)

Modal is unique: instead of renting a long-lived VM, you write Python (or call from JS) and Modal spins up a GPU just for the function call.

```python
import modal
stub = modal.Stub("codragraph-bench")
image = modal.Image.debian_slim().pip_install("vllm")

@stub.function(gpu="A100", image=image, timeout=3600)
def run_one_treatment(treatment, model, tasks):
    # Boot vLLM, run benchmark, return results
    ...
```

Best for: **the matrix sweep**. Each (model × treatment × workload) cell becomes a Modal call. No GPU wasted between cells.

Cost: pay-per-second; auto-shutoff. Very efficient for bursty workloads.

We provide a Modal-native script in `scripts/modal-sweep.py` (sketch only — fill in for your exact matrix).

## Picking provider for our benchmark sweep

The full headline sweep is:
- 5 models × 7 treatments × 1 workload (105 tasks) × 3 runs = **105 tasks × 5 × 7 × 3 = 11,025 task-runs**
- Average task: ~5–15 seconds depending on treatment
- Total compute: ~30–90 GPU-hours

Best providers:
- **First sweep / iteration: RunPod RTX 4090** — cheap, fast for solo work
- **Headline sweep: Lambda A100 80GB** — reliable, faster, supports up to 70B
- **Repeated sweeps (CI-style): Modal** — pay-per-task; tear-down is automatic

## Provider-agnostic prep

Before you click "rent", have ready:

1. Your fork URL of thinqmesh-codra (or rsync the folder over scp)
2. `.env` populated with API keys for closed-source models you'll benchmark against (Claude, OpenAI)
3. The model list you want to download (HuggingFace mirror cache helps if your bandwidth is metered)
4. A target repo to index — we recommend codragraph itself (the monorepo is the workload's source of truth)
5. A way to sync results back: `scp` the `results/` folder back, or upload to S3 from the pod

## Cost guardrails

- Set a billing alert at 2× your expected cost on every provider
- ALWAYS terminate pods when done. The #1 way devs lose money on cloud GPU is forgetting a pod overnight.
- If you're iterating, use **RTX 4090 ($0.40/hr)** for development; switch to **A100 80GB ($1.50/hr)** only for the final headline sweep
- Modal's auto-shutoff is genuinely the safest because there's no "forgot to terminate" failure mode

## Latency considerations

If you're benchmarking from a different region than the closed-API endpoint (Anthropic = us-east, OpenAI = us-east + multiregion), include the network latency in your interpretation:

- Pod in `us-east` → API in `us-east` → ~50–100ms per call latency
- Pod in `eu-west` → API in `us-east` → ~150–200ms per call latency

Closed-API treatments will run faster from US-east pods. Document the pod region in `env.json`.
