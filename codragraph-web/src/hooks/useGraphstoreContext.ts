import { useEffect, useState } from 'react';
import {
  fetchGraphstoreBranches,
  fetchGraphstoreLog,
  type GraphstoreBranch,
  type GraphstoreCommit,
} from '@/services/graphstore-client';
import { fetchRecipesList, type RecipeSummary } from '@/services/recipes-client';

/**
 * Cross-section glue for the Phase 4 × Phase 3 dashboard.
 *
 * Loads the graphstore commit log + branches + the full recipes list
 * once, and exposes:
 *   - commitBySnapshotId: maps snapshotId → commit so recipe cards can
 *     render "→ a1b2c3d on main · message"
 *   - recipesByCommitId:  maps commitId → recipe[] so the commit list
 *     can render an "N recipes" badge
 *   - recipeBranchBySnapshot: best-guess branch a snapshot lives on
 *
 * All loads are best-effort — when an endpoint is unavailable, the
 * hook returns empty maps so the UI silently degrades.
 */
export interface GraphstoreContext {
  commits: GraphstoreCommit[];
  branches: GraphstoreBranch[];
  currentBranch: string | null;
  commitBySnapshotId: Map<string, GraphstoreCommit>;
  recipes: RecipeSummary[];
  recipesByCommitId: Map<string, RecipeSummary[]>;
  recipesBySnapshotId: Map<string, RecipeSummary[]>;
  loading: boolean;
  unavailable: { graphstore: boolean; recipes: boolean };
}

const EMPTY: GraphstoreContext = {
  commits: [],
  branches: [],
  currentBranch: null,
  commitBySnapshotId: new Map(),
  recipes: [],
  recipesByCommitId: new Map(),
  recipesBySnapshotId: new Map(),
  loading: false,
  unavailable: { graphstore: false, recipes: false },
};

export const useGraphstoreContext = (repo: string | null): GraphstoreContext => {
  const [state, setState] = useState<GraphstoreContext>({
    ...EMPTY,
    loading: !!repo,
  });

  useEffect(() => {
    if (!repo) {
      setState(EMPTY);
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    Promise.all([
      fetchGraphstoreLog(repo, { limit: 500 }),
      fetchGraphstoreBranches(repo),
      fetchRecipesList(repo, { limit: 500 }),
    ]).then(([logRes, branchesRes, recipesRes]) => {
      if (cancelled) return;
      const commits = logRes.available ? logRes.data.commits : [];
      const branches = branchesRes.available ? branchesRes.data.branches : [];
      const recipes = recipesRes.available ? recipesRes.data.recipes : [];

      const commitBySnapshotId = new Map<string, GraphstoreCommit>();
      for (const c of commits) commitBySnapshotId.set(c.snapshot, c);

      const recipesBySnapshotId = new Map<string, RecipeSummary[]>();
      for (const r of recipes) {
        const arr = recipesBySnapshotId.get(r.snapshotId) ?? [];
        arr.push(r);
        recipesBySnapshotId.set(r.snapshotId, arr);
      }

      // Recipes are keyed by snapshotId; convert to commitId via the
      // commit→snapshot map so the commit list can render the badge.
      const recipesByCommitId = new Map<string, RecipeSummary[]>();
      for (const c of commits) {
        const matches = recipesBySnapshotId.get(c.snapshot);
        if (matches && matches.length > 0) recipesByCommitId.set(c.id, matches);
      }

      setState({
        commits,
        branches,
        currentBranch: branchesRes.available ? branchesRes.data.current : null,
        commitBySnapshotId,
        recipes,
        recipesByCommitId,
        recipesBySnapshotId,
        loading: false,
        unavailable: {
          graphstore: !logRes.available || !branchesRes.available,
          recipes: !recipesRes.available,
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [repo]);

  return state;
};
