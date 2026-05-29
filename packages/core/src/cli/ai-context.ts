/**
 * AI Context Generator
 *
 * Creates AGENTS.md and CLAUDE.md with full inline CodraGraph context.
 * AGENTS.md is the standard read by Cursor, Windsurf, OpenCode, Codex, Cline, etc.
 * CLAUDE.md is for Claude Code which only reads that file.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'node:child_process';
import { type GeneratedSkillInfo } from './skill-gen.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RepoStats {
  files?: number;
  nodes?: number;
  edges?: number;
  communities?: number;
  clusters?: number; // Aggregated cluster count (what tools show)
  processes?: number;
}

interface AgentStructureState {
  projectName: string;
  repoPath: string;
  storagePath: string;
  generatedAt: string;
  indexedAt?: string;
  currentBranch?: string;
  currentGitHead?: string;
  indexedCommit?: string;
  remoteUrl?: string;
  schemaVersion?: number;
  compress?: string;
  graphstoreBranch?: string;
  graphstoreHeadCommit?: string;
  stats: RepoStats & { embeddings?: number };
}

export interface AIContextOptions {
  skipAgentsMd?: boolean;
  noStats?: boolean;
}

const CODRAGRAPH_START_MARKER = '<!-- codragraph:start -->';
const CODRAGRAPH_END_MARKER = '<!-- codragraph:end -->';
const AGENT_STRUCTURE_DIR = 'structure';
const AGENT_HISTORY_LIMIT = 20;

/**
 * Find the index of a section marker that occupies its own line.
 * Unlike `indexOf`, this rejects inline prose references like
 * `` See the `<!-- codragraph:start -->` block `` that appear
 * mid-sentence (#1041). A marker counts as section-position only when:
 *   - preceded by newline or start-of-file, AND
 *   - followed by newline, `\r` (CRLF files), or end-of-file.
 * The generator always emits each marker alone on its line, so this
 * matches every legitimate section and none of the inline mentions.
 *
 * `startFrom` lets the end-marker lookup start after the already-found
 * start marker, avoiding a scan from 0 and guaranteeing we never pick
 * up an end marker that appears earlier in the file than the start.
 */
function findSectionMarkerIndex(content: string, marker: string, startFrom = 0): number {
  let idx = content.indexOf(marker, startFrom);
  while (idx !== -1) {
    const atLineStart = idx === 0 || content[idx - 1] === '\n';
    const endPos = idx + marker.length;
    const atLineEnd =
      endPos === content.length || content[endPos] === '\n' || content[endPos] === '\r';
    if (atLineStart && atLineEnd) return idx;
    idx = content.indexOf(marker, idx + 1);
  }
  return -1;
}

/**
 * Generate the full CodraGraph context content.
 *
 * Design principles (learned from real agent behavior and industry research):
 * - Inline critical workflows — skills are skipped 56% of the time (Vercel eval data)
 * - Use RFC 2119 language (MUST, NEVER, ALWAYS) — models follow imperative rules
 * - Three-tier boundaries (Always/When/Never) — proven to change model behavior
 * - Keep under 120 lines — adherence degrades past 150 lines
 * - Exact tool commands with parameters — vague directives get ignored
 * - Self-review checklist — forces model to verify its own work
 */
async function findGroupsContainingRegistryName(registryName: string): Promise<string[]> {
  const { listGroups, getDefaultCodragraphDir, getGroupDir } =
    await import('../core/group/storage.js');
  const { loadGroupConfig } = await import('../core/group/config-parser.js');
  const names = await listGroups();
  const hits: string[] = [];
  for (const g of names) {
    try {
      const config = await loadGroupConfig(getGroupDir(getDefaultCodragraphDir(), g));
      if (Object.values(config.repos).some((r) => r === registryName)) hits.push(config.name);
    } catch {
      // skip invalid or unreadable groups
    }
  }
  return hits;
}

