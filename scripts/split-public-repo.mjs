#!/usr/bin/env node
/**
 * Build the public distribution repository tree for CodraGraph.
 *
 * This script intentionally does NOT copy source directories such as
 * packages/, apps/, integrations/, infra/, or marketing/. The public GitHub
 * repo carries install assets, public docs, branding, and package tarballs;
 * source remains in the private working repository.
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

const packageDefs = [
  {
    name: '@codragraph/cli',
    workspace: 'packages/core',
    purpose: 'CLI, MCP server, HTTP API, indexer, dashboard, feature-cluster context packs',
  },
  {
    name: '@codragraph/shared',
    workspace: 'packages/shared',
    purpose: 'Shared runtime/type contracts used by published packages',
  },
  {
    name: '@codragraph/graphstore',
    workspace: 'packages/graphstore',
    purpose: 'Content-addressed graph snapshots, diffs, branches, merges',
  },
  {
    name: '@codragraph/harness',
    workspace: 'packages/harness',
    purpose: 'Agent harness search, swarm, recipe memory',
  },
  {
    name: '@codragraph/compress',
    workspace: 'packages/compress',
    purpose: 'Context-pack compression utilities',
  },
  { name: '@codragraph/sdk', workspace: 'packages/sdk', purpose: 'Programmatic SDK surface' },
  {
    name: '@codragraph/org',
    workspace: 'packages/org',
    purpose: 'Tenant, RBAC, and audit helpers',
  },
  {
    name: '@codragraph/claude-plugin',
    workspace: 'integrations/claude',
    purpose: 'Claude Code hooks and skills',
  },
  {
    name: '@codragraph/codex',
    workspace: 'integrations/codex',
    purpose: 'Codex hook installer',
  },
];

const readJson = async (rel) => JSON.parse(await fs.readFile(path.join(monorepo, rel), 'utf8'));

const packages = await Promise.all(
  packageDefs.map(async (pkg) => {
    const manifest = await readJson(path.join(pkg.workspace, 'package.json'));
    if (manifest.name !== pkg.name) {
      throw new Error(
        `Package definition mismatch for ${pkg.workspace}: expected ${pkg.name}, got ${manifest.name}`,
      );
    }
    return { ...pkg, version: manifest.version };
  }),
);
const cliPackage = packages.find((pkg) => pkg.name === '@codragraph/cli');
if (!cliPackage) {
  throw new Error('Missing @codragraph/cli package definition');
}

const forbiddenTopLevel = new Set([
  'apps',
  'packages',
  'integrations',
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

const copyTreeIfExists = async (fromRel, toRel = fromRel) => {
  const from = path.join(monorepo, fromRel);
  const to = path.join(target, toRel);
  if (!existsSync(from)) return;
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, {
    recursive: true,
    force: true,
    filter: (source) => {
      const rel = path.relative(from, source).replaceAll(path.sep, '/');
      if (rel.split('/').includes('node_modules')) return false;
      if (rel.includes('.heapsnapshot')) return false;
      return true;
    },
  });
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
const cliTarball = tarballName(cliPackage.name, cliPackage.version);
const publicCiWorkflow = `name: Public Release CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
  release:
    types: [published]

permissions:
  contents: read

jobs:
  validate-public-release:
    name: Validate public release bundle
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Validate docs, manifest, and checksums
        run: |
          node <<'NODE'
          const fs = require('node:fs');
          const crypto = require('node:crypto');
          const path = require('node:path');

          const root = process.cwd();
          const mustExist = [
            'README.md',
            'INSTALL.md',
            'LICENSE',
            'SECURITY.md',
            'CODE_OF_CONDUCT.md',
            'llms.txt',
            'branding/codragraph-logo.png',
            'docs/README.md',
            'docs/ARCHITECTURE.md',
            'docs/AI_AGENT_CLI_GUIDE.md',
            'docs/STORAGE_AND_RETRIEVAL.md',
            'docs/releases/v${cliPackage.version}.md',
            'downloads/manifest.json',
            'downloads/npm/SHA256SUMS.txt',
          ];

          for (const rel of mustExist) {
            if (!fs.existsSync(path.join(root, rel))) {
              throw new Error(\`Missing required public file: \${rel}\`);
            }
          }

          const forbidden = [
            'apps',
            'packages',
            'integrations',
            'infra',
            'marketing',
            'scripts',
            '.claude',
            '.cursor',
            '.sisyphus',
          ];
          for (const rel of forbidden) {
            if (fs.existsSync(path.join(root, rel))) {
              throw new Error(\`Public repo must not include private source directory: \${rel}\`);
            }
          }

          const manifest = JSON.parse(fs.readFileSync('downloads/manifest.json', 'utf8'));
          if (!Array.isArray(manifest) || manifest.length === 0) {
            throw new Error('downloads/manifest.json must be a non-empty package array');
          }

          const versions = new Set(manifest.map((entry) => entry.version));
          if (versions.size !== 1 || !versions.has('${cliPackage.version}')) {
            throw new Error(\`Expected every package version to be ${cliPackage.version}, got \${[...versions].join(', ')}\`);
          }

          const checksums = new Map(
            fs
              .readFileSync('downloads/npm/SHA256SUMS.txt', 'utf8')
              .trim()
              .split(/\\r?\\n/)
              .map((line) => {
                const [hash, file] = line.trim().split(/\\s+/);
                return [file, hash];
              }),
          );

          const requiredPackages = new Set(${JSON.stringify(packages.map((pkg) => pkg.name))});
          for (const entry of manifest) {
            requiredPackages.delete(entry.package);
            const rel = path.join('downloads', 'npm', entry.file);
            const bytes = fs.statSync(rel).size;
            if (bytes !== entry.bytes) {
              throw new Error(\`\${entry.file} byte size mismatch: manifest=\${entry.bytes}, actual=\${bytes}\`);
            }
            const digest = crypto.createHash('sha256').update(fs.readFileSync(rel)).digest('hex');
            if (digest !== entry.sha256) {
              throw new Error(\`\${entry.file} manifest checksum mismatch\`);
            }
            if (checksums.get(entry.file) !== digest) {
              throw new Error(\`\${entry.file} SHA256SUMS checksum mismatch\`);
            }
          }

          if (requiredPackages.size > 0) {
            throw new Error(\`Missing package tarballs: \${[...requiredPackages].join(', ')}\`);
          }

          const cli = manifest.find((entry) => entry.package === '@codragraph/cli');
          if (!cli || cli.file !== '${cliTarball}') {
            throw new Error('Missing expected @codragraph/cli tarball metadata');
          }

          const readme = fs.readFileSync('README.md', 'utf8');
          const install = fs.readFileSync('INSTALL.md', 'utf8');
          for (const text of [readme, install]) {
            if (!text.includes('${cliTarball}') || !text.includes('${cliPackage.version}')) {
              throw new Error('README.md and INSTALL.md must mention the current CLI tarball and version');
            }
          }
          NODE

      - name: Smoke test CLI tarball contents
        run: |
          mkdir -p .ci-tarball
          tar -xzf "./downloads/npm/${cliTarball}" -C .ci-tarball package/package.json package/dist/cli/index.js
          node <<'NODE'
          const fs = require('node:fs');
          const pkg = JSON.parse(fs.readFileSync('.ci-tarball/package/package.json', 'utf8'));
          if (pkg.name !== '@codragraph/cli') {
            throw new Error(\`Unexpected CLI package name: \${pkg.name}\`);
          }
          if (pkg.version !== '${cliPackage.version}') {
            throw new Error(\`Unexpected CLI package version: \${pkg.version}\`);
          }
          if (pkg.bin?.codragraph !== 'dist/cli/index.js') {
            throw new Error('CLI tarball must expose the codragraph binary');
          }
          if (!fs.existsSync('.ci-tarball/package/dist/cli/index.js')) {
            throw new Error('CLI tarball is missing dist/cli/index.js');
          }
          NODE
`;

console.error(`Building public distribution repo in ${target}`);
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
await copyIfExists('llms.txt');
await copyIfExists('.github/ISSUE_TEMPLATE/bug_report.yml');
await copyIfExists('.github/ISSUE_TEMPLATE/feature_request.yml');
await write('.github/workflows/public-ci.yml', publicCiWorkflow);
await copyTreeIfExists('docs');
await copyTreeIfExists('branding');
await copyIfExists('apps/web/public/codragraph-logo.png', 'branding/codragraph-logo.png');
await copyIfExists('apps/web/public/codragraph-logo-512.png', 'branding/codragraph-logo-512.png');
await copyIfExists('apps/web/public/favicon.png', 'branding/favicon.png');

const readmeMirrors = [
  ['packages/core/README.md', 'docs/packages/cli.md'],
  ['packages/sdk/README.md', 'docs/packages/sdk.md'],
  ['packages/graphstore/README.md', 'docs/packages/graphstore.md'],
  ['packages/harness/README.md', 'docs/packages/harness.md'],
  ['packages/compress/README.md', 'docs/packages/compress.md'],
  ['packages/org/README.md', 'docs/packages/org.md'],
  ['integrations/claude/README.md', 'docs/integrations/claude.md'],
  ['integrations/codex/README.md', 'docs/integrations/codex.md'],
  [
    '.github/actions/codragraph-pr-review/README.md',
    'docs/integrations/github-action-pr-review.md',
  ],
];

for (const [from, to] of readmeMirrors) {
  await copyIfExists(from, to);
}

await write(
  'README.md',
  `<p align="center">
  <img src="./branding/codragraph-logo.png" alt="CodraGraph" width="120" height="120" />
</p>

<h1 align="center">CodraGraph</h1>

<p align="center">
  Graph-powered code intelligence for AI agents by Thinqmesh Technologies.
</p>

# CodraGraph Public Repository

This public GitHub repository carries the install path, public docs, branding
assets, security policy, issue templates, and downloadable npm package tarballs
for CodraGraph. The private development monorepo still owns application source
directories such as \`packages/\`, \`apps/\`, \`integrations/\`, \`infra/\`, and
\`marketing/\`.

## What CodraGraph Does

CodraGraph indexes a repository into a local LadybugDB knowledge graph:
symbols, imports, calls, routes, tools, execution flows, feature clusters,
BM25 search metadata, and optional embeddings. AI agents then query that graph
through the CLI, MCP, HTTP API, bundled web dashboard, or SDK.

\`\`\`mermaid
flowchart LR
    Repo["Your repo"] --> Analyze["codragraph analyze"]
    Analyze --> Store[".codragraph graph store"]
    Store --> CLI["CLI tools"]
    Store --> MCP["MCP stdio / HTTP"]
    Store --> Web["Local or hosted web UI"]
    Store --> SDK["SDK / custom agents"]
    MCP --> Agents["Claude, Cursor, Codex, OpenCode"]
\`\`\`

## Install

Most users should install from npm:

\`\`\`bash
npm install -g @codragraph/cli
codragraph analyze .
\`\`\`

With Bun:

\`\`\`bash
bun add -g @codragraph/cli --trust
codragraph analyze .
\`\`\`

For local/offline verification, download the matching tarball from \`downloads/npm/\` and install it directly:

\`\`\`bash
npm install -g ./downloads/npm/${cliTarball}
\`\`\`

Windows PowerShell:

\`\`\`powershell
npm install -g .\\downloads\\npm\\${cliTarball}
codragraph analyze .
\`\`\`

## Web Dashboard

\`codragraph serve\` starts the local API and serves the bundled dashboard at
\`http://127.0.0.1:4747\`. The CLI package ships built web assets; it does not
ship \`apps/web/node_modules\` or require users to install frontend dependencies.

\`\`\`bash
codragraph serve
codragraph serve --web hosted
\`\`\`

Hosted mode keeps project data on the user's machine: the browser UI is hosted,
but it connects back to the local API.

REST health is \`GET /api/info\`. HTTP MCP is StreamableHTTP at \`POST /api/mcp\`;
\`/api/mcp/tools/list\` is intentionally not a REST route.

## Packages

| Package | Version | Purpose |
|---|---:|---|
${packages.map((pkg) => `| \`${pkg.name}\` | ${pkg.version} | ${pkg.purpose} |`).join('\n')}

## Documentation

- [Documentation index](docs/README.md)
- [Install guide](docs/INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [AI agent CLI guide](docs/AI_AGENT_CLI_GUIDE.md)
- [Storage and retrieval](docs/STORAGE_AND_RETRIEVAL.md)
- [Runbook](docs/RUNBOOK.md)
- [Guardrails](docs/GUARDRAILS.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Testing](docs/TESTING.md)
- [LLM context file](llms.txt)

Package and integration README mirrors live under [docs/packages](docs/packages)
and [docs/integrations](docs/integrations), so users can inspect the public API
and integration behavior without cloning the private development tree.

## Verify Downloads

SHA-256 checksums are published in \`downloads/npm/SHA256SUMS.txt\`.

Linux/macOS:

\`\`\`bash
cd downloads/npm
shasum -a 256 -c SHA256SUMS.txt
\`\`\`

Windows PowerShell:

\`\`\`powershell
Get-FileHash .\\downloads\\npm\\${cliTarball} -Algorithm SHA256
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

For the complete install and architecture guide, see \`docs/INSTALL.md\` and
\`docs/ARCHITECTURE.md\`.

## npm registry

\`\`\`bash
npm install -g @codragraph/cli
codragraph analyze .
\`\`\`

## Local tarball

\`\`\`bash
npm install -g ./downloads/npm/${cliTarball}
\`\`\`

## PowerShell

\`\`\`powershell
npm install -g .\\downloads\\npm\\${cliTarball}
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
  sh('npm', ['pack', '--silent', '--workspace', pkg.name, '--pack-destination', downloadsDir]);
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
