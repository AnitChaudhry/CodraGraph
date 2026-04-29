# Results

Output directory for benchmark sweeps. Gitignored except this README.

## Structure

Each run gets a timestamped subdirectory:

```
results/2026-04-29-headline/
├── env.json
├── summary.json
├── REPORT.md
├── baseline-grep_qwen-coder-7b-awq/
├── codragraph-graph-only_qwen-coder-7b-awq/
└── ...
```

## What gets published

For each headline claim in marketing or the website:
- Link to the `results/<id>/` folder containing the env.json + summary.json
- The REPORT.md should be the human-readable narrative

For each results dir that backs a public claim, **make a copy** to durable cold storage (S3 / GCS) — local results dirs are gitignored and easy to lose.

## Cleanup

Old results can be deleted; the `summary.json` is the durable artifact. If you need to re-run, you can recreate them from the env.json (REPRODUCIBILITY.md).
