/**
 * Analyze Command
 *
 * Indexes a repository and stores the knowledge graph in .codragraph/
 *
 * Delegates core analysis to the shared runFullAnalysis orchestrator.
 * This CLI wrapper handles: heap management, progress bar, SIGINT,
 * skill generation (--skills), summary output, and process.exit().
 */

import path from 'path';
import { execFileSync } from 'child_process';
import v8 from 'v8';
import cliProgress from 'cli-progress';
import * as fsSync from 'node:fs';
import { createRequire } from 'module';
import { closeCgdb } from '../core/cgdb/cgdb-adapter.js';
import {
  getStoragePaths,
  getGlobalRegistryPath,
  RegistryNameCollisionError,
} from '../storage/repo-manager.js';
import { getGitRoot, hasGitDir } from '../storage/git.js';
import { runFullAnalysis } from '../core/run-analyze.js';
import {
  parseAnalyzeProfile,
  parseCompressionOption,
  parseEmbeddingMode,
  type AnalyzeProfileOption,
  type CompressionOption,
  type EmbeddingMode,
} from '../core/adaptive-profile.js';
import { getMaxFileSizeBannerMessage } from '../core/ingestion/utils/max-file-size.js';
import fs from 'fs/promises';
import { formatBytes, LARGE_INDEX_WARNING_BYTES, summarizeIndexStorage } from './status.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };
const CLI_PACKAGE_SPEC = `@codragraph/cli@${pkg.version}`;
const HEAP_MB = 8192;
const HEAP_FLAG = `--max-old-space-size=${HEAP_MB}`;
/** Increase default stack size (KB) to prevent stack overflow on deep class hierarchies. */
const STACK_KB = 4096;
const STACK_FLAG = `--stack-size=${STACK_KB}`;

function hasNodeFlag(flagName: string, nodeOpts: string, execArgv: readonly string[]): boolean {
  return (
    nodeOpts.includes(flagName) ||
    execArgv.some((arg) => arg === flagName || arg.startsWith(`${flagName}=`))
  );
}

/** Re-exec the process with an 8GB heap and larger stack if we're currently below that. */
function ensureHeap(): boolean {
  const nodeOpts = process.env.NODE_OPTIONS || '';
  if (hasNodeFlag('--max-old-space-size', nodeOpts, process.execArgv)) return false;

  const v8Heap = v8.getHeapStatistics().heap_size_limit;
  if (v8Heap >= HEAP_MB * 1024 * 1024 * 0.9) return false;

  // --stack-size is a V8 flag not allowed in NODE_OPTIONS on Node 24+,
  // so pass it only as a direct CLI argument, not via the environment.
  const cliFlags = [HEAP_FLAG];
  if (!hasNodeFlag('--stack-size', nodeOpts, process.execArgv)) cliFlags.push(STACK_FLAG);

  try {
    // Preserve loader/debug flags from the outer process. This is required
    // for source-mode invocations such as `tsx src/cli/index.ts analyze`;
    // otherwise the child runs plain node against .ts files and cannot
    // resolve the emitted .js import specifiers.
    execFileSync(process.execPath, [...process.execArgv, ...cliFlags, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: `${nodeOpts} ${HEAP_FLAG}`.trim() },
    });
  } catch (e: any) {
    process.exitCode = e.status ?? 1;
  }
  return true;
}

