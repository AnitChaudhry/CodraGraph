import type { Recipe, RecipeMatch, RecipeStaleness } from './types.js';
import type { RecipeStore } from './recipe-store.js';

/**
 * Optional graphstore handle — used to compute structural staleness when
 * a recipe's snapshot differs from the current snapshot. Modeled as a
 * structural type (not an import from codragraph-graphstore) so this
 * package stays a leaf of the dependency graph.
 */
export interface GraphstoreDiffer {
  diffSnapshots(input: { from: string; to: string }): Promise<{
    addedNodes: Record<string, readonly string[]>;
    removedNodes: Record<string, readonly string[]>;
    modifiedSymbols: readonly unknown[];
    addedEdges: readonly unknown[];
    removedEdges: readonly unknown[];
  }>;
}

export interface FindReusableOptions {
  readonly store: RecipeStore;
  readonly snapshotId: string;
  readonly taskFamily: string;
  readonly requiredSubgraphSignature?: string;
  /**
   * When provided AND the recipe's snapshotId differs from `snapshotId`,
   * the lookup runs a structural diff to populate
   * {@link RecipeStaleness.summary} and risk classification.
   */
  readonly differ?: GraphstoreDiffer;
  /**
   * Limit on candidate recipes returned (per match kind). Default 10.
   */
  readonly limit?: number;
}

export interface FindReusableResult {
  /** Exact-match recipes (same snapshotId + same taskFamily). */
  readonly exact: Recipe[];
  /** Same-family recipes from a different snapshot, with staleness. */
  readonly candidates: RecipeMatch[];
}

/**
 * Look up reusable recipes for a given snapshot + task family.
 *
 * Result shape:
 *   - `exact`        always safe to reuse byte-for-byte; same graph.
 *   - `candidates`   came from a different snapshot but the same task
 *                    family. Each carries a staleness summary so the
 *                    caller can decide to (a) reuse anyway, (b) re-run
 *                    swarm cheaply with this recipe as a seed, or
 *                    (c) re-run from scratch.
 */
export const findReusableRecipes = async (
  opts: FindReusableOptions,
): Promise<FindReusableResult> => {
  const limit = opts.limit ?? 10;
  const exact = await opts.store.findExact(
    opts.snapshotId,
    opts.taskFamily,
    opts.requiredSubgraphSignature,
  );
  const familyOthers = (await opts.store.findByFamily(opts.taskFamily)).filter((r) => {
    if (r.snapshotId === opts.snapshotId) return false;
    if (opts.requiredSubgraphSignature === undefined) return true;
    return r.requiredSubgraphSignature === opts.requiredSubgraphSignature;
  });

  // Score by accuracy desc → tokens asc; take the top `limit` for staleness.
  const ranked = familyOthers
    .sort((a, b) => {
      if (a.paretoCoords.accuracy !== b.paretoCoords.accuracy) {
        return b.paretoCoords.accuracy - a.paretoCoords.accuracy;
      }
      return a.paretoCoords.tokens - b.paretoCoords.tokens;
    })
    .slice(0, limit);

  const candidates: RecipeMatch[] = [];
  for (const r of ranked) {
    const staleness = await assessStaleness({
      currentSnapshotId: opts.snapshotId,
      recipe: r,
      differ: opts.differ,
      requiredSubgraphSignature: opts.requiredSubgraphSignature,
    });
    candidates.push({ kind: 'candidate', recipe: r, staleness });
  }

  return { exact: exact.slice(0, limit), candidates };
};

/**
 * Compute a {@link RecipeStaleness} for a single recipe relative to a
 * target snapshot. When no differ is provided, the staleness reports
 * `diffComputed: false` and `riskLevel: "unknown"` — still useful as a
 * "snapshots differ, here are the ids" signal.
 */
export const assessStaleness = async (input: {
  currentSnapshotId: string;
  recipe: Recipe;
  differ?: GraphstoreDiffer;
  requiredSubgraphSignature?: string;
}): Promise<RecipeStaleness> => {
  const signatureMatched =
    input.requiredSubgraphSignature === undefined
      ? undefined
      : input.recipe.requiredSubgraphSignature === input.requiredSubgraphSignature;
  if (!input.differ) {
    return {
      currentSnapshotId: input.currentSnapshotId,
      ...(input.requiredSubgraphSignature !== undefined
        ? { requiredSubgraphSignature: input.requiredSubgraphSignature, signatureMatched }
        : {}),
      diffComputed: false,
      riskLevel: 'unknown',
    };
  }
  let diff;
  try {
    diff = await input.differ.diffSnapshots({
      from: input.recipe.snapshotId,
      to: input.currentSnapshotId,
    });
  } catch {
    // Recipe's snapshot may have been gc'd. Treat as high-risk.
    return {
      currentSnapshotId: input.currentSnapshotId,
      ...(input.requiredSubgraphSignature !== undefined
        ? { requiredSubgraphSignature: input.requiredSubgraphSignature, signatureMatched }
        : {}),
      diffComputed: false,
      riskLevel: 'high',
    };
  }

  const summary = {
    addedNodes: countByTable(diff.addedNodes),
    removedNodes: countByTable(diff.removedNodes),
    modifiedSymbols: diff.modifiedSymbols.length,
    addedEdges: diff.addedEdges.length,
    removedEdges: diff.removedEdges.length,
  };
  const total =
    summary.addedNodes +
    summary.removedNodes +
    summary.modifiedSymbols +
    summary.addedEdges +
    summary.removedEdges;

  let riskLevel: RecipeStaleness['riskLevel'];
  if (total === 0) riskLevel = 'low';
  else if (total < 10) riskLevel = 'low';
  else if (total < 100) riskLevel = 'medium';
  else riskLevel = 'high';

  return {
    currentSnapshotId: input.currentSnapshotId,
    ...(input.requiredSubgraphSignature !== undefined
      ? { requiredSubgraphSignature: input.requiredSubgraphSignature, signatureMatched }
      : {}),
    diffComputed: true,
    summary,
    riskLevel,
  };
};

const countByTable = (byTable: Record<string, readonly string[]>): number => {
  let n = 0;
  for (const ids of Object.values(byTable)) n += ids.length;
  return n;
};
