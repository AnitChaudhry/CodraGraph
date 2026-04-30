import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Search, GitCommit } from 'lucide-react';
import { useAppState } from '@/hooks/useAppState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { fetchRecipesList, type RecipeSummary } from '@/services/recipes-client';
import type { GraphstoreCommit } from '@/services/graphstore-client';
import { useGraphstoreContext } from '@/hooks/useGraphstoreContext';
import { RecipeDetailSheet } from './RecipeDetailSheet';

/**
 * Recipes section — versioned harness-recipe memory browser. Card grid
 * grouped by task family; each card shows the recipe's Pareto coords
 * and the graph snapshot it was learned at. Click any card to open
 * the side drawer with the full harness body, scores, and provenance.
 */
export const RecipesSection = (): React.JSX.Element => {
  const { projectName } = useAppState();
  const currentRepo = projectName || null;
  const ctx = useGraphstoreContext(currentRepo);
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [taskFamilyFilter, setTaskFamilyFilter] = useState<string | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeSummary | null>(null);

  useEffect(() => {
    if (!currentRepo) return;
    let cancelled = false;
    setRecipes(null);
    fetchRecipesList(currentRepo, { limit: 100 }).then((r) => {
      if (cancelled) return;
      if (r.available) {
        setRecipes(r.data.recipes);
        setUnavailable(null);
      } else {
        setRecipes([]);
        setUnavailable(r.reason);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentRepo]);

  const taskFamilies = useMemo<string[]>(() => {
    if (!recipes) return [];
    return Array.from(new Set(recipes.map((r) => r.taskFamily))).sort();
  }, [recipes]);

  const filtered = useMemo<RecipeSummary[]>(() => {
    if (!recipes) return [];
    if (!taskFamilyFilter) return recipes;
    return recipes.filter((r) => r.taskFamily === taskFamilyFilter);
  }, [recipes, taskFamilyFilter]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-deep px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Search className="h-3.5 w-3.5" />
              {taskFamilyFilter ?? 'All families'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setTaskFamilyFilter(null)}>
              All families
            </DropdownMenuItem>
            {taskFamilies.map((f) => (
              <DropdownMenuItem key={f} onSelect={() => setTaskFamilyFilter(f)}>
                {f}
              </DropdownMenuItem>
            ))}
            {taskFamilies.length === 0 && (
              <DropdownMenuItem disabled>(no families yet)</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-xs text-text-muted">
          {filtered.length} recipe{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {unavailable ? (
            <UnavailableHint reason={unavailable} />
          ) : recipes === null ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-36 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyHint />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((r) => (
                <RecipeCard
                  key={r.id}
                  recipe={r}
                  commit={ctx.commitBySnapshotId.get(r.snapshotId) ?? null}
                  branch={ctx.currentBranch}
                  onClick={() => setSelectedRecipe(r)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
      <RecipeDetailSheet
        recipe={selectedRecipe}
        commit={
          selectedRecipe ? (ctx.commitBySnapshotId.get(selectedRecipe.snapshotId) ?? null) : null
        }
        branch={ctx.currentBranch}
        onClose={() => setSelectedRecipe(null)}
      />
    </div>
  );
};

const RecipeCard = ({
  recipe,
  commit,
  branch,
  onClick,
}: {
  recipe: RecipeSummary;
  commit: GraphstoreCommit | null;
  branch: string | null;
  onClick: () => void;
}): React.JSX.Element => (
  <Card
    onClick={onClick}
    className="flex h-full cursor-pointer flex-col transition-colors hover:bg-elevated"
  >
    <CardHeader>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{recipe.harnessName}</CardTitle>
          <p className="mt-1 text-xs text-text-secondary">{recipe.taskFamily}</p>
        </div>
        <Sparkles className="h-4 w-4 shrink-0 text-accent" />
      </div>
    </CardHeader>
    <CardContent className="flex flex-1 flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 font-mono text-xs">
        <Metric label="acc" value={recipe.accuracy.toFixed(3)} variant="success" />
        <Metric label="tokens" value={formatNum(recipe.tokens)} variant="default" />
        <Metric label="ms" value={formatNum(recipe.latencyMs)} variant="default" />
      </div>
      {/* Cross-link to the graph version this recipe was learned at. */}
      <div className="mt-auto rounded-md border border-border-subtle bg-deep px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 text-text-muted">
          <GitCommit className="h-3 w-3 text-accent" />
          <span className="font-mono text-text-primary">
            {commit ? commit.short : recipe.snapshotId.replace(/^sha256:/, '').slice(0, 12)}
          </span>
          {branch && (
            <span className="text-text-muted">
              on <span className="text-text-secondary">{branch}</span>
            </span>
          )}
          <span className="ml-auto">{recipe.searchedAt.slice(0, 10)}</span>
        </div>
        {commit && (
          <p className="mt-1 truncate text-text-secondary" title={commit.message}>
            {commit.message}
          </p>
        )}
      </div>
    </CardContent>
  </Card>
);

const Metric = ({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: 'success' | 'default';
}): React.JSX.Element => (
  <div className="rounded-md border border-border-subtle bg-deep p-2">
    <div className="text-[10px] tracking-wider text-text-muted uppercase">{label}</div>
    <Badge variant={variant} className="mt-1 font-mono">
      {value}
    </Badge>
  </div>
);

const UnavailableHint = ({ reason }: { reason: string }): React.JSX.Element => (
  <div className="rounded-md border border-dashed border-border-subtle bg-deep p-6">
    <h3 className="text-sm font-semibold text-text-primary">Recipes endpoint not wired</h3>
    <p className="mt-1 text-xs text-text-secondary">
      The codragraph server hasn't exposed <code className="font-mono">/api/recipes</code> yet. Once
      wired, this section will list every recipe learned by{' '}
      <code className="font-mono">codragraph-harness swarm-search</code> for the current repo.
    </p>
    <p className="mt-3 font-mono text-[10px] text-text-muted">reason: {reason}</p>
  </div>
);

const EmptyHint = (): React.JSX.Element => (
  <div className="rounded-md border border-dashed border-border-subtle bg-deep p-6">
    <h3 className="text-sm font-semibold text-text-primary">No recipes yet</h3>
    <p className="mt-1 text-xs text-text-secondary">
      Recipes are Pareto-winning harnesses learned by swarm runs, tagged against the graph snapshot
      they were trained on. Run:
    </p>
    <pre className="mt-3 overflow-x-auto rounded-md border border-border-subtle bg-void p-3 text-xs text-text-primary">
      {`codragraph-harness swarm-search \\
  --task ./tasks.json \\
  --task-family codebase-qa \\
  --snapshot-id sha256:<current-snapshot>`}
    </pre>
  </div>
);

const formatNum = (n: number): string => {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
};
