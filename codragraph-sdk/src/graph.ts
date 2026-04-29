// Graph namespace — clients for the codragraph knowledge graph.
//
// The HttpGraphClient talks to a running `codragraph serve` instance over the
// REST API. For in-process use (when codragraph-sdk is consumed inside a
// codragraph CLI subcommand or MCP server), expose a direct adapter in a
// future phase.

export { HttpGraphClient, type HttpGraphClientOptions } from 'codragraph-harness/graph/http-client';

export type {
  GraphClient,
  GraphQueryInput,
  GraphQueryResult,
  GraphContextInput,
  GraphContextResult,
  GraphImpactInput,
  GraphImpactResult,
} from 'codragraph-harness/types';
