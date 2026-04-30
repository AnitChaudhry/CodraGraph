#!/usr/bin/env node
// `codragraph-codex` — merges the bundled codex.config.template.json into the
// user's `~/.codex/config.json`. Substitutes ${CODRAGRAPH_PLUGIN_ROOT} and
// ${HOME} with real absolute paths so Codex can locate the hook script and
// CodraGraph can find the user's home directory.
//
// Idempotent re-runs are safe:
//   - existing user keys outside of `hooks` / `mcpServers` are preserved
//   - entries we previously wrote are tracked in a sidecar file at
//     `~/.codex/.codragraph-managed.json` and are overwritten silently
//   - existing user entries we did NOT write are PRESERVED; we print a
//     warning and skip our entry rather than clobber user config
//
// The sidecar approach (vs. inline markers) keeps the user's codex config
// clean and avoids any chance of unknown-key collisions with Codex's schema.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const templatePath = path.join(pluginRoot, 'codex.config.template.json');

const codexDir = path.join(os.homedir(), '.codex');
const codexConfigPath = path.join(codexDir, 'config.json');
const managedPath = path.join(codexDir, '.codragraph-managed.json');

const substitute = (value) => {
  if (typeof value === 'string') {
    return value
      .replaceAll('${CODRAGRAPH_PLUGIN_ROOT}', pluginRoot)
      .replaceAll('${HOME}', os.homedir());
  }
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v);
    return out;
  }
  return value;
};

const readManagedSet = () => {
  if (!existsSync(managedPath)) return new Set();
  try {
    const data = JSON.parse(readFileSync(managedPath, 'utf8'));
    return new Set(Array.isArray(data?.keys) ? data.keys : []);
  } catch (err) {
    console.warn(
      `Warning: ${managedPath} is unreadable (${err.message}). ` +
        `Treating all current entries as user-owned to avoid clobbering them. ` +
        `Delete the sidecar to re-enable migration.`,
    );
    return new Set();
  }
};

// Detect entries that match the shape of an old-installer write (no sidecar
// existed yet, but the entry is clearly ours). Used to migrate users who ran
// the broken pre-sidecar installer; without this, their stale `${HOME}` literal
// would be preserved forever as "user-owned."
const looksLikeOurOldEntry = (key, name, value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cmd = typeof value.command === 'string' ? value.command : '';
  const args = Array.isArray(value.args) ? value.args : [];

  // mcpServers.codragraph: command "codragraph" with args ["mcp"], or the
  // npx fallback shape we shipped previously
  if (key === 'mcpServers' && name === 'codragraph') {
    if (cmd === 'codragraph' && args[0] === 'mcp') return true;
    if (args.some((a) => typeof a === 'string' && a.includes('@codragraph/cli'))) return true;
    if (args.some((a) => typeof a === 'string' && a.includes('codragraph@latest'))) return true;
    return false;
  }

  // hooks.preToolUse / hooks.postToolUse: command path references the hook
  // script we ship
  if (key === 'hooks') {
    return cmd.includes('codragraph-codex-hook.js');
  }

  return false;
};

// The mcpServer entry is generated here (not in the template) so we can pick
// a launcher that actually works on this platform. On Windows, Node's spawn
// refuses to launch `codragraph` (extensionless Unix shim — ENOENT) or
// `codragraph.cmd` (EINVAL). Routing through `cmd /c` lets PATHEXT resolve
// the right shim. POSIX direct-spawn is fine.
const buildMcpServerEntry = () =>
  process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'codragraph', 'mcp'] }
    : { command: 'codragraph', args: ['mcp'] };

const template = substitute(JSON.parse(readFileSync(templatePath, 'utf8')));
// Inject the platform-correct mcpServer; the template only ships hooks.
template.mcpServers = { ...(template.mcpServers ?? {}), codragraph: buildMcpServerEntry() };
const managed = readManagedSet();
// The migration gate is "did the sidecar file exist?" — NOT "does it have
// keys?" An empty sidecar (e.g. `{"keys":[]}` from a clean uninstall, or a
// truncated write) means the user has previously been through this installer
// and any current entries are user-owned. Re-running migration in that state
// would silently overwrite them.
const sidecarExisted = existsSync(managedPath);
const nowManaged = new Set();

// Strip a UTF-8 BOM (`﻿`) before parsing — PowerShell, Notepad, and
// some Windows editors save JSON with a leading BOM that JSON.parse rejects.
const parseConfig = (raw) => JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);

let existing = {};
if (existsSync(codexConfigPath)) {
  try {
    existing = parseConfig(readFileSync(codexConfigPath, 'utf8'));
  } catch (err) {
    console.error(`Refusing to overwrite ${codexConfigPath}: not valid JSON (${err.message}).`);
    console.error('Fix or remove the file and re-run `codragraph-codex`.');
    process.exit(1);
  }
}

const warnings = [];

const migrated = [];

const mergeNamespace = (key) => {
  const existingNs = existing[key] ?? {};
  const templateNs = template[key] ?? {};
  const out = { ...existingNs };
  for (const [name, value] of Object.entries(templateNs)) {
    const fqn = `${key}.${name}`;
    if (out[name] && !managed.has(fqn)) {
      // First-run migration: the old installer didn't write a sidecar, so on
      // the first run after upgrade we adopt entries that match our old shape.
      // Subsequent runs go through the normal sidecar path.
      if (!sidecarExisted && looksLikeOurOldEntry(key, name, out[name])) {
        migrated.push(fqn);
        out[name] = value;
        nowManaged.add(fqn);
        continue;
      }
      warnings.push(
        `  - ${fqn} already set by user — leaving untouched. ` +
          `Remove that entry from ${codexConfigPath} and re-run if you want CodraGraph to manage it.`,
      );
      continue;
    }
    out[name] = value;
    nowManaged.add(fqn);
  }
  return out;
};

const merged = {
  ...existing,
  hooks: mergeNamespace('hooks'),
  mcpServers: mergeNamespace('mcpServers'),
};

mkdirSync(codexDir, { recursive: true });
writeFileSync(codexConfigPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
writeFileSync(
  managedPath,
  JSON.stringify({ keys: [...nowManaged].sort() }, null, 2) + '\n',
  'utf8',
);

console.log(`CodraGraph + Codex wired up.`);
console.log(`  config:      ${codexConfigPath}`);
console.log(`  plugin root: ${pluginRoot}`);
if (migrated.length > 0) {
  console.log(`\nMigrated stale entries from a previous install:`);
  for (const m of migrated) console.log(`  - ${m}`);
}
if (warnings.length > 0) {
  console.log(`\nSkipped (user entries preserved):`);
  for (const w of warnings) console.log(w);
}
console.log(`Restart Codex to pick up the new hooks.`);