function generateCodraGraphContent(
  projectName: string,
  stats: RepoStats,
  generatedSkills?: GeneratedSkillInfo[],
  groupNames?: string[],
  noStats?: boolean,
): string {
  const generatedRows =
    generatedSkills && generatedSkills.length > 0
      ? generatedSkills
          .map(
            (s) =>
              `| Work in the ${s.label} area (${s.symbolCount} symbols) | \`.claude/skills/generated/${s.name}/SKILL.md\` |`,
          )
          .join('\n')
      : '';

  const skillsTable = `| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | \`.claude/skills/codragraph/codragraph-exploring/SKILL.md\` |
| Blast radius / "What breaks if I change X?" | \`.claude/skills/codragraph/codragraph-impact-analysis/SKILL.md\` |
| Trace bugs / "Why is X failing?" | \`.claude/skills/codragraph/codragraph-debugging/SKILL.md\` |
| Rename / extract / split / refactor | \`.claude/skills/codragraph/codragraph-refactoring/SKILL.md\` |
| Tools, resources, schema reference | \`.claude/skills/codragraph/codragraph-guide/SKILL.md\` |
| Index, status, clean, wiki CLI commands | \`.claude/skills/codragraph/codragraph-cli/SKILL.md\` |${generatedRows ? '\n' + generatedRows : ''}`;

  return `${CODRAGRAPH_START_MARKER}
# CodraGraph — Code Intelligence

This project is indexed by CodraGraph as **${projectName}**${noStats ? '' : ` (${stats.nodes || 0} symbols, ${stats.edges || 0} relationships, ${stats.processes || 0} execution flows)`}. Use the CodraGraph MCP tools to understand code, assess impact, and navigate safely.

> If any CodraGraph tool warns the index is stale, run \`npx @codragraph/cli analyze\` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run \`codragraph_impact({target: "symbolName", direction: "upstream"})\` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run \`codragraph_detect_changes()\` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use \`codragraph_query({query: "concept"})\` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use \`codragraph_context({name: "symbolName"})\`.

## Never Do

- NEVER edit a function, class, or method without first running \`codragraph_impact\` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use \`codragraph_rename\` which understands the call graph.
- NEVER commit changes without running \`codragraph_detect_changes()\` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| \`codragraph://repo/${projectName}/context\` | Codebase overview, check index freshness |
| \`codragraph://repo/${projectName}/clusters\` | All functional areas |
| \`codragraph://repo/${projectName}/feature-clusters\` | Product/domain feature areas |
| \`codragraph://repo/${projectName}/feature/{name}\` | Focused files, line ranges, flows, dependencies |
| \`codragraph://repo/${projectName}/processes\` | All execution flows |
| \`codragraph://repo/${projectName}/process/{name}\` | Step-by-step execution trace |
| \`.codragraph/structure/README.md\` | Local what/why/how/when/where memory, branch state, and SQLite seed |

${
  groupNames && groupNames.length > 0
    ? `## Cross-Repo Groups

This repository is listed under CodraGraph **group(s): ${groupNames.join(', ')}** (see \`~/.codragraph/groups/\`). For cross-repo analysis, use MCP tools \`impact\`, \`query\`, and \`context\` with \`repo\` set to \`@<groupName>\` or \`@<groupName>/<memberPath>\` (paths match keys in that group’s \`group.yaml\`). Use \`group_list\` / \`group_sync\` for membership and sync. From the terminal: \`npx @codragraph/cli group list\`, \`npx @codragraph/cli group sync <name>\`, \`npx @codragraph/cli group impact <name> --target <symbol> --repo <group-path>\`.

`
    : ''
}## CLI

Commands are cross-platform: \`codragraph ...\`, \`npx @codragraph/cli ...\`, or \`bunx @codragraph/cli ...\`. Scripts: \`npm --prefix ...\` or \`bun run --filter ...\`.

${skillsTable}

${CODRAGRAPH_END_MARKER}`;
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create or update CodraGraph section in a file
 * - If file doesn't exist: create with CodraGraph content
 * - If file exists without CodraGraph section: append
 * - If file exists with CodraGraph section: replace that section
 */
async function upsertCodraGraphSection(
  filePath: string,
  content: string,
): Promise<'created' | 'updated' | 'appended'> {
  const exists = await fileExists(filePath);

  if (!exists) {
    await fs.writeFile(filePath, content, 'utf-8');
    return 'created';
  }

  const existingContent = await fs.readFile(filePath, 'utf-8');

  // Check if CodraGraph section already exists. Matching is restricted
  // to markers that occupy their own line so that inline prose
  // references (e.g. `` See the `<!-- codragraph:start -->` block `` in
  // the shipped CLAUDE.md) are NOT treated as section delimiters
  // (#1041). The end-marker scan starts after the start-marker so it
  // can never pick up an earlier end in the file.
  const startIdx = findSectionMarkerIndex(existingContent, CODRAGRAPH_START_MARKER);
  const endIdx = findSectionMarkerIndex(
    existingContent,
    CODRAGRAPH_END_MARKER,
    startIdx === -1 ? 0 : startIdx,
  );

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing section
    const before = existingContent.substring(0, startIdx);
    const after = existingContent.substring(endIdx + CODRAGRAPH_END_MARKER.length);
    const newContent = before + content + after;
    await fs.writeFile(filePath, newContent.trim() + '\n', 'utf-8');
    return 'updated';
  }

  // Append new section
  const newContent = existingContent.trim() + '\n\n' + content + '\n';
  await fs.writeFile(filePath, newContent, 'utf-8');
  return 'appended';
}

