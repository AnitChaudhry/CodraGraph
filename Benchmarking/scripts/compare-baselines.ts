#!/usr/bin/env node
// Cross-run comparison: load multiple results dirs, produce a side-by-side
// comparison table. Useful for "did our recipe-cached treatment match the
// fresh-search treatment from last week?" sanity checks.
//
// Usage: tsx compare-baselines.ts ./results/run-A/ ./results/run-B/ [more dirs...]

import { promises as fs } from "node:fs";
import path from "node:path";

interface CellSummary {
  treatment: string;
  modelId: string;
  aggregate: {
    accuracyMean: number;
    tokensMeanMean: number;
    costSumSum: number;
  };
}

interface SummaryFile {
  env: { runId: string; workload: { id: string } };
  cells: CellSummary[];
}

async function main(): Promise<void> {
  const dirs = process.argv.slice(2);
  if (dirs.length < 2) {
    console.error("Usage: tsx compare-baselines.ts <dir-A> <dir-B> [more...]");
    process.exit(1);
  }

  const summaries = await Promise.all(
    dirs.map(async (d) => {
      const raw = await fs.readFile(path.join(d, "summary.json"), "utf8");
      return { dir: d, summary: JSON.parse(raw) as SummaryFile };
    }),
  );

  // Build a unified cell key → per-run results table
  const allKeys = new Set<string>();
  for (const { summary } of summaries) {
    for (const cell of summary.cells) {
      allKeys.add(`${cell.treatment}::${cell.modelId}`);
    }
  }

  // Print table
  console.log("# Cross-run comparison");
  console.log("");
  console.log("Runs:");
  for (const { dir, summary } of summaries) {
    console.log(`- \`${path.basename(dir)}\` — ${summary.env.runId} (${summary.env.workload.id})`);
  }
  console.log("");

  const header = ["Treatment / Model", ...summaries.map((s) => path.basename(s.dir))];
  console.log("| " + header.join(" | ") + " |");
  console.log("|" + header.map(() => "---").join("|") + "|");

  for (const key of [...allKeys].sort()) {
    const [treatment, modelId] = key.split("::");
    const row = [`\`${treatment}\` / ${modelId}`];
    for (const { summary } of summaries) {
      const cell = summary.cells.find((c) => c.treatment === treatment && c.modelId === modelId);
      if (!cell) {
        row.push("—");
      } else {
        row.push(
          `${(cell.aggregate.accuracyMean * 100).toFixed(1)}% / ${cell.aggregate.tokensMeanMean.toFixed(0)} tok / $${cell.aggregate.costSumSum.toFixed(4)}`,
        );
      }
    }
    console.log("| " + row.join(" | ") + " |");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
