/**
 * Direct CLI Tool Commands
 *
 * Exposes CodraGraph tools (query, context, impact, cypher) as direct CLI commands.
 * Bypasses MCP entirely — invokes LocalBackend directly for minimal overhead.
 *
 * Usage:
 *   codragraph query "authentication flow"
 *   codragraph context --name "validateUser"
 *   codragraph impact --target "AuthService" --direction upstream
 *   codragraph cypher "MATCH (n:Function) RETURN n.name LIMIT 10"
 *
 * Note: Output goes to stdout via fs.writeSync(fd 1), bypassing LadybugDB's
 * native module which captures the Node.js process.stdout stream during init.
 * See the output() function for details (#324).
 */

import { writeSync } from 'node:fs';
import { LocalBackend } from '../mcp/local/local-backend.js';
import { emitTokenStats } from './compress-stats.js';
import { findRepo } from '../storage/repo-manager.js';

let _backend: LocalBackend | null = null;

async function getBackend(): Promise<LocalBackend> {
  if (_backend) return _backend;
  _backend = new LocalBackend();
  const ok = await _backend.init();
  if (!ok) {
    console.error('CodraGraph: No indexed repositories found. Run: codragraph analyze');
    process.exit(1);
  }
  return _backend;
}

async function callToolOnce(toolName: string, params: Record<string, unknown>): Promise<any> {
  const backend = await getBackend();
  return backend.callTool(toolName, params);
}

async function resolveCliRepoParam(repoParam?: string): Promise<string | null> {
  if (repoParam) return repoParam;

  const currentRepo = await findRepo(process.cwd());
  if (currentRepo) return currentRepo.repoPath;

  output(
    `Error: Current repository is not indexed: ${process.cwd()}\n` +
      'Run: npx @codragraph/cli analyze',
  );
  process.exitCode = 1;
  return null;
}

/**
 * Write tool output to stdout using low-level fd write.
 *
 * LadybugDB's native module captures Node.js process.stdout during init,
 * but the underlying OS file descriptor 1 (stdout) remains intact.
 * By using fs.writeSync(1, ...) we bypass the Node.js stream layer
 * and write directly to the real stdout fd (#324).
 *
 * Falls back to stderr if the fd write fails (e.g., broken pipe).
 */
function output(data: any): void {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  try {
    writeSync(1, text + '\n');
  } catch (err: any) {
    if (err?.code === 'EPIPE') {
      // Consumer closed the pipe (e.g., `codragraph cypher ... | head -1`)
      // Exit cleanly per Unix convention
      process.exit(0);
    }
    // Fallback: stderr (previous behavior, works on all platforms)
    process.stderr.write(text + '\n');
  }
}

export async function queryCommand(
  queryText: string,
  options?: {
    repo?: string;
    context?: string;
    goal?: string;
    limit?: string;
    content?: boolean;
  },
): Promise<void> {
  if (!queryText?.trim()) {
    console.error('Usage: codragraph query <search_query>');
    process.exit(1);
  }

  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('query', {
    query: queryText,
    task_context: options?.context,
    goal: options?.goal,
    limit: options?.limit ? parseInt(options.limit) : undefined,
    include_content: options?.content ?? false,
    repo,
  });
  output(result);
  emitTokenStats(result);
}

export async function contextCommand(
  name: string,
  options?: {
    repo?: string;
    file?: string;
    uid?: string;
    content?: boolean;
  },
): Promise<void> {
  if (!name?.trim() && !options?.uid) {
    console.error('Usage: codragraph context <symbol_name> [--uid <uid>] [--file <path>]');
    process.exit(1);
  }

  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('context', {
    name: name || undefined,
    uid: options?.uid,
    file_path: options?.file,
    include_content: options?.content ?? false,
    repo,
  });
  output(result);
  emitTokenStats(result);
}

export async function impactCommand(
  target: string,
  options?: {
    direction?: string;
    repo?: string;
    depth?: string;
    includeTests?: boolean;
  },
): Promise<void> {
  if (!target?.trim()) {
    console.error('Usage: codragraph impact <symbol_name> [--direction upstream|downstream]');
    process.exit(1);
  }

  try {
    const repo = await resolveCliRepoParam(options?.repo);
    if (!repo) return;
    const result = await callToolOnce('impact', {
      target,
      direction: options?.direction || 'upstream',
      maxDepth: options?.depth ? parseInt(options.depth, 10) : undefined,
      includeTests: options?.includeTests ?? false,
      repo,
    });
    output(result);
    emitTokenStats(result);
  } catch (err: unknown) {
    // Belt-and-suspenders: catch infrastructure failures (getBackend, callTool transport)
    // The backend's impact() already returns structured errors for graph query failures
    output({
      error:
        (err instanceof Error ? err.message : String(err)) || 'Impact analysis failed unexpectedly',
      target: { name: target },
      direction: options?.direction || 'upstream',
      suggestion: 'Try reducing --depth or using codragraph context <symbol> as a fallback',
    });
    process.exit(1);
  }
}

