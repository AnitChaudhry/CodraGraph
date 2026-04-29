/**
 * MCP Server (Multi-Repo)
 *
 * Model Context Protocol server that runs on stdio.
 * External AI tools (Cursor, Claude) spawn this process and
 * communicate via stdin/stdout using the MCP protocol.
 *
 * Supports multiple indexed repositories via the global registry.
 *
 * Tools: list_repos, query, cypher, context, impact, detect_changes, rename
 * Resources: repos, repo/{name}/context, repo/{name}/clusters, ...
 */

import { createRequire } from 'module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CompatibleStdioServerTransport } from './compatible-stdio-transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CODRAGRAPH_TOOLS } from './tools.js';
import { realStdoutWrite } from './core/lbug-adapter.js';
import type { LocalBackend } from './local/local-backend.js';
import { getResourceDefinitions, getResourceTemplates, readResource } from './resources.js';

/**
 * Next-step hints appended to tool responses.
 *
 * Agents often stop after one tool call. These hints guide them to the
 * logical next action, creating a self-guiding workflow without hooks.
 *
 * Design: Each hint is a short, actionable instruction (not a suggestion).
 * The hint references the specific tool/resource to use next.
 */
function getNextStepHint(toolName: string, args: Record<string, any> | undefined): string {
  const repo = args?.repo;
  const repoParam = repo ? `, repo: "${repo}"` : '';
  const repoPath = repo || '{name}';

  switch (toolName) {
    case 'list_repos':
      return `\n\n---\n**Next:** READ codragraph://repo/{name}/context for any repo above to get its overview and check staleness.`;

    case 'query':
      return `\n\n---\n**Next:** To understand a specific symbol in depth, use context({name: "<symbol_name>"${repoParam}}) to see categorized refs and process participation.`;

    case 'context':
      return `\n\n---\n**Next:** If planning changes, use impact({target: "${args?.name || '<name>'}", direction: "upstream"${repoParam}}) to check blast radius. To see execution flows, READ codragraph://repo/${repoPath}/processes.`;

    case 'impact':
      return `\n\n---\n**Next:** Review d=1 items first (WILL BREAK). To check affected execution flows, READ codragraph://repo/${repoPath}/processes.`;

    case 'detect_changes':
      return `\n\n---\n**Next:** Review affected processes. Use context() on high-risk changed symbols. READ codragraph://repo/${repoPath}/process/{name} for full execution traces.`;

    case 'rename':
      return `\n\n---\n**Next:** Run detect_changes(${repoParam ? `{repo: "${repo}"}` : ''}) to verify no unexpected side effects from the rename.`;

    case 'cypher':
      return `\n\n---\n**Next:** To explore a result symbol, use context({name: "<name>"${repoParam}}). For schema reference, READ codragraph://repo/${repoPath}/schema.`;

    // Legacy tool names — still return useful hints
    case 'search':
      return `\n\n---\n**Next:** To understand a result in context, use context({name: "<symbol_name>"${repoParam}}).`;
    case 'explore':
      return `\n\n---\n**Next:** If planning changes, use impact({target: "<name>", direction: "upstream"${repoParam}}).`;
    case 'overview':
      return `\n\n---\n**Next:** To drill into an area, READ codragraph://repo/${repoPath}/cluster/{name}. To see execution flows, READ codragraph://repo/${repoPath}/processes.`;

    default:
      return '';
  }
}

/**
 * Create a configured MCP Server with all handlers registered.
 * Transport-agnostic — caller connects the desired transport.
 */
