# Benchmarking Scripts

Runnable TS scripts that drive the benchmark sweep, the swarm tuning, the report generation, and cross-run comparisons.

## Files

| File | What it does |
|---|---|
| `run-benchmark.ts` | The main entry. Runs (workload × treatment × model × seeds) cells, persists results. |
| `swarm-tune.ts` | Runs the Phase 3 swarm against a workload's search set; persists the winning recipe so subsequent benchmark runs can reuse it. |
| `export-report.ts` | Reads `summary.json` from a results dir and writes a markdown REPORT.md. |
| `compare-baselines.ts` | Cross-run comparison table — useful for verifying recipe-cached vs fresh-search parity. |
| `treatments.ts` | Per-treatment runners. `baseline-grep`, `baseline-fullfile`, `codragraph-graph-only`, `codragraph-graph-compress` are implemented; the harness/swarm/recipe-cached treatments require a precomputed recipe (see swarm-tune.ts first). |
| `aggregate.ts` | Per-task → run summary; runs → cell aggregate. Wilson 95% CIs. |
| `pricing.ts` | Per-1k-token pricing for closed-API providers. **Update when providers change rates.** |
| `models.yaml` | Pinned model registry. |
| `types.ts` | Shared TS types. |

## Install

```bash
cd infra/benchmarking/scripts
npm install
```

(This is a workspace package; `npm install` at the root also works.)

## Common workflows

### A) Smoke test (5 tasks, 1 model, 1 treatment, 1 run)

```bash
npm run benchmark -- \
  --workload codebase-qa \
  --treatments codragraph-graph-only \
  --models claude-haiku \
  --runs 1 \
  --tasks 5 \
  --output ../results/smoke/
```

Should complete in 30–60 seconds. If `correct/total` is sane, the wiring works.

### B) Headline open-source sweep

Pre-req: vLLM running (`cd ../docker && docker compose up -d vllm`) and the target repo indexed (`docker compose run --rm codragraph codragraph analyze /workspace/repo`).

```bash
npm run benchmark -- \
  --workload codebase-qa \
  --treatments baseline-grep,codragraph-graph-only,codragraph-graph-compress \
  --models qwen-coder-7b-awq,qwen-coder-32b-awq \
  --runs 3 \
  --output ../results/$(date +%Y%m%d)-open-headline/

npm run report -- ../results/$(date +%Y%m%d)-open-headline/
```

### C) Adding the harness-tuned / swarm-tuned cells

These need a precomputed recipe. Run `swarm-tune.ts` first:

```bash
npm run swarm-tune -- \
  --workload codebase-qa \
  --inference openai \
  --inference-base-url http://localhost:8000/v1 \
  --inference-model Qwen/Qwen2.5-Coder-7B-Instruct \
  --max-iterations 20 \
  --plateau-k 5 \
  --output ../results/recipes/
```

Once that completes, the recipe is stored at `../results/recipes/tune-codebase-qa-<stamp>/candidates/<best-id>/`. Add support in `treatments.ts` to load it (the throw-with-instructions case in `runTreatment` documents what to add). For the headline sweep, that path becomes the `loadCandidate` target.

### D) Closed-API cross-comparison cells

```bash
ANTHROPIC_API_KEY=sk-... \
OPENAI_API_KEY=sk-... \
npm run benchmark -- \
  --workload codebase-qa \
  --treatments baseline-grep,codragraph-graph-only \
  --models claude-haiku,claude-sonnet,gpt-4o-mini \
  --runs 3 \
  --output ../results/$(date +%Y%m%d)-closed-headline/
```

Costs $5–15 for Haiku/4o-mini; up to ~$30 for Sonnet/4o. Watch your bill.

## Output structure

```
results/<run-id>/
├── env.json                    captured environment (REPRODUCIBILITY.md)
├── summary.json                aggregated results
├── REPORT.md                   generated markdown
├── <treatment>_<model>/
│   ├── run-seed42.json         per-run task results + summary
│   ├── run-seed1337.json
│   └── run-seed8675309.json
└── ...
```

## Extending

### Add a new treatment

1. Add the tag to `TreatmentTag` in `types.ts`
2. Implement a runner function in `treatments.ts`
3. Wire it into the `switch` in `runTreatment`
4. Document the treatment in `../workloads/03-baselines.md`

### Add a new workload

1. Create `../workloads/<id>.json` (or reference an existing fixture)
2. Document in `../workloads/<id>-overview.md`
3. The runner will pick up `<id>.json` automatically via `resolveWorkloadPath`

### Add a new model

1. Add an entry to `models.yaml` with `id`, `provider`, `modelId`, `quantization`, `maxContext`
2. (closed-API only) Add pricing to `pricing.ts`
3. The runner picks it up automatically

## What's stubbed today

- `packages/harness-tuned`, `codragraph-swarm-tuned`, `codragraph-recipe-cached` treatments throw a clear error instructing you to run `swarm-tune.ts` first and then load the recipe via the candidate filesystem. The next iteration of `treatments.ts` will accept a `--recipe-dir` flag and use `compileAndLoadCandidate` to load the persisted recipe automatically.
- GPU/CUDA detection in `env.json` is a stub (returns empty `gpus` array). For headline runs, manually capture `nvidia-smi` output and merge into the env JSON.
- `compare-baselines.ts` does basic diffing; statistical significance testing (paired bootstrap) is a future addition.

## Sanity checks before publishing numbers

1. `env.json` has no `<sha>` placeholders in the model spec
2. `git.dirty` is `false` (run from a clean working tree)
3. At least 3 seeds completed for any cell whose number is in the headline
4. The judge model is documented and its tokens are accounted for separately from the treatment's cost
5. `tasks ≥ 30` per cell (Codebase Q&A v1 has 105; full sweep is fine)

If any of those fail, the result is a smoke-test, not a headline.
