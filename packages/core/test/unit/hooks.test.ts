/**
 * Regression Tests: Claude Code Hooks
 *
 * Tests the hook scripts (codragraph-hook.cjs and codragraph-hook.js) that run
 * as PreToolUse and PostToolUse hooks in Claude Code.
 *
 * Covers:
 * - extractPattern: pattern extraction from Grep/Glob/Bash tool inputs
 * - findCodraGraphDir: .codragraph directory discovery
 * - handlePostToolUse: staleness detection after git mutations
 * - cwd validation: rejects relative paths (defense-in-depth)
 * - shell injection: verifies no shell: true in spawnSync calls
 * - dispatch map: correct handler routing
 * - cross-platform: Windows .cmd extension handling
 *
 * Since the hooks are CJS scripts that call main() on load, we test them
 * by spawning them as child processes with controlled stdin JSON.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runHook, parseHookOutput } from '../utils/hook-test-helpers.js';

// ─── Paths to both hook variants ────────────────────────────────────

const CJS_HOOK = path.resolve(__dirname, '..', '..', 'hooks', 'claude', 'codragraph-hook.cjs');
// The Claude plugin lives under `integrations/claude/` on disk and publishes
// as `@codragraph/claude-plugin` on npm.
const PLUGIN_HOOK = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'integrations',
  'claude',
  'hooks',
  'codragraph-hook.js',
);
const CODEX_HOOK = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'integrations',
  'codex',
  'hooks',
  'codragraph-codex-hook.js',
);

// ─── Test fixtures: temporary .codragraph directory ───────────────────

let tmpDir: string;
let codragraphDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codragraph-hook-test-'));
  codragraphDir = path.join(tmpDir, '.codragraph');
  fs.mkdirSync(codragraphDir, { recursive: true });

  // Initialize a bare git repo so git rev-parse HEAD works
  spawnSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(tmpDir, 'dummy.txt'), 'hello');
  spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helper to get HEAD commit hash ─────────────────────────────────

function getHeadCommit(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: tmpDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return (result.stdout || '').trim();
}

// ─── Both hook files should exist ───────────────────────────────────

describe('Hook files exist', () => {
  it('CJS hook exists', () => {
    expect(fs.existsSync(CJS_HOOK)).toBe(true);
  });

  it('Plugin hook exists', () => {
    expect(fs.existsSync(PLUGIN_HOOK)).toBe(true);
  });

  it('Codex hook exists', () => {
    expect(fs.existsSync(CODEX_HOOK)).toBe(true);
  });
});

// ─── Source code regression: no shell: true ──────────────────────────

describe('Shell injection regression', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook has no shell: true in spawnSync calls`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      // Match spawnSync calls with shell option set to true or a variable
      // Allowed: comments mentioning shell: true, string literals
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments and string literals
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // Check for shell: true or shell: isWin in actual code
        if (/shell:\s*(true|isWin)/.test(line)) {
          throw new Error(`${label} hook line ${i + 1} has shell injection risk: ${line.trim()}`);
        }
      }
    });
  }
});

// ─── Source code regression: .cmd extensions for Windows ─────────────

describe('Windows .cmd extension handling', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook never invokes package runners from the hot path`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).not.toContain('runner.bin');
      expect(source).not.toContain("'npx'");
      expect(source).not.toContain("'bunx'");
    });
  }

  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook uses cmd wrapper for Windows codragraph binary`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain("'/c', 'codragraph'");
    });
  }
});

// ─── Source code regression: cwd validation ─────────────────────────

describe('cwd validation guards', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook validates cwd is absolute path`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      const cwdChecks = (source.match(/path\.isAbsolute\(cwd\)/g) || []).length;
      // Should have at least 2 checks (one in PreToolUse, one in PostToolUse)
      expect(cwdChecks).toBeGreaterThanOrEqual(2);
    });
  }
});

// ─── Source code regression: sendHookResponse used consistently ──────

describe('sendHookResponse consistency', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook uses sendHookResponse in both handlers`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      const calls = (source.match(/sendHookResponse\(/g) || []).length;
      // At least 3: definition + PreToolUse call + PostToolUse call
      expect(calls).toBeGreaterThanOrEqual(3);
    });

    it(`${label} hook does not inline hookSpecificOutput JSON in handlers`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      // Count inline hookSpecificOutput usage (should only be in sendHookResponse definition)
      const inlineCount = (source.match(/hookSpecificOutput/g) || []).length;
      // Exactly 1 occurrence: inside the sendHookResponse function body
      expect(inlineCount).toBe(1);
    });
  }
});

// ─── Source code regression: dispatch map pattern ────────────────────

describe('Dispatch map pattern', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook uses dispatch map instead of if/else`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain('const handlers = {');
      expect(source).toContain('PreToolUse: handlePreToolUse');
      expect(source).toContain('PostToolUse: handlePostToolUse');
      // Should NOT have if/else dispatch in main()
      expect(source).not.toMatch(/if\s*\(hookEvent\s*===\s*'PreToolUse'\)/);
    });
  }
});

// ─── Source code regression: debug error truncation ──────────────────

describe('Debug error message truncation', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook truncates error messages to 200 chars`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain('.slice(0, 200)');
    });
  }
});

// ─── extractPattern regression (via source analysis) ────────────────

describe('Hook write-path guard', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} PostToolUse does not start background analyze`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).not.toContain('CODRAGRAPH_AUTO_REINDEX');
      expect(source).not.toContain('autoReindex');
      expect(source).not.toContain('.reindex.coalesce');
      expect(source).toContain('Hooks never start analyze in the background');
    });
  }
});

describe('Codex hook regressions', () => {
  it('never invokes package runners from the hot path', () => {
    const source = fs.readFileSync(CODEX_HOOK, 'utf-8');
    expect(source).not.toContain("'npx'");
    expect(source).not.toContain("'bunx'");
  });

  it('does not run detect-changes from the post-edit path', () => {
    const source = fs.readFileSync(CODEX_HOOK, 'utf-8');
    expect(source).not.toContain("['detect-changes'");
    expect(source).not.toContain("['detect_changes'");
    expect(source).toContain('hasWorkingTreeChanges');
  });

  it('uses stderr graph context when augment writes there', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codragraph-codex-hook-'));
    const fakeBin = path.join(tempDir, 'bin');
    fs.mkdirSync(fakeBin, { recursive: true });
    const fakeCli = path.join(
      fakeBin,
      process.platform === 'win32' ? 'codragraph.cmd' : 'codragraph',
    );
    fs.writeFileSync(
      fakeCli,
      process.platform === 'win32'
        ? '@echo off\r\necho GRAPH_FROM_STDERR 1>&2\r\nexit /b 0\r\n'
        : '#!/bin/sh\necho GRAPH_FROM_STDERR >&2\nexit 0\n',
    );
    if (process.platform !== 'win32') fs.chmodSync(fakeCli, 0o755);

    try {
      const result = spawnSync(process.execPath, [CODEX_HOOK], {
        input: JSON.stringify({ args: { pattern: 'auth' }, repoRoot: tmpDir }),
        encoding: 'utf-8',
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const output = JSON.parse(result.stdout.trim());
      expect(output.context).toContain('GRAPH_FROM_STDERR');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('warns on uncommitted working-tree edits without opening the graph DB', () => {
    const head = getHeadCommit();
    fs.writeFileSync(path.join(codragraphDir, 'meta.json'), JSON.stringify({ lastCommit: head }));
    const dummyPath = path.join(tmpDir, 'dummy.txt');
    fs.writeFileSync(dummyPath, 'changed');

    try {
      const result = spawnSync(process.execPath, [CODEX_HOOK, '--post'], {
        input: JSON.stringify({ repoRoot: tmpDir }),
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const output = JSON.parse(result.stdout.trim());
      expect(output.context).toContain('uncommitted changes');
    } finally {
      fs.writeFileSync(dummyPath, 'hello');
    }
  });
});

describe('extractPattern coverage', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook extracts pattern from Grep tool input`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain("toolName === 'Grep'");
      expect(source).toContain('toolInput.pattern');
    });

    it(`${label} hook extracts pattern from Glob tool input`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain("toolName === 'Glob'");
    });

    it(`${label} hook extracts pattern from Bash grep/rg commands`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toMatch(/\\brg\\b.*\\bgrep\\b/);
    });

    it(`${label} hook rejects patterns shorter than 3 chars`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain('cleaned.length >= 3');
    });
  }
});

// ─── PostToolUse: git mutation regex coverage ───────────────────────

describe('Git mutation regex', () => {
  const _GIT_REGEX = /\\bgit\\s\+\(commit\|merge\|rebase\|cherry-pick\|pull\)/;

  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label} hook detects git commit`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain('commit');
    });

    it(`${label} hook detects git merge`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain('merge');
    });

    it(`${label} hook detects git rebase`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain('rebase');
    });

    it(`${label} hook detects git cherry-pick`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      expect(source).toContain('cherry-pick');
    });

    it(`${label} hook detects git pull`, () => {
      const source = fs.readFileSync(hookPath, 'utf-8');
      // 'pull' in the regex alternation
      expect(source).toMatch(/commit\|merge\|rebase\|cherry-pick\|pull/);
    });
  }
});

// ─── Integration: PostToolUse staleness detection ───────────────────

describe('PostToolUse staleness detection (integration)', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label}: emits stale notification when HEAD differs from meta`, () => {
      // Write meta.json with a different commit
      fs.writeFileSync(
        path.join(codragraphDir, 'meta.json'),
        JSON.stringify({ lastCommit: 'aaaaaaa0000000000000000000000000deadbeef', stats: {} }),
      );

      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "test"' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });

      const output = parseHookOutput(result.stdout);
      expect(output).not.toBeNull();
      expect(output!.hookEventName).toBe('PostToolUse');
      expect(output!.additionalContext).toContain('stale');
      expect(output!.additionalContext).toContain('aaaaaaa');
    });

    it(`${label}: silent when HEAD matches meta lastCommit`, () => {
      const head = getHeadCommit();
      fs.writeFileSync(
        path.join(codragraphDir, 'meta.json'),
        JSON.stringify({ lastCommit: head, stats: {} }),
      );

      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "test"' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });

      expect(result.stdout.trim()).toBe('');
    });

    it(`${label}: silent when tool is not Bash`, () => {
      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Grep',
        tool_input: { command: 'git commit -m "test"' },
        cwd: tmpDir,
      });
      expect(result.stdout.trim()).toBe('');
    });

    it(`${label}: silent when command is not a git mutation`, () => {
      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });
      expect(result.stdout.trim()).toBe('');
    });

    it(`${label}: silent when exit code is non-zero`, () => {
      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fail"' },
        tool_output: { exit_code: 1 },
        cwd: tmpDir,
      });
      expect(result.stdout.trim()).toBe('');
    });

    it(`${label}: includes --embeddings in suggestion when meta had embeddings`, () => {
      fs.writeFileSync(
        path.join(codragraphDir, 'meta.json'),
        JSON.stringify({ lastCommit: 'deadbeef', stats: { embeddings: 42 } }),
      );

      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git merge feature' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });

      const output = parseHookOutput(result.stdout);
      expect(output).not.toBeNull();
      expect(output!.additionalContext).toContain('--embeddings');
    });

    it(`${label}: omits --embeddings when meta had no embeddings`, () => {
      fs.writeFileSync(
        path.join(codragraphDir, 'meta.json'),
        JSON.stringify({ lastCommit: 'deadbeef', stats: { embeddings: 0 } }),
      );

      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "test"' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });

      const output = parseHookOutput(result.stdout);
      expect(output).not.toBeNull();
      expect(output!.additionalContext).not.toContain('--embeddings');
    });

    it(`${label}: detects git rebase as a mutation`, () => {
      fs.writeFileSync(
        path.join(codragraphDir, 'meta.json'),
        JSON.stringify({ lastCommit: 'oldcommit', stats: {} }),
      );

      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git rebase main' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });

      const output = parseHookOutput(result.stdout);
      expect(output).not.toBeNull();
      expect(output!.additionalContext).toContain('stale');
    });

    it(`${label}: detects git cherry-pick as a mutation`, () => {
      fs.writeFileSync(
        path.join(codragraphDir, 'meta.json'),
        JSON.stringify({ lastCommit: 'oldcommit', stats: {} }),
      );

      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git cherry-pick abc123' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });

      const output = parseHookOutput(result.stdout);
      expect(output).not.toBeNull();
    });

    it(`${label}: detects git pull as a mutation`, () => {
      fs.writeFileSync(
        path.join(codragraphDir, 'meta.json'),
        JSON.stringify({ lastCommit: 'oldcommit', stats: {} }),
      );

      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git pull origin main' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });

      const output = parseHookOutput(result.stdout);
      expect(output).not.toBeNull();
    });
  }
});

// ─── Integration: cwd validation rejects relative paths ─────────────

describe('cwd validation (integration)', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label}: PostToolUse silent when cwd is relative`, () => {
      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "test"' },
        tool_output: { exit_code: 0 },
        cwd: 'relative/path',
      });
      expect(result.stdout.trim()).toBe('');
    });

    it(`${label}: PreToolUse silent when cwd is relative`, () => {
      const result = runHook(hookPath, {
        hook_event_name: 'PreToolUse',
        tool_name: 'Grep',
        tool_input: { pattern: 'validateUser' },
        cwd: 'relative/path',
      });
      expect(result.stdout.trim()).toBe('');
    });
  }
});

// ─── Integration: dispatch map routes correctly ─────────────────────

describe('Dispatch map routing (integration)', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label}: unknown hook_event_name produces no output`, () => {
      const result = runHook(hookPath, {
        hook_event_name: 'UnknownEvent',
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
        cwd: tmpDir,
      });
      expect(result.stdout.trim()).toBe('');
      expect(result.status).toBe(0);
    });

    it(`${label}: empty hook_event_name produces no output`, () => {
      const result = runHook(hookPath, {
        hook_event_name: '',
        tool_name: 'Bash',
        cwd: tmpDir,
      });
      expect(result.stdout.trim()).toBe('');
      expect(result.status).toBe(0);
    });

    it(`${label}: missing hook_event_name produces no output`, () => {
      const result = runHook(hookPath, {
        tool_name: 'Bash',
        cwd: tmpDir,
      });
      expect(result.stdout.trim()).toBe('');
      expect(result.status).toBe(0);
    });

    it(`${label}: invalid JSON input exits cleanly`, () => {
      const result = spawnSync(process.execPath, [hookPath], {
        input: 'not json at all',
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('');
    });

    it(`${label}: empty stdin exits cleanly`, () => {
      const result = spawnSync(process.execPath, [hookPath], {
        input: '',
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(result.status).toBe(0);
    });
  }
});

// ─── Integration: PostToolUse with missing meta.json ────────────────

describe('PostToolUse with missing/corrupt meta.json', () => {
  for (const [label, hookPath] of [
    ['CJS', CJS_HOOK],
    ['Plugin', PLUGIN_HOOK],
  ] as const) {
    it(`${label}: emits stale when meta.json does not exist`, () => {
      const metaPath = path.join(codragraphDir, 'meta.json');
      const hadMeta = fs.existsSync(metaPath);
      if (hadMeta) fs.unlinkSync(metaPath);

      try {
        const result = runHook(hookPath, {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m "test"' },
          tool_output: { exit_code: 0 },
          cwd: tmpDir,
        });

        const output = parseHookOutput(result.stdout);
        expect(output).not.toBeNull();
        expect(output!.additionalContext).toContain('never');
      } finally {
        // Restore meta.json for subsequent tests
        fs.writeFileSync(metaPath, JSON.stringify({ lastCommit: 'old', stats: {} }));
      }
    });

    it(`${label}: emits stale when meta.json is corrupt`, () => {
      const metaPath = path.join(codragraphDir, 'meta.json');
      fs.writeFileSync(metaPath, 'not valid json!!!');

      const result = runHook(hookPath, {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "test"' },
        tool_output: { exit_code: 0 },
        cwd: tmpDir,
      });

      const output = parseHookOutput(result.stdout);
      expect(output).not.toBeNull();
      expect(output!.additionalContext).toContain('never');

      // Restore
      fs.writeFileSync(metaPath, JSON.stringify({ lastCommit: 'old', stats: {} }));
    });
  }
});