export function createMCPServer(backend: LocalBackend): Server {
  const require = createRequire(import.meta.url);
  const pkgVersion: string = require('../../package.json').version;
  const server = new Server(
    {
      name: 'codragraph',
      version: pkgVersion,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // Handle list resources request
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = getResourceDefinitions();
    return {
      resources: resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  // Handle list resource templates request (for dynamic resources)
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    const templates = getResourceTemplates();
    return {
      resourceTemplates: templates.map((t) => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      })),
    };
  });

  // Handle read resource request
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      const content = await readResource(uri, backend);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/yaml',
            text: content,
          },
        ],
      };
    } catch (err: any) {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Error: ${err.message}`,
          },
        ],
      };
    }
  });

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: CODRAGRAPH_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  // Handle tool calls — append next-step hints to guide agent workflow
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await backend.callTool(name, args);
      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const hint = getNextStepHint(name, args as Record<string, any> | undefined);

      return {
        content: [
          {
            type: 'text',
            text: resultText + hint,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Handle list prompts request
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'detect_impact',
        description:
          'Analyze the impact of your current changes before committing. Guides through scope selection, change detection, process analysis, and risk assessment.',
        arguments: [
          {
            name: 'scope',
            description: 'What to analyze: unstaged, staged, all, or compare',
            required: false,
          },
          { name: 'base_ref', description: 'Branch/commit for compare scope', required: false },
        ],
      },
      {
        name: 'generate_map',
        description:
          'Generate architecture documentation from the knowledge graph. Creates a codebase overview with execution flows and mermaid diagrams.',
        arguments: [
          {
            name: 'repo',
            description: 'Repository name (omit if only one indexed)',
            required: false,
          },
        ],
      },
      // ── Phase 4: versioned-graph prompts ──────────────────────────
      {
        name: 'review_recent_changes',
        description:
          'Phase 4: review what changed in the knowledge graph between two commits or branches. Walks log, runs structural diff, drills into modified symbols, summarizes risk.',
        arguments: [
          { name: 'repo', description: 'Repository (omit if only one indexed)', required: false },
          {
            name: 'from',
            description: 'Older branch/commit (defaults to HEAD~1)',
            required: false,
          },
          { name: 'to', description: 'Newer branch/commit (defaults to HEAD)', required: false },
        ],
      },
      {
        name: 'inspect_change_history',
        description:
          'Phase 4: trace a specific symbol through graph history — every commit where its row hash transitioned, with messages and timestamps.',
        arguments: [
          { name: 'repo', description: 'Repository (omit if only one indexed)', required: false },
          {
            name: 'symbolId',
            description: 'Stable symbol id (PK in the lbug node table)',
            required: true,
          },
          {
            name: 'table',
            description: 'Optional table hint (Function, Class, Method, Interface)',
            required: false,
          },
        ],
      },
      {
        name: 'compare_branches',
        description:
          'Phase 4: structural comparison of two graph branches with summary tables, modified symbols, and risk callouts.',
        arguments: [
          { name: 'repo', description: 'Repository (omit if only one indexed)', required: false },
          { name: 'base', description: 'Base branch (defaults to main)', required: false },
          { name: 'head', description: 'Head branch (required)', required: true },
        ],
      },
      {
        name: 'resolve_merge',
        description:
          'Phase 4: walk through a graph merge — preview the structural delta, run the three-way merger in dry-run, surface conflicts, and recommend a resolution path (manual edit + commit, take-theirs, take-ours, or abort).',
        arguments: [
          { name: 'repo', description: 'Repository (omit if only one indexed)', required: false },
          { name: 'source', description: 'Branch / commit to merge in', required: true },
          {
            name: 'into',
            description: 'Target branch (defaults to current HEAD)',
            required: false,
          },
        ],
      },
      {
        name: 'cleanup_graphstore',
        description:
          'Phase 4: report on graphstore disk usage and run mark-and-sweep gc with a safety dry-run pass first.',
        arguments: [
          { name: 'repo', description: 'Repository (omit if only one indexed)', required: false },
        ],
      },
      {
        name: 'recipe_aware_search',
        description:
          'Phase 4 × Phase 3 moat: lookup cached recipes for a task family at the current snapshot before deciding whether to run the swarm. Reuse exact matches; surface stale candidates as seeds; only re-search when nothing applies.',
        arguments: [
          { name: 'repo', description: 'Repository (omit if only one indexed)', required: false },
          {
            name: 'task_family',
            description: 'Task family identifier (e.g. "codebase-qa")',
            required: true,
          },
          {
            name: 'task',
            description: 'Path to the task-set JSON file (used if a search is needed)',
            required: false,
          },
        ],
      },
    ],
  }));

  // Handle get prompt request
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'detect_impact') {
      const scope = args?.scope || 'all';
      const baseRef = args?.base_ref || '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Analyze the impact of my current code changes before committing.

Follow these steps:
1. Run \`detect_changes(${JSON.stringify({ scope, ...(baseRef ? { base_ref: baseRef } : {}) })})\` to find what changed and affected processes
2. For each changed symbol in critical processes, run \`context({name: "<symbol>"})\` to see its full reference graph
3. For any high-risk items (many callers or cross-process), run \`impact({target: "<symbol>", direction: "upstream"})\` for blast radius
4. Summarize: changes, affected processes, risk level, and recommended actions

Present the analysis as a clear risk report.`,
            },
          },
        ],
      };
    }

    if (name === 'generate_map') {
      const repo = args?.repo || '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Generate architecture documentation for this codebase using the knowledge graph.

Follow these steps:
1. READ \`codragraph://repo/${repo || '{name}'}/context\` for codebase stats
2. READ \`codragraph://repo/${repo || '{name}'}/clusters\` to see all functional areas
3. READ \`codragraph://repo/${repo || '{name}'}/processes\` to see all execution flows
4. For the top 5 most important processes, READ \`codragraph://repo/${repo || '{name}'}/process/{name}\` for step-by-step traces
5. Generate a mermaid architecture diagram showing the major areas and their connections
6. Write an ARCHITECTURE.md file with: overview, functional areas, key execution flows, and the mermaid diagram`,
            },
          },
        ],
      };
    }

    if (name === 'review_recent_changes') {
      const repo = (args?.repo as string | undefined) ?? '';
      const from = (args?.from as string | undefined) ?? 'HEAD~1';
      const to = (args?.to as string | undefined) ?? 'HEAD';
      const repoArg = repo ? `, repo: "${repo}"` : '';
      const repoUri = repo || '{name}';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Review what changed in the knowledge graph between ${from} and ${to}.

Follow these steps:
1. READ \`codragraph://repo/${repoUri}/graphstore/head\` to confirm the current branch and head commit.
2. READ \`codragraph://repo/${repoUri}/graphstore/log\` to ground the timeline.
3. Call \`graphstore_diff({from: "${from}", to: "${to}"${repoArg}})\` to get the structural delta — added/removed nodes per table, edge deltas, modified symbols.
4. For each entry in \`modifiedSymbols\` (top 5 by table priority — Function/Method first), call \`context({name: "<id>"${repoArg}})\` to surface callers and process participation.
5. For high-risk modified symbols (many callers, cross-process), call \`impact({target: "<id>", direction: "upstream"${repoArg}})\` to estimate blast radius.
6. Summarize: counts by table, top modified symbols with their risk classification, and a single recommendation (safe / review / block).`,
            },
          },
        ],
      };
    }

    if (name === 'inspect_change_history') {
      const repo = (args?.repo as string | undefined) ?? '';
      const symbolId = (args?.symbolId as string | undefined) ?? '';
      const table = args?.table as string | undefined;
      const repoArg = repo ? `, repo: "${repo}"` : '';
      const tableArg = table ? `, table: "${table}"` : '';
      const repoUri = repo || '{name}';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Trace the change history of symbol \`${symbolId}\` through the knowledge graph.

Follow these steps:
1. READ \`codragraph://repo/${repoUri}/graphstore/head\` to confirm what HEAD points at.
2. Call \`graphstore_blame_symbol({symbolId: "${symbolId}"${tableArg}${repoArg}})\` to get every commit where the symbol's row hash transitioned.
3. For each transition, list the commit short id, timestamp, and message — present them as a timeline.
4. If the symbol no longer exists at HEAD, surface that as the first finding.
5. For each transition with an apparent semantic change (the row hash differs and the commit message hints at a refactor), call \`context({name: "${symbolId}"${repoArg}})\` to compare against the current shape.
6. Summarize: when the symbol was introduced, last meaningful change, and any churn signal (more than 5 transitions in 30 days).`,
            },
          },
        ],
      };
    }

    if (name === 'compare_branches') {
      const repo = (args?.repo as string | undefined) ?? '';
      const base = (args?.base as string | undefined) ?? 'main';
      const head = (args?.head as string | undefined) ?? '';
      const repoArg = repo ? `, repo: "${repo}"` : '';
      const repoUri = repo || '{name}';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Compare graph branch \`${head}\` against base \`${base}\`.

Follow these steps:
1. READ \`codragraph://repo/${repoUri}/graphstore/branches\` to confirm both branches exist.
2. Call \`graphstore_diff({from: "${base}", to: "${head}"${repoArg}})\` for the structural summary.
3. For each modified symbol (cap at 10 by table priority Function/Method/Class/Interface), call \`context\` to gather caller-side context.
4. Highlight any added or removed Process — those are execution-flow changes, the highest-impact category.
5. Output: counts by table, top changed APIs (functions/methods that gained or lost callers), removed symbols (potential breakage), and recommended review focus.`,
            },
          },
        ],
      };
    }

    if (name === 'resolve_merge') {
      const repo = (args?.repo as string | undefined) ?? '';
      const source = (args?.source as string | undefined) ?? '';
      const into = (args?.into as string | undefined) ?? '';
      const repoArg = repo ? `, repo: "${repo}"` : '';
      const intoArg = into ? `, into: "${into}"` : '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Help me merge graph branch \`${source}\` ${into ? `into \`${into}\`` : 'into the current branch'} safely.

Follow these steps:
1. Call \`graphstore_branches\`${repoArg ? `({ ${repoArg.slice(2)} })` : '({})'} to confirm the branches exist and identify HEAD.
2. Call \`graphstore_diff({from: "<base-branch>", to: "${source}"${repoArg}})\` for a quick scan of what's coming.
3. Call \`graphstore_merge({source: "${source}"${intoArg}${repoArg}, dryRun: true})\` to preview the merge:
   - kind=already-up-to-date → nothing to do; surface that.
   - kind=fast-forward → safe to advance; recommend re-running with dryRun: false.
   - kind=merged → preview clean — recommend re-running without dryRun.
   - kind=conflicts → for each conflict (kind, id, reason), advise: (a) which side to take if the reason hints obviously, (b) escalate to manual review if "modified-on-both-sides" with non-obvious semantics.
4. For high-risk merges (changed APIs in modifiedSymbols, or many conflicts), suggest creating a backup branch first via \`branch create\`.
5. Output: actionable plan — single sentence per next step, plus the exact graphstore_merge call to run.`,
            },
          },
        ],
      };
    }

    if (name === 'recipe_aware_search') {
      const repo = (args?.repo as string | undefined) ?? '';
      const taskFamily = (args?.task_family as string | undefined) ?? '';
      const task = (args?.task as string | undefined) ?? '';
      const repoArg = repo ? `, repo: "${repo}"` : '';
      const taskArg = task ? `, task: "${task}"` : '';
      const repoUri = repo || '{name}';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Help me decide whether to reuse a learned harness recipe or run a fresh swarm for task family \`${taskFamily}\`.

Follow these steps:
1. READ \`codragraph://repo/${repoUri}/graphstore/head\` to capture the current snapshot id.
2. Call \`harness_recipes_lookup({task_family: "${taskFamily}", snapshot_id: "<from step 1>"${repoArg}})\`.
3. Decide based on the result:
   - exact non-empty → call \`harness_swarm_run({task: "...", task_family: "${taskFamily}", snapshot_id: "...", use_cache: true${repoArg}${taskArg}})\` to short-circuit; report the cached frontier.
   - exact empty + candidates with riskLevel "low" → recommend running the swarm with \`use_cache: false\` but seeding with the candidate; the swarm will write a fresh recipe at the new snapshot.
   - exact empty + candidates "medium"/"high"/"unknown" → recommend a fresh swarm; flag that earlier recipes likely don't apply.
   - both empty → recommend running the swarm; first time learning this family for the current codebase.
4. After any swarm completes, READ \`codragraph://repo/${repoUri}/recipes/${taskFamily}\` to confirm the recipe was persisted.
5. Output: a one-paragraph rationale, the exact \`harness_swarm_run\` call recommended, and (if cached) the projected token savings vs a full swarm.`,
            },
          },
        ],
      };
    }

    if (name === 'cleanup_graphstore') {
      const repo = (args?.repo as string | undefined) ?? '';
      const repoArg = repo ? `, repo: "${repo}"` : '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Audit graphstore disk usage and reclaim space safely.

Follow these steps:
1. READ \`codragraph://repo/${repo || '{name}'}/graphstore/branches\` to confirm the branch set.
2. READ \`codragraph://repo/${repo || '{name}'}/graphstore/log\` to get a sense of history depth.
3. Call \`graphstore_gc({dryRun: true${repoArg}})\` to compute the unreachable set without deleting.
4. If the dry-run reports >100 KB to free, recommend running \`graphstore_gc({${repoArg.slice(2)}})\` to actually sweep. Otherwise recommend leaving it.
5. If the user has experimental branches that look stale (no recent commits), suggest deleting them via \`branch delete\` first to expand the unreachable set.
6. Output: current size estimate, what would be freed, and the recommended action as a single command.`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  return server;
}

