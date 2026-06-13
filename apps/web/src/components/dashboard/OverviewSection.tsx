import * as React from 'react';
import {
  Activity,
  ArrowRight,
  Boxes,
  Coins,
  Files,
  GitCommit,
  Network,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatCard } from './StatCard';
import { CapabilityCard } from './CapabilityCard';
import { fetchGraphstoreLog, type GraphstoreCommit } from '@/services/graphstore-client';
// (the GraphstoreCommit type is also referenced by the Top-recipes panel below)
import { fetchRecipesList, type RecipeSummary } from '@/services/recipes-client';
import {
  fetchGraphpackStatus,
  fetchSemanticRelationships,
  type GraphpackStatus,
  type SemanticRelationshipReport,
} from '@/services/graphpack-client';
import type { DashboardSection } from '@/hooks/useDashboardSection';
import type { BackendRepo } from '@/services/backend-client';
import { useGraphstoreContext } from '@/hooks/useGraphstoreContext';

/**
 * The Overview marquee. Renders:
 *   - 4 stat cards (Files / Nodes / Edges / Processes)
 *   - 4 capability cards (Token savings / Dynamic harness / Versioned graph / Agent swarm)
 *   - Recent commits timeline (via graphstore_log)
 *   - Recipes summary (via harness_recipes_list)
 *
 * All async data calls degrade gracefully when the server hasn't yet
 * exposed the endpoints: empty states with explanatory hints replace
 * the data panels rather than blocking the page.
 */
export interface OverviewSectionProps {
  onNavigate: (section: DashboardSection) => void;
}

interface RemoteState<T> {
  status: 'idle' | 'loading' | 'available' | 'unavailable';
  data: T | null;
  reason?: string;
}

