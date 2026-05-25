#!/usr/bin/env node
// Generate a markdown report from a results directory.
//
// Usage: tsx export-report.ts ./results/2026-04-29-headline/

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BenchEnv, RunSummary, TreatmentTag } from './types.js';

interface CellSummary {
  treatment: TreatmentTag;
  modelId: string;
  aggregate: {
    accuracyMean: number;
    accuracyStdDev: number;
    accuracyMin: number;
    accuracyMax: number;
    tokensMeanMean: number;
    costSumSum: number;
  };
  runSummaries: RunSummary[];
}

interface SummaryFile {
  env: BenchEnv;
  cells: CellSummary[];
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: tsx export-report.ts <results-dir>');
    process.exit(1);
  }
  const summaryPath = path.join(dir, 'summary.json');
  const summary: SummaryFile = JSON.parse(await fs.readFile(summaryPath, 'utf8'));

  const md = renderMarkdown(summary);
  const reportPath = path.join(dir, 'REPORT.md');
  await fs.writeFile(reportPath, md, 'utf8');
  console.error(`Wrote ${reportPath}`);
}

function renderMarkdown(s: SummaryFile): string {
  const lines: string[] = [];
  lines.push(`# Benchmark Report — ${s.env.runId}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Environment block
  lines.push('## Environment');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(
    `| Workload | \`${s.env.workload.id}\` v${s.env.workload.version} (${s.env.workload.taskCount} tasks; split: ${s.env.workload.split}) |`,
  );
  lines.push(`| Seeds | ${s.env.seeds.join(', ')} |`);
  lines.push(`| Judge | ${s.env.judge.provider} / ${s.env.judge.model} |`);
  lines.push(
    `| CodraGraph | ${s.env.codragraph.version}; indexed repo SHA: ${s.env.codragraph.indexedRepoSha} |`,
  );
  lines.push(`| Host | ${s.env.host.os}; ${s.env.host.cpu}; ${s.env.host.ramGb} GB RAM |`);
  if (s.env.host.gpus.length > 0) {
    lines.push(
      `| GPU | ${s.env.host.gpus.map((g) => `${g.name} (${g.memoryGb} GB)`).join(', ')} |`,
    );
  }
  lines.push(`| Node | ${s.env.node.version} on ${s.env.node.platform} |`);
  if (s.env.git.dirty) {
    lines.push(
      `| **⚠️ Git** | dirty working tree at ${s.env.git.sha} (results not strictly reproducible) |`,
    );
  } else {
    lines.push(`| Git | ${s.env.git.sha} on ${s.env.git.branch} (clean) |`);
  }
  lines.push('');

  // Headline matrix
  lines.push('## Results Matrix');
  lines.push('');
  lines.push(
    '| Treatment | Model | Accuracy (mean ± std) | 95% CI | Mean tokens | p95 tokens | Mean latency | Cost |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const cell of s.cells) {
    const a = cell.aggregate;
    const firstRun = cell.runSummaries[0];
    const ci = firstRun?.accuracyCi95;
    const ciStr = ci ? `[${(ci.lower * 100).toFixed(1)}, ${(ci.upper * 100).toFixed(1)}]` : '—';
    const p95 = firstRun?.tokensP95.toFixed(0) ?? '—';
    const lat = firstRun?.meanLatencyMs.toFixed(0) ?? '—';
    lines.push(
      `| \`${cell.treatment}\` | ${cell.modelId} | ${(a.accuracyMean * 100).toFixed(1)}% ± ${(a.accuracyStdDev * 100).toFixed(1)} | ${ciStr} | ${a.tokensMeanMean.toFixed(0)} | ${p95} | ${lat} ms | $${a.costSumSum.toFixed(4)} |`,
    );
  }
  lines.push('');

  // Pairwise comparisons grouped by model
  const byModel = new Map<string, CellSummary[]>();
  for (const cell of s.cells) {
    const arr = byModel.get(cell.modelId) ?? [];
    arr.push(cell);
    byModel.set(cell.modelId, arr);
  }
  lines.push('## Treatment Wins (per model, vs baseline-grep)');
  lines.push('');
  for (const [modelId, cells] of byModel) {
    const baseline = cells.find((c) => c.treatment === 'baseline-grep');
    if (!baseline) continue;
    lines.push(`### ${modelId}`);
    lines.push('');
    lines.push('| Treatment | Δ accuracy | Token reduction | Δ latency | Δ cost |');
    lines.push('|---|---|---|---|---|');
    for (const cell of cells) {
      if (cell.treatment === 'baseline-grep') continue;
      const accDelta = cell.aggregate.accuracyMean - baseline.aggregate.accuracyMean;
      const tokenRed =
        baseline.aggregate.tokensMeanMean > 0
          ? 1 - cell.aggregate.tokensMeanMean / baseline.aggregate.tokensMeanMean
          : 0;
      const latDelta =
        (cell.runSummaries[0]?.meanLatencyMs ?? 0) - (baseline.runSummaries[0]?.meanLatencyMs ?? 0);
      const costDelta = cell.aggregate.costSumSum - baseline.aggregate.costSumSum;
      lines.push(
        `| \`${cell.treatment}\` | ${accDelta >= 0 ? '+' : ''}${(accDelta * 100).toFixed(1)} pts | ${(tokenRed * 100).toFixed(1)}% | ${latDelta >= 0 ? '+' : ''}${latDelta.toFixed(0)} ms | $${costDelta.toFixed(4)} |`,
      );
    }
    lines.push('');
  }

  // Headline statement (if applicable)
  lines.push('## Headline (auto-generated)');
  lines.push('');
  const headline = generateHeadline(s);
  if (headline) {
    lines.push(`> ${headline}`);
  } else {
    lines.push(
      `(No headline generated — need at least one model with both \`baseline-grep\` and a \`codragraph-*\` treatment.)`,
    );
  }
  lines.push('');

  // Caveats
  lines.push('## Methodology Notes');
  lines.push('');
  lines.push(
    '- Each cell ran **${s.env.seeds.length} seeds** with mean-of-means aggregation.'.replace(
      '${s.env.seeds.length}',
      String(s.env.seeds.length),
    ),
  );
  lines.push('- Accuracy CIs are 95% Wilson score intervals on individual run accuracies.');
  lines.push('- Token counts are total (input + output) per task; judge tokens not included.');
  lines.push('- Cost is provider-billed only; self-hosted models report $0.');
  lines.push('- Per-task traces and per-run JSONs are in subdirectories of this folder.');
  lines.push('');

  return lines.join('\n');
}

