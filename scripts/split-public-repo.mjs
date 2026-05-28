#!/usr/bin/env node
/**
 * Build the distribution-only public repository tree for CodraGraph.
 *
 * This script intentionally does NOT copy source directories such as
 * packages/, apps/, integrations/, docs/, infra/, or marketing/. The public
 * GitHub repo is a downloads/install repo; source remains in the private
 * working repository.
 *
 * Run:
 *   node scripts/split-public-repo.mjs <target-dir>
 *
 * Default target: ../codragraph-public next to the monorepo.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepo = path.resolve(__dirname, '..');
const targetArg = process.argv[2] ?? path.resolve(monorepo, '..', 'codragraph-public');
const target = path.resolve(targetArg);
const downloadsDir = path.join(target, 'downloads', 'npm');

const packages = [
  {
    name: '@codragraph/cli',
    version: '2.1.2',
    purpose: 'CLI, MCP server, HTTP API, indexer, dashboard, feature-cluster context packs',
  },
  {
    name: '@codragraph/shared',
    version: '2.1.2',
    purpose: 'Shared runtime/type contracts used by published packages',
  },
  {
    name: '@codragraph/graphstore',
    version: '2.1.2',
    purpose: 'Content-addressed graph snapshots, diffs, branches, merges',
  },
  {
    name: '@codragraph/harness',
    version: '2.1.2',
    purpose: 'Agent harness search, swarm, recipe memory',
  },
  { name: '@codragraph/compress', version: '2.1.2', purpose: 'Context-pack compression utilities' },
  { name: '@codragraph/sdk', version: '2.1.2', purpose: 'Programmatic SDK surface' },
  { name: '@codragraph/org', version: '2.1.2', purpose: 'Tenant, RBAC, and audit helpers' },
  { name: '@codragraph/claude-plugin', version: '0.1.2', purpose: 'Claude Code hooks and skills' },
  { name: '@codragraph/codex', version: '0.1.2', purpose: 'Codex hook installer' },
];

const forbiddenTopLevel = new Set([
  'apps',
  'packages',
  'integrations',
  'docs',
  'infra',
  'marketing',
  'scripts',
  '.claude',
  '.cursor',
  '.sisyphus',
]);

if (target === monorepo || target.startsWith(monorepo + path.sep)) {
  console.error(`Refusing to write public distribution inside the source repo: ${target}`);
  process.exit(1);
}

const copyIfExists = async (fromRel, toRel = fromRel) => {
  const from = path.join(monorepo, fromRel);
  const to = path.join(target, toRel);
  try {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  } catch (err) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }
};

const write = async (rel, body) => {
  const file = path.join(target, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, 'utf8');
};

const sh = (command, args) => {
  let executable = command;
  let finalArgs = args;
  if (command === 'npm') {
    const npmCli = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(
        path.dirname(process.execPath),
        '..',
        'lib',
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
      ),
    ].find((candidate) => candidate && existsSync(candidate));
    if (npmCli) {
      executable = process.execPath;
      finalArgs = [npmCli, ...args];
    }
  }
  const result = spawnSync(executable, finalArgs, {
    cwd: monorepo,
    shell: false,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}${reason}`);
  }
};

const sha256 = async (file) => {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(file));
  return hash.digest('hex');
};

const tarballName = (packageName, version) =>
  `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;

console.error(`Building distribution-only public repo in ${target}`);
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(downloadsDir, { recursive: true });

await write(
  '.gitattributes',
  `* text=auto eol=lf
*.tgz binary
`,
);
await write(
  '.gitignore',
  `node_modules/
.DS_Store
*.log
`,
);

await copyIfExists('LICENSE');
await copyIfExists('SECURITY.md');
await copyIfExists('CODE_OF_CONDUCT.md');
await copyIfExists('.github/ISSUE_TEMPLATE/bug_report.yml');
await copyIfExists('.github/ISSUE_TEMPLATE/feature_request.yml');

await write(
  'README.md',
  `# CodraGraph Distribution Repository

CodraGraph is graph-powered code intelligence for AI agents by Thinqmesh Technologies.

This public GitHub repository is distribution-only. It contains install instructions, licenses, security policy, issue templates, and downloadable npm package tarballs. It does not contain the application source tree (\`packages/\`, \`apps/\`, \`integrations/\`, internal docs, or development configs).

## Install

Most users should install from npm:

\`\`\`bash
npm install -g @codragraph/cli
codragraph analyze .
\`\`\`

For local/offline verification, download the matching tarball from \`downloads/npm/\` and install it directly:

\`\`\`bash
npm install -g ./downloads/npm/codragraph-cli-2.1.2.tgz
\`\`\`

Windows PowerShell:

\`\`\`powershell
npm install -g .\\downloads\\npm\\codragraph-cli-2.1.2.tgz
codragraph analyze .
\`\`\`

## Packages

| Package | Version | Purpose |
|---|---:|---|
${packages.map((pkg) => `| \`${pkg.name}\` | ${pkg.version} | ${pkg.purpose} |`).join('\n')}

## Verify Downloads

SHA-256 checksums are published in \`downloads/npm/SHA256SUMS.txt\`.

Linux/macOS:

\`\`\`bash
cd downloads/npm
shasum -a 256 -c SHA256SUMS.txt
\`\`\`

Windows PowerShell:

\`\`\`powershell
Get-FileHash .\\downloads\\npm\\codragraph-cli-2.1.2.tgz -Algorithm SHA256
\`\`\`

## License

CodraGraph packages are distributed under the Apache License 2.0. See \`LICENSE\`.

## Security

Please do not open public issues for vulnerabilities. See \`SECURITY.md\`.
`,
);

await write(
  'INSTALL.md',
  `# Install CodraGraph

## npm registry

\`\`\`bash
npm install -g @codragraph/cli
codragraph analyze .
\`\`\`

## Local tarball

\`\`\`bash
npm install -g ./downloads/npm/codragraph-cli-2.1.2.tgz
\`\`\`

## PowerShell

\`\`\`powershell
npm install -g .\\downloads\\npm\\codragraph-cli-2.1.2.tgz
codragraph analyze .
\`\`\`

## Requirements

- Node.js 20 or newer
- Git for repository metadata and graph freshness checks
- Windows PowerShell, macOS bash/zsh, or Linux shell
`,
);

for (const pkg of packages) {
  console.error(`Packing ${pkg.name}`);
  sh('npm', ['pack', '--workspace', pkg.name, '--pack-destination', downloadsDir]);
}

const entries = [];
for (const pkg of packages) {
  const name = tarballName(pkg.name, pkg.version);
  const file = path.join(downloadsDir, name);
  const stat = await fs.stat(file);
  entries.push({
    package: pkg.name,
    version: pkg.version,
    file: name,
    bytes: stat.size,
    sha256: await sha256(file),
  });
}

entries.sort((a, b) => a.file.localeCompare(b.file));
await write(
  'downloads/npm/SHA256SUMS.txt',
  `${entries.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
);
await write('downloads/manifest.json', `${JSON.stringify(entries, null, 2)}\n`);

const topLevel = await fs.readdir(target, { withFileTypes: true });
const forbidden = topLevel
  .filter((entry) => forbiddenTopLevel.has(entry.name))
  .map((entry) => entry.name);
if (forbidden.length > 0) {
  throw new Error(
    `Distribution export unexpectedly contains source/internal directories: ${forbidden.join(', ')}`,
  );
}

console.error('\nDistribution export ready.');
console.error(`Target: ${target}`);
console.error(
  'Next: initialize a clean git repo here and force-with-lease push it to the public distribution remote.',
);
