#!/usr/bin/env node

// Heap re-spawn removed — only analyze.ts needs the 8GB heap (via its own ensureHeap()).
// Removing it from here improves MCP server startup time significantly.

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { createLazyAction } from './lazy-action.js';
import { registerGroupCommands } from './group.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json');
const program = new Command();

program.name('codragraph').description('CodraGraph local CLI and MCP server').version(pkg.version);

program
  .command('setup')
  .description('One-time setup: configure MCP for Cursor, Claude Code, OpenCode, Codex')
  .action(createLazyAction(() => import('./setup.js'), 'setupCommand'));

program
  .command('analyze [path]')
  .description('Index a repository (full analysis)')
  .option('-f, --force', 'Force full re-index even if up to date')
  .option('--embeddings', 'Enable embedding generation for semantic search (off by default)')
  .option('--skills', 'Generate repo-specific skill files from detected communities')
  .option(
    '--skill-targets <list>',
    'CSV of editor targets for --skills (claude, cursor, opencode, codex). Default: claude.',
  )
  .option('--skip-agents-md', 'Skip updating the codragraph section in AGENTS.md and CLAUDE.md')
  .option('--no-stats', 'Omit volatile file/symbol counts from AGENTS.md and CLAUDE.md')
  .option('--skip-git', 'Index a folder without requiring a .git directory')
  .option(
    '--name <alias>',
    'Register this repo under a custom name in ~/.codragraph/registry.json ' +
      '(disambiguates repos whose paths share a basename, e.g. two different .../app folders)',
  )
  .option(
    '--allow-duplicate-name',
    'Register this repo even if another path already uses the same --name alias. ' +
      'Leaves `-r <name>` ambiguous for the two paths; use -r <path> to disambiguate.',
  )
  .option('-v, --verbose', 'Enable verbose ingestion warnings (default: false)')
  .option(
    '--max-file-size <kb>',
    'Skip files larger than this (KB). Default: 512. Hard cap: 32768 (tree-sitter limit).',
  )
  .option(
    '--no-setup',
    'Skip the first-run editor setup (auto-runs once when ~/.codragraph/registry.json is missing)',
  )
  .option(
    '--compress <encoding>',
    'Compress per-row content (RFC 0001 Phase 2). One of: none (default), brotli, zstd. zstd requires Node ≥ 22.15.',
    'none',
  )
  .addHelpText(
    'after',
    '\nEnvironment variables:\n' +
      '  CODRAGRAPH_NO_GITIGNORE=1   Skip .gitignore parsing (still reads .codragraphignore)\n' +
      '  CODRAGRAPH_MAX_FILE_SIZE=N  Override large-file skip threshold (KB). Default 512, max 32768.\n' +
      '\nTip: `.codragraphignore` supports `.gitignore`-style negation. Add e.g.\n' +
      '     `!__tests__/` to index a directory that is auto-filtered by default (#771).',
  )
  .action(createLazyAction(() => import('./analyze.js'), 'analyzeCommand'));

program
  .command('profile-heap [path]')
  .description(
    'Run analyze with heap-profile instrumentation (RFC 0002 Phase 1). ' +
      'Writes per-phase v8 heap snapshots + a JSONL RSS timeline under ' +
      '.codragraph/heap-profiles/, then prints a summary table.',
  )
  .option('-f, --force', 'Force full re-index (analyze flag, passed through)')
  .option('--skip-git', 'Index a folder without requiring a .git directory')
  .option('--no-setup', 'Skip first-run editor setup')
  .option('--no-summary', 'Skip the post-run summary table (raw artifacts only)')
  .action(createLazyAction(() => import('./profile-heap.js'), 'profileHeapCommand'));

program
  .command('index [path...]')
  .description(
    'Register an existing .codragraph/ folder into the global registry (no re-analysis needed)',
  )
  .option('-f, --force', 'Register even if meta.json is missing (stats will be empty)')
  .option('--allow-non-git', 'Allow registering folders that are not Git repositories')
  .action(createLazyAction(() => import('./index-repo.js'), 'indexCommand'));

program
  .command('serve')
  .description('Start local HTTP server for web UI connection')
  .option('-p, --port <port>', 'Port number', '4747')
  .option('--host <host>', 'Bind address (default: 127.0.0.1, use 0.0.0.0 for remote access)')
  .action(createLazyAction(() => import('./serve.js'), 'serveCommand'));

program
  .command('mcp')
  .description('Start MCP server (stdio) — serves all indexed repos')
  .action(createLazyAction(() => import('./mcp.js'), 'mcpCommand'));

program
  .command('list')
  .description('List all indexed repositories')
  .action(createLazyAction(() => import('./list.js'), 'listCommand'));

program
  .command('status')
  .description('Show index status for current repo')
  .action(createLazyAction(() => import('./status.js'), 'statusCommand'));

