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
const { spawnSync } = require('node:child_process');

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
    // Post-edit: ask codragraph whether the index is now stale.
    const result = spawnSync('codragraph', ['detect-changes', '--scope=unstaged'], {
      cwd: payload.repoRoot ?? process.cwd(),
      encoding: 'utf-8',
      timeout: 8000,
    });
    const note =
      result.status === 0 && result.stdout
        ? `[CodraGraph] post-edit detect-changes:\n${result.stdout.slice(0, 1500)}`
        : '';
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
  const result = spawnSync('codragraph', ['augment', String(target)], {
    cwd: payload.repoRoot ?? process.cwd(),
    encoding: 'utf-8',
    timeout: 8000,
  });
  const enrichment =
    result.status === 0 && result.stdout
      ? `[CodraGraph] graph context for ${JSON.stringify(target)}:\n${result.stdout.slice(0, 2000)}`
      : '';
  process.stdout.write(JSON.stringify({ context: enrichment, blocked: false }));
};

main().catch((err) => {
  // Hooks must never crash the host CLI — emit empty + exit 0.
  process.stderr.write(`codragraph-codex-hook: ${err?.message ?? String(err)}\n`);
  process.stdout.write(JSON.stringify({ context: '', blocked: false }));
  process.exit(0);
});
