// swarmSearchWithMoat — Phase 4 × Phase 3 integration.
//
// Wraps Phase 3's swarmSearch with a recipe-cache lookup. On entry we
// check the RecipeStore for an exact (snapshotId, taskFamily) match; if
// one is found and useCache is true, we short-circuit and return the
// cached frontier without paying for the swarm. On exit, we persist the
// top-K Pareto candidates as recipes so future invocations on the same
// snapshot reuse them.
//
// The wrapper is intentionally additive — no changes to swarmSearch
// itself — so callers that don't need the moat keep working.

import { swarmSearch, type SwarmSearchOptions } from '../swarm/algorithm.js';
import type { SwarmSearchResult } from '../swarm/interface.js';
import type { ParetoPoint } from '../pareto.js';
import type { CandidateMetadata } from '../filesystem.js';
import type { RecipeStore } from './recipe-store.js';
import type { Recipe, RecipeSearchSource } from './types.js';
import { findReusableRecipes, type GraphstoreDiffer } from './lookup.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface SwarmSearchWithMoatOptions extends SwarmSearchOptions {
  /** Recipe store — typically FsRecipeStore over `<repo>/.codragraph/recipes`. */
  readonly recipeStore: RecipeStore;
  /** Logical snapshot id (from codragraph-graphstore HEAD). Opaque here. */
  readonly snapshotId: string;
  /** User-supplied task family identifier. */
  readonly taskFamily: string;
  readonly requiredSubgraphSignature?: string;

  /**
   * When true and at least one exact-match recipe exists, return the
   * cached frontier without calling swarmSearch. Default: false (caller
   * must opt in, so first-time users always see fresh search results).
   */
  readonly useCache?: boolean;

  /**
   * Number of top-Pareto candidates to persist after a fresh search.
   * Default 5. Capped at the frontier size.
   */
  readonly persistTopK?: number;

  /**
   * Optional graphstore handle for partial-match staleness assessment.
   * When provided, the lookup result includes a structural diff
   * summary for non-exact candidate recipes.
   */
  readonly differ?: GraphstoreDiffer;
}

export type SwarmSearchWithMoatResult =
  | (SwarmSearchResult & {
      readonly fromCache: true;
      readonly cachedRecipeIds: string[];
      /** When useCache hit, no new recipes are persisted. */
      readonly persistedRecipeIds: never[];
    })
  | (SwarmSearchResult & {
      readonly fromCache: false;
      readonly cachedRecipeIds: never[];
      readonly persistedRecipeIds: string[];
    });

/**
 * Run a swarm search with recipe caching.
 *
 * Sequence:
 *   1. Look up exact-match recipes for (snapshotId, taskFamily).
 *   2. If `useCache` and at least one exact match exists, return the
 *      cached frontier as a synthetic SwarmSearchResult and stop.
 *   3. Otherwise, run swarmSearch as usual.
 *   4. Persist the top-K Pareto frontier candidates as new recipes.
 */
export const swarmSearchWithMoat = async (
  opts: SwarmSearchWithMoatOptions,
): Promise<SwarmSearchWithMoatResult> => {
  const lookup = await findReusableRecipes({
    store: opts.recipeStore,
    snapshotId: opts.snapshotId,
    taskFamily: opts.taskFamily,
    requiredSubgraphSignature: opts.requiredSubgraphSignature,
    differ: opts.differ,
  });

  if (opts.useCache && lookup.exact.length > 0) {
    const cachedFrontier = recipesToFrontier(lookup.exact);
    return {
      fromCache: true,
      cachedRecipeIds: lookup.exact.map((r) => r.id),
      persistedRecipeIds: [],
      frontier: cachedFrontier,
      totalEvaluated: 0,
      totalCriticRejected: 0,
      totalLoadRejected: 0,
      terminatedAt: { iteration: 0, reason: 'cache-hit' },
      perRole: {},
      scoredCandidates: [],
    };
  }

  const result = await swarmSearch(opts);

  const persisted = await persistFrontierAsRecipes({
    result,
    storeRoot: opts.store.rootPath,
    recipeStore: opts.recipeStore,
    snapshotId: opts.snapshotId,
    taskFamily: opts.taskFamily,
    requiredSubgraphSignature: opts.requiredSubgraphSignature,
    persistTopK: opts.persistTopK ?? 5,
    searchSource: 'swarm',
  });

  return {
    ...result,
    fromCache: false,
    cachedRecipeIds: [],
    persistedRecipeIds: persisted.map((r) => r.id),
  };
};

// ──────────────────────────────────────────────────────────────────────
// Persistence
// ──────────────────────────────────────────────────────────────────────