program
  .command('clean')
  .description('Delete CodraGraph index for current repo')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--all', 'Clean all indexed repos')
  .action(createLazyAction(() => import('./clean.js'), 'cleanCommand'));

program
  .command('remove <target>')
  .description(
    'Delete the CodraGraph index for a registered repo (by alias, name, or absolute path). ' +
      'Unlike `clean`, does not require being inside the repo. Idempotent on unknown targets.',
  )
  .option('-f, --force', 'Skip confirmation prompt')
  .action(createLazyAction(() => import('./remove.js'), 'removeCommand'));

program
  .command('wiki [path]')
  .description('Generate repository wiki from knowledge graph')
  .option('-f, --force', 'Force full regeneration even if up to date')
  .option('--provider <provider>', 'LLM provider: openai or cursor (default: openai)')
  .option('--model <model>', 'LLM model or Azure deployment name (default: minimax/minimax-m2.5)')
  .option(
    '--base-url <url>',
    'LLM API base URL. Azure v1: https://{resource}.openai.azure.com/openai/v1',
  )
  .option('--api-key <key>', 'LLM API key or Azure api-key (saved to ~/.codragraph/config.json)')
  .option(
    '--api-version <version>',
    'Azure api-version query param, e.g. 2024-10-21 (legacy Azure API only)',
  )
  .option(
    '--reasoning-model',
    'Mark deployment as reasoning model (o1/o3/o4-mini) — strips temperature, uses max_completion_tokens',
  )
  .option('--no-reasoning-model', 'Disable reasoning model mode (overrides saved config)')
  .option('--concurrency <n>', 'Parallel LLM calls (default: 3)', '3')
  .option('--gist', 'Publish wiki as a public GitHub Gist after generation')
  .option('-v, --verbose', 'Enable verbose output (show LLM commands and responses)')
  .option('--review', 'Stop after grouping to review module structure before generating pages')
  .action(createLazyAction(() => import('./wiki.js'), 'wikiCommand'));

program
  .command('augment <pattern>')
  .description('Augment a search pattern with knowledge graph context (used by hooks)')
  .action(createLazyAction(() => import('./augment.js'), 'augmentCommand'));

// ─── Direct Tool Commands (no MCP overhead) ────────────────────────
// These invoke LocalBackend directly for use in eval, scripts, and CI.

program
  .command('query <search_query>')
  .description('Search the knowledge graph for execution flows related to a concept')
  .option('-r, --repo <name>', 'Target repository (omit if only one indexed)')
  .option('-c, --context <text>', 'Task context to improve ranking')
  .option('-g, --goal <text>', 'What you want to find')
  .option('-l, --limit <n>', 'Max processes to return (default: 5)')
  .option('--content', 'Include full symbol source code')
  .action(createLazyAction(() => import('./tool.js'), 'queryCommand'));

program
  .command('context [name]')
  .description('360-degree view of a code symbol: callers, callees, processes')
  .option('-r, --repo <name>', 'Target repository')
  .option('-u, --uid <uid>', 'Direct symbol UID (zero-ambiguity lookup)')
  .option('-f, --file <path>', 'File path to disambiguate common names')
  .option('--content', 'Include full symbol source code')
  .action(createLazyAction(() => import('./tool.js'), 'contextCommand'));

program
  .command('impact <target>')
  .description('Blast radius analysis: what breaks if you change a symbol')
  .option('-d, --direction <dir>', 'upstream (dependants) or downstream (dependencies)', 'upstream')
  .option('-r, --repo <name>', 'Target repository')
  .option('--depth <n>', 'Max relationship depth (default: 3)')
  .option('--include-tests', 'Include test files in results')
  .action(createLazyAction(() => import('./tool.js'), 'impactCommand'));

program
  .command('cypher <query>')
  .description('Execute raw Cypher query against the knowledge graph')
  .option('-r, --repo <name>', 'Target repository')
  .action(createLazyAction(() => import('./tool.js'), 'cypherCommand'));

program
  .command('detect-changes')
  .alias('detect_changes')
  .description('Map git diff hunks to indexed symbols and affected execution flows')
  .option('-s, --scope <scope>', 'What to analyze: unstaged, staged, all, or compare', 'unstaged')
  .option('-b, --base-ref <ref>', 'Branch/commit for compare scope (e.g. main)')
  .option('-r, --repo <name>', 'Target repository')
  .action(createLazyAction(() => import('./tool.js'), 'detectChangesCommand'));

// ─── Eval Server (persistent daemon for SWE-bench) ─────────────────

program
  .command('eval-server')
  .description('Start lightweight HTTP server for fast tool calls during evaluation')
  .option('-p, --port <port>', 'Port number', '4848')
  .option('--idle-timeout <seconds>', 'Auto-shutdown after N seconds idle (0 = disabled)', '0')
  .action(createLazyAction(() => import('./eval-server.js'), 'evalServerCommand'));

registerGroupCommands(program);

// ─── Config: unified API-key model (~/.codragraph/config.json) ─────

