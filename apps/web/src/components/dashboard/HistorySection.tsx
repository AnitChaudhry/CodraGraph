import * as React from 'react';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GitBranch,
  GitCommit,
  Sparkles,
} from 'lucide-react';
import { useAppState } from '@/hooks/useAppState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  fetchGraphstoreBranches,
  fetchGraphstoreLog,
  fetchGraphstoreSemanticDiff,
  type GraphstoreBranch,
  type GraphstoreCommit,
  type GraphstoreSemanticDiffResult,
} from '@/services/graphstore-client';
import { useGraphstoreContext } from '@/hooks/useGraphstoreContext';

/**
 * History section — graphstore commit log + diff viewer.
 *
 * Layout:
 *   - Branch dropdown (top left)
 *   - Commit list (left column, click to compare with parent)
 *   - Diff summary panel (right column) — added/removed/modified per table
 *
 * Defensive against missing endpoints: if /api/graphstore/* returns 404,
 * the section shows an explanatory empty state instead of breaking.
 */
export const HistorySection = (): React.JSX.Element => {
  const { projectName } = useAppState();
  const currentRepo = projectName || null;
  const ctx = useGraphstoreContext(currentRepo);

  const [branches, setBranches] = useState<GraphstoreBranch[] | null>(null);
  const [branchesUnavailable, setBranchesUnavailable] = useState<string | null>(null);
  const [commits, setCommits] = useState<GraphstoreCommit[] | null>(null);
  const [logUnavailable, setLogUnavailable] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<GraphstoreCommit | null>(null);
  const [diff, setDiff] = useState<GraphstoreSemanticDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    if (!currentRepo) return;
    let cancelled = false;
    fetchGraphstoreBranches(currentRepo).then((r) => {
      if (cancelled) return;
      if (r.available) {
        setBranches(r.data.branches);
        setBranchesUnavailable(null);
      } else {
        setBranchesUnavailable(r.reason);
        setBranches([]);
      }
    });
    fetchGraphstoreLog(currentRepo, { limit: 50 }).then((r) => {
      if (cancelled) return;
      if (r.available) {
        setCommits(r.data.commits);
        setLogUnavailable(null);
        if (r.data.commits.length > 0) {
          setSelectedCommit(r.data.commits[0]!);
        }
      } else {
        setLogUnavailable(r.reason);
        setCommits([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentRepo]);

  // When the user picks a commit, diff against its first parent.
  useEffect(() => {
    if (!selectedCommit || !currentRepo) {
      setDiff(null);
      return;
    }
    const parent = selectedCommit.parents[0];
    if (!parent) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    fetchGraphstoreSemanticDiff(parent, selectedCommit.id, currentRepo).then((r) => {
      if (cancelled) return;
      setDiffLoading(false);
      if (r.available) setDiff(r.data);
      else setDiff(null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCommit, currentRepo]);

  const currentBranch = branches?.find((b) => b.isCurrent)?.name ?? 'main';

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-deep px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <GitBranch className="h-3.5 w-3.5" />
              {currentBranch}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {(branches ?? []).map((b) => (
              <DropdownMenuItem key={b.name}>
                {b.name} · {b.short}
              </DropdownMenuItem>
            ))}
            {branches && branches.length === 0 && (
              <DropdownMenuItem disabled>(no branches)</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-xs text-text-muted">{commits?.length ?? 0} commits</span>
      </div>

      {/* Two-column body */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-1/2 min-w-0 flex-col border-r border-border-subtle">
          <div className="border-b border-border-subtle px-4 py-2 text-xs font-semibold tracking-wider text-text-secondary uppercase">
            Commits
          </div>
          <ScrollArea className="flex-1">
            {logUnavailable ? (
              <SectionUnavailable reason={logUnavailable} endpoint="/api/graphstore/log" />
            ) : commits === null ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : commits.length === 0 ? (
              <div className="p-4 text-sm text-text-secondary">
                No commits yet. Run <code>codragraph analyze</code> first.
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {commits.map((c) => {
                  const recipeCount = ctx.recipesByCommitId.get(c.id)?.length ?? 0;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedCommit(c)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated ${
                          selectedCommit?.id === c.id ? 'bg-elevated' : ''
                        }`}
                      >
                        <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="truncate text-sm font-medium text-text-primary">
                              {c.message}
                            </div>
                            {recipeCount > 0 && (
                              <Badge
                                variant="default"
                                className="shrink-0 gap-1 font-mono"
                                title={`${recipeCount} harness recipe${
                                  recipeCount === 1 ? '' : 's'
                                } learned at this commit`}
                              >
                                <Sparkles className="h-2.5 w-2.5" />
                                {recipeCount}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                            <span className="font-mono">{c.short}</span>
                            <span>·</span>
                            <span>{c.ts}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </div>

        <div className="flex w-1/2 min-w-0 flex-col">
          <div className="border-b border-border-subtle px-4 py-2 text-xs font-semibold tracking-wider text-text-secondary uppercase">
            Structural diff
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4">
              {!selectedCommit ? (
                <p className="text-sm text-text-secondary">Pick a commit to see what changed.</p>
              ) : selectedCommit.parents.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  Initial commit — nothing to diff against.
                </p>
              ) : diffLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : !diff ? (
                <p className="text-sm text-text-secondary">
                  Diff endpoint unavailable. The commit is at{' '}
                  <span className="font-mono text-xs">{selectedCommit.short}</span>.
                </p>
              ) : (
                <DiffSummary diff={diff} />
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {branchesUnavailable && !branches?.length && (
        <div className="border-t border-border-subtle bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          Versioning endpoints aren't wired on this server yet. The History view will populate once
          `/api/graphstore/*` is live.
        </div>
      )}
    </div>
  );
};

const DiffSummary = ({ diff }: { diff: GraphstoreSemanticDiffResult }): React.JSX.Element => {
  const totals = {
    added: Object.values(diff.summary.addedNodes).reduce((a, b) => a + b, 0),
    removed: Object.values(diff.summary.removedNodes).reduce((a, b) => a + b, 0),
    modified: diff.summary.modifiedSymbols,
  };
  // "What broke" — strong signals: removed exported APIs + removed
  // Processes + signature changes that flip parameter count or return
  // type. "What fixed" — added exported APIs + added Processes (new
  // contracts the agent can use).
  const signatureBreakers = diff.classifiedModifications.filter(
    (m) =>
      m.changes.includes('signature') &&
      (m.signatureChange?.parameterCountChanged !== undefined ||
        m.signatureChange?.returnTypeChanged !== undefined),
  );
  const visibilityHides = diff.classifiedModifications.filter(
    (m) => m.visibilityFlip && m.visibilityFlip.from && !m.visibilityFlip.to,
  );
  const breakageCount =
    diff.removedAPIs.length +
    diff.removedProcesses.length +
    signatureBreakers.length +
    visibilityHides.length;
  const fixCount = diff.addedAPIs.length + diff.addedProcesses.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 font-mono text-xs text-text-secondary">
        <span>{diff.from.short}</span>
        <ArrowRight className="h-3 w-3" />
        <span>{diff.to.short}</span>
      </div>

      {/* Headline: what broke / what fixed */}
      <div className="grid grid-cols-2 gap-2">
        <Card
          className={breakageCount > 0 ? 'border-red-500/40 bg-red-500/5' : 'border-border-subtle'}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs tracking-wider text-text-secondary uppercase">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              What broke
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-red-400 tabular-nums">
              {breakageCount}
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              removed APIs · removed processes · breaking signatures · hidden exports
            </p>
          </CardContent>
        </Card>
        <Card
          className={
            fixCount > 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border-subtle'
          }
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs tracking-wider text-text-secondary uppercase">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              What's new
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {fixCount}
            </div>
            <p className="mt-1 text-[11px] text-text-muted">new exported APIs · new processes</p>
          </CardContent>
        </Card>
      </div>

      {/* Counts row */}
      <div className="grid grid-cols-3 gap-2">
        <CountTile label="added" value={totals.added} accent="text-emerald-400" prefix="+" />
        <CountTile label="removed" value={totals.removed} accent="text-red-400" prefix="-" />
        <CountTile label="modified" value={totals.modified} accent="text-amber-400" prefix="~" />
      </div>

      {breakageCount > 0 && (
        <BreakagePanel
          diff={diff}
          signatureBreakers={signatureBreakers}
          visibilityHides={visibilityHides}
        />
      )}
      {fixCount > 0 && <FixesPanel diff={diff} />}

      <Separator />

      {/* By-table table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">By table</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {Object.entries(diff.summary.addedNodes).map(([t, n]) => (
              <li key={`a-${t}`} className="flex items-center gap-2">
                <Badge variant="success" className="font-mono">
                  +{n}
                </Badge>
                <span className="text-text-secondary">{t}</span>
              </li>
            ))}
            {Object.entries(diff.summary.removedNodes).map(([t, n]) => (
              <li key={`r-${t}`} className="flex items-center gap-2">
                <Badge variant="destructive" className="font-mono">
                  -{n}
                </Badge>
                <span className="text-text-secondary">{t}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {diff.classifiedModifications.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Modified symbols ({diff.classifiedModifications.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {diff.classifiedModifications.slice(0, 25).map((m) => (
                <li key={`${m.table}/${m.id}`} className="flex items-center gap-2 truncate">
                  <Badge variant="warning" className="font-mono">
                    {m.table}
                  </Badge>
                  <span className="font-mono text-xs text-text-primary">{m.id}</span>
                  <div className="ml-auto flex shrink-0 gap-1">
                    {m.changes.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px] uppercase">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const CountTile = ({
  label,
  value,
  accent,
  prefix,
}: {
  label: string;
  value: number;
  accent: string;
  prefix: string;
}): React.JSX.Element => (
  <div className="rounded-md border border-border-subtle bg-deep p-3">
    <div className="text-xs tracking-wider text-text-secondary uppercase">{label}</div>
    <div className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${accent}`}>
      {prefix}
      {value}
    </div>
  </div>
);

const BreakagePanel = ({
  diff,
  signatureBreakers,
  visibilityHides,
}: {
  diff: GraphstoreSemanticDiffResult;
  signatureBreakers: GraphstoreSemanticDiffResult['classifiedModifications'];
  visibilityHides: GraphstoreSemanticDiffResult['classifiedModifications'];
}): React.JSX.Element => (
  <Card className="border-red-500/30 bg-red-500/5">
    <CardHeader className="pb-2">
      <CardTitle className="flex items-center gap-2 text-sm text-red-300">
        <AlertTriangle className="h-4 w-4" />
        Breakage signals
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      {diff.removedAPIs.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs tracking-wider text-text-secondary uppercase">
            Removed exported APIs ({diff.removedAPIs.length})
          </p>
          <ul className="space-y-1">
            {diff.removedAPIs.slice(0, 8).map((a) => (
              <li key={`${a.table}/${a.id}`} className="flex items-center gap-2 truncate">
                <Badge variant="destructive" className="font-mono">
                  {a.table}
                </Badge>
                <span className="font-mono text-xs text-text-primary">{a.name ?? a.id}</span>
                {a.filePath && (
                  <span className="ml-auto truncate font-mono text-[10px] text-text-muted">
                    {a.filePath}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {diff.removedProcesses.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs tracking-wider text-text-secondary uppercase">
            Removed processes ({diff.removedProcesses.length})
          </p>
          <ul className="space-y-1">
            {diff.removedProcesses.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-2 truncate">
                <Badge variant="destructive" className="font-mono">
                  Process
                </Badge>
                <span className="font-mono text-xs text-text-primary">{p.name ?? p.id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {signatureBreakers.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs tracking-wider text-text-secondary uppercase">
            Breaking signatures ({signatureBreakers.length})
          </p>
          <ul className="space-y-1">
            {signatureBreakers.slice(0, 5).map((m) => (
              <li key={`${m.table}/${m.id}`} className="flex items-center gap-2 text-xs">
                <Badge variant="warning" className="font-mono">
                  sig
                </Badge>
                <span className="font-mono text-text-primary">{m.name ?? m.id}</span>
                {m.signatureChange?.parameterCountChanged && (
                  <span className="text-text-muted">
                    params {m.signatureChange.parameterCountChanged.from}→
                    {m.signatureChange.parameterCountChanged.to}
                  </span>
                )}
                {m.signatureChange?.returnTypeChanged && (
                  <span className="font-mono text-text-muted">
                    {m.signatureChange.returnTypeChanged.from} →{' '}
                    {m.signatureChange.returnTypeChanged.to}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {visibilityHides.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs tracking-wider text-text-secondary uppercase">
            No-longer-exported ({visibilityHides.length})
          </p>
          <ul className="space-y-1">
            {visibilityHides.slice(0, 5).map((m) => (
              <li key={`${m.table}/${m.id}`} className="flex items-center gap-2 text-xs">
                <Badge variant="warning" className="font-mono">
                  vis
                </Badge>
                <span className="font-mono text-text-primary">{m.name ?? m.id}</span>
                <span className="text-text-muted">exported → internal</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardContent>
  </Card>
);

const FixesPanel = ({ diff }: { diff: GraphstoreSemanticDiffResult }): React.JSX.Element => (
  <Card className="border-emerald-500/30 bg-emerald-500/5">
    <CardHeader className="pb-2">
      <CardTitle className="flex items-center gap-2 text-sm text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        New & fixes
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      {diff.addedAPIs.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs tracking-wider text-text-secondary uppercase">
            New exported APIs ({diff.addedAPIs.length})
          </p>
          <ul className="space-y-1">
            {diff.addedAPIs.slice(0, 8).map((a) => (
              <li key={`${a.table}/${a.id}`} className="flex items-center gap-2 truncate">
                <Badge variant="success" className="font-mono">
                  {a.table}
                </Badge>
                <span className="font-mono text-xs text-text-primary">{a.name ?? a.id}</span>
                {a.filePath && (
                  <span className="ml-auto truncate font-mono text-[10px] text-text-muted">
                    {a.filePath}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {diff.addedProcesses.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs tracking-wider text-text-secondary uppercase">
            New processes ({diff.addedProcesses.length})
          </p>
          <ul className="space-y-1">
            {diff.addedProcesses.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center gap-2 truncate">
                <Badge variant="success" className="font-mono">
                  Process
                </Badge>
                <span className="font-mono text-xs text-text-primary">{p.name ?? p.id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardContent>
  </Card>
);

const SectionUnavailable = ({
  reason,
  endpoint,
}: {
  reason: string;
  endpoint: string;
}): React.JSX.Element => (
  <div className="m-4 rounded-md border border-dashed border-border-subtle bg-deep p-6">
    <h3 className="text-sm font-semibold text-text-primary">Versioning endpoint unavailable</h3>
    <p className="mt-1 text-xs text-text-secondary">
      The codragraph server hasn't exposed <code className="font-mono">{endpoint}</code> yet. Once
      it does, this view will populate from the graph-versioning layer.
    </p>
    <p className="mt-3 font-mono text-[10px] text-text-muted">reason: {reason}</p>
  </div>
);
