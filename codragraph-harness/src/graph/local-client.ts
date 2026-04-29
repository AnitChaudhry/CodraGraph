// In-process GraphClient — wraps codragraph's LocalBackend directly.
//
// Phase 1 default: harness runs in the same Node process as codragraph, so
// there's no need for an HTTP hop. LocalBackend.callTool(method, params)
// returns rich structured data that we adapt to the GraphClient interface's
// simpler shape.
//
// HttpGraphClient becomes the Phase 2 path for out-of-process / hosted
// scenarios (uses MCP-over-HTTP via @modelcontextprotocol/sdk Client).

import type { LocalBackend } from "codragraph/dist/mcp/local/local-backend.js";
import type {
  GraphClient,
  GraphContextInput,
  GraphContextResult,
  GraphImpactInput,
  GraphImpactResult,
  GraphQueryInput,
  GraphQueryResult,
} from "../types.js";

export interface LocalGraphClientOptions {
  /** A LocalBackend instance — wire it from codragraph's exported factory. */
  backend: LocalBackend;
  /** Default repo to pass through if not specified per-call. */
  defaultRepo?: string;
}

interface ProcessSymbolRaw {
  name?: string;
  filePath?: string;
  file_path?: string;
}
interface QueryResultRaw {
  process_symbols?: ProcessSymbolRaw[];
  definitions?: ProcessSymbolRaw[];
  error?: string;
}
interface ContextResultRaw {
  symbol?: { name?: string; filePath?: string; file_path?: string };
  incoming?: Record<string, Array<{ name: string; filePath?: string }>>;
  outgoing?: Record<string, Array<{ name: string; filePath?: string }>>;
  processes?: Array<{ name: string }>;
  error?: string;
}
interface ImpactResultRaw {
  target?: { name?: string };
  byDepth?: Record<
    string,
    Array<{ name: string; filePath?: string; type?: string; relationType?: string }>
  >;
  impactedCount?: number;
  error?: string;
}

export class LocalGraphClient implements GraphClient {
  constructor(private readonly options: LocalGraphClientOptions) {}

  async query(input: GraphQueryInput): Promise<GraphQueryResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool("query", {
      query: input.query,
      limit: input.limit,
      repo,
    })) as QueryResultRaw;
    if (raw.error) throw new Error(`codragraph query: ${raw.error}`);

    const symbols = (raw.process_symbols ?? []).concat(raw.definitions ?? []);
    const seen = new Set<string>();
    const results: GraphQueryResult["results"] = [];
    let rank = 0;
    for (const sym of symbols) {
      if (!sym.name) continue;
      if (seen.has(sym.name)) continue;
      seen.add(sym.name);
      results.push({
        name: sym.name,
        score: 1 / (++rank),
        file: sym.filePath ?? sym.file_path,
      });
      if (input.limit && results.length >= input.limit) break;
    }
    return { results };
  }

  async context(input: GraphContextInput): Promise<GraphContextResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool("context", {
      name: input.name,
      repo,
    })) as ContextResultRaw;
    if (raw.error) throw new Error(`codragraph context: ${raw.error}`);

    const callers: Array<{ name: string; file?: string }> = [];
    for (const refs of Object.values(raw.incoming ?? {})) {
      for (const r of refs) callers.push({ name: r.name, file: r.filePath });
    }
    const callees: Array<{ name: string; file?: string }> = [];
    for (const refs of Object.values(raw.outgoing ?? {})) {
      for (const r of refs) callees.push({ name: r.name, file: r.filePath });
    }

    return {
      name: raw.symbol?.name ?? input.name,
      file: raw.symbol?.filePath ?? raw.symbol?.file_path,
      callers,
      callees,
      processes: (raw.processes ?? []).map((p) => p.name),
    };
  }

  async impact(input: GraphImpactInput): Promise<GraphImpactResult> {
    const repo = input.repo ?? this.options.defaultRepo;
    const raw = (await this.options.backend.callTool("impact", {
      target: input.target,
      direction: input.direction ?? "upstream",
      repo,
    })) as ImpactResultRaw;
    if (raw.error) throw new Error(`codragraph impact: ${raw.error}`);

    const affected: GraphImpactResult["affected"] = [];
    for (const [depthStr, items] of Object.entries(raw.byDepth ?? {})) {
      const depth = parseInt(depthStr, 10);
      for (const it of items) {
        affected.push({ name: it.name, depth, file: it.filePath });
      }
    }
    return {
      target: raw.target?.name ?? input.target,
      affected,
      riskLevel: deriveRiskLevel(raw.impactedCount ?? affected.length),
    };
  }
}

function deriveRiskLevel(count: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (count >= 50) return "CRITICAL";
  if (count >= 20) return "HIGH";
  if (count >= 5) return "MEDIUM";
  return "LOW";
}