const configCmd = program
  .command('config')
  .description('Manage codragraph CLI config — provider API keys, base URLs, models');

configCmd
  .command('list', { isDefault: true })
  .description('List configured providers (api keys redacted)')
  .action(createLazyAction(() => import('./config.js'), 'configListCommand'));

configCmd
  .command('get <provider>')
  .description(
    "Show a provider's settings (api key redacted). Provider: claude, openai, opencode, openrouter, azure, cursor, custom.",
  )
  .action(createLazyAction(() => import('./config.js'), 'configGetCommand'));

configCmd
  .command('set <provider>')
  .description('Set provider settings (writes ~/.codragraph/config.json with chmod 600 on POSIX).')
  .option('-k, --api-key <key>', 'BYO API key for this provider')
  .option('--base-url <url>', 'Override the default API base URL')
  .option('--model <model>', 'Default model for this provider')
  .option('--api-version <version>', 'Azure-only: api-version query param (e.g. 2024-10-21)')
  .option('--reasoning-model', 'Mark deployment as reasoning model (o1/o3/o4-mini variants)')
  .action(createLazyAction(() => import('./config.js'), 'configSetCommand'));

configCmd
  .command('remove <provider>')
  .alias('rm')
  .description("Remove a provider's configuration")
  .action(createLazyAction(() => import('./config.js'), 'configRemoveCommand'));

configCmd
  .command('path')
  .description('Print the canonical config-file path')
  .action(createLazyAction(() => import('./config.js'), 'configPathCommand'));

// ─── Versioned-graph commands (Phase 4) ────────────────────────────

program
  .command('log')
  .description('Show the graph commit history for the current repo')
  .option('-n, --limit <n>', 'Maximum number of commits to show', '50')
  .action(createLazyAction(() => import('./graphstore.js'), 'logCommand'));

const branchCmd = program.command('branch').description('Manage versioned-graph branches');
branchCmd
  .command('list', { isDefault: true })
  .description('List branches')
  .action(createLazyAction(() => import('./graphstore.js'), 'branchListCommand'));
branchCmd
  .command('create <name>')
  .description('Create a new branch at HEAD (or at --from <target>)')
  .option('--from <target>', 'Branch / commit id to start from (defaults to HEAD)')
  .action(createLazyAction(() => import('./graphstore.js'), 'branchCreateCommand'));
branchCmd
  .command('delete <name>')
  .description('Delete a branch ref (refuses the currently checked-out branch)')
  .action(createLazyAction(() => import('./graphstore.js'), 'branchDeleteCommand'));

program
  .command('diff <from> <to>')
  .description('Structural diff between two graph commits or branches')
  .option('--semantic', 'Use the semantic differ (added APIs, classified modifications, processes)')
  .option(
    '--json',
    'Emit machine-readable JSON instead of human-readable text (for CI / GitHub Action consumers)',
  )
  .action(async (from: string, to: string, opts: { semantic?: boolean; json?: boolean }) => {
    const mod = await import('./graphstore.js');
    if (opts.semantic) await mod.diffSemanticCommand(from, to, { json: opts.json });
    else await mod.diffCommand(from, to, { json: opts.json });
  });

program
  .command('merge <branch>')
  .description('Three-way merge <branch> into the current branch')
  .option('-m, --message <message>', 'Override the default merge commit message')
  .action(createLazyAction(() => import('./graphstore.js'), 'mergeCommand'));

program
  .command('gc')
  .description('Garbage-collect unreachable graphstore objects (mark-and-sweep)')
  .option('--dry-run', 'List what would be deleted without removing anything')
  .action(createLazyAction(() => import('./graphstore.js'), 'gcCommand'));

program
  .command('commit')
  .description('Re-snapshot the live graph and create a labelled commit')
  .requiredOption('-m, --message <message>', 'Commit message')
  .action(createLazyAction(() => import('./graphstore.js'), 'commitCommand'));

program
  .command('checkout <target>')
  .description('Move HEAD to a branch or commit; --materialize also rebuilds the live LadybugDB')
  .option('--materialize', 'Rebuild the live LadybugDB from the target snapshot (destructive)')
  .action(createLazyAction(() => import('./graphstore.js'), 'checkoutCommand'));

program
  .command('materialize <target>')
  .description(
    'Rebuild a target snapshot into a fresh LadybugDB at --into <path> (read-only inspection)',
  )
  .requiredOption('--into <path>', 'Output LadybugDB file path')
  .action(createLazyAction(() => import('./graphstore.js'), 'materializeCommand'));

program
  .command('blame <symbolId>')
  .description("Show every commit where a symbol's row hash changed")
  .option('--table <name>', 'Restrict to a specific node table (Function, Class, …)')
  .option('-n, --limit <n>', 'Maximum number of changes to show', '20')
  .action(createLazyAction(() => import('./graphstore.js'), 'blameCommand'));

program.parse(process.argv);