/**
 * Start the MCP server on stdio transport (for CLI use).
 */
export async function startMCPServer(backend: LocalBackend): Promise<void> {
  const server = createMCPServer(backend);

  // Use the shared stdout reference captured at module-load time by the
  // lbug-adapter.  Avoids divergence if anything patches stdout between
  // module load and server start.
  const _safeStdout = new Proxy(process.stdout, {
    get(target, prop, receiver) {
      if (prop === 'write') return realStdoutWrite;
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
  const transport = new CompatibleStdioServerTransport(process.stdin, _safeStdout);
  await server.connect(transport);

  // Graceful shutdown helper
  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await backend.disconnect();
    } catch {}
    try {
      await server.close();
    } catch {}
    process.exit(exitCode);
  };

  // Handle graceful shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Log crashes to stderr so they aren't silently lost.
  // uncaughtException is fatal — shut down.
  // unhandledRejection is logged but kept non-fatal (availability-first):
  // killing the server for one missed catch would be worse than logging it.
  process.on('uncaughtException', (err) => {
    process.stderr.write(`CodraGraph MCP uncaughtException: ${err?.stack || err}\n`);
    shutdown(1);
  });
  process.on('unhandledRejection', (reason: any) => {
    process.stderr.write(`CodraGraph MCP unhandledRejection: ${reason?.stack || reason}\n`);
  });

  // Handle stdio errors — stdin close means the parent process is gone
  process.stdin.on('end', shutdown);
  process.stdin.on('error', () => shutdown());
  process.stdout.on('error', () => shutdown());
}