async function readJsonFile(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function gitValue(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function statValue(value: unknown): string {
  return value === undefined || value === null || value === '' ? 'unknown' : String(value);
}

function shortCommit(value?: string): string {
  return value ? value.slice(0, 12) : 'unknown';
}

function sqlString(value: unknown): string {
  return String(value ?? '').replace(/'/g, "''");
}

async function buildAgentStructureState(
  repoPath: string,
  storagePath: string,
  projectName: string,
  stats: RepoStats,
): Promise<AgentStructureState> {
  const meta = await readJsonFile(path.join(storagePath, 'meta.json'));
  const currentGitHead = gitValue(repoPath, ['rev-parse', 'HEAD']);
  const currentBranch =
    gitValue(repoPath, ['branch', '--show-current']) ||
    gitValue(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);

  return {
    projectName,
    repoPath,
    storagePath,
    generatedAt: new Date().toISOString(),
    indexedAt: meta?.indexedAt,
    currentBranch: currentBranch || undefined,
    currentGitHead: currentGitHead || undefined,
    indexedCommit: meta?.lastCommit || currentGitHead || undefined,
    remoteUrl: meta?.remoteUrl,
    schemaVersion: meta?.schemaVersion,
    compress: meta?.compress,
    graphstoreBranch: meta?.currentBranch,
    graphstoreHeadCommit: meta?.headCommit,
    stats: {
      files: stats.files ?? meta?.stats?.files,
      nodes: stats.nodes ?? meta?.stats?.nodes,
      edges: stats.edges ?? meta?.stats?.edges,
      communities: stats.communities ?? meta?.stats?.communities,
      clusters: stats.clusters ?? meta?.stats?.featureClusters,
      processes: stats.processes ?? meta?.stats?.processes,
      embeddings: meta?.stats?.embeddings,
    },
  };
}

function buildStructureDocs(state: AgentStructureState): Record<string, string> {
  const statsTable = `| Metric | Value |
|---|---|
| Files | ${statValue(state.stats.files)} |
| Symbols | ${statValue(state.stats.nodes)} |
| Relationships | ${statValue(state.stats.edges)} |
| Feature clusters | ${statValue(state.stats.clusters)} |
| Execution flows | ${statValue(state.stats.processes)} |
| Embeddings | ${statValue(state.stats.embeddings)} |
| Compression | ${statValue(state.compress)} |
| Schema version | ${statValue(state.schemaVersion)} |`;

  const branchTable = `| Field | Value |
|---|---|
| Current git branch | ${statValue(state.currentBranch)} |
| Current git HEAD | ${statValue(state.currentGitHead)} |
| Indexed commit | ${statValue(state.indexedCommit)} |
| Indexed at | ${statValue(state.indexedAt)} |
| Graphstore branch | ${statValue(state.graphstoreBranch)} |
| Graphstore head commit | ${statValue(state.graphstoreHeadCommit)} |
| Remote | ${statValue(state.remoteUrl)} |`;

  return {
    'README.md': `# CodraGraph Agent Structure

Generated: ${state.generatedAt}

This folder is the small, pre-seeded context pack for AI agents. It is rebuilt
by \`codragraph analyze\` so agents can read stable markdown instead of guessing
from stale terminal output.

Read order:

1. [WHAT.md](WHAT.md) - what this index represents.
2. [WHY.md](WHY.md) - why the agent should use graph context first.
3. [HOW.md](HOW.md) - how to query, analyze, and recover safely.
4. [WHEN.md](WHEN.md) - when to refresh, reuse, or clean the index.
5. [WHERE.md](WHERE.md) - where local storage, MCP, HTTP, and docs live.
6. [BRANCHES.md](BRANCHES.md) - branch, commit, and graphstore state.
7. [SQLITE.md](SQLITE.md) - SQLite-compatible seed data for external agent memory.
`,

    'WHAT.md': `# What

CodraGraph index name: **${state.projectName}**

This index stores a local code graph for the repository at:

\`${state.repoPath}\`

The graph includes file structure, symbols, relationships, imports, execution
flows, feature clusters, Markdown graph docs, and optional embeddings. Agents
should use this pack as the first local orientation layer, then ask MCP/CLI for
live graph details.

${statsTable}
`,

    'WHY.md': `# Why

AI agents should not rebuild project understanding from raw grep every time.
This folder gives them a compact, reusable map of the current indexed state.

Use it to avoid:

- Querying the wrong registered repo.
- Running multiple analyzers against the same .codragraph store.
- Treating stale branch or commit context as fresh.
- Enabling embeddings by default when BM25 and graph search are enough.
- Deleting index files when a targeted analyze or clean command is safer.
`,

    'HOW.md': `# How

Safe command flow for agents:

1. Read this folder and \`AGENTS.md\` / \`CLAUDE.md\`.
2. Run \`codragraph status\` or \`npx @codragraph/cli status\`.
3. Use MCP \`query\`, \`context\`, \`impact\`, and \`detect_changes\` for graph work.
4. Run \`codragraph analyze\` only when the index is missing or stale.
5. Use \`--repo ${state.projectName}\` when running from outside this checkout.

Do not run \`analyze\`, \`detect-changes\`, \`clean\`, or DB-writing commands from
editor hooks. Hooks should stay bounded and read-only.
`,

    'WHEN.md': `# When

Refresh with \`codragraph analyze\` when:

- The repo was never indexed.
- MCP or CLI reports stale graph context.
- Source files, Markdown graph docs, language config, or path topology changed.
- Schema, compression, or embedding settings changed.

Reuse the existing graph when only generated agent context, lockfiles, or
ignored assets changed. Use \`codragraph analyze --force\` when ignore rules
changed or corruption is suspected. Ask before \`codragraph clean --force\`.
`,

    'WHERE.md': `# Where

| Item | Location |
|---|---|
| Repository | \`${state.repoPath}\` |
| Local index storage | \`${state.storagePath}\` |
| Agent structure pack | \`${path.join(state.storagePath, AGENT_STRUCTURE_DIR)}\` |
| Root agent instructions | \`AGENTS.md\`, \`CLAUDE.md\` |
| Claude skills | \`.claude/skills/@codragraph/cli/\` |
| HTTP API | \`http://127.0.0.1:4747/api/info\` after \`codragraph serve\` |
| MCP tools | \`codragraph mcp\` |
`,

    'BRANCHES.md': `# Branches And Commits

${branchTable}

The indexed commit is the source-of-truth for whether graph answers are fresh.
If \`Current git HEAD\` and \`Indexed commit\` differ, agents should say the graph
is stale and run \`codragraph analyze\` before relying on impact, context, or
detect-changes output.
`,

    'INDEX.md': `# Index Snapshot

${statsTable}

Storage notes:

- BM25 and graph traversal work without embeddings.
- Embeddings are optional and should be preserved with \`--embeddings\` only
  when semantic/vector search is intentionally required.
- Compression mode is recorded in \`.codragraph/meta.json\`.
- This markdown pack is small and should not be embedded or vectorized.
`,

    'SQLITE.md': `# SQLite Seed

\`agent-memory.sql\` is a SQLite-compatible seed file for external agent memory
stores. CodraGraph writes it as plain SQL so installs stay light on Node 20 and
do not pull native SQLite dependencies into the CLI hot path.

Optional import:

\`\`\`sh
sqlite3 agent-memory.sqlite < agent-memory.sql
\`\`\`

The canonical live source remains \`.codragraph/meta.json\` plus the graph DB.
`,
  };
}

function buildSqlSeed(state: AgentStructureState): string {
  const rows: Array<[string, unknown]> = [
    ['project_name', state.projectName],
    ['repo_path', state.repoPath],
    ['storage_path', state.storagePath],
    ['generated_at', state.generatedAt],
    ['indexed_at', state.indexedAt],
    ['current_branch', state.currentBranch],
    ['current_git_head', state.currentGitHead],
    ['indexed_commit', state.indexedCommit],
    ['remote_url', state.remoteUrl],
    ['schema_version', state.schemaVersion],
    ['compress', state.compress],
    ['graphstore_branch', state.graphstoreBranch],
    ['graphstore_head_commit', state.graphstoreHeadCommit],
    ['stats_json', JSON.stringify(state.stats)],
  ];

  const values = rows
    .map(
      ([key, value]) =>
        `('${sqlString(key)}', '${sqlString(value)}', '${sqlString(state.generatedAt)}')`,
    )
    .join(',\n');

  return `BEGIN;
CREATE TABLE IF NOT EXISTS codragraph_agent_context (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
DELETE FROM codragraph_agent_context;
INSERT INTO codragraph_agent_context (key, value, updated_at) VALUES
${values};
COMMIT;
`;
}

async function buildHistoryContent(
  historyPath: string,
  state: AgentStructureState,
): Promise<string> {
  const entryId = (state.indexedCommit || 'no-git').replace(/[^a-zA-Z0-9._-]/g, '_');
  const entry = `<!-- codragraph:history-entry:${entryId} -->
## ${shortCommit(state.indexedCommit)} - ${state.generatedAt}

- Branch: ${statValue(state.currentBranch)}
- Indexed commit: ${statValue(state.indexedCommit)}
- Git HEAD: ${statValue(state.currentGitHead)}
- Graphstore: ${statValue(state.graphstoreBranch)} / ${statValue(state.graphstoreHeadCommit)}
- Stats: ${statValue(state.stats.nodes)} symbols, ${statValue(state.stats.edges)} relationships, ${statValue(state.stats.processes)} flows
<!-- /codragraph:history-entry -->`;

  let existing = '';
  try {
    existing = await fs.readFile(historyPath, 'utf-8');
  } catch {
    /* first run */
  }

  const blocks: string[] = [];
  const regex =
    /<!-- codragraph:history-entry:([^ ]+) -->[\s\S]*?<!-- \/codragraph:history-entry -->/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(existing)) !== null) {
    if (match[1] !== entryId) blocks.push(match[0]);
  }

  return `# Analyze History

Most recent CodraGraph analyze or smart-reuse events. Bounded to the latest
${AGENT_HISTORY_LIMIT} entries so this file remains small.

${[entry, ...blocks].slice(0, AGENT_HISTORY_LIMIT).join('\n\n')}
`;
}

async function generateAgentStructurePack(
  repoPath: string,
  storagePath: string,
  projectName: string,
  stats: RepoStats,
): Promise<string[]> {
  const structureDir = path.join(storagePath, AGENT_STRUCTURE_DIR);
  await fs.mkdir(structureDir, { recursive: true });

  const state = await buildAgentStructureState(repoPath, storagePath, projectName, stats);
  const docs = buildStructureDocs(state);

  const written: string[] = [];
  for (const [fileName, content] of Object.entries(docs)) {
    await fs.writeFile(path.join(structureDir, fileName), content.trim() + '\n', 'utf-8');
    written.push(fileName);
  }

  await fs.writeFile(
    path.join(structureDir, 'state.json'),
    JSON.stringify(state, null, 2) + '\n',
    'utf-8',
  );
  written.push('state.json');

  await fs.writeFile(path.join(structureDir, 'agent-memory.sql'), buildSqlSeed(state), 'utf-8');
  written.push('agent-memory.sql');

  const historyPath = path.join(structureDir, 'HISTORY.md');
  await fs.writeFile(historyPath, await buildHistoryContent(historyPath, state), 'utf-8');
  written.push('HISTORY.md');

  return written;
}

/**
 * Install CodraGraph skills to .claude/skills/codragraph/
 * Works natively with Claude Code, Cursor, and GitHub Copilot
 */
async function installSkills(repoPath: string): Promise<string[]> {
  const skillsDir = path.join(repoPath, '.claude', 'skills', '@codragraph/cli');
  const installedSkills: string[] = [];

  // Skill definitions bundled with the package
  const skills = [
    {
      name: 'codragraph-exploring',
      description:
        'Use when the user asks how code works, wants to understand architecture, trace execution flows, or explore unfamiliar parts of the codebase. Examples: "How does X work?", "What calls this function?", "Show me the auth flow"',
    },
    {
      name: 'codragraph-debugging',
      description:
        'Use when the user is debugging a bug, tracing an error, or asking why something fails. Examples: "Why is X failing?", "Where does this error come from?", "Trace this bug"',
    },
    {
      name: 'codragraph-impact-analysis',
      description:
        'Use when the user wants to know what will break if they change something, or needs safety analysis before editing code. Examples: "Is it safe to change X?", "What depends on this?", "What will break?"',
    },
    {
      name: 'codragraph-refactoring',
      description:
        'Use when the user wants to rename, extract, split, move, or restructure code safely. Examples: "Rename this function", "Extract this into a module", "Refactor this class", "Move this to a separate file"',
    },
    {
      name: 'codragraph-guide',
      description:
        'Use when the user asks about CodraGraph itself — available tools, how to query the knowledge graph, MCP resources, graph schema, or workflow reference. Examples: "What CodraGraph tools are available?", "How do I use CodraGraph?"',
    },
    {
      name: 'codragraph-cli',
      description:
        'Use when the user needs to run CodraGraph CLI commands like analyze/index a repo, check status, clean the index, generate a wiki, or list indexed repos. Examples: "Index this repo", "Reanalyze the codebase", "Generate a wiki"',
    },
  ];

  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);
    const skillPath = path.join(skillDir, 'SKILL.md');

    try {
      // Create skill directory
      await fs.mkdir(skillDir, { recursive: true });

      // Try to read from package skills directory
      const packageSkillPath = path.join(__dirname, '..', '..', 'skills', `${skill.name}.md`);
      let skillContent: string;

      try {
        skillContent = await fs.readFile(packageSkillPath, 'utf-8');
      } catch {
        // Fallback: generate minimal skill content
        skillContent = `---
name: ${skill.name}
description: ${skill.description}
---

# ${skill.name.charAt(0).toUpperCase() + skill.name.slice(1)}

${skill.description}

Use CodraGraph tools to accomplish this task.
`;
      }

      await fs.writeFile(skillPath, skillContent, 'utf-8');
      installedSkills.push(skill.name);
    } catch (err) {
      // Skip on error, don't fail the whole process
      console.warn(`Warning: Could not install skill ${skill.name}:`, err);
    }
  }

  return installedSkills;
}

