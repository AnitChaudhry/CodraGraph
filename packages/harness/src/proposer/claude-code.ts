// Claude Code subprocess proposer.
//
// Mirrors the Meta-Harness paper's proposer-as-Claude-Code pattern (their
// Python claude_wrapper.py). We spawn `claude` non-interactively with a
// prompt that:
//   1. Points it at the candidate store (read-only filesystem 𝒟).
//   2. Points it at a fresh proposal directory to write new harness sources to.
//   3. Specifies the Harness contract path.
//   4. Asks for k candidates plus a stdout JSON manifest.
//
// After the subprocess exits, we scan the proposal directory for new
// harnesses and parse the manifest to recover names + rationales.
//
// Requires the `claude` CLI on PATH. API key configured in Claude Code's own
// config — we don't manage it here.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { HarnessSource, ProposeInput, Proposer, SourceFile } from './interface.js';

export interface ClaudeCodeProposerOptions {
  /** Path to the `claude` binary. Default: "claude" (resolved via PATH). */
  binary?: string;
  /** Where to write each iteration's proposals. Default: <storeRoot>/../proposals/. */
  proposalsRoot?: string;
  /** Absolute path to codragraph-harness/src/harness/interface.ts. Used in the prompt. */
  contractPath: string;
  /** Hard timeout for one propose() call. Default: 10 minutes. */
  timeoutMs?: number;
  /** Pass --dangerously-skip-permissions. Default: true (subprocess can't prompt). */
  skipPermissions?: boolean;
  /** Extra args to pass to `claude`. */
  extraArgs?: string[];
  /**
   * Optional role-specific guidance injected into the prompt's "Your task"
   * section. Used by ExplorerRole and ExploiterRole to bias the proposer
   * toward broad mutations vs targeted refinement, respectively.
   */
  additionalGuidance?: string;
  /**
   * Optional override of the proposer's identity name. Default: "claude-code".
   * Roles set this to "explorer" / "exploiter" so candidate metadata.origin
   * carries the role.
   */
  proposerName?: string;
  /**
   * Override the proposals subdirectory name within proposalsRoot. Default:
   * `iteration-<t>`. Swarm sets this to `iteration-<t>-<role>` so Explorer
   * and Exploiter writing concurrently don't collide.
   */
  iterationDirNamer?: (iteration: number) => string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class ClaudeCodeProposer implements Proposer {
  readonly name: string;
  constructor(private readonly options: ClaudeCodeProposerOptions) {
    this.name = options.proposerName ?? 'claude-code';
  }

  async propose(input: ProposeInput): Promise<HarnessSource[]> {
    const proposalsRoot =
      this.options.proposalsRoot ?? path.join(input.filesystem.rootPath, '..', 'proposals');
    const iterDirName =
      this.options.iterationDirNamer?.(input.iteration) ?? `iteration-${input.iteration}`;
    const iterationDir = path.join(proposalsRoot, iterDirName);
    await fs.mkdir(iterationDir, { recursive: true });

    const prompt = buildPrompt({
      candidatesRoot: input.filesystem.rootPath,
      proposalsDir: iterationDir,
      contractPath: this.options.contractPath,
      count: input.count,
      iteration: input.iteration,
      populationSize: input.populationSize,
      additionalGuidance: this.options.additionalGuidance,
    });

    await runClaude({
      binary: this.options.binary ?? 'claude',
      prompt,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      skipPermissions: this.options.skipPermissions ?? true,
      extraArgs: this.options.extraArgs ?? [],
    });

    return await readProposals(iterationDir);
  }
}

interface PromptArgs {
  candidatesRoot: string;
  proposalsDir: string;
  contractPath: string;
  count: number;
  iteration: number;
  populationSize: number;
  /** Optional role-specific guidance appended after "Your task". */
  additionalGuidance?: string;
}

function buildPrompt(args: PromptArgs): string {
  const taskGuidance = [
    `=== Your task ===`,
    `Write exactly ${args.count} new harness candidate directories under ${args.proposalsDir}/.`,
    `Each must default-export a Harness. Pick names that describe the mutation (e.g. "graph-aware-rerank", "few-shot-domain-prompt").`,
    `Avoid trivial mutations (renaming variables, reformatting). Each candidate should target a hypothesis you formed from reading 𝒟.`,
  ];
  if (args.additionalGuidance && args.additionalGuidance.trim().length > 0) {
    taskGuidance.push('', '=== Role-specific guidance ===', args.additionalGuidance.trim());
  }

  return [
    `You are proposing new harness candidates for the codragraph-harness Meta-Harness outer loop.`,
    ``,
    `Iteration: ${args.iteration}`,
    `Current population size: ${args.populationSize}`,
    `New candidates requested: ${args.count}`,
    ``,
    `=== Read first ===`,
    `1. Harness contract: ${args.contractPath}`,
    `2. Filesystem 𝒟 (every prior candidate, read-only): ${args.candidatesRoot}/`,
    `   For each candidate <id>/:`,
    `     - source/: TS source files implementing the Harness`,
    `     - traces/: per-task JSON traces from evaluator runs`,
    `     - score.json: aggregate {accuracy, tokens, latencyMs, taskCount, perTask}`,
    `     - metadata.json: name, version, origin, parents, createdAt`,
    `     - rationale.md: prior proposer's natural-language explanation (if any)`,
    ``,
    `Recommended reading order: list candidates sorted by accuracy desc; read source/ + traces/ for the top 3 and bottom 1; identify *why* the top performers win and the bottom loses; propose mutations that target the gap.`,
    ``,
    `=== Write to ===`,
    `Output directory for your proposals: ${args.proposalsDir}/`,
    `Layout per candidate:`,
    `  ${args.proposalsDir}/<your-candidate-name>/`,
    `    index.ts            # default-exports a Harness implementing the contract`,
    `    rationale.md        # short explanation of what you mutated and why`,
    ``,
    ...taskGuidance,
    ``,
    `=== Output ===`,
    `When you finish writing files, print exactly one JSON line to stdout (and nothing else after it):`,
    `<<<HARNESS_MANIFEST>>>`,
    `[{"name": "<name>", "parents": ["<parent-id>"], "rationale": "<one-sentence>"}, ...]`,
    `<<<END_HARNESS_MANIFEST>>>`,
    ``,
    `Begin.`,
  ].join('\n');
}

interface RunArgs {
  binary: string;
  prompt: string;
  timeoutMs: number;
  skipPermissions: boolean;
  extraArgs: string[];
}

async function runClaude(args: RunArgs): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const flags = ['-p'];
    if (args.skipPermissions) flags.push('--dangerously-skip-permissions');
    flags.push(...args.extraArgs);
    flags.push(args.prompt);

    const child = spawn(args.binary, flags, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`claude proposer subprocess exceeded ${args.timeoutMs}ms`));
    }, args.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude proposer exited with code ${code}: ${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readProposals(iterationDir: string): Promise<HarnessSource[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(iterationDir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const out: HarnessSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidateDir = path.join(iterationDir, entry.name);
    const files = await readSourceTree(candidateDir, candidateDir);
    if (files.length === 0) continue;

    let rationale = '';
    try {
      rationale = await fs.readFile(path.join(candidateDir, 'rationale.md'), 'utf8');
    } catch {
      // missing rationale.md is OK — proposer may have skipped it.
    }

    out.push({
      name: entry.name,
      files: files.filter((f) => f.path !== 'rationale.md'),
      rationale,
    });
  }
  return out;
}

async function readSourceTree(dir: string, base: string): Promise<SourceFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: SourceFile[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await readSourceTree(full, base)));
    } else if (entry.isFile()) {
      const content = await fs.readFile(full, 'utf8');
      out.push({
        path: path.relative(base, full).replace(/\\/g, '/'),
        content,
      });
    }
  }
  return out;
}
