// Graph namespace — clients for the codragraph knowledge graph.
//
// LocalGraphClient runs in-process against the same LocalBackend the
// codragraph CLI uses. HttpGraphClient is a Phase 2 placeholder for
// out-of-process / hosted scenarios; calling its methods currently throws
// (use MCP-over-HTTP via @modelcontextprotocol/sdk for now).

import { LocalGraphClient } from '@codragraph/harness/graph/local-client';

export {
  LocalGraphClient,
  type LocalGraphClientOptions,
} from '@codragraph/harness/graph/local-client';

export {
  HttpGraphClient,
  type HttpGraphClientOptions,
} from '@codragraph/harness/graph/http-client';

export type {
  GraphClient,
  GraphQueryInput,
  GraphQueryResult,
  GraphContextInput,
  GraphContextResult,
  GraphImpactInput,
  GraphImpactResult,
} from '@codragraph/harness/types';

/**
 * Construct a LocalGraphClient backed by the same in-process LocalBackend
 * the codragraph CLI uses. Hides the deep import into `@codragraph/cli` so
 * SDK consumers depend only on the SDK's public surface.
 */
export async function createLocalGraphClient(
  opts: { defaultRepo?: string } = {},
): Promise<LocalGraphClient> {
  const { LocalBackend } = await import('@codragraph/cli/mcp/local/local-backend');
  const backend = new LocalBackend();
  await backend.init();
  return new LocalGraphClient({ backend, defaultRepo: opts.defaultRepo });
}