/**
 * Generate AI context files after indexing
 */
export async function generateAIContextFiles(
  repoPath: string,
  _storagePath: string,
  projectName: string,
  stats: RepoStats,
  generatedSkills?: GeneratedSkillInfo[],
  options?: AIContextOptions,
): Promise<{ files: string[] }> {
  const groupNames = await findGroupsContainingRegistryName(projectName);
  const content = generateCodraGraphContent(
    projectName,
    stats,
    generatedSkills,
    groupNames,
    options?.noStats,
  );
  const createdFiles: string[] = [];

  if (!options?.skipAgentsMd) {
    // Create AGENTS.md (standard for Cursor, Windsurf, OpenCode, Cline, etc.)
    const agentsPath = path.join(repoPath, 'AGENTS.md');
    const agentsResult = await upsertCodraGraphSection(agentsPath, content);
    createdFiles.push(`AGENTS.md (${agentsResult})`);

    // Create CLAUDE.md (for Claude Code)
    const claudePath = path.join(repoPath, 'CLAUDE.md');
    const claudeResult = await upsertCodraGraphSection(claudePath, content);
    createdFiles.push(`CLAUDE.md (${claudeResult})`);
  } else {
    createdFiles.push('AGENTS.md (skipped via --skip-agents-md)');
    createdFiles.push('CLAUDE.md (skipped via --skip-agents-md)');
  }

  try {
    const structureFiles = await generateAgentStructurePack(
      repoPath,
      _storagePath,
      projectName,
      stats,
    );
    createdFiles.push(`.codragraph/structure/ (${structureFiles.length} files)`);
  } catch (err) {
    console.warn('Warning: Could not generate .codragraph/structure agent pack:', err);
  }

  // Install skills to .claude/skills/codragraph/
  const installedSkills = await installSkills(repoPath);
  if (installedSkills.length > 0) {
    createdFiles.push(`.claude/skills/codragraph/ (${installedSkills.length} skills)`);
  }

  return { files: createdFiles };
}
