import * as React from 'react';
import { useEffect, useState } from 'react';
import { GitCommit, FileText, Sparkles, Tag } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getBackendUrl } from '@/services/backend-client';
import type { GraphstoreCommit } from '@/services/graphstore-client';
import type { RecipeSummary } from '@/services/recipes-client';

/**
 * Full Recipe object as the harness recipe store persists it. Mirrors
 * the Recipe type from codragraph-harness/src/moat/types.ts (kept in
 * sync structurally; not imported directly so this package stays a
 * leaf of the dependency graph).
 */
interface RecipeFull {
  id: string;
  taskFamily: string;
  snapshotId: string;
  searchedAt: string;
  searchSource: 'swarm' | 'phase1';
  harness: {
    name: string;
    version: string;
    origin?: { kind?: string };
    files: Array<{ path: string; content: string }>;
    rationale?: string;
  };
  paretoCoords: { accuracy: number; tokens: number; latencyMs: number };
  scores: { accuracy: number; tokens: number; latencyMs: number; taskCount: number };
  provenance?: Record<string, unknown>;
}

export interface RecipeDetailSheetProps {
  /** When non-null, the sheet opens and shows this recipe. */
  recipe: RecipeSummary | null;
  /** Optional cross-link to the graphstore commit the recipe was learned at. */
  commit?: GraphstoreCommit | null;
  /** Optional branch name (typically the current branch). */
  branch?: string | null;
  onClose: () => void;
}

/**
 * Side drawer that renders the full content of a recipe — harness
 * source files, scores, provenance, and the cross-link to the
 * graphstore commit. Triggered from the RecipesSection card list.
 *
 * Loads the full Recipe from the recipe store via a one-shot fetch
 * against the backend's `/api/recipes/by-id/<recipeId>` route. The
 * route doesn't yet exist, so the sheet falls back to the summary
 * + a "deeper view requires backend" hint.
 */
