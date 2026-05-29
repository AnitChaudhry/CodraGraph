#!/usr/bin/env node
/**
 * CodraGraph Claude Code Plugin Hook
 *
 * PreToolUse  — intercepts Grep/Glob/Bash searches and augments
 *               with graph context from the CodraGraph index.
 * PostToolUse — detects stale index after git mutations and notifies
 *               the agent to reindex.
 *
 * NOTE: SessionStart hooks are broken on Windows (Claude Code bug #23576).
 * Session context is injected via CLAUDE.md / skills instead.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  for (let i = 0; i < 8; i++) {
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
 * Spawn a codragraph CLI command synchronously.
 * Detects binary on PATH once, then runs exactly once.
 *
 * SECURITY: Never use shell: true with user-controlled arguments.
 * On Windows, route through cmd /c so PATH shims resolve correctly.
 *
 * Note: the npm package is `@codragraph/cli`, but the executable it installs
 * is `codragraph`. PATH lookup must use the bin name; npx still uses the
 * scoped package name.
 */
function runCodraGraphCli(args, cwd, timeout) {
  const isWin = process.platform === 'win32';

  // Windows: direct spawn of package-manager shims can return EINVAL on
  // Node 22 because Node refuses to spawn .cmd files outside a shell. Use
  // `cmd /c <bin> ...` and let cmd resolve via PATHEXT. This works whether
  // `codragraph` is installed as `.cmd` shim, `.exe`, or via npm/bun/pnpm/yarn.
  // (Direct spawn is fine on POSIX; .cmd workaround is Windows-only.)

  // Detect whether 'codragraph' is on PATH (cheap check, no execution)
  let useDirectBinary = false;
  try {
    const which = spawnSync(isWin ? 'where' : 'which', ['codragraph'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    useDirectBinary = which.status === 0;
  } catch {
    /* not on PATH */
  }

  if (useDirectBinary) {
    if (isWin) {
      return spawnSync('cmd', ['/c', 'codragraph', ...args], {
        encoding: 'utf-8',
        timeout,
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    return spawnSync('codragraph', args, {
      encoding: 'utf-8',
      timeout,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  // Hooks run in the agent hot path. Never invoke npx/bunx here because that
  // can install/fetch packages and hang PowerShell sessions. If the CLI is not
  // already available, stay silent and let MCP/skills guide setup.
  return {
    status: 127,
    stdout: '',
    stderr: '',
    error: new Error('codragraph binary not found on PATH'),
  };
}

/**
 * Emit a hook response with additional context for the agent.
 */
function sendHookResponse(hookEventName, message) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName, additionalContext: message },
    }),
  );
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

  let result = '';
  try {
    const child = runCodraGraphCli(['augment', '--', pattern], cwd, 7000);
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
 * PostToolUse handler — detect index staleness after git mutations.
 *
 * Hooks must not own writes to `.codragraph`. They run inside the agent's hot
 * path, so starting analyze from here can contend with MCP/LadybugDB and make
 * normal edits feel hung. Keep this to a cheap metadata comparison and let the
 * user or agent run the CLI explicitly when fresh graph context is required.
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
  sendHookResponse(
    'PostToolUse',
    `CodraGraph index is stale (last indexed: ${lastCommit ? lastCommit.slice(0, 7) : 'never'}). ` +
      `Run \`${analyzeCmd}\` when you need fresh graph context. Hooks never start analyze in the background.`,
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
