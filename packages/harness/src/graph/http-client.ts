// HTTP-based GraphClient — Phase 2 placeholder.
//
// Phase 1 finding (2026-04-29): the running `codragraph serve` HTTP API
// only exposes `/api/query` as a structured-JSON endpoint. `/api/context`
// and `/api/impact` do NOT exist; the equivalent of those tool calls flows
// through MCP over StreamableHTTP transport (see codragraph/src/server/
// mcp-http.ts) which requires session handshake and JSON-RPC 2.0.
//
// The Phase 2 implementation uses @modelcontextprotocol/sdk's Client class
// to talk to the MCP-over-HTTP endpoint properly. For Phase 1, the default
// path is in-process via `LocalGraphClient` (graph/local-client.ts).
//
// This file exists so the import surface is stable; calling it currently
// throws, with an informative error pointing at LocalGraphClient.

import type {
  GraphClient,
  GraphContextInput,
  GraphContextResult,
  GraphImpactInput,
  GraphImpactResult,
  GraphQueryInput,
  GraphQueryResult,
} from '../types.js';

export interface HttpGraphClientOptions {
  baseURL?: string;
  timeoutMs?: number;
}

export class HttpGraphClient implements GraphClient {
  constructor(_options: HttpGraphClientOptions = {}) {
    // Intentionally empty — kept so existing imports do not break while the
    // MCP-over-HTTP wiring lands in Phase 2.
  }

  query(_input: GraphQueryInput): Promise<GraphQueryResult> {
    throw new Error(
      'HttpGraphClient is a Phase 2 placeholder. Use LocalGraphClient (in-process) for Phase 1, ' +
        'or wait for the MCP-over-HTTP client landing in Phase 2.',
    );
  }
  context(_input: GraphContextInput): Promise<GraphContextResult> {
    throw new Error('HttpGraphClient is a Phase 2 placeholder. Use LocalGraphClient (in-process).');
  }
  impact(_input: GraphImpactInput): Promise<GraphImpactResult> {
    throw new Error('HttpGraphClient is a Phase 2 placeholder. Use LocalGraphClient (in-process).');
  }
}