interface PersistFrontierOptions {
  readonly result: SwarmSearchResult;
  /** Filesystem 𝒟 root — used to read each candidate's source/. */
  readonly storeRoot: string;
  readonly recipeStore: RecipeStore;
  readonly snapshotId: string;
  readonly taskFamily: string;
  readonly requiredSubgraphSignature?: string;
  readonly persistTopK: number;
  readonly searchSource: RecipeSearchSource;
}

/**
 * Walk the search's Pareto frontier in order, read each candidate's
 * source files + metadata from the candidate store, and persist the
 * top-K as recipes.
 *
 * Best-effort: if a candidate's files can't be read (corrupted or
 * partially-evaluated state), we skip it rather than aborting the whole
 * persistence step. Errors are swallowed so the swarm result is still
 * returned cleanly.
 */
const persistFrontierAsRecipes = async (opts: PersistFrontierOptions): Promise<Recipe[]> => {
  const persisted: Recipe[] = [];
  const ranked = [...opts.result.frontier]
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, opts.persistTopK);

  for (const point of ranked) {
    const recipe = await pointToRecipe({
      point,
      storeRoot: opts.storeRoot,
      snapshotId: opts.snapshotId,
      taskFamily: opts.taskFamily,
      requiredSubgraphSignature: opts.requiredSubgraphSignature,
      searchSource: opts.searchSource,
      result: opts.result,
    });
    if (!recipe) continue;
    try {
      const stored = await opts.recipeStore.put(recipe);
      persisted.push(stored);
    } catch {
      /* best-effort */
    }
  }
  return persisted;
};

interface PointToRecipeOptions {
  readonly point: ParetoPoint;
  readonly storeRoot: string;
  readonly snapshotId: string;
  readonly taskFamily: string;
  readonly requiredSubgraphSignature?: string;
  readonly searchSource: RecipeSearchSource;
  readonly result: SwarmSearchResult;
}

const pointToRecipe = async (opts: PointToRecipeOptions): Promise<Omit<Recipe, 'id'> | null> => {
  const candidateDir = path.join(opts.storeRoot, opts.point.id);
  let metadata: CandidateMetadata;
  try {
    const raw = await fs.readFile(path.join(candidateDir, 'metadata.json'), 'utf-8');
    metadata = JSON.parse(raw) as CandidateMetadata;
  } catch {
    return null;
  }

  const sourceDir = path.join(candidateDir, 'source');
  let files;
  try {
    files = await readSourceFiles(sourceDir);
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  // Best-effort rationale read.
  let rationale: string | undefined;
  try {
    rationale = await fs.readFile(path.join(candidateDir, 'rationale.md'), 'utf-8');
  } catch {
    /* not all candidates have rationale */
  }

  const matching = opts.result.scoredCandidates.find((sc) => sc.id === opts.point.id);
  const taskCount = matching?.scores.taskCount ?? 0;

  return {
    taskFamily: opts.taskFamily,
    snapshotId: opts.snapshotId,
    ...(opts.requiredSubgraphSignature !== undefined
      ? { requiredSubgraphSignature: opts.requiredSubgraphSignature }
      : {}),
    searchedAt: new Date().toISOString(),
    searchSource: opts.searchSource,
    harness: {
      name: metadata.name,
      version: metadata.version,
      origin: metadata.origin as Record<string, unknown> & { kind: string },
      files,
      ...(rationale !== undefined ? { rationale } : {}),
    },
    paretoCoords: {
      accuracy: opts.point.accuracy,
      tokens: opts.point.tokens,
      latencyMs: opts.point.latencyMs,
    },
    scores: {
      accuracy: opts.point.accuracy,
      tokens: opts.point.tokens,
      latencyMs: opts.point.latencyMs,
      taskCount,
    },
    provenance: {
      candidateId: opts.point.id,
      role: matching?.role,
      terminatedAt: opts.result.terminatedAt,
    },
  };
};

const readSourceFiles = async (
  sourceDir: string,
): Promise<Array<{ path: string; content: string }>> => {
  const out: Array<{ path: string; content: string }> = [];
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(sourceDir, entry.name);
    const content = await fs.readFile(full, 'utf-8');
    out.push({ path: entry.name, content });
  }
  return out;
};

const recipesToFrontier = (recipes: Recipe[]): SwarmSearchResult['frontier'] => {
  return recipes
    .map((r) => ({
      id: r.id,
      accuracy: r.paretoCoords.accuracy,
      tokens: r.paretoCoords.tokens,
      latencyMs: r.paretoCoords.latencyMs,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
};
