#!/usr/bin/env node
/**
 * Codex CLI hook — enriches the agent's working context with CodraGraph
 * impact + context information before tool calls. Same shape as the
 * Claude plugin hook (codragraph-claude-plugin/hooks/codragraph-hook.js)
 * but reads Codex-shaped input on stdin and writes the enrichment to
 * stdout (Codex inlines stdout into the next tool call's context).
 *
 * Codex hook protocol (JSON on stdin, JSON on stdout):
 *   in:  { tool, args, repoRoot }
 *   out: { context: string, blocked: false }
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// On Windows, npm-installed bins are .cmd shims. Node 22's spawn refuses
// to launch .cmd files directly (returns EINVAL); routing through `cmd /c`
// lets PATHEXT resolve to the right shim. POSIX direct-spawn is fine.
const IS_WIN = process.platform === 'win32';
const runCli = (args, opts) =>
  IS_WIN
    ? spawnSync('cmd', ['/c', 'codragraph', ...args], opts)
    : spawnSync('codragraph', args, opts);

const findCodraGraphDir = (startDir) => {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, '.codragraph');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};

const readMeta = (codragraphDir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(codragraphDir, 'meta.json'), 'utf-8'));
  } catch {
    return null;
  }
};

const currentGitHead = (cwd) => {
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.status === 0 ? (result.stdout || '').trim() : '';
  } catch {
    return '';
  }
};

const hasWorkingTreeChanges = (cwd) => {
  const gitQuiet = (args) => {
    try {
      return spawnSync('git', args, {
        cwd,
        timeout: 3000,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch {
      return { status: null };
    }
  };

  const unstaged = gitQuiet(['diff', '--quiet', '--ignore-submodules', '--']);
  const staged = gitQuiet(['diff', '--cached', '--quiet', '--ignore-submodules', '--']);
  return unstaged.status === 1 || staged.status === 1;
};

const main = async () => {
  const isPost = process.argv.includes('--post');
  let input = '';
  try {
    input = fs.readFileSync(0, 'utf-8');
  } catch {
    /* stdin not available — emit empty enrichment */
  }
  let payload = {};
  try {
    payload = input ? JSON.parse(input) : {};
  } catch {
    /* malformed input — emit empty */
  }

  if (isPost) {
    // Post-edit hooks must stay cheap and must never open LadybugDB. Running
    // detect-changes here can contend with MCP/analyze and makes every edit pay
    // DB startup cost. Compare git HEAD to meta.json instead and let the agent
    // decide when to run analyze.
    const cwd = payload.repoRoot ?? process.cwd();
    const codragraphDir = findCodraGraphDir(cwd);
    const meta = codragraphDir ? readMeta(codragraphDir) : null;
    const head = currentGitHead(cwd);
    let note = '';
    if (head && meta?.lastCommit && head !== meta.lastCommit) {
      note = `[CodraGraph] index is behind HEAD. Run \`codragraph analyze\` when you need fresh graph context.`;
    } else if (hasWorkingTreeChanges(cwd)) {
      note = `[CodraGraph] working tree has uncommitted changes. Run \`codragraph analyze\` when you need graph context for these edits.`;
    }
    process.stdout.write(JSON.stringify({ context: note, blocked: false }));
    return;
  }

  // Pre-tool: ask codragraph for graph context relevant to the tool args.
  const args = payload.args ?? {};
  const target = args.pattern ?? args.path ?? args.command ?? '';
  if (!target) {
    process.stdout.write(JSON.stringify({ context: '', blocked: false }));
    return;
  }
  const result = runCli(['augment', String(target)], {
    cwd: payload.repoRoot ?? process.cwd(),
    encoding: 'utf-8',
    timeout: 8000,
  });
  const graphOutput = result.stderr || result.stdout || '';
  const enrichment =
    result.status === 0 && graphOutput
      ? `[CodraGraph] graph context for ${JSON.stringify(target)}:\n${graphOutput.slice(0, 2000)}`
      : '';
  process.stdout.write(JSON.stringify({ context: enrichment, blocked: false }));
};

main().catch((err) => {
  // Hooks must never crash the host CLI — emit empty + exit 0.
  process.stderr.write(`codragraph-codex-hook: ${err?.message ?? String(err)}\n`);
  process.stdout.write(JSON.stringify({ context: '', blocked: false }));
  process.exit(0);
});