export const OverviewSection = ({ onNavigate }: OverviewSectionProps): React.JSX.Element => {
  const { projectName, availableRepos } = useAppState();
  const currentRepo = projectName || null;
  const repo = useCurrentRepo(currentRepo, availableRepos);
  const ctx = useGraphstoreContext(currentRepo);

  const [logState, setLogState] = useState<RemoteState<GraphstoreCommit[]>>({
    status: 'idle',
    data: null,
  });
  const [recipesState, setRecipesState] = useState<RemoteState<RecipeSummary[]>>({
    status: 'idle',
    data: null,
  });
  const [graphpackState, setGraphpackState] = useState<RemoteState<GraphpackStatus>>({
    status: 'idle',
    data: null,
  });
  const [semanticState, setSemanticState] = useState<RemoteState<SemanticRelationshipReport>>({
    status: 'idle',
    data: null,
  });

  useEffect(() => {
    if (!currentRepo) return;
    let cancelled = false;
    setLogState({ status: 'loading', data: null });
    fetchGraphstoreLog(currentRepo, { limit: 8 }).then((res) => {
      if (cancelled) return;
      if (res.available) {
        setLogState({ status: 'available', data: res.data.commits });
      } else {
        setLogState({ status: 'unavailable', data: null, reason: res.reason });
      }
    });
    setRecipesState({ status: 'loading', data: null });
    fetchRecipesList(currentRepo, { limit: 5 }).then((res) => {
      if (cancelled) return;
      if (res.available) {
        setRecipesState({ status: 'available', data: res.data.recipes });
      } else {
        setRecipesState({
          status: 'unavailable',
          data: null,
          reason: res.reason,
        });
      }
    });
    setGraphpackState({ status: 'loading', data: null });
    fetchGraphpackStatus(currentRepo).then((res) => {
      if (cancelled) return;
      if (res.available) {
        setGraphpackState({ status: 'available', data: res.data });
      } else {
        setGraphpackState({ status: 'unavailable', data: null, reason: res.reason });
      }
    });
    setSemanticState({ status: 'loading', data: null });
    fetchSemanticRelationships(currentRepo, 200).then((res) => {
      if (cancelled) return;
      if (res.available) {
        setSemanticState({ status: 'available', data: res.data });
      } else {
        setSemanticState({ status: 'unavailable', data: null, reason: res.reason });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentRepo]);

  const stats = repo?.stats ?? {};

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-screen-2xl space-y-8 px-4 py-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            {repo?.name ?? 'Repository overview'}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {repo
              ? `${repo.repoPath ?? repo.path}${repo.indexedAt ? ` - indexed ${formatRelative(repo.indexedAt)}` : ''}`
              : 'Connect to a server and pick a repo to see its knowledge-graph overview.'}
          </p>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Files"
            value={stats.files}
            icon={Files}
            accentClassName="text-node-file"
            loading={!repo}
          />
          <StatCard
            label="Nodes"
            value={stats.nodes}
            icon={Boxes}
            accentClassName="text-node-class"
            hint={stats.embeddings ? `${stats.embeddings.toLocaleString()} embeddings` : undefined}
            loading={!repo}
          />
          <StatCard
            label="Edges"
            value={stats.edges}
            icon={Network}
            accentClassName="text-node-method"
            loading={!repo}
          />
          <StatCard
            label="Processes"
            value={stats.processes}
            icon={Workflow}
            accentClassName="text-node-interface"
            hint={
              stats.communities ? `${stats.communities.toLocaleString()} communities` : undefined
            }
            loading={!repo}
          />
        </div>

        {/* Capabilities row */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider text-text-secondary uppercase">
              Capabilities
            </h2>
            <Badge variant="outline" className="text-text-muted">
              graph workspace
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <CapabilityCard
              title="Token savings"
              tagline="Cluster-aware context packs for smaller, sharper prompts."
              icon={Coins}
              status={
                recipesState.status === 'available' && (recipesState.data?.length ?? 0) > 0
                  ? 'active'
                  : recipesState.status === 'unavailable'
                    ? 'idle'
                    : 'ready'
              }
              metric={
                recipesState.status === 'available'
                  ? `${recipesState.data?.length ?? 0} recipes`
                  : recipesState.status === 'loading'
                    ? '-'
                    : undefined
              }
              detail={
                recipesState.status === 'unavailable'
                  ? 'Recipe endpoint not yet wired to this server'
                  : 'Versioned recipe memory'
              }
              cta={{ label: 'Open Recipes', onClick: () => onNavigate('recipes') }}
            />
            <CapabilityCard
              title="Dynamic harness"
              tagline="Tune retrieval and prompts against task families."
              icon={Sparkles}
              status="ready"
              metric={recipesState.status === 'available' ? 'ready' : '-'}
              detail="Run swarm-search to learn a harness for a task family."
            />
            <CapabilityCard
              title="Versioned code graph"
              tagline="Snapshot, diff, and review graph history over time."
              icon={GitCommit}
              status={repo?.headCommit ? 'active' : 'ready'}
              metric={repo?.headCommit ? repo.headCommit.replace(/^sha256:/, '').slice(0, 12) : '-'}
              detail={
                repo?.currentBranch
                  ? `HEAD on ${repo.currentBranch}`
                  : 'Run codragraph analyze to capture the first snapshot'
              }
              cta={{ label: 'Open History', onClick: () => onNavigate('history') }}
            />
            <CapabilityCard
              title="Agent swarm"
              tagline="Explore, exploit, and critique candidate harnesses."
              icon={Activity}
              status="ready"
              metric="ready"
              detail="harness_swarm_run with --task-family to start."
            />
          </div>
        </div>

        <Separator />

        <div className="grid gap-4 lg:grid-cols-2">
          <TeamGraphPanel state={graphpackState} />
          <SemanticRelationshipsPanel state={semanticState} />
        </div>

        {/* Recent activity row */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent commits</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('history')}
                  className="text-text-secondary"
                >
                  View all
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <CommitsList state={logState} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Top recipes</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('recipes')}
                  className="text-text-secondary"
                >
                  View all
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <RecipesList state={recipesState} commitBySnapshotId={ctx.commitBySnapshotId} />
            </CardContent>
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────

const useCurrentRepo = (
  currentRepo: string | null,
  availableRepos: BackendRepo[],
): BackendRepo | null => {
  if (!currentRepo) return null;
  return availableRepos.find((r) => r.name === currentRepo) ?? null;
};

const CommitsList = ({ state }: { state: RemoteState<GraphstoreCommit[]> }): React.JSX.Element => {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (state.status === 'unavailable') {
    return (
      <EmptyHint
        title="Versioning endpoint not wired"
        body="The codragraph server hasn't exposed `/api/graphstore/log`. Once it does, this panel will populate from the graphstore HEAD walk."
        reason={state.reason}
      />
    );
  }
  if (!state.data || state.data.length === 0) {
    return (
      <EmptyHint
        title="No commits yet"
        body={
          'Run `codragraph analyze` to capture the first snapshot, or `codragraph commit -m "message"` to record a checkpoint.'
        }
      />
    );
  }
  return (
    <ul className="space-y-1.5">
      {state.data.map((c) => (
        <li
          key={c.id}
          className="flex items-start gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-elevated"
        >
          <span className="font-mono text-xs text-text-muted">{c.short}</span>
          <span className="flex-1 truncate text-text-primary">{c.message}</span>
          <span className="text-xs text-text-secondary">{formatRelative(c.ts)}</span>
        </li>
      ))}
    </ul>
  );
};

const RecipesList = ({
  state,
  commitBySnapshotId,
}: {
  state: RemoteState<RecipeSummary[]>;
  commitBySnapshotId: Map<string, GraphstoreCommit>;
}): React.JSX.Element => {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (state.status === 'unavailable') {
    return (
      <EmptyHint
        title="Recipe endpoint not wired"
        body="The codragraph server hasn't exposed `/api/recipes`. Once it does, top recipes for the current snapshot will appear here."
        reason={state.reason}
      />
    );
  }
  if (!state.data || state.data.length === 0) {
    return (
      <EmptyHint
        title="No recipes yet"
        body='Run `codragraph-harness swarm-search --task-family "..." --snapshot-id "..."` to learn the first recipe.'
      />
    );
  }
  return (
    <ul className="space-y-2">
      {state.data.map((r) => {
        const commit = commitBySnapshotId.get(r.snapshotId);
        return (
          <li key={r.id} className="rounded-md border border-border-subtle bg-deep px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-primary">
                  {r.harnessName}
                </div>
                <div className="text-xs text-text-secondary">
                  {r.taskFamily} - {formatRelative(r.searchedAt)}
                </div>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2 font-mono text-xs">
                <Badge variant="success">acc {r.accuracy.toFixed(2)}</Badge>
                <span className="text-text-muted">{r.tokens.toFixed(0)}t</span>
              </div>
            </div>
            {commit && (
              <div
                className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-muted"
                title={commit.message}
              >
                <GitCommit className="h-3 w-3 text-accent" />
                <span className="font-mono text-text-secondary">{commit.short}</span>
                <span className="truncate">{commit.message}</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const TeamGraphPanel = ({ state }: { state: RemoteState<GraphpackStatus> }): React.JSX.Element => {
  if (state.status === 'loading' || state.status === 'idle') {
    return <Skeleton className="h-40 w-full" />;
  }
  if (state.status === 'unavailable') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team graph</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyHint
            title="Graphpack endpoint not wired"
            body="The server has not exposed `/api/graphpack/status` yet."
            reason={state.reason}
          />
        </CardContent>
      </Card>
    );
  }
  const data = state.data;
  const health = data?.compatibility.ok && data.chunks.missing.length === 0;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Team graph</CardTitle>
          <Badge variant={health ? 'success' : 'secondary'}>{data?.source ?? 'missing'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Metric label="Lock" value={data?.lockPresent ? 'present' : 'missing'} />
          <Metric
            label="Chunks"
            value={`${data?.chunks.verified ?? 0}/${data?.chunks.expected ?? 0}`}
          />
          <Metric
            label="Graphpack"
            value={data?.lock?.graphpack.id ? shortGraphId(data.lock.graphpack.id) : '-'}
          />
          <Metric
            label="Snapshot"
            value={
              data?.lock?.graphpack.graphstoreSnapshot
                ? shortGraphId(data.lock.graphpack.graphstoreSnapshot)
                : '-'
            }
          />
        </div>
        {!health && (
          <p className="text-xs text-text-secondary">
            {data?.compatibility.reasons[0] ??
              data?.chunks.missing[0] ??
              'Graphpack needs bootstrap or local analyze.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

const SemanticRelationshipsPanel = ({
  state,
}: {
  state: RemoteState<SemanticRelationshipReport>;
}): React.JSX.Element => {
  if (state.status === 'loading' || state.status === 'idle') {
    return <Skeleton className="h-40 w-full" />;
  }
  if (state.status === 'unavailable') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Semantic edges</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyHint
            title="Semantic endpoint not wired"
            body="The server has not exposed `/api/semantic/relationships` yet."
            reason={state.reason}
          />
        </CardContent>
      </Card>
    );
  }
  const topFamilies = Object.entries(state.data?.summary ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Semantic edges</CardTitle>
          <Badge variant="outline">{state.data?.extractorVersion ?? 'semantic'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Metric label="Edges" value={String(state.data?.relationships.length ?? 0)} />
          <Metric
            label="Snapshot"
            value={state.data?.snapshotId ? shortGraphId(state.data.snapshotId) : '-'}
          />
        </div>
        {topFamilies.length === 0 ? (
          <p className="text-xs text-text-secondary">
            No semantic relationships detected for the current snapshot yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {topFamilies.map(([family, count]) => (
              <Badge key={family} variant="secondary">
                {family} {count}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const Metric = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <div className="rounded-md border border-border-subtle bg-deep px-3 py-2">
    <div className="text-[11px] font-medium tracking-normal text-text-muted uppercase">{label}</div>
    <div className="truncate font-mono text-xs text-text-primary">{value}</div>
  </div>
);

const EmptyHint = ({
  title,
  body,
  reason,
}: {
  title: string;
  body: string;
  reason?: string;
}): React.JSX.Element => (
  <div className="rounded-md border border-dashed border-border-subtle bg-deep p-4">
    <p className="text-sm font-medium text-text-primary">{title}</p>
    <p className="mt-1 text-xs text-text-secondary">{body}</p>
    {reason && <p className="mt-2 font-mono text-[10px] text-text-muted">reason: {reason}</p>}
  </div>
);

const formatRelative = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
};

const shortGraphId = (id: string): string => id.replace(/^sha256:/, '').slice(0, 12);
