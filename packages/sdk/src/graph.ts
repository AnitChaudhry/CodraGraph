// Graph namespace — clients for the codragraph knowledge graph.
//
// LocalGraphClient runs in-process against the same LocalBackend the
// codragraph CLI uses. HttpGraphClient talks to a running `codragraph serve`
// instance over the REST endpoints for search, context, impact, and
// feature-cluster workflows.

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
  GraphClusterImpactInput,
  GraphClusterImpactResult,
  GraphQueryInput,
  GraphQueryResult,
  GraphContextInput,
  GraphContextResult,
  GraphFeatureClustersInput,
  GraphFeatureClustersResult,
  GraphFeatureClusterSummary,
  GraphFeatureContextInput,
  GraphFeatureContextMember,
  GraphFeatureContextResult,
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
  const ok = await backend.init();
  if (!ok) {
    throw new Error(
      'CodraGraph has no indexed repositories. Run `codragraph analyze` in a repo before creating a local graph client.',
    );
  }
  return new LocalGraphClient({ backend, defaultRepo: opts.defaultRepo });
}
