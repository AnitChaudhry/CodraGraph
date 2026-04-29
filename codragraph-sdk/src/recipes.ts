// Recipes namespace — Phase 4 × Phase 3 moat: versioned harness-recipe
// memory. Re-exports the codragraph-harness/moat module so SDK users
// can persist + reuse swarm-search Pareto winners across runs.

export {
  type Recipe,
  type RecipeMatch,
  type RecipeStaleness,
  type RecipeSearchSource,
  type HarnessRecipeBody,
  type HarnessSourceFile,
  type ParetoCoords,
  type RecipeScores,
  type RecipeStore,
  type RecipeInput,
  type RecipeListFilter,
  FsRecipeStore,
  type FsRecipeStoreOptions,
  deriveRecipeId,
  findReusableRecipes,
  assessStaleness,
  type FindReusableOptions,
  type FindReusableResult,
  type GraphstoreDiffer,
  swarmSearchWithMoat,
  type SwarmSearchWithMoatOptions,
  type SwarmSearchWithMoatResult,
} from 'codragraph-harness/moat/index';
