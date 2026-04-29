// Phase 4 × Phase 3 moat — versioned recipe memory.
//
// A "recipe" is a Pareto-winning harness produced by a swarm search,
// tagged against the codragraph-graphstore snapshot id that was current
// at the time of the search. New tasks query the recipe store first:
//   - Same snapshot + same task family → exact reuse, zero cost.
//   - Different snapshot but same task family → "candidate" recipe;
//     caller decides via `staleness` whether the relevant subgraph is
//     close enough to reuse, or to re-run the swarm.
//
// The store does not depend on codragraph-graphstore directly — the
// snapshotId is just an opaque string here. The lookup helper accepts
// an optional graphstore CAS to compute staleness when callers want it.

export interface Recipe {
  /** Stable id — sha256 of canonical Recipe content. */
  readonly id: string;

  /** User-supplied task family identifier (e.g. "codebase-qa", "swe-bench"). */
  readonly taskFamily: string;

  /**
   * codragraph-graphstore snapshot id at the time the recipe was learned.
   * Same snapshot id ⇒ byte-identical knowledge graph ⇒ exact reuse.
   * Format `sha256:<64-hex>` matches the graphstore's ObjectId format,
   * but this module does not validate it (the store is engine-agnostic).
   */
  readonly snapshotId: string;

  /** ISO 8601 timestamp at which the recipe was persisted. */
  readonly searchedAt: string;

  /** "swarm" (Phase 3) or "phase1" (single-proposer search). */
  readonly searchSource: RecipeSearchSource;

  /** The harness that produced these scores. */
  readonly harness: HarnessRecipeBody;

  /** Pareto coordinates. Used for ranking when multiple recipes match. */
  readonly paretoCoords: ParetoCoords;

  /** Detailed scores from the evaluator. */
  readonly scores: RecipeScores;

  /** Free-text provenance — which run produced this, who authored, etc. */
  readonly provenance?: Record<string, unknown>;
}

export type RecipeSearchSource = "swarm" | "phase1";

export interface HarnessRecipeBody {
  readonly name: string;
  readonly version: string;
  readonly origin?: { readonly kind: string } & Record<string, unknown>;
  /** Source files that make up the harness. Replayed verbatim on reuse. */
  readonly files: HarnessSourceFile[];
  /** Optional rationale (typically the proposer's natural-language explanation). */
  readonly rationale?: string;
}

export interface HarnessSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface ParetoCoords {
  readonly accuracy: number;
  readonly tokens: number;
  readonly latencyMs: number;
}

export interface RecipeScores extends ParetoCoords {
  readonly taskCount: number;
  readonly extras?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────
// Lookup result types
// ──────────────────────────────────────────────────────────────────────

/**
 * Outcome of a recipe lookup. Kept as a tagged union so the caller can
 * pattern-match without inspecting fields.
 */
export type RecipeMatch =
  | { readonly kind: "exact"; readonly recipe: Recipe }
  | {
      readonly kind: "candidate";
      readonly recipe: Recipe;
      readonly staleness: RecipeStaleness;
    };

/**
 * Subgraph-aware staleness assessment. Computed by the lookup helper
 * when the recipe's snapshotId differs from the current snapshotId.
 *
 * Phase 4 ships `summary` (counts) only. Phase 5 will track the
 * recipe's required subgraph signature so we can compute precise
 * "did anything I read change?" — that needs harness instrumentation.
 */
export interface RecipeStaleness {
  /** ISO timestamp of the current snapshot, when known. */
  readonly currentSnapshotId: string;
  /**
   * Whether a structural diff was actually computed. When false, the
   * caller did not provide a graphstore CAS and we can only say
   * "snapshots differ".
   */
  readonly diffComputed: boolean;
  readonly summary?: {
    readonly addedNodes: number;
    readonly removedNodes: number;
    readonly modifiedSymbols: number;
    readonly addedEdges: number;
    readonly removedEdges: number;
  };
  /**
   * Coarse classification — "low" means the diff was small enough that
   * reuse is probably fine; "high" means re-running the swarm is
   * recommended. The threshold is intentionally simple (sum < 10 = low,
   * < 100 = medium, else high) and tunable in a follow-up.
   */
  readonly riskLevel: "low" | "medium" | "high" | "unknown";
}