export interface AnalyzeOptions {
  force?: boolean;
  embeddings?: boolean;
  /** Adaptive runtime profile. `auto` detects CPU/RAM/heap and chooses lean/balanced/power. */
  profile?: AnalyzeProfileOption;
  /** Embedding policy. `--embeddings` is kept as a shortcut for `on`. */
  embeddingMode?: EmbeddingMode;
  skills?: boolean;
  verbose?: boolean;
  /** Skip AGENTS.md and CLAUDE.md codragraph block updates. */
  skipAgentsMd?: boolean;
  /** Omit volatile symbol/relationship counts from AGENTS.md and CLAUDE.md. */
  noStats?: boolean;
  /** Index the folder even when no .git directory is present. */
  skipGit?: boolean;
  /**
   * Override the default basename-derived registry `name` with a
   * user-supplied alias (#829). Disambiguates repos whose paths share a
   * basename. Persisted — subsequent re-analyses of the same path without
   * `--name` preserve the alias.
   */
  name?: string;
  /**
   * Allow registration even when another path already uses the same
   * `--name` alias (#829). Intentionally a distinct flag from `--force`
   * because the user may want to coexist under the same name WITHOUT
   * paying the cost of a pipeline re-index. Maps to registerRepo's
   * `allowDuplicateName` option end-to-end.
   */
  allowDuplicateName?: boolean;
  /**
   * Override the walker's large-file skip threshold (#991). Value in KB;
   * clamped downstream to the tree-sitter 32 MB ceiling. Sets
   * `CODRAGRAPH_MAX_FILE_SIZE` for the rest of the pipeline.
   */
  maxFileSize?: string;
  /**
   * First-run auto-setup gate. Default `true` (commander injects this from the
   * `--no-setup` flag — see CLI registration). When `true`, `analyze` detects a
   * missing `~/.codragraph/registry.json` and runs editor setup before indexing,
   * making `npx @codragraph/cli analyze` a true zero-install entry. Pass
   * `--no-setup` to opt out (CI, headless servers, automated pipelines).
   */
  setup?: boolean;
  /**
   * Comma-separated list of editor targets for `--skills` output. Valid values
   * are `claude`, `cursor`, `opencode`, `codex`. Default: `claude` (matches
   * pre-flag behavior). Unknown values are reported and ignored.
   */
  skillTargets?: string;
  /**
   * RFC 0001 Phase 2 - per-row content compression. Accepts `'auto'`
   * (default), `'none'`, `'brotli'` (Node >= 18), or `'zstd'`
   * (Node >= 22.15). Compressed indexes are still queryable via the standard
   * read path; decode happens at every external-consumer boundary
   * (MCP, HTTP API, embeddings, CLI tools).
   */
  compress?: CompressionOption;
}

