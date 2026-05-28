#!/usr/bin/env node
/**
 * CodraGraph Claude Code Hook
 *
 * PreToolUse  — intercepts Grep/Glob/Bash searches and augments
 *               with graph context from the CodraGraph index.
 * PostToolUse — detects stale index after git mutations and notifies
 *               the agent to reindex.
 *
 * NOTE: SessionStart hooks are broken on Windows (Claude Code bug).
 * Session context is injected via CLAUDE.md / skills instead.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

/**
 * Decide whether background auto-reindex is opted in. Two equivalent signals:
 *   1. CODRAGRAPH_AUTO_REINDEX=1 in env (good for shells, CI)
 *   2. `{ "autoReindex": true }` in ~/.codragraph/config.json (good for GUI
 *      editor launches on Windows, where shell env doesn't propagate to
 *      hook child processes reliably)
 */
function isAutoReindexEnabled() {
  if (process.env.CODRAGRAPH_AUTO_REINDEX === '1') return true;
  try {
    const configPath = path.join(os.homedir(), '.codragraph', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config && config.autoReindex === true;
  } catch {
    return false;
  }
}

/**
 * Read JSON input from stdin synchronously.
 */
function readInput() {
  try {
    const data = fs.readFileSync(0, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Find the .codragraph directory by walking up from startDir.
 * Returns the path to .codragraph/ or null if not found.
 */
function findCodraGraphDir(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.codragraph');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Extract search pattern from tool input.
 */
function extractPattern(toolName, toolInput) {
  if (toolName === 'Grep') {
    return toolInput.pattern || null;
  }

  if (toolName === 'Glob') {
    const raw = toolInput.pattern || '';
    const match = raw.match(/[*\/]([a-zA-Z][a-zA-Z0-9_-]{2,})/);
    return match ? match[1] : null;
  }

  if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    if (!/\brg\b|\bgrep\b/.test(cmd)) return null;

    const tokens = cmd.split(/\s+/);
    let foundCmd = false;
    let skipNext = false;
    const flagsWithValues = new Set([
      '-e',
      '-f',
      '-m',
      '-A',
      '-B',
      '-C',
      '-g',
      '--glob',
      '-t',
      '--type',
      '--include',
      '--exclude',
    ]);

    for (const token of tokens) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (!foundCmd) {
        if (/\brg$|\bgrep$/.test(token)) foundCmd = true;
        continue;
      }
      if (token.startsWith('-')) {
        if (flagsWithValues.has(token)) skipNext = true;
        continue;
      }
      const cleaned = token.replace(/['"]/g, '');
      return cleaned.length >= 3 ? cleaned : null;
    }
    return null;
  }

  return null;
}

/**
 * Resolve the codragraph CLI path.
 * 1. Relative path (works when script is inside npm package)
 * 2. require.resolve (works when codragraph is globally installed)
 * 3. Fall back to a package runner (returns empty string)
 */
function resolveCliPath() {
  let cliPath = path.resolve(__dirname, '..', '..', 'dist', 'cli', 'index.js');
  if (!fs.existsSync(cliPath)) {
    try {
      cliPath = require.resolve('@codragraph/cli/cli/index');
    } catch {
      cliPath = '';
    }
  }
  return cliPath;
}

function isRunningUnderBun() {
  const userAgent = (process.env.npm_config_user_agent || '').toLowerCase();
  const execBase = path.basename(process.env.npm_execpath || '').toLowerCase();
  return userAgent.startsWith('bun/') || execBase === 'bun' || execBase === 'bun.exe';
}

function getPackageRunnerArgs(args) {
  const useBun = isRunningUnderBun();
  if (useBun) return { bin: 'bunx', args: ['@codragraph/cli', ...args] };
  return { bin: 'npx', args: ['-y', '@codragraph/cli', ...args] };
}

/**
 * Spawn a codragraph CLI command synchronously.
 * Returns the stderr output (KuzuDB captures stdout at OS level).
 */
function runCodraGraphCli(cliPath, args, cwd, timeout) {
  const isWin = process.platform === 'win32';
  if (cliPath) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      encoding: 'utf-8',
      timeout,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  // Package-runner fallback: on Windows, Node 22's spawn refuses to launch
  // `.cmd` shims directly, so route through `cmd /c`. POSIX direct-spawn is fine.
  const runner = getPackageRunnerArgs(args);
  if (isWin) {
    return spawnSync('cmd', ['/c', runner.bin, ...runner.args], {
      encoding: 'utf-8',
      timeout: timeout + 5000,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  return spawnSync(runner.bin, runner.args, {
    encoding: 'utf-8',
    timeout: timeout + 5000,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * PreToolUse handler — augment searches with graph context.
 */
function handlePreToolUse(input) {
  const cwd = input.cwd || process.cwd();
  if (!path.isAbsolute(cwd)) return;
  if (!findCodraGraphDir(cwd)) return;

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  if (toolName !== 'Grep' && toolName !== 'Glob' && toolName !== 'Bash') return;

  const pattern = extractPattern(toolName, toolInput);
  if (!pattern || pattern.length < 3) return;

  const cliPath = resolveCliPath();
  let result = '';
  try {
    const child = runCodraGraphCli(cliPath, ['augment', '--', pattern], cwd, 7000);
    if (!child.error && child.status === 0) {
      result = child.stderr || '';
    }
  } catch {
    /* graceful failure */
  }

  if (result && result.trim()) {
    sendHookResponse('PreToolUse', result.trim());
  }
}

/**
 * Emit a PostToolUse hook response with additional context for the agent.
 */
function sendHookResponse(hookEventName, message) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName, additionalContext: message },
    }),
  );
}

/**
 * PostToolUse handler — detect index staleness after git mutations.
 *
 * Instead of spawning a full `codragraph analyze` synchronously (which blocks
 * the agent for up to 120s and risks KuzuDB corruption on timeout), we do a
 * lightweight staleness check: compare `git rev-parse HEAD` against the
 * lastCommit stored in `.codragraph/meta.json`. If they differ, notify the
 * agent so it can decide when to reindex.
 */
function handlePostToolUse(input) {
  const toolName = input.tool_name || '';
  if (toolName !== 'Bash') return;

  const command = (input.tool_input || {}).command || '';
  if (!/\bgit\s+(commit|merge|rebase|cherry-pick|pull)(\s|$)/.test(command)) return;

  // Only proceed if the command succeeded
  const toolOutput = input.tool_output || {};
  if (toolOutput.exit_code !== undefined && toolOutput.exit_code !== 0) return;

  const cwd = input.cwd || process.cwd();
  if (!path.isAbsolute(cwd)) return;
  const codragraphDir = findCodraGraphDir(cwd);
  if (!codragraphDir) return;

  // Compare HEAD against last indexed commit — skip if unchanged
  let currentHead = '';
  try {
    const headResult = spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 3000,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    currentHead = (headResult.stdout || '').trim();
  } catch {
    return;
  }

  if (!currentHead) return;

  let lastCommit = '';
  let hadEmbeddings = false;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(codragraphDir, 'meta.json'), 'utf-8'));
    lastCommit = meta.lastCommit || '';
    hadEmbeddings = meta.stats && meta.stats.embeddings > 0;
  } catch {
    /* no meta — treat as stale */
  }

  // If HEAD matches last indexed commit, no reindex needed
  if (currentHead && currentHead === lastCommit) return;

  const analyzeArgs = `analyze${hadEmbeddings ? ' --embeddings' : ''}`;
  const analyzeCmd = `npx @codragraph/cli ${analyzeArgs} (or bunx @codragraph/cli ${analyzeArgs})`;

  // Opt-in background auto-reindex.
  // Default stays as notification-only because spawning analyze while an MCP
  // server holds LadybugDB will fail with a database-busy error — the
  // notification path lets the agent reindex at a quiet moment instead.
  // Power users who run MCP outside Claude Code's lifecycle can opt in via
  // CODRAGRAPH_AUTO_REINDEX=1 or `{ "autoReindex": true }` in
  // ~/.codragraph/config.json.
  if (isAutoReindexEnabled()) {
    // The "coalesce" file is a single-process gate: it exists only while a
    // reindex is in flight. The spawned analyze removes it on exit (success or
    // failure) via CODRAGRAPH_REINDEX_LOCK_PATH; the 10-min mtime fallback
    // catches the rare crash that bypasses analyze's exit handler.
    const coalescePath = path.join(codragraphDir, '.reindex.coalesce');
    const crashSafetyTtlMs = 10 * 60 * 1000;
    let inFlight = false;
    try {
      const stat = fs.statSync(coalescePath);
      if (Date.now() - stat.mtimeMs < crashSafetyTtlMs) inFlight = true;
    } catch {
      /* no coalesce file — no reindex in flight */
    }

    if (!inFlight) {
      try {
        fs.writeFileSync(coalescePath, String(process.pid));
      } catch {
        /* best-effort — gate is for coalescing, not correctness */
      }

      const cliPath = resolveCliPath();
      const reindexArgs = hadEmbeddings
        ? ['analyze', '--embeddings', '--no-setup']
        : ['analyze', '--no-setup'];
      const spawnEnv = { ...process.env, CODRAGRAPH_REINDEX_LOCK_PATH: coalescePath };
      const spawnOpts = {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: spawnEnv,
      };
      try {
        let child;
        if (cliPath) {
          child = spawn(process.execPath, [cliPath, ...reindexArgs], spawnOpts);
        } else if (process.platform === 'win32') {
          const runner = getPackageRunnerArgs(reindexArgs);
          child = spawn('cmd', ['/c', runner.bin, ...runner.args], spawnOpts);
        } else {
          const runner = getPackageRunnerArgs(reindexArgs);
          child = spawn(runner.bin, runner.args, spawnOpts);
        }
        child.unref();
      } catch {
        /* spawn failed — fall through to notification */
      }

      sendHookResponse(
        'PostToolUse',
        `CodraGraph: auto-reindex started in background ` +
          `(HEAD ${lastCommit ? lastCommit.slice(0, 7) : 'never'} → ${currentHead.slice(0, 7)}). ` +
          `If an MCP server is currently holding the database, the reindex will fail silently — ` +
          `run \`${analyzeCmd}\` manually after closing the agent session.`,
      );
      return;
    }

    sendHookResponse(
      'PostToolUse',
      `CodraGraph: auto-reindex coalesced — another reindex is in flight (will pick up your latest commit when it finishes).`,
    );
    return;
  }

  sendHookResponse(
    'PostToolUse',
    `CodraGraph index is stale (last indexed: ${lastCommit ? lastCommit.slice(0, 7) : 'never'}). ` +
      `Run \`${analyzeCmd}\` to update the knowledge graph. ` +
      `Set CODRAGRAPH_AUTO_REINDEX=1 (or autoReindex: true in ~/.codragraph/config.json) for background auto-reindex.`,
  );
}

// Dispatch map for hook events
const handlers = {
  PreToolUse: handlePreToolUse,
  PostToolUse: handlePostToolUse,
};

function main() {
  try {
    const input = readInput();
    const handler = handlers[input.hook_event_name || ''];
    if (handler) handler(input);
  } catch (err) {
    if (process.env.CODRAGRAPH_DEBUG) {
      console.error('CodraGraph hook error:', (err.message || '').slice(0, 200));
    }
  }
}

main();