export async function cypherCommand(
  query: string,
  options?: {
    repo?: string;
  },
): Promise<void> {
  if (!query?.trim()) {
    console.error('Usage: codragraph cypher <cypher_query>');
    process.exit(1);
  }

  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('cypher', {
    query,
    repo,
  });
  output(result);
}

export async function featureClustersCommand(options?: {
  repo?: string;
  limit?: string;
}): Promise<void> {
  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('feature_clusters', {
    repo,
    limit: options?.limit ? parseInt(options.limit, 10) : undefined,
  });
  output(result);
}

export async function clusterQueryCommand(
  query?: string,
  options?: {
    repo?: string;
    limit?: string;
  },
): Promise<void> {
  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('cluster_query', {
    query,
    repo,
    limit: options?.limit ? parseInt(options.limit, 10) : undefined,
  });
  output(result);
}

export async function featureContextCommand(
  name: string,
  options?: {
    repo?: string;
    limit?: string;
  },
): Promise<void> {
  if (!name?.trim()) {
    console.error('Usage: codragraph feature-context <name>');
    process.exit(1);
  }

  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('feature_context', {
    name,
    repo,
    limit: options?.limit ? parseInt(options.limit, 10) : undefined,
  });
  output(result);
  emitTokenStats(result);
}

export async function clusterContextCommand(
  name: string,
  options?: {
    repo?: string;
    limit?: string;
  },
): Promise<void> {
  if (!name?.trim()) {
    console.error('Usage: codragraph cluster-context <name>');
    process.exit(1);
  }

  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('cluster_context', {
    name,
    repo,
    limit: options?.limit ? parseInt(options.limit, 10) : undefined,
  });
  output(result);
  emitTokenStats(result);
}

export async function contextPackCommand(
  name: string,
  options?: {
    repo?: string;
    limit?: string;
  },
): Promise<void> {
  if (!name?.trim()) {
    console.error('Usage: codragraph context-pack <name>');
    process.exit(1);
  }

  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('context_pack', {
    name,
    repo,
    limit: options?.limit ? parseInt(options.limit, 10) : undefined,
  });
  output(result);
  emitTokenStats(result);
}

export async function clusterImpactCommand(
  name: string,
  options?: {
    direction?: string;
    repo?: string;
    limit?: string;
  },
): Promise<void> {
  if (!name?.trim()) {
    console.error('Usage: codragraph cluster-impact <name>');
    process.exit(1);
  }

  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;
  const result = await callToolOnce('cluster_impact', {
    name,
    direction: options?.direction,
    repo,
    limit: options?.limit ? parseInt(options.limit, 10) : undefined,
  });
  output(result);
  emitTokenStats(result);
}

function formatDetectChangesResult(result: any): string {
  if (result?.error) return `Error: ${result.error}`;

  const summary = result?.summary || {};
  if ((summary.changed_count || 0) === 0) {
    return 'No changes detected.';
  }

  const lines: string[] = [];
  lines.push(`Changes: ${summary.changed_files || 0} files, ${summary.changed_count || 0} symbols`);
  lines.push(`Affected processes: ${summary.affected_count || 0}`);
  lines.push(`Risk level: ${summary.risk_level || 'unknown'}`);
  lines.push('');

  const changed = result?.changed_symbols || [];
  if (changed.length > 0) {
    lines.push('Changed symbols:');
    for (const symbol of changed.slice(0, 15)) {
      lines.push(`  ${symbol.type} ${symbol.name} → ${symbol.filePath}`);
    }
    if (changed.length > 15) {
      lines.push(`  ... and ${changed.length - 15} more`);
    }
    lines.push('');
  }

  const affected = result?.affected_processes || [];
  if (affected.length > 0) {
    lines.push('Affected execution flows:');
    for (const processInfo of affected.slice(0, 10)) {
      const steps = (processInfo.changed_steps || []).map((s: any) => s.symbol).join(', ');
      lines.push(`  • ${processInfo.name} (${processInfo.step_count} steps) — changed: ${steps}`);
    }
  }

  return lines.join('\n').trim();
}

export async function detectChangesCommand(options?: {
  scope?: string;
  baseRef?: string;
  repo?: string;
}): Promise<void> {
  const repo = await resolveCliRepoParam(options?.repo);
  if (!repo) return;

  const result = await callToolOnce('detect_changes', {
    scope: options?.scope || 'unstaged',
    base_ref: options?.baseRef,
    repo,
  });
  output(formatDetectChangesResult(result));
  if (result?.error) process.exitCode = 1;
}
