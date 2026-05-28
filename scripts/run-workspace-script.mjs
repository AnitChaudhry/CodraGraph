#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [workspace, script, ...scriptArgs] = process.argv.slice(2);

if (!workspace || !script) {
  console.error('Usage: node scripts/run-workspace-script.mjs <workspace> <script> [...args]');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userAgent = (process.env.npm_config_user_agent ?? '').toLowerCase();
const execPath = path.basename(process.env.npm_execpath ?? '').toLowerCase();
const runningUnderBun =
  userAgent.startsWith('bun/') || execPath === 'bun' || execPath === 'bun.exe';

let command;
let args;

if (runningUnderBun) {
  command = 'bun';
  args = ['run', '--filter', workspace, script, ...scriptArgs];
} else if (process.platform === 'win32') {
  command = 'cmd';
  args = ['/c', 'npm', '--workspace', workspace, 'run', script, ...scriptArgs];
} else {
  command = 'npm';
  args = ['--workspace', workspace, 'run', script, ...scriptArgs];
}

const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
