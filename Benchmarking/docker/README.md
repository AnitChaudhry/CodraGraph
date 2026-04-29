# Benchmarking — Docker Stack

One-command reproducible inference + bench environment.

## Files

- `docker-compose.yaml` — orchestrates 3 services (vllm, codragraph, bench)
- `codragraph.dockerfile` — builds the codragraph CLI as a container
- `bench.dockerfile` — builds the bench-script runner
- `.env.example` — template for configuration; copy to `.env` and edit

## Usage

```bash
# 1. Configure
cp .env.example .env
# Edit .env: set MODEL, HUGGING_FACE_HUB_TOKEN if needed, API keys for closed-source comparisons

# 2. Start the inference server
docker compose up -d vllm

# 3. Wait for vLLM to load the model (usually 1–3 min)
docker compose logs -f vllm
# Wait for "Application startup complete"

# 4. Index the target repo
docker compose run --rm codragraph npx codragraph analyze /workspace/repo

# 5. (Optional) Run a swarm to populate recipe cache for the test workload
docker compose run --rm bench npm run swarm-tune -- \
  --workload codebase-qa \
  --inference openai \
  --inference-base-url http://vllm:8000/v1

# 6. Run the benchmark sweep
docker compose run --rm bench npm run benchmark -- \
  --workload codebase-qa \
  --treatments baseline-grep,codragraph-graph-only,codragraph-graph-compress,codragraph-swarm-tuned \
  --runs 3 \
  --output ../results/$(date +%Y%m%d-%H%M%S)/

# 7. Generate the report
docker compose run --rm bench npm run report -- ../results/<run-id>/

# 8. Tear down
docker compose down
```

## Volume management

- `hf_cache` — HuggingFace model cache. Persists across runs so you don't re-download.
- `codragraph_data` — `.codragraph` graph index. Persists so reindexing isn't required.
- `Benchmarking/results/` — output directory, mounted from the host so results survive teardown.

## Networking

All services share the default compose network. The bench container talks to vllm at `http://vllm:8000/v1` (Docker DNS).

If you need to expose vLLM externally (e.g. testing from outside the host), it's already mapped to `localhost:8000`.

## Resource caveats

- vLLM grabs the GPU at startup. If you need it for something else, `docker compose stop vllm` first.
- The bench scripts can fork subprocess proposers (Claude Code) — those run on the host CPU, not the GPU. Make sure the bench container can reach the host's `claude` binary (mount it via a volume, or run the bench process on the host instead of in container).

## Running bench on host (not in container)

If you'd rather run bench scripts on the host (e.g. so the proposer subprocess uses your local Claude Code installation):

```bash
docker compose up -d vllm
# (in another terminal, on the host)
cd Benchmarking/scripts
npm install
VLLM_URL=http://localhost:8000/v1 npm run benchmark -- ...
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| vLLM stuck at "Loading model weights" | HF download slow — pre-cache with `huggingface-cli download` |
| "no GPUs available" | `nvidia-ctk runtime configure --runtime=docker && systemctl restart docker` |
| `codragraph analyze` slow | Check that `INDEXED_REPO_PATH` mount isn't a network share |
| bench can't reach vllm | Same compose network? Check `docker compose ps` shows both running |
| OOM on model load | Lower `GPU_MEMORY_UTILIZATION` in `.env` to 0.85, or pick a smaller model |