export const RecipeDetailSheet = ({
  recipe,
  commit,
  branch,
  onClose,
}: RecipeDetailSheetProps): React.JSX.Element => {
  const [full, setFull] = useState<RecipeFull | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!recipe) {
      setFull(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${getBackendUrl()}/api/recipes/by-id/${encodeURIComponent(recipe.id)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) {
          setFull((await r.json()) as RecipeFull);
        } else {
          setFull(null);
        }
      })
      .catch(() => {
        if (!cancelled) setFull(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recipe]);

  return (
    <Sheet open={recipe !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl">
        {recipe && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                {recipe.harnessName}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 font-mono text-xs">
                <Tag className="h-3 w-3" />
                {recipe.taskFamily}
                <span className="text-text-muted">·</span>
                <span>{recipe.searchedAt.slice(0, 10)}</span>
                <span className="text-text-muted">·</span>
                <span title={recipe.id} className="truncate">
                  {recipe.id.replace(/^recipe:/, '').slice(0, 12)}
                </span>
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-5 px-6 py-4">
                {/* Cross-link to graph version */}
                <section className="rounded-md border border-border-subtle bg-deep p-3">
                  <p className="mb-1.5 text-xs tracking-wider text-text-secondary uppercase">
                    Learned at graph version
                  </p>
                  <div className="flex items-center gap-2 text-sm">
                    <GitCommit className="h-3.5 w-3.5 text-accent" />
                    <span className="font-mono text-text-primary">
                      {commit
                        ? commit.short
                        : recipe.snapshotId.replace(/^sha256:/, '').slice(0, 12)}
                    </span>
                    {branch && (
                      <span className="text-text-muted">
                        on <span className="text-text-secondary">{branch}</span>
                      </span>
                    )}
                  </div>
                  {commit?.message && (
                    <p className="mt-1 truncate text-xs text-text-secondary" title={commit.message}>
                      {commit.message}
                    </p>
                  )}
                </section>

                {/* Pareto scores */}
                <section>
                  <p className="mb-2 text-xs tracking-wider text-text-secondary uppercase">
                    Pareto scores ({recipe.searchedAt.slice(0, 10)})
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <ScoreTile label="acc" value={recipe.accuracy.toFixed(3)} variant="success" />
                    <ScoreTile label="tokens" value={recipe.tokens.toFixed(0)} />
                    <ScoreTile label="ms" value={recipe.latencyMs.toFixed(0)} />
                  </div>
                </section>

                <Separator />

                {/* Harness source / rationale */}
                {loading ? (
                  <Skeleton className="h-32 w-full" />
                ) : full ? (
                  <>
                    {full.harness.rationale && (
                      <section>
                        <p className="mb-2 text-xs tracking-wider text-text-secondary uppercase">
                          Rationale
                        </p>
                        <pre className="overflow-x-auto rounded-md border border-border-subtle bg-void p-3 text-xs whitespace-pre-wrap text-text-primary">
                          {full.harness.rationale}
                        </pre>
                      </section>
                    )}
                    <section>
                      <p className="mb-2 flex items-center gap-1.5 text-xs tracking-wider text-text-secondary uppercase">
                        <FileText className="h-3 w-3" />
                        Harness body ({full.harness.files.length} file
                        {full.harness.files.length === 1 ? '' : 's'})
                      </p>
                      <div className="space-y-3">
                        {full.harness.files.map((f) => (
                          <details key={f.path} open={f === full.harness.files[0]}>
                            <summary className="cursor-pointer rounded-md border border-border-subtle bg-deep px-3 py-2 text-sm font-medium text-text-primary">
                              {f.path}{' '}
                              <span className="text-xs font-normal text-text-muted">
                                ({f.content.length.toLocaleString()} chars)
                              </span>
                            </summary>
                            <pre className="mt-2 overflow-x-auto rounded-md border border-border-subtle bg-void p-3 text-xs text-text-primary">
                              {f.content}
                            </pre>
                          </details>
                        ))}
                      </div>
                    </section>
                    {full.provenance && (
                      <section>
                        <p className="mb-2 text-xs tracking-wider text-text-secondary uppercase">
                          Provenance
                        </p>
                        <pre className="overflow-x-auto rounded-md border border-border-subtle bg-void p-3 text-xs text-text-primary">
                          {JSON.stringify(full.provenance, null, 2)}
                        </pre>
                      </section>
                    )}
                  </>
                ) : (
                  <FullRecipeUnavailable recipeId={recipe.id} />
                )}

                <Separator />

                <section>
                  <p className="mb-2 text-xs tracking-wider text-text-secondary uppercase">
                    Snapshot fingerprint
                  </p>
                  <pre
                    className="overflow-x-auto rounded-md border border-border-subtle bg-void p-3 font-mono text-[11px] text-text-primary"
                    title={recipe.snapshotId}
                  >
                    {recipe.snapshotId}
                  </pre>
                </section>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

const ScoreTile = ({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: string;
  variant?: 'default' | 'success';
}): React.JSX.Element => (
  <div className="rounded-md border border-border-subtle bg-deep p-2">
    <div className="text-[10px] tracking-wider text-text-muted uppercase">{label}</div>
    <Badge variant={variant} className="mt-1 font-mono">
      {value}
    </Badge>
  </div>
);

const FullRecipeUnavailable = ({ recipeId }: { recipeId: string }): React.JSX.Element => (
  <section className="rounded-md border border-dashed border-border-subtle bg-deep p-4">
    <p className="text-sm font-medium text-text-primary">Full body not available</p>
    <p className="mt-1 text-xs text-text-secondary">
      The server hasn't yet exposed <code className="font-mono">/api/recipes/by-id/&lt;id&gt;</code>
      . The summary above is what the listing endpoint returns. Once the by-id route is wired, the
      harness source files and provenance will populate here.
    </p>
    <p className="mt-2 font-mono text-[10px] text-text-muted">recipe id: {recipeId}</p>
  </section>
);