export const analyzeCommand = async (inputPath?: string, options?: AnalyzeOptions) => {
  if (ensureHeap()) return;

  if (options?.verbose) {
    process.env.CODRAGRAPH_VERBOSE = '1';
  }

  try {
    parseAnalyzeProfile(options?.profile);
    parseEmbeddingMode(options?.embeddingMode);
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    process.exitCode = 2;
    return;
  }

  // RFC 0001 Phase 2 - validate --compress before doing any work. Catching
  // a typo or an unsupported encoding here is much friendlier than failing
  // mid-analyze with an opaque CSV-write error. Node-version gating for
  // zstd lives in @codragraph/graphstore via isEncodingSupported, but we
  // import the check here so the CLI can offer the brotli fallback hint.
  const requestedCompress = options?.compress ?? 'auto';
  try {
    parseCompressionOption(requestedCompress);
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    process.exitCode = 2;
    return;
  }
  if (requestedCompress !== 'auto' && requestedCompress !== 'none') {
    if (requestedCompress === 'zstd') {
      const { isEncodingSupported } = await import('@codragraph/graphstore');
      if (!isEncodingSupported('zstd')) {
        console.error(
          '  --compress zstd requires Node ≥ 22.15.0 (native node:zlib zstd).\n' +
            `  Detected Node ${process.version}. Use --compress brotli instead, or upgrade Node.`,
        );
        process.exitCode = 2;
        return;
      }
    }

    // RFC 0001 Phase 2.5 — BM25 / FTS now drops `content` from its
    // property list when meta.compress is non-'none' (see
    // `core/search/bm25-index.ts`), so search inside compressed bodies
    // gracefully falls back to name-only matches instead of tokenising
    // base64 garbage. Surface the trade-off so users know what they're
    // opting into.
    console.warn(
      `  Note: --compress ${requestedCompress} reduces .codragraph/cgdb size.\n` +
        `  BM25 search will index symbol names only (function bodies are not tokenised\n` +
        `  when compressed); embeddings, graph queries, and \`context\` / \`impact\` are\n` +
        `  unaffected. Run with --compress none if you rely on full-text search inside\n` +
        `  source bodies.`,
    );
  }

  if (options?.maxFileSize) {
    process.env.CODRAGRAPH_MAX_FILE_SIZE = options.maxFileSize;
  }

  // ── Auto-reindex coalesce-file cleanup ─────────────────────────────
  // When the Claude Code PostToolUse hook spawns us in background mode, it
  // passes the coalesce file path through this env var. We delete it on every
  // exit path so the next commit immediately triggers a new reindex (rather
  // than being blocked by a 10-min mtime TTL). The hook's TTL is just a
  // crash safety net — this is the happy path.
  const reindexLockPath = process.env.CODRAGRAPH_REINDEX_LOCK_PATH || '';
  if (reindexLockPath) {
    process.on('exit', () => {
      try {
        fsSync.unlinkSync(reindexLockPath);
      } catch {
        /* already gone or unreadable — fine */
      }
    });
  }

  console.log('\n  CodraGraph Analyzer\n');

  let repoPath: string;
  if (inputPath) {
    repoPath = path.resolve(inputPath);
  } else {
    const gitRoot = getGitRoot(process.cwd());
    if (!gitRoot) {
      if (!options?.skipGit) {
        console.log(
          '  Not inside a git repository.\n  Tip: pass --skip-git to index any folder without a .git directory.\n',
        );
        process.exitCode = 1;
        return;
      }
      // --skip-git: fall back to cwd as the root
      repoPath = path.resolve(process.cwd());
    } else {
      repoPath = gitRoot;
    }
  }

  const repoHasGit = hasGitDir(repoPath);
  if (!repoHasGit && !options?.skipGit) {
    console.log(
      '  Not a git repository.\n  Tip: pass --skip-git to index any folder without a .git directory.\n',
    );
    process.exitCode = 1;
    return;
  }
  if (!repoHasGit) {
    console.log(
      '  Warning: no .git directory found \u2014 commit-tracking and incremental updates disabled.\n',
    );
  }

  // ── First-run auto-setup ───────────────────────────────────────────
  // Makes `npx @codragraph/cli analyze` a true one-command entry. Validate
  // the target repo first so invalid invocations fail fast without mutating
  // editor/global config.
  if (options?.setup !== false) {
    let registryExists = true;
    try {
      await fs.access(getGlobalRegistryPath());
    } catch {
      registryExists = false;
    }
    if (!registryExists) {
      const { runSetup } = await import('./setup.js');
      await runSetup({ skipNextSteps: true, compactHeader: true });
    }
  }

  // KuzuDB migration cleanup is handled by runFullAnalysis internally.
  // Note: --skills is handled after runFullAnalysis using the returned pipelineResult.

  if (process.env.CODRAGRAPH_NO_GITIGNORE) {
    console.log(
      '  CODRAGRAPH_NO_GITIGNORE is set — skipping .gitignore (still reading .codragraphignore)\n',
    );
  }

  const maxFileSizeBanner = getMaxFileSizeBannerMessage();
  if (maxFileSizeBanner) {
    console.log(`${maxFileSizeBanner}\n`);
  }

  // ── CLI progress bar setup ─────────────────────────────────────────
  const bar = new cliProgress.SingleBar(
    {
      format: '  {bar} {percentage}% | {phase}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      barGlue: '',
      autopadding: true,
      clearOnComplete: false,
      stopOnComplete: false,
    },
    cliProgress.Presets.shades_grey,
  );

  bar.start(100, 0, { phase: 'Initializing...' });

  // Graceful SIGINT handling
  let aborted = false;
  const sigintHandler = () => {
    if (aborted) process.exit(1);
    aborted = true;
    bar.stop();
    console.log('\n  Interrupted — cleaning up...');
    closeCgdb()
      .catch(() => {})
      .finally(() => process.exit(130));
  };
  process.on('SIGINT', sigintHandler);

  // Route console output through bar.log() to prevent progress bar corruption
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  let barCurrentValue = 0;
  const barLog = (...args: any[]) => {
    process.stdout.write('\x1b[2K\r');
    origLog(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    bar.update(barCurrentValue);
  };
  console.log = barLog;
  console.warn = barLog;
  console.error = barLog;

  // Track elapsed time per phase
  let lastPhaseLabel = 'Initializing...';
  let phaseStart = Date.now();

  const updateBar = (value: number, phaseLabel: string) => {
    barCurrentValue = value;
    if (phaseLabel !== lastPhaseLabel) {
      lastPhaseLabel = phaseLabel;
      phaseStart = Date.now();
    }
    const elapsed = Math.round((Date.now() - phaseStart) / 1000);
    const display = elapsed >= 3 ? `${phaseLabel} (${elapsed}s)` : phaseLabel;
    bar.update(value, { phase: display });
  };

  const elapsedTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - phaseStart) / 1000);
    if (elapsed >= 3) {
      bar.update({ phase: `${lastPhaseLabel} (${elapsed}s)` });
    }
  }, 1000);

  const t0 = Date.now();

  // ── Run shared analysis orchestrator ───────────────────────────────
  try {
    const result = await runFullAnalysis(
      repoPath,
      {
        // Pipeline re-index — OR'd with --skills because skill generation
        // needs a fresh pipelineResult. Has no bearing on the registry
        // collision guard (see allowDuplicateName below).
        force: options?.force || options?.skills,
        embeddings: options?.embeddings,
        skipGit: options?.skipGit,
        skipAgentsMd: options?.skipAgentsMd,
        noStats: options?.noStats,
        registryName: options?.name,
        // Registry-collision bypass — its own CLI flag, intentionally NOT
        // overloading --force. A user who hits the collision guard should
        // be able to accept the duplicate name without also paying the
        // cost of a full pipeline re-index. See #829 review round 2.
        allowDuplicateName: options?.allowDuplicateName,
        // RFC 0001 Phase 2 — pass through the per-row encoding choice.
        // Default 'auto' lets the adaptive profile choose the storage tier.
        compress: options?.compress,
        profile: options?.profile,
        embeddingMode: options?.embeddingMode,
      },
      {
        onProgress: (_phase, percent, message) => {
          updateBar(percent, message);
        },
        onLog: barLog,
      },
    );

    if (result.alreadyUpToDate) {
      clearInterval(elapsedTimer);
      process.removeListener('SIGINT', sigintHandler);
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      bar.stop();
      console.log(`  ${result.reuseReason ?? 'Already up to date'}\n`);
      // Safe to return without process.exit(0) — the early-return path in
      // runFullAnalysis never opens LadybugDB, so no native handles prevent exit.
      return;
    }

    // Skill generation (CLI-only, uses pipeline result from analysis)
    if (options?.skills && result.pipelineResult) {
      updateBar(99, 'Generating skill files...');
      try {
        const { generateSkillFiles, SKILL_TARGETS } = await import('./skill-gen.js');
        const { generateAIContextFiles } = await import('./ai-context.js');

        // Parse --skill-targets CSV; default to ['claude'] when omitted.
        // Unknown tokens are reported once and dropped — we don't fail the
        // whole analyze for a typo here, but we do want the user to see it.
        const requestedTargets = (options?.skillTargets || 'claude')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const validTargets = requestedTargets.filter((t) =>
          (SKILL_TARGETS as readonly string[]).includes(t),
        ) as Array<(typeof SKILL_TARGETS)[number]>;
        const invalidTargets = requestedTargets.filter(
          (t) => !(SKILL_TARGETS as readonly string[]).includes(t),
        );
        if (invalidTargets.length > 0) {
          barLog(
            `  Skills: unknown target(s) ignored: ${invalidTargets.join(', ')} ` +
              `(valid: ${SKILL_TARGETS.join(', ')})`,
          );
        }
        const targetsToUse: Array<(typeof SKILL_TARGETS)[number]> =
          validTargets.length > 0 ? validTargets : ['claude'];

        const skillResult = await generateSkillFiles(
          repoPath,
          result.repoName,
          result.pipelineResult,
          targetsToUse,
        );
        if (skillResult.skills.length > 0) {
          barLog(`  Generated ${skillResult.skills.length} skill files`);
          // Re-generate AI context files now that we have skill info
          const s = result.stats;
          const communityResult = result.pipelineResult?.communityResult;
          let aggregatedClusterCount = 0;
          if (communityResult?.communities) {
            const groups = new Map<string, number>();
            for (const c of communityResult.communities) {
              const label = c.heuristicLabel || c.label || 'Unknown';
              groups.set(label, (groups.get(label) || 0) + c.symbolCount);
            }
            aggregatedClusterCount = Array.from(groups.values()).filter(
              (count: number) => count >= 5,
            ).length;
          }
          const { storagePath: sp } = getStoragePaths(repoPath);
          await generateAIContextFiles(
            repoPath,
            sp,
            result.repoName,
            {
              files: s.files ?? 0,
              nodes: s.nodes ?? 0,
              edges: s.edges ?? 0,
              communities: s.communities,
              clusters:
                result.pipelineResult?.featureClusterResult?.stats.totalClusters ??
                aggregatedClusterCount,
              processes: s.processes,
            },
            skillResult.skills,
            { skipAgentsMd: options?.skipAgentsMd, noStats: options?.noStats },
          );
        }
      } catch {
        /* best-effort */
      }
    }

    const totalTime = ((Date.now() - t0) / 1000).toFixed(1);

    clearInterval(elapsedTimer);
    process.removeListener('SIGINT', sigintHandler);

    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;

    bar.update(100, { phase: 'Done' });
    bar.stop();

    // ── Summary ────────────────────────────────────────────────────
    const s = result.stats;
    console.log(`\n  Repository indexed successfully (${totalTime}s)\n`);
    console.log(
      `  ${(s.nodes ?? 0).toLocaleString()} nodes | ${(s.edges ?? 0).toLocaleString()} edges | ${s.communities ?? 0} clusters | ${s.processes ?? 0} flows`,
    );
    console.log(`  ${repoPath}`);

    try {
      const { storagePath } = getStoragePaths(repoPath);
      const storageSummary = await summarizeIndexStorage(storagePath);
      if (storageSummary) {
        console.log(`  .codragraph size: ${formatBytes(storageSummary.bytes)}`);
        if (storageSummary.bytes >= LARGE_INDEX_WARNING_BYTES) {
          console.log(
            `  Storage warning: index is >= ${formatBytes(LARGE_INDEX_WARNING_BYTES)}. ` +
              `Use --compress brotli (or zstd on Node >=22.15) and reserve --embeddings for repos that need vector search.`,
          );
        }
      }
    } catch {
      /* size summary is best-effort */
    }

    // Surface @codragraph/compress's value prop with concrete numbers: how
    // many tokens of distilled context did we generate. Best-effort — never
    // fail the analyze for a stat read.
    try {
      const { estimateTokens } = await import('./compress-stats.js');
      const candidates = ['AGENTS.md', 'CLAUDE.md'];
      const sizes: string[] = [];
      for (const file of candidates) {
        try {
          const content = await fs.readFile(path.join(repoPath, file), 'utf-8');
          sizes.push(`${file} ~${estimateTokens(content).toLocaleString()} tokens`);
        } catch {
          /* file not generated for this run — skip */
        }
      }
      if (sizes.length > 0) {
        console.log(`  @codragraph/compress: ${sizes.join(' | ')}`);
      }
    } catch {
      /* compress-stats import failed — non-fatal */
    }

    console.log('');
  } catch (err: any) {
    clearInterval(elapsedTimer);
    process.removeListener('SIGINT', sigintHandler);
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    bar.stop();

    const msg = err.message || String(err);

    // Registry name-collision from --name (#829) — surface as an
    // actionable error rather than a generic stack-trace.
    if (err instanceof RegistryNameCollisionError) {
      console.error(`\n  Registry name collision:\n`);
      console.error(`    "${err.registryName}" is already used by "${err.existingPath}".\n`);
      console.error(`  Options:`);
      console.error(`    • Pick a different alias:  codragraph analyze --name <alias>`);
      console.error(
        `    • Allow the duplicate:     codragraph analyze --allow-duplicate-name  (leaves "-r ${err.registryName}" ambiguous)`,
      );
      console.error('');
      process.exitCode = 1;
      return;
    }

    console.error(`\n  Analysis failed: ${msg}\n`);

    // Provide helpful guidance for known failure modes
    if (
      msg.includes('Maximum call stack size exceeded') ||
      msg.includes('call stack') ||
      msg.includes('Map maximum size') ||
      msg.includes('Invalid array length') ||
      msg.includes('Invalid string length') ||
      msg.includes('allocation failed') ||
      msg.includes('heap out of memory') ||
      msg.includes('JavaScript heap')
    ) {
      console.error('  This error typically occurs on very large repositories.');
      console.error('  Suggestions:');
      console.error('    1. Add large vendored/generated directories to .codragraphignore');
      console.error('    2. Increase Node.js heap: NODE_OPTIONS="--max-old-space-size=16384"');
      console.error('    3. Increase stack size: NODE_OPTIONS="--stack-size=4096"');
      console.error('');
    } else if (msg.includes('ERESOLVE') || msg.includes('Could not resolve dependency')) {
      // Note: the original arborist "Cannot destructure property 'package' of
      // 'node.target'" crash happens inside npm *before* codragraph code runs,
      // so it can't be caught here.  This branch handles dependency-resolution
      // errors that surface at runtime (e.g. dynamic require failures).
      console.error('  This looks like a package-manager dependency resolution issue.');
      console.error('  Suggestions:');
      console.error('    1. Clear the npm cache:    npm cache clean --force');
      console.error('    2. Update npm:             npm install -g npm@latest');
      console.error(`    3. Reinstall codragraph:     npm install -g ${CLI_PACKAGE_SPEC}`);
      console.error(`    4. Or try npx directly:    npx ${CLI_PACKAGE_SPEC} analyze`);
      console.error(`    5. Bun alternative:        bunx ${CLI_PACKAGE_SPEC} analyze`);
      console.error('');
    } else if (
      msg.includes('MODULE_NOT_FOUND') ||
      msg.includes('Cannot find module') ||
      msg.includes('ERR_MODULE_NOT_FOUND')
    ) {
      console.error('  A required module could not be loaded. The installation may be corrupt.');
      console.error('  Suggestions:');
      console.error(`    1. Reinstall:   npm install -g ${CLI_PACKAGE_SPEC}`);
      console.error(
        `    2. Clear cache: npm cache clean --force && npx ${CLI_PACKAGE_SPEC} analyze`,
      );
      console.error(`    3. Bun cache:   bun pm cache rm && bunx ${CLI_PACKAGE_SPEC} analyze`);
      console.error('');
    }

    process.exitCode = 1;
    return;
  }

  // LadybugDB's native module holds open handles that prevent Node from exiting.
  // ONNX Runtime also registers native atexit hooks that segfault on some
  // platforms (#38, #40). Force-exit to ensure clean termination.
  process.exit(0);
};