function generateHeadline(s: SummaryFile): string | null {
  const byModel = new Map<string, CellSummary[]>();
  for (const cell of s.cells) {
    const arr = byModel.get(cell.modelId) ?? [];
    arr.push(cell);
    byModel.set(cell.modelId, arr);
  }
  // Pick the model where codragraph-* has the largest token reduction at non-negative accuracy delta
  let best: {
    modelId: string;
    treatment: TreatmentTag;
    accDelta: number;
    tokenRed: number;
  } | null = null;
  for (const [modelId, cells] of byModel) {
    const baseline = cells.find((c) => c.treatment === 'baseline-grep');
    if (!baseline) continue;
    for (const cell of cells) {
      if (!cell.treatment.startsWith('codragraph-')) continue;
      const accDelta = cell.aggregate.accuracyMean - baseline.aggregate.accuracyMean;
      const tokenRed =
        baseline.aggregate.tokensMeanMean > 0
          ? 1 - cell.aggregate.tokensMeanMean / baseline.aggregate.tokensMeanMean
          : 0;
      if (accDelta < -0.01) continue; // Reject treatments that lose accuracy
      if (!best || tokenRed > best.tokenRed) {
        best = { modelId, treatment: cell.treatment, accDelta, tokenRed };
      }
    }
  }
  if (!best) return null;
  return `On the **${s.env.workload.id}** workload (${s.env.workload.taskCount} tasks, split: ${s.env.workload.split}), \`${best.treatment}\` on **${best.modelId}** delivered **${(best.tokenRed * 100).toFixed(1)}% token reduction** vs \`baseline-grep\` at ${best.accDelta >= 0 ? '+' : ''}${(best.accDelta * 100).toFixed(1)} pts accuracy.`;
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
