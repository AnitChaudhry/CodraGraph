/**
 * MCP Tool Definitions
 *
 * Defines the tools that CodraGraph exposes to external AI agents.
 * All tools support an optional `repo` parameter for multi-repo setups.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        default?: unknown;
        items?: { type: string };
        enum?: string[];
        minimum?: number;
        maximum?: number;
        minLength?: number;
      }
    >;
    required: string[];
  };
}

export const CODRAGRAPH_TOOLS: ToolDefinition[] = [
  {
    name: 'list_repos',
    description: `List all indexed repositories available to CodraGraph.

Returns each repo's name, path, indexed date, last commit, and stats.

WHEN TO USE: First step when multiple repos are indexed, or to discover available repos.
AFTER THIS: READ codragraph://repo/{name}/context for the repo you want to work with.

When multiple repos are indexed, you MUST specify the "repo" parameter
on other tools (query, context, impact, etc.) to target the correct one.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'query',
    description: `Query the code knowledge graph for execution flows related to a concept.
Returns processes (call chains) ranked by relevance, each with its symbols and file locations.

WHEN TO USE: Understanding how code works together. Use this when you need execution flows and relationships, not just file matches. Complements grep/IDE search.
AFTER THIS: Use context() on a specific symbol for 360-degree view (callers, callees, categorized refs).

Returns results grouped by process (execution flow):
- processes: ranked execution flows with relevance priority
- process_symbols: all symbols in those flows with file locations and module (functional area)
- definitions: standalone types/interfaces not in any process

Hybrid ranking: BM25 keyword + semantic vector search, ranked by Reciprocal Rank Fusion.

GROUP MODE: set "repo" to "@<groupName>" to search all member repos in that group (merged via RRF), or "@<groupName>/<groupRepoPath>" to run against a single member (same path keys as in group.yaml). If you use "@<groupName>" only, the member repo defaults to the lexicographically first key in group.yaml "repos". Prefer resources for contracts/status (see migration from legacy group_* tools).

SERVICE: optional monorepo path prefix (POSIX-style, case-sensitive segments). When "repo" starts with "@", only processes whose symbols fall under that prefix are included. For a normal indexed repo name (no leading @), this field is currently ignored by the server.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language or keyword search query' },
        task_context: {
          type: 'string',
          description: 'What you are working on (e.g., "adding OAuth support"). Helps ranking.',
        },
        goal: {
          type: 'string',
          description:
            'What you want to find (e.g., "existing auth validation logic"). Helps ranking.',
        },
        limit: {
          type: 'number',
          description: 'Max processes to return (default: 5)',
          default: 5,
          minimum: 1,
          maximum: 100,
        },
        max_symbols: {
          type: 'number',
          description: 'Max symbols per process (default: 10)',
          default: 10,
          minimum: 1,
          maximum: 200,
        },
        include_content: {
          type: 'boolean',
          description: 'Include full symbol source code (default: false)',
          default: false,
        },
        repo: {
          type: 'string',
          description:
            'Indexed repository name or path, or group mode "@<groupName>" / "@<groupName>/<memberPath>" (member path keys from group.yaml). Omit when only one indexed repo exists.',
        },
        service: {
          type: 'string',
          minLength: 1,
          description:
            'Optional monorepo service root (relative path, "/" separators). In group mode (@repo), prefix-matches symbol file paths; ignored for a normal repo name. Empty string is rejected server-side.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'feature_clusters',
    description: `List human-facing feature clusters such as Settings, AI, Auth, Billing, MCP, or Ingestion.

WHEN TO USE: First step for targeted implementation/refactoring when you need the functional area map before loading files. This is the product/domain layer above algorithmic Community nodes.
AFTER THIS: Use feature_context(name) for members with file paths and line ranges, then context() or impact() on specific symbols.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional cluster owner search term (e.g. "settings", "AI", "billing").',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        limit: {
          type: 'number',
          description: 'Max feature clusters to return (default: 100)',
          default: 100,
          minimum: 1,
          maximum: 500,
        },
      },
      required: [],
    },
  },
  {
    name: 'feature_context',
    description: `Get a complete context pack for one FeatureCluster.

Returns the cluster metadata, member symbols/files with line ranges, outgoing/incoming feature dependencies, and related execution processes.

WHEN TO USE: Before editing a feature area like Settings or AI. This narrows exploration to the exact files and symbols in that feature cluster.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Feature cluster name, slug, or id (e.g. "Settings", "settings").',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        limit: {
          type: 'number',
          description: 'Max members to return (default: 100)',
          default: 100,
          minimum: 1,
          maximum: 500,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'cluster_query',
    description: `Cluster-first alias for feature_clusters.

WHEN TO USE: Ask which product/domain cluster owns an area like Settings, AI, Auth, or Billing before loading files.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional cluster owner search term (e.g. "settings", "AI", "billing").',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        limit: {
          type: 'number',
          description: 'Max feature clusters to return (default: 100)',
          default: 100,
          minimum: 1,
          maximum: 500,
        },
      },
      required: [],
    },
  },
  {
    name: 'cluster_context',
    description: `Cluster-first alias for feature_context.

Returns a FeatureCluster context pack with members, entry points, routes, tools, tests, docs, dependencies, and safe edit surface.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Feature cluster name, slug, or id (e.g. "Settings", "settings").',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        limit: {
          type: 'number',
          description: 'Max members to return (default: 100)',
          default: 100,
          minimum: 1,
          maximum: 500,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'context_pack',
    description: `Get the compact agent context pack for a FeatureCluster.

WHEN TO USE: Before a refactor or implementation task where the agent should avoid re-exploring the full repo.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Feature cluster name, slug, or id (e.g. "AI", "ai").',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        limit: {
          type: 'number',
          description: 'Max members to return (default: 100)',
          default: 100,
          minimum: 1,
          maximum: 500,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'cluster_impact',
    description: `Assess feature-level blast radius for a FeatureCluster.

Returns upstream/downstream cluster dependencies plus the same context pack and safe edit surface used for targeted edits.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Feature cluster name, slug, or id.',
        },
        direction: {
          type: 'string',
          enum: ['upstream', 'downstream', 'both'],
          description: 'Dependency direction to inspect.',
          default: 'upstream',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        limit: {
          type: 'number',
          description: 'Max members to include in the context pack (default: 100)',
          default: 100,
          minimum: 1,
          maximum: 500,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'cypher',
    description: `Execute Cypher query against the code knowledge graph.

WHEN TO USE: Complex structural queries that search/explore can't answer. READ codragraph://repo/{name}/schema first for the full schema.
AFTER THIS: Use context() on result symbols for deeper context.

SCHEMA:
- Nodes: File, Folder, Function, Class, Interface, Method, CodeElement, Community, Process, FeatureCluster, Route, Tool
- Multi-language nodes (use backticks): \`Struct\`, \`Enum\`, \`Trait\`, \`Impl\`, etc.
- All edges via single CodeRelation table with 'type' property
- Edge types: CONTAINS, DEFINES, CALLS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_METHOD, HAS_PROPERTY, ACCESSES, METHOD_OVERRIDES, METHOD_IMPLEMENTS, MEMBER_OF, STEP_IN_PROCESS, HANDLES_ROUTE, FETCHES, HANDLES_TOOL, ENTRY_POINT_OF, WRAPS, QUERIES, FEATURE_MEMBER_OF, FEATURE_DEPENDS_ON
- Edge properties: type (STRING), confidence (DOUBLE), reason (STRING), step (INT32)

EXAMPLES:
• Find callers of a function:
  MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b:Function {name: "validateUser"}) RETURN a.name, a.filePath

• Find community members:
  MATCH (f)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community) WHERE c.heuristicLabel = "Auth" RETURN f.name

• Trace a process:
  MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process) WHERE p.heuristicLabel = "UserLogin" RETURN s.name, r.step ORDER BY r.step

• Find all methods of a class:
  MATCH (c:Class {name: "UserService"})-[r:CodeRelation {type: 'HAS_METHOD'}]->(m:Method) RETURN m.name, m.parameterCount, m.returnType

• Find all properties of a class:
  MATCH (c:Class {name: "User"})-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property) RETURN p.name, p.declaredType

• Find all writers of a field:
  MATCH (f:Function)-[r:CodeRelation {type: 'ACCESSES', reason: 'write'}]->(p:Property) WHERE p.name = "address" RETURN f.name, f.filePath

• Find method overrides (MRO resolution):
  MATCH (winner:Method)-[r:CodeRelation {type: 'METHOD_OVERRIDES'}]->(loser:Method) RETURN winner.name, winner.filePath, loser.filePath, r.reason

• Detect diamond inheritance:
  MATCH (d:Class)-[:CodeRelation {type: 'EXTENDS'}]->(b1), (d)-[:CodeRelation {type: 'EXTENDS'}]->(b2), (b1)-[:CodeRelation {type: 'EXTENDS'}]->(a), (b2)-[:CodeRelation {type: 'EXTENDS'}]->(a) WHERE b1 <> b2 RETURN d.name, b1.name, b2.name, a.name

OUTPUT: Returns { markdown, row_count } — results formatted as a Markdown table for easy reading.

TIPS:
- All relationships use single CodeRelation table — filter with {type: 'CALLS'} etc.
- Community = auto-detected functional area (Leiden algorithm). Properties: heuristicLabel, cohesion, symbolCount, keywords, description, enrichedBy
- Process = execution flow trace from entry point to terminal. Properties: heuristicLabel, processType, stepCount, communities, entryPointId, terminalId
- FeatureCluster = product/domain area for targeted context packs. Properties: name, slug, featureKind, summary, repo, service, memberCount, entryPointIds, routes, tools, testCoverageHints, lastIndexedCommit, confidence, signals
- Use heuristicLabel (not label) for human-readable community/process names`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Cypher query to execute' },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'context',
    description: `360-degree view of a single code symbol.
Shows categorized incoming/outgoing references (calls, imports, extends, implements, methods, properties, overrides), process participation, and file location.

WHEN TO USE: After query() to understand a specific symbol in depth. When you need to know all callers, callees, and what execution flows a symbol participates in.
AFTER THIS: Use impact() if planning changes, or READ codragraph://repo/{name}/process/{processName} for full execution trace.

Handles disambiguation: if multiple symbols share the same name, returns ranked candidates (each with a relevance score) for you to pick from. Use uid for zero-ambiguity lookup, or narrow the search with file_path and/or kind hints.

NOTE: ACCESSES edges (field read/write tracking) are included in context results with reason 'read' or 'write'. CALLS edges resolve through field access chains and method-call chains (e.g., user.address.getCity().save() produces CALLS edges at each step).

GROUP MODE: set "repo" to "@<groupName>" to run context in each member repo (aggregated list), or "@<groupName>/<groupRepoPath>" for one member. If you use "@<groupName>" only, the member defaults to the lexicographically first key in group.yaml "repos".

SERVICE: optional monorepo path prefix (case-sensitive path segments). When "repo" starts with "@", prefix-matches resolved symbol file paths; when a hit is outside the prefix, that member returns an empty payload for the symbol. Ignored for a normal indexed repo name.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name (e.g., "validateUser", "AuthService")' },
        uid: {
          type: 'string',
          description: 'Direct symbol UID from prior tool results (zero-ambiguity lookup)',
        },
        file_path: { type: 'string', description: 'File path to disambiguate common names' },
        kind: {
          type: 'string',
          description:
            "Kind filter to disambiguate common names (e.g. 'Function', 'Class', 'Method', 'Interface', 'Constructor')",
        },
        include_content: {
          type: 'boolean',
          description: 'Include full symbol source code (default: false)',
          default: false,
        },
        repo: {
          type: 'string',
          description:
            'Indexed repository name or path, or group mode "@<groupName>" / "@<groupName>/<memberPath>". Omit if only one repo is indexed.',
        },
        service: {
          type: 'string',
          minLength: 1,
          description:
            'Optional monorepo service root (relative path). Applies in group mode (@repo) only; ignored for a normal repo name. Empty string is rejected server-side.',
        },
      },
      required: [],
    },
  },
  {
    name: 'detect_changes',
    description: `Analyze uncommitted git changes and find affected execution flows.
Maps git diff hunks to indexed symbols, then traces which processes are impacted.

WHEN TO USE: Before committing — to understand what your changes affect. Pre-commit review, PR preparation.
AFTER THIS: Review affected processes. Use context() on high-risk symbols. READ codragraph://repo/{name}/process/{name} for full traces.

Returns: changed symbols, affected processes, and a risk summary.`,
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'What to analyze: "unstaged" (default), "staged", "all", or "compare"',
          enum: ['unstaged', 'staged', 'all', 'compare'],
          default: 'unstaged',
        },
        base_ref: {
          type: 'string',
          description: 'Branch/commit for "compare" scope (e.g., "main")',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
      },
      required: [],
    },
  },
  {
    name: 'rename',
    description: `Multi-file coordinated rename using the knowledge graph + text search.
Finds all references via graph (high confidence) and regex text search (lower confidence). Preview by default.

WHEN TO USE: Renaming a function, class, method, or variable across the codebase. Safer than find-and-replace.
AFTER THIS: Run detect_changes() to verify no unexpected side effects.

Each edit is tagged with confidence:
- "graph": found via knowledge graph relationships (high confidence, safe to accept)
- "text_search": found via regex text search (lower confidence, review carefully)`,
    inputSchema: {
      type: 'object',
      properties: {
        symbol_name: { type: 'string', description: 'Current symbol name to rename' },
        symbol_uid: {
          type: 'string',
          description: 'Direct symbol UID from prior tool results (zero-ambiguity)',
        },
        new_name: { type: 'string', description: 'The new name for the symbol' },
        file_path: { type: 'string', description: 'File path to disambiguate common names' },
        dry_run: {
          type: 'boolean',
          description: 'Preview edits without modifying files (default: true)',
          default: true,
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
      },
      required: ['new_name'],
    },
  },
  {
    name: 'impact',
    description: `Analyze the blast radius of changing a code symbol.
Returns affected symbols grouped by depth, plus risk assessment, affected execution flows, and affected modules.

WHEN TO USE: Before making code changes — especially refactoring, renaming, or modifying shared code. Shows what would break.
AFTER THIS: Review d=1 items (WILL BREAK). Use context() on high-risk symbols.

Output includes:
- risk: LOW / MEDIUM / HIGH / CRITICAL
- summary: direct callers, processes affected, modules affected
- affected_processes: which execution flows break and at which step
- affected_modules: which functional areas are hit (direct vs indirect)
- byDepth: all affected symbols grouped by traversal depth

Depth groups:
- d=1: WILL BREAK (direct callers/importers)
- d=2: LIKELY AFFECTED (indirect)
- d=3: MAY NEED TESTING (transitive)

TIP: Default traversal uses CALLS/IMPORTS/EXTENDS/IMPLEMENTS. For class members, include HAS_METHOD and HAS_PROPERTY in relationTypes. For field access analysis, include ACCESSES in relationTypes.

Handles disambiguation: when multiple symbols share the target name, returns ranked candidates (each with a relevance score) instead of silently picking one. Use target_uid for zero-ambiguity lookup, or narrow with file_path and/or kind hints.

EdgeType: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_METHOD, HAS_PROPERTY, METHOD_OVERRIDES, METHOD_IMPLEMENTS, ACCESSES
Confidence: 1.0 = certain, <0.8 = fuzzy match

GROUP MODE: set "repo" to "@<groupName>" for cross-repo impact anchored at the default member (lexicographically first key in group.yaml "repos"), or "@<groupName>/<groupRepoPath>" to choose the member (same path keys as in group.yaml). Phase-1 walk runs in that member; cross-boundary fan-out uses the group bridge.

SERVICE: optional monorepo path prefix (case-sensitive path segments). When "repo" starts with "@", scopes the local impact walk and cross-repo symbol paths to files under that prefix; ignored for a normal indexed repo name.`,
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Name of function, class, or file to analyze' },
        target_uid: {
          type: 'string',
          description:
            'Direct symbol UID from prior tool results (zero-ambiguity lookup, skips target resolution)',
        },
        direction: {
          type: 'string',
          description: 'upstream (what depends on this) or downstream (what this depends on)',
        },
        file_path: {
          type: 'string',
          description: 'File path hint to disambiguate common names',
        },
        kind: {
          type: 'string',
          description:
            "Kind filter to disambiguate common names (e.g. 'Function', 'Class', 'Method', 'Interface', 'Constructor')",
        },
        maxDepth: {
          type: 'number',
          description: 'Max relationship depth (default: 3, server clamps to 1–32)',
          default: 3,
          minimum: 1,
          maximum: 32,
        },
        crossDepth: {
          type: 'number',
          description:
            'Cross-repository hop depth via contract bridge (default: 1; values above server maximum are clamped)',
          default: 1,
          minimum: 1,
          maximum: 32,
        },
        relationTypes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_METHOD, HAS_PROPERTY, METHOD_OVERRIDES, METHOD_IMPLEMENTS, ACCESSES (default: usage-based, ACCESSES excluded by default)',
        },
        includeTests: { type: 'boolean', description: 'Include test files (default: false)' },
        minConfidence: {
          type: 'number',
          description:
            'Minimum edge confidence 0–1 (default: 0 when omitted; server clamps to 0–1)',
          default: 0,
          minimum: 0,
          maximum: 1,
        },
        repo: {
          type: 'string',
          description:
            'Indexed repository name or path, or group mode "@<groupName>" / "@<groupName>/<memberPath>". Omit if only one repo is indexed.',
        },
        service: {
          type: 'string',
          minLength: 1,
          description:
            'Optional monorepo service root (relative path). Applies when "repo" is group mode (@…); ignored for a normal repo name. Empty string is rejected server-side.',
        },
        subgroup: {
          type: 'string',
          description:
            'Optional group subgroup prefix (member repo paths) limiting which repos participate in cross fan-out.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Wall-clock budget in milliseconds for the Phase-1 local impact leg (default 30000)',
          minimum: 1,
          maximum: 3600000,
        },
        timeout: {
          type: 'number',
          description: 'Alias of timeoutMs (milliseconds) when timeoutMs is omitted',
          minimum: 1,
          maximum: 3600000,
        },
      },
      required: ['target', 'direction'],
    },
  },
  {
    name: 'route_map',
    description: `Show API route mappings: which components/hooks fetch which API endpoints, and which handler files serve them.

WHEN TO USE: Understanding API consumption patterns, finding orphaned routes. For pre-change analysis, prefer \`api_impact\` which combines this data with mismatch detection and risk assessment.
AFTER THIS: Use impact() on specific route handlers to see full blast radius.

Returns: route nodes with their handlers, middleware wrapper chains (e.g., withAuth, withRateLimit), and consumers.`,
    inputSchema: {
      type: 'object',
      properties: {
        route: {
          type: 'string',
          description: 'Filter by route path (e.g., "/api/grants"). Omit for all routes.',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
      },
      required: [],
    },
  },
  {
    name: 'tool_map',
    description: `Show MCP/RPC tool definitions: which tools are defined, where they're handled, and their descriptions.

WHEN TO USE: Understanding tool APIs, finding tool implementations, impact analysis for tool changes.

Returns: tool nodes with their handler files and descriptions.`,
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Filter by tool name. Omit for all tools.' },
        repo: { type: 'string', description: 'Repository name or path.' },
      },
      required: [],
    },
  },
  {
    name: 'shape_check',
    description: `Check response shapes for API routes against their consumers' property accesses.

WHEN TO USE: Detecting mismatches between what an API route returns and what consumers expect. Finding shape drift. For pre-change analysis, prefer \`api_impact\` which combines this data with mismatch detection and risk assessment.
REQUIRES: Route nodes with responseKeys (extracted from .json({...}) calls during indexing).

Returns routes that have both detected response keys AND consumers. Shows top-level keys each endpoint returns (e.g., data, pagination, error) and what keys each consumer accesses. Reports MISMATCH status when a consumer accesses keys not present in the route's response shape.`,
    inputSchema: {
      type: 'object',
      properties: {
        route: {
          type: 'string',
          description: 'Check a specific route (e.g., "/api/grants"). Omit to check all routes.',
        },
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
      },
      required: [],
    },
  },
  {
    name: 'api_impact',
    description: `Pre-change impact report for an API route handler.

WHEN TO USE: BEFORE modifying any API route handler. Shows what consumers depend on, what response fields they access, what middleware protects the route, and what execution flows it triggers. Requires at least "route" or "file" parameter.

Risk levels: LOW (0-3 consumers), MEDIUM (4-9 or any mismatches), HIGH (10+ consumers or mismatches with 4+ consumers). Mismatches with confidence "low" indicate the consumer file fetches multiple routes — property attribution is approximate.

Returns: single route object when one match, or { routes: [...], total: N } for multiple matches. Combines route_map, shape_check, and impact data.`,
    inputSchema: {
      type: 'object',
      properties: {
        route: { type: 'string', description: 'Route path (e.g., "/api/grants")' },
        file: { type: 'string', description: 'Handler file path (alternative to route)' },
        repo: { type: 'string', description: 'Repository name or path.' },
      },
      required: [],
    },
  },
  {
    name: 'group_list',
    description: `List all configured repository groups, or return details for one group (repos, manifest links).

WHEN TO USE: Discover groups before group_sync. Optional "name" returns a single group's config.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Group name. Omit to list all groups.' },
      },
      required: [],
    },
  },
  {
    name: 'group_sync',
    description: `Rebuild the Contract Registry (contracts.json) for a group: extract HTTP contracts, apply manifest links, exact-match cross-links.

WHEN TO USE: After changing group.yaml or re-indexing member repos.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Group name' },
        skipEmbeddings: {
          type: 'boolean',
          description: 'Exact + BM25 only (Demo PR: same as default exact path)',
        },
        exactOnly: { type: 'boolean', description: 'Exact match only in cascade' },
      },
      required: ['name'],
    },
  },
  {
    name: 'graphpack_status',
    description: `Show the team graphpack state for a repo.

WHEN TO USE: before answering team-shared-context questions. Reports whether the answer should be considered canonical main graph, PR overlay, local graph, or missing/fallback.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        strict: {
          type: 'boolean',
          description: 'Recompute graphstore CAS digest instead of trusting local presence.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'graphpack_publish',
    description: `Create a thin .codragraph/index.lock.json plus graphpack manifest for GitHub-native artifact publishing.

WHEN TO USE: CI on main or PR branches after analyze. Commits the lock only; heavy graphstore chunks remain artifact storage.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        target: {
          type: 'string',
          enum: ['main', 'pr'],
          description: 'Graphpack target.',
          default: 'main',
        },
        artifact_dir: { type: 'string', description: 'Local artifact staging directory.' },
        artifact_url: { type: 'string', description: 'Remote artifact URL to record in the lock.' },
        base_snapshot_id: { type: 'string', description: 'PR overlay base snapshot id.' },
        head_snapshot_id: { type: 'string', description: 'PR overlay head snapshot id.' },
        pull_request: { type: 'string', description: 'Pull request number or URL.' },
      },
      required: [],
    },
  },
  {
    name: 'graphpack_pull',
    description: `Validate/pull a graphpack from a lock and report whether local materialization can proceed.

WHEN TO USE: developer bootstrap after clone/checkout. If unavailable or incompatible, the result includes a safe local analyze fallback reason.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        artifact_dir: { type: 'string', description: 'Local graphpack artifact directory.' },
      },
      required: [],
    },
  },
  {
    name: 'semantic_relationships',
    description: `Return developer-intent semantic relationships above raw graph edges.

Families include COMPOSES, ADAPTS, DELEGATES_TO, WRAPS, CONFIGURES, FACTORY_CREATES, ORCHESTRATES, PROXIES_TO, and MAPS_TO. Every edge includes evidence, confidence, extractor version, and provenance.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository name or path. Omit if only one repo is indexed.',
        },
        limit: {
          type: 'number',
          description: 'Maximum relationships to return.',
          default: 1000,
          minimum: 1,
          maximum: 10000,
        },
        llm: {
          type: 'boolean',
          description: 'Allow optional LLM-inferred edges when provider support is configured.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'harness_swarm_run',
    description: `Phase 3 swarm: Explorer + Exploiter (subprocess) + Critic (in-process), with hybrid termination.

WHEN TO USE: When auto-tuning needs MULTIPLE specialized roles working in parallel. Explorer makes broad mutations; Exploiter refines top frontier; Critic gates each proposal before evaluation. Hybrid termination (max-N + plateau + budget) lets you cap cost.

Reference: arXiv 2603.28052 (Meta-Harness) extended with role specialization.

Returns the Pareto frontier plus per-role attribution stats (which role contributed which frontier hits).`,
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Path to a task-set JSON file.',
        },
        max_iterations: {
          type: 'number',
          description: 'Hard upper bound on iterations. Default 30.',
          default: 30,
          minimum: 1,
          maximum: 200,
        },
        explore_count: {
          type: 'number',
          description: 'Candidates per iteration from Explorer. Default 2.',
          default: 2,
          minimum: 1,
          maximum: 10,
        },
        exploit_count: {
          type: 'number',
          description: 'Candidates per iteration from Exploiter. Default 2.',
          default: 2,
          minimum: 1,
          maximum: 10,
        },
        plateau_k: {
          type: 'number',
          description: 'Stop early when frontier stagnates for K iterations. Omit to disable.',
          minimum: 1,
        },
        token_budget: {
          type: 'number',
          description: 'Stop when total proposer+eval tokens exceed N. Omit to disable.',
          minimum: 1,
        },
        time_budget_ms: {
          type: 'number',
          description: 'Stop when wall-clock exceeds ms. Omit to disable.',
          minimum: 1,
        },
        cost_budget_usd: {
          type: 'number',
          description: 'Stop when estimated cost exceeds USD. Omit to disable.',
          minimum: 0,
        },
        inference: {
          type: 'string',
          description: 'Harness inference provider.',
          default: 'claude',
          enum: ['claude', 'openai', 'opencode'],
        },
        critic_inference: {
          type: 'string',
          description: 'Critic inference provider (use a small/fast model).',
          default: 'claude',
          enum: ['claude', 'openai', 'opencode'],
        },
        seeds: {
          type: 'string',
          description: 'Comma-separated seed names or "all".',
          default: 'all',
        },
        output: { type: 'string', description: 'Run directory.' },
        repo: { type: 'string', description: 'Indexed repo for graph queries.' },
        // ── Phase 4 × Phase 3 moat ──────────────────────────────────
        task_family: {
          type: 'string',
          description:
            'Phase 4 moat: cache key for recipe memory. When provided with snapshot_id, learned recipes get persisted under (snapshot_id, task_family).',
        },
        snapshot_id: {
          type: 'string',
          description:
            'Phase 4 moat: codragraph-graphstore snapshot id (sha256:...). Required to enable recipe caching.',
        },
        required_subgraph_signature: {
          type: 'string',
          description:
            'Phase 4 moat: stable signature of the task-required subgraph. Exact cache reuse keys on (snapshot_id, task_family, required_subgraph_signature).',
        },
        use_cache: {
          type: 'boolean',
          description:
            'Phase 4 moat: when true and an exact (snapshot_id, task_family) recipe exists, return it instead of running the swarm.',
          default: false,
        },
        recipe_store: {
          type: 'string',
          description: 'Recipe store root. Defaults to <cwd>/.codragraph/recipes.',
        },
        persist_top_k: {
          type: 'number',
          description: 'Recipes to persist after a fresh swarm. Default 5.',
          default: 5,
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'harness_recipes_list',
    description: `List harness recipes — Pareto-winning harnesses persisted by past swarm runs, keyed by (snapshot_id, task_family).

WHEN TO USE: discover what's already been learned for the current codebase. Optionally filter by task_family (e.g. "codebase-qa") or snapshot_id. Pair with \`harness_swarm_run\` (use_cache: true) to reuse a recipe instead of re-running the swarm.

This is the Phase 4 × Phase 3 moat — versioned recipe memory. Recipes auto-invalidate when the codragraph-graphstore snapshot changes.`,
    inputSchema: {
      type: 'object',
      properties: {
        task_family: { type: 'string', description: 'Filter by task family.' },
        snapshot_id: { type: 'string', description: 'Filter by snapshot id (sha256:...).' },
        required_subgraph_signature: {
          type: 'string',
          description: 'Filter by required subgraph signature.',
        },
        recipe_store: {
          type: 'string',
          description: 'Recipe store root. Defaults to <cwd>/.codragraph/recipes.',
        },
        limit: { type: 'number', description: 'Max entries (default 50).', default: 50 },
      },
      required: [],
    },
  },
  {
    name: 'harness_recipes_lookup',
    description: `Find reusable recipes for a (snapshot_id, task_family) pair.

Returns:
- exact: recipes that match the snapshot exactly — safe to reuse byte-for-byte.
- candidates: recipes from a different snapshot for the same family, with a staleness assessment (low/medium/high/unknown). High-risk candidates should NOT be auto-reused; surface them as starting seeds for a fresh swarm instead.

WHEN TO USE: before kicking off a swarm. If exact matches exist, you can skip the swarm entirely.`,
    inputSchema: {
      type: 'object',
      properties: {
        task_family: { type: 'string', description: 'Task family identifier.' },
        snapshot_id: { type: 'string', description: 'Current codragraph-graphstore snapshot id.' },
        required_subgraph_signature: {
          type: 'string',
          description:
            'Stable signature of the subgraph this task needs. Exact reuse requires matching snapshot, family, and signature.',
        },
        recipe_store: {
          type: 'string',
          description: 'Recipe store root. Defaults to <cwd>/.codragraph/recipes.',
        },
        limit: {
          type: 'number',
          description: 'Max entries per match kind (default 10).',
          default: 10,
        },
      },
      required: ['task_family', 'snapshot_id'],
    },
  },
  {
    name: 'harness_run',
    description: `Run the codragraph-harness Meta-Harness search loop for a task family.

WHEN TO USE: When you want to *auto-tune* the harness (the code that decides what context to retrieve and how to prompt) for a specific task family. Returns the Pareto frontier of discovered harnesses over (accuracy, tokens, latencyMs).

Reference: arXiv 2603.28052 (Meta-Harness). Implementation: codragraph-harness package.

Each run creates a runs/<runId>/ directory with the candidate filesystem 𝒟 (every harness's source, traces, and scores). The proposer (Claude Code subprocess by default) reads 𝒟 between iterations to design new mutations. Returns the non-dominated frontier on completion.

NOTE (Phase 1): handler is registered out-of-process by codragraph-harness; the codragraph MCP server forwards this tool call to the harness package. See codragraph-harness/src/mcp/handler.ts.`,
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Path to a task-set JSON file (see codragraph-harness/test/fixtures/qa-test-set.json for the format).',
        },
        iterations: {
          type: 'number',
          description: 'Outer-loop iterations N (default: 20).',
          default: 20,
          minimum: 1,
          maximum: 200,
        },
        candidates_per_iteration: {
          type: 'number',
          description: 'k — candidates proposed per iteration (default: 2).',
          default: 2,
          minimum: 1,
          maximum: 10,
        },
        proposer: {
          type: 'string',
          description: 'Proposer name (Phase 1: only "claude-code").',
          default: 'claude-code',
          enum: ['claude-code'],
        },
        inference: {
          type: 'string',
          description: 'Inference provider for harness execution.',
          default: 'claude',
          enum: ['claude', 'openai', 'opencode'],
        },
        seeds: {
          type: 'string',
          description: 'Comma-separated seed names, or "all" (default: all).',
          default: 'all',
        },
        output: {
          type: 'string',
          description: 'Run output directory. Default: ./runs/<timestamp>/',
        },
        repo: {
          type: 'string',
          description: 'Indexed repo to run the harness against (forwarded to graph tools).',
        },
      },
      required: ['task'],
    },
  },
  // ─── Phase 4: versioned graph ─────────────────────────────────────
  {
    name: 'graphstore_log',
    description: `List the graph commit history for the indexed repo.

WHEN TO USE: Inspect when the knowledge graph last changed. Each \`codragraph analyze\` (and explicit \`codragraph commit -m\`) creates a content-addressed snapshot + commit. Returns commits newest-first.

Returns: { branch, head, commits[] } — each commit has id (sha256:…), short id, snapshot id, parents, author, ts, message.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Indexed repo (omit if only one).' },
        from: {
          type: 'string',
          description: 'Branch name or commit id to start the walk from. Defaults to HEAD.',
        },
        limit: { type: 'number', description: 'Max commits to return (default: 50).', default: 50 },
      },
      required: [],
    },
  },
  {
    name: 'graphstore_branches',
    description: `List versioned-graph branches for the indexed repo. Returns the current branch plus every named branch with its head commit.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Indexed repo (omit if only one).' },
      },
      required: [],
    },
  },
  {
    name: 'graphstore_diff',
    description: `Structural diff between two graph commits or branches.

WHEN TO USE: "What changed in the codebase's structure between commit A and B?" Returns added/removed nodes per table, added/removed edges, and modified symbols (Function/Method/Class/Interface rows whose canonical content hash changed).

Inputs accept either branch names or sha256:… commit ids. Output is a compact summary plus the first 50 modified-symbol entries.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Indexed repo (omit if only one).' },
        from: { type: 'string', description: 'Branch name or commit id (older side).' },
        to: { type: 'string', description: 'Branch name or commit id (newer side).' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'graphstore_semantic_diff',
    description: `Higher-level diff between two graph commits or branches.

WHEN TO USE: instead of (or after) graphstore_diff, when you want categorized output — added/removed exported APIs, added/removed Processes, and modifiedSymbols classified into signature / visibility / body / location / metadata. Useful for code-review prompts that need to highlight API breakage.

Inputs accept either branch names or commit ids.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Indexed repo (omit if only one).' },
        from: { type: 'string', description: 'Branch name or commit id (older side).' },
        to: { type: 'string', description: 'Branch name or commit id (newer side).' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'graphstore_merge',
    description: `Three-way merge of two graph branches.

WHEN TO USE: integrate changes from one graph branch into another. Returns one of:
- already-up-to-date — target already contains source
- fast-forward — target moved to source's commit (no merge commit)
- merged — divergent histories merged cleanly; new merge commit created (parents = [ours, theirs])
- conflicts — at least one row diverged on both sides; merge aborted, conflict report returned

In conflict mode, no snapshot is written and the target branch is unchanged. The caller decides whether to resolve conflicts manually or escalate.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Indexed repo (omit if only one).' },
        source: { type: 'string', description: 'Branch / commit id to merge in.' },
        into: { type: 'string', description: 'Target branch (defaults to current HEAD).' },
        message: { type: 'string', description: 'Override the default merge commit message.' },
        dryRun: {
          type: 'boolean',
          description: 'Compute the merge without advancing the ref.',
          default: false,
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'graphstore_gc',
    description: `Mark-and-sweep garbage collection over the content-addressed store.

WHEN TO USE: reclaim disk used by orphaned objects after \`branch delete\` or experiments that left unreachable commits behind. Walks every branch ref + HEAD, marks the transitive closure of reachable objects, and deletes the rest.

Not safe to run concurrently with \`codragraph analyze\` on the same repo — defer if an analyze is in flight.`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Indexed repo (omit if only one).' },
        dryRun: {
          type: 'boolean',
          description: 'Compute what would be swept without deleting.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'graphstore_blame_symbol',
    description: `Show every commit where a specific symbol's row hash transitioned.

WHEN TO USE: "When did the graph last record a change to function/class X?" Walks history newest-first and emits the commits where the symbol's content hash actually changed (collapses no-op commits). Equivalent to git blame for graph contents rather than file lines.

Pair with codragraph_context first to get the symbol's stable id (e.g. \`fn:src/foo.ts:bar\`).`,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Indexed repo (omit if only one).' },
        symbolId: { type: 'string', description: 'Stable symbol id (PK in the cgdb node table).' },
        table: {
          type: 'string',
          description:
            'Optional table hint to narrow the search (Function, Class, Method, Interface, …).',
        },
        limit: {
          type: 'number',
          description: 'Max transition entries (default: 20).',
          default: 20,
        },
      },
      required: ['symbolId'],
    },
  },
];
