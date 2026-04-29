// Public surface of the Phase 4 × Phase 3 moat module.

export {
  type Recipe,
  type RecipeMatch,
  type RecipeStaleness,
  type RecipeSearchSource,
  type HarnessRecipeBody,
  type HarnessSourceFile,
  type ParetoCoords,
  type RecipeScores,
} from './types.js';

export {
  type RecipeStore,
  type RecipeInput,
  type RecipeListFilter,
  FsRecipeStore,
  type FsRecipeStoreOptions,
  deriveRecipeId,
} from './recipe-store.js';

export {
  findReusableRecipes,
  assessStaleness,
  type FindReusableOptions,
  type FindReusableResult,
  type GraphstoreDiffer,
} from './lookup.js';

export {
  swarmSearchWithMoat,
  type SwarmSearchWithMoatOptions,
  type SwarmSearchWithMoatResult,
} from './swarm-with-moat.js';
