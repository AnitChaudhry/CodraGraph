/**
 * profile-heap — RFC 0002 Phase 1 entry point.
 *
 * A thin wrapper around `analyze` that flips on the heap-profile
 * instrumentation already living in `runFullAnalysis`, then prints a
 * per-phase RSS / heapUsed summary table after the run finishes.
 *
 * Why a dedicated subcommand instead of just documenting the env var?
 *   - Discoverability: `codragraph --help` lists it next to `analyze`.
 *   - One-shot UX: users (and the maintainer) get a useful summary table
 *     without having to spelunk through Chrome DevTools to compare
 *     snapshots. The `.heapsnapshot` files are still written for deep
 *     dives; the summary just makes the cheap signal (RSS curve, heapUsed
 *     curve) visible at a glance.
 *   - Phase 1 of RFC 0002 is profile-first by design — we ship the tool
 *     before any mitigation. Don't add compression, eviction, or streaming
 *     refactors here; that's Phase 2+ once we know which phase is the
 *     actual bottleneck.
 *
 * Side effects: writes `.codragraph/heap-profiles/<ts>-<phase>.heapsnapshot`
 * (one per phase boundary, ~100-500MB each) plus a small
 * `profile-summary.jsonl` timeline. Disk usage adds up fast on large
 * repos — clean up between runs if you don't need the raw snapshots.
 */

import path from 'path';
import * as fsSync from 'node:fs';
import { getGitRoot, hasGitDir } from '../storage/git.js';
import { analyzeCommand, type AnalyzeOptions } from './analyze.js';

interface ProfileEntry {
  ts: number;
  phase: string;
  percent: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  snapshotFile: string;
}

export interface ProfileHeapOptions extends AnalyzeOptions {
  /**
   * Commander injects this from the `--no-summary` flag — see CLI
   * registration. `--no-summary` ⇒ `summary === false`. The dual-name
   * convention (positive flag name, negated value) is a commander
   * footgun: a `noSummary?: boolean` field would silently never fire.
   */
  summary?: boolean;
}

export const profileHeapCommand = async (
  inputPath?: string,
  options?: ProfileHeapOptions,
): Promise<void> => {
  // Flip on the instrumentation BEFORE delegating to analyze. The env var
  // is read by `runFullAnalysis` at orchestrator entry, so it must be set
  // here. Setting it on every profile-heap invocation also guarantees that
  // a leftover `unset` from a prior shell session can't disable profiling
  // in this run.
  process.env.CODRAGRAPH_HEAP_PROFILE = '1';

  // Resolve the repo path the same way `analyze` does so we can locate the
  // summary file after the run. Mirroring this avoids touching analyze's
  // resolution logic, which already handles --skip-git, gitRoot, etc.
  let repoPath: string;
  if (inputPath) {
    repoPath = path.resolve(inputPath);
  } else {
    const gitRoot = getGitRoot(process.cwd());
    if (!gitRoot && !options?.skipGit) {
      // Let analyze produce its standard error message + exit code rather
      // than duplicating the message here.
      await analyzeCommand(inputPath, options);
      return;
    }
    repoPath = gitRoot ?? path.resolve(process.cwd());
  }
  if (!hasGitDir(repoPath) && !options?.skipGit) {
    await analyzeCommand(inputPath, options);
    return;
  }

  // Detect whether we're the outer (pre-re-exec) process. analyzeCommand
  // calls ensureHeap() which `execFileSync`s a child with
  // --max-old-space-size=8192 on first invocation; that child runs the
  // instrumented codepath and prints its own summary before exiting. If
  // we don't bail here, the outer process re-reads the just-written
  // summary file and prints it a second time.
  //
  // Capture the flag BEFORE the await so a future change to NODE_OPTIONS
  // mid-flight can't confuse us. (execFileSync's child env doesn't
  // propagate back to process.env, but be defensive.)
  const isInnerProcess = (process.env.NODE_OPTIONS || '').includes('--max-old-space-size');

  await analyzeCommand(inputPath, options);

  // Outer process: the inner already printed the summary on its way out.
  if (!isInnerProcess) return;
  // `--no-summary` → commander sets options.summary === false.
  if (options?.summary === false) return;

  const summaryPath = path.join(repoPath, '.codragraph', 'heap-profiles', 'profile-summary.jsonl');
  if (!fsSync.existsSync(summaryPath)) {
    // analyze re-execs itself with a larger heap on first invocation; the
    // outer process never reaches the instrumented codepath. Tell the user
    // where to find the artifacts in that case.
    console.log(
      `\n  Heap profile summary not found at ${summaryPath}.\n` +
        `  This is expected on the first call (analyze re-execs with --max-old-space-size).\n` +
        `  Re-run \`codragraph profile-heap\` and the summary will appear in the second pass.\n`,
    );
    return;
  }

  const lines = fsSync
    .readFileSync(summaryPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const entries: ProfileEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as ProfileEntry);
    } catch {
      /* skip malformed lines — best-effort */
    }
  }

  if (entries.length === 0) {
    console.log(`\n  Heap profile summary at ${summaryPath} is empty.\n`);
    return;
  }

  printSummary(entries, summaryPath);
};

function printSummary(entries: ProfileEntry[], summaryPath: string): void {
  const peakRss = entries.reduce((m, e) => (e.rss > m ? e.rss : m), 0);
  const peakHeapUsed = entries.reduce((m, e) => (e.heapUsed > m ? e.heapUsed : m), 0);
  const startTs = entries[0]!.ts;

  console.log('\n  Heap-profile summary');
  console.log('  ────────────────────');
  console.log(
    '  Phase'.padEnd(28) +
      '  Δt(s)'.padEnd(10) +
      '  RSS(MB)'.padEnd(12) +
      '  heapUsed(MB)'.padEnd(16) +
      '  Snapshot',
  );
  for (const e of entries) {
    const dt = ((e.ts - startTs) / 1000).toFixed(1);
    const rssMb = (e.rss / 1024 / 1024).toFixed(0);
    const heapMb = (e.heapUsed / 1024 / 1024).toFixed(0);
    console.log(
      `  ${e.phase.padEnd(26)}  ${dt.padStart(6)}    ${rssMb.padStart(7)}    ${heapMb.padStart(11)}      ${e.snapshotFile}`,
    );
  }
  console.log('  ────────────────────');
  console.log(`  peak RSS:       ${(peakRss / 1024 / 1024).toFixed(0)} MB`);
  console.log(`  peak heapUsed:  ${(peakHeapUsed / 1024 / 1024).toFixed(0)} MB`);
  console.log(`  raw timeline:   ${summaryPath}`);
  console.log(
    `  snapshots dir:  ${path.dirname(summaryPath)} (open .heapsnapshot files in Chrome DevTools → Memory → Load)\n`,
  );
}
