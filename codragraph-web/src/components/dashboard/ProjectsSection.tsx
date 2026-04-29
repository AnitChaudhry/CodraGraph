import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Box,
  GitMerge,
  Layers,
  Link2,
  Network,
  Server,
  Workflow,
} from 'lucide-react';
import { useAppState } from '@/hooks/useAppState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  fetchGroupContracts,
  fetchGroupDetails,
  fetchGroupsForRepo,
  fetchGroupsList,
  type ContractRow,
  type CrossLinkRow,
  type GroupContractsResult,
  type GroupDetails,
} from '@/services/groups-client';
import type { BackendRepo } from '@/services/backend-client';

/**
 * Cross-repo Projects view. Renders the org-scale picture for users
 * working across multiple GitHub repos / monorepos:
 *   - Group switcher
 *   - Linked repos panel (the bundle of repos this project participates with)
 *   - Cross-link contracts table (provider → consumer arrows)
 *   - Per-contract type breakdown (HTTP / gRPC / topic / lib / custom)
 *
 * Every value rendered here comes from a real API call; no mock data.
 */
export const ProjectsSection = (): React.JSX.Element => {
  const { projectName, availableRepos } = useAppState();
  const currentRepo = projectName || null;

  const [groups, setGroups] = useState<string[] | null>(null);
  const [groupsUnavailable, setGroupsUnavailable] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [details, setDetails] = useState<GroupDetails | null>(null);
  const [contracts, setContracts] = useState<GroupContractsResult | null>(null);
  const [groupsForCurrent, setGroupsForCurrent] = useState<
    Array<{ group: string; groupPath: string }>
  >([]);

  // Initial load: list groups + reverse-lookup which groups contain
  // the current project.
  useEffect(() => {
    let cancelled = false;
    fetchGroupsList().then((res) => {
      if (cancelled) return;
      if (res.available) {
        setGroups(res.data.groups);
        setGroupsUnavailable(null);
        if (res.data.groups.length > 0 && activeGroup === null) {
          setActiveGroup(res.data.groups[0]!);
        }
      } else {
        setGroups([]);
        setGroupsUnavailable(res.reason);
      }
    });
    if (currentRepo) {
      fetchGroupsForRepo(currentRepo).then((res) => {
        if (cancelled) return;
        if (res.available) setGroupsForCurrent(res.data.groups);
        else setGroupsForCurrent([]);
      });
    } else {
      setGroupsForCurrent([]);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo]);

  // When groupsForCurrent resolves, prefer one of those over a generic first.
  useEffect(() => {
    if (activeGroup === null && groupsForCurrent.length > 0) {
      setActiveGroup(groupsForCurrent[0]!.group);
    }
  }, [groupsForCurrent, activeGroup]);

  // Load details + contracts when the active group changes.
  useEffect(() => {
    if (!activeGroup) {
      setDetails(null);
      setContracts(null);
      return undefined;
    }
    let cancelled = false;
    setDetails(null);
    setContracts(null);
    fetchGroupDetails(activeGroup).then((res) => {
      if (cancelled) return;
      if (res.available) setDetails(res.data);
    });
    fetchGroupContracts(activeGroup).then((res) => {
      if (cancelled) return;
      if (res.available) setContracts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [activeGroup]);

  if (groupsUnavailable) {
    return <GroupsUnavailable reason={groupsUnavailable} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-deep px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Layers className="h-3.5 w-3.5" />
              {activeGroup ?? 'Pick a group'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {(groups ?? []).length === 0 ? (
              <DropdownMenuItem disabled>(no groups configured)</DropdownMenuItem>
            ) : (
              (groups ?? []).map((g) => (
                <DropdownMenuItem key={g} onSelect={() => setActiveGroup(g)}>
                  {g}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {currentRepo && groupsForCurrent.length > 0 && (
          <span className="text-xs text-text-muted">
            <span className="text-text-secondary">{currentRepo}</span> participates in{' '}
            <span className="font-mono text-text-primary">{groupsForCurrent.length}</span>{' '}
            group{groupsForCurrent.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-screen-2xl space-y-6 px-4 py-6">
          {!activeGroup ? (
            <NoGroupsHint />
          ) : (
            <>
              <GroupHeader details={details} />
              <LinkedReposPanel
                details={details}
                availableRepos={availableRepos}
                currentRepo={currentRepo}
              />
              <ContractsPanel
                contracts={contracts}
                details={details}
                currentRepo={currentRepo}
              />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Group header
// ──────────────────────────────────────────────────────────────────────

const GroupHeader = ({
  details,
}: {
  details: GroupDetails | null;
}): React.JSX.Element => {
  if (!details) {
    return <Skeleton className="h-16 w-full" />;
  }
  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-text-primary">
        <Layers className="h-6 w-6 text-accent" />
        {details.name}
      </h1>
      <p className="mt-1 text-sm text-text-secondary">{details.description}</p>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Linked repos panel
// ──────────────────────────────────────────────────────────────────────

const LinkedReposPanel = ({
  details,
  availableRepos,
  currentRepo,
}: {
  details: GroupDetails | null;
  availableRepos: BackendRepo[];
  currentRepo: string | null;
}): React.JSX.Element => {
  const repos = useMemo(() => {
    if (!details) return [];
    return Object.entries(details.repos).map(([groupPath, registryName]) => {
      const meta = availableRepos.find((r) => r.name === registryName) ?? null;
      return { groupPath, registryName, meta };
    });
  }, [details, availableRepos]);

  if (!details) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Linked repositories ({repos.length})</CardTitle>
          <Badge variant="secondary" className="font-mono">
            {repos.length} repo{repos.length === 1 ? '' : 's'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {repos.map(({ groupPath, registryName, meta }) => (
          <div
            key={groupPath}
            className={cn(
              'rounded-md border bg-deep p-4',
              registryName === currentRepo
                ? 'border-accent/50 shadow-glow-soft'
                : 'border-border-subtle',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Server className="h-3.5 w-3.5 text-accent" />
                  <span className="truncate">{registryName}</span>
                  {registryName === currentRepo && (
                    <Badge variant="default" className="text-[10px]">
                      you are here
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-text-muted">
                  {groupPath}
                </p>
              </div>
            </div>
            {meta?.stats && (
              <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs">
                <RepoStat label="files" value={meta.stats.files} />
                <RepoStat label="nodes" value={meta.stats.nodes} />
                <RepoStat label="edges" value={meta.stats.edges} />
              </dl>
            )}
            {meta && (
              <p className="mt-2 text-[11px] text-text-muted">
                indexed {formatRelative(meta.indexedAt)}
              </p>
            )}
            {!meta && (
              <p className="mt-2 text-[11px] text-amber-400">
                Not indexed locally — `codragraph analyze` to add it.
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

const RepoStat = ({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}): React.JSX.Element => (
  <div>
    <dt className="text-[10px] uppercase tracking-wider text-text-muted">{label}</dt>
    <dd className="text-text-primary">{value?.toLocaleString() ?? '—'}</dd>
  </div>
);

// ──────────────────────────────────────────────────────────────────────
// Contracts panel
// ──────────────────────────────────────────────────────────────────────

const ContractsPanel = ({
  contracts,
  details,
  currentRepo,
}: {
  contracts: GroupContractsResult | null;
  details: GroupDetails | null;
  currentRepo: string | null;
}): React.JSX.Element => {
  if (!contracts) return <Skeleton className="h-48 w-full" />;

  // Map group-path → registry-name so cross-link arrows can label by
  // the registered repo the user knows.
  const registryByGroupPath = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const [groupPath, registryName] of Object.entries(details?.repos ?? {})) {
      m.set(groupPath, registryName);
    }
    return m;
  }, [details]);

  // Group cross-links by contract type for the breakdown.
  const linksByType = useMemo(() => {
    const out = new Map<string, CrossLinkRow[]>();
    for (const link of contracts.crossLinks) {
      const arr = out.get(link.type) ?? [];
      arr.push(link);
      out.set(link.type, arr);
    }
    return out;
  }, [contracts]);

  const providers = contracts.contracts.filter((c) => c.role === 'provider');
  const consumers = contracts.contracts.filter((c) => c.role === 'consumer');

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CountTile
          icon={Server}
          label="Providers"
          value={providers.length}
          hint="contracts this group exposes"
        />
        <CountTile
          icon={Box}
          label="Consumers"
          value={consumers.length}
          hint="contracts this group consumes"
        />
        <CountTile
          icon={Link2}
          label="Cross-links"
          value={contracts.crossLinks.length}
          hint="resolved provider ↔ consumer matches"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="h-4 w-4 text-accent" />
              Cross-repo contracts
            </CardTitle>
            <Badge variant="outline" className="font-mono">
              {contracts.crossLinks.length} link{contracts.crossLinks.length === 1 ? '' : 's'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {contracts.crossLinks.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No resolved cross-links yet. Run{' '}
              <code className="font-mono text-text-primary">codragraph group sync</code>
              {details ? ` ${details.name}` : ' &lt;group&gt;'} to extract contracts.
            </p>
          ) : (
            contracts.crossLinks.map((link, i) => (
              <CrossLinkRowView
                key={`${link.contractId}-${i}`}
                link={link}
                registryByGroupPath={registryByGroupPath}
                currentRepo={currentRepo}
              />
            ))
          )}
        </CardContent>
      </Card>

      {linksByType.size > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By contract type</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {Array.from(linksByType.entries()).map(([type, links]) => (
                <li key={type} className="flex items-center gap-2">
                  <Badge variant="default" className="font-mono uppercase">
                    {type}
                  </Badge>
                  <span className="text-text-secondary">
                    {links.length} link{links.length === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Separator />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All contracts ({contracts.contracts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wider text-text-muted">
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5">Role</th>
                  <th className="px-2 py-1.5">Contract</th>
                  <th className="px-2 py-1.5">Repo</th>
                  <th className="px-2 py-1.5">Symbol</th>
                </tr>
              </thead>
              <tbody>
                {contracts.contracts.slice(0, 50).map((c, i) => (
                  <ContractRowView key={`${c.contractId}-${c.repo}-${i}`} contract={c} />
                ))}
              </tbody>
            </table>
            {contracts.contracts.length > 50 && (
              <p className="mt-2 text-xs text-text-muted">
                … and {contracts.contracts.length - 50} more
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
};

const CountTile = ({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint?: string;
}): React.JSX.Element => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-text-secondary">
        <Icon className="h-3.5 w-3.5 text-accent" />
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-text-primary">
        {value}
      </div>
      {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
    </CardContent>
  </Card>
);

const CrossLinkRowView = ({
  link,
  registryByGroupPath,
  currentRepo,
}: {
  link: CrossLinkRow;
  registryByGroupPath: Map<string, string>;
  currentRepo: string | null;
}): React.JSX.Element => {
  const fromRepoName = registryByGroupPath.get(link.from.repo) ?? link.from.repo;
  const toRepoName = registryByGroupPath.get(link.to.repo) ?? link.to.repo;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-deep px-3 py-2 text-sm">
      <Badge variant="default" className="font-mono uppercase">
        {link.type}
      </Badge>
      <RepoChip name={fromRepoName} highlighted={fromRepoName === currentRepo} />
      <span className="font-mono text-xs text-text-muted" title={link.from.symbolRef.filePath}>
        {link.from.symbolRef.name}
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 text-text-muted" />
      <RepoChip name={toRepoName} highlighted={toRepoName === currentRepo} />
      <span className="font-mono text-xs text-text-muted" title={link.to.symbolRef.filePath}>
        {link.to.symbolRef.name}
      </span>
      <span className="ml-auto truncate font-mono text-[11px] text-text-secondary" title={link.contractId}>
        {link.contractId}
      </span>
      <Badge variant={link.matchType === 'manifest' || link.matchType === 'exact' ? 'success' : 'warning'} className="text-[10px]">
        {link.matchType}
      </Badge>
    </div>
  );
};

const RepoChip = ({
  name,
  highlighted,
}: {
  name: string;
  highlighted: boolean;
}): React.JSX.Element => (
  <span
    className={cn(
      'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px]',
      highlighted
        ? 'border-accent/50 bg-accent/10 text-accent'
        : 'border-border-subtle bg-elevated text-text-primary',
    )}
  >
    {name}
  </span>
);

const ContractRowView = ({
  contract,
}: {
  contract: ContractRow;
}): React.JSX.Element => (
  <tr className="border-b border-border-subtle/40 hover:bg-elevated">
    <td className="px-2 py-1.5">
      <Badge variant="default" className="font-mono uppercase">
        {contract.type}
      </Badge>
    </td>
    <td className="px-2 py-1.5">
      <Badge variant={contract.role === 'provider' ? 'success' : 'secondary'} className="text-[10px] uppercase">
        {contract.role}
      </Badge>
    </td>
    <td className="px-2 py-1.5 font-mono text-xs">{contract.contractId}</td>
    <td className="px-2 py-1.5 font-mono text-xs text-text-secondary">{contract.repo}</td>
    <td className="px-2 py-1.5 font-mono text-xs text-text-primary" title={contract.symbolRef.filePath}>
      {contract.symbolName}
    </td>
  </tr>
);

// ──────────────────────────────────────────────────────────────────────
// Empty / error states
// ──────────────────────────────────────────────────────────────────────

const NoGroupsHint = (): React.JSX.Element => (
  <Card>
    <CardContent className="p-8">
      <div className="flex flex-col items-center text-center">
        <Workflow className="h-10 w-10 text-text-muted" />
        <h3 className="mt-3 text-base font-semibold text-text-primary">
          No groups configured yet
        </h3>
        <p className="mt-1 max-w-md text-sm text-text-secondary">
          Groups bundle multiple registered repos so the dashboard can show how a
          frontend / backend / shared-lib bundle relates. Each group declares
          contracts (HTTP routes, gRPC services, topics, shared libs) and the
          backend resolves cross-repo links between them.
        </p>
        <pre className="mt-4 max-w-full overflow-x-auto rounded-md border border-border-subtle bg-void px-4 py-3 text-left text-xs text-text-primary">
{`codragraph group create my-platform
codragraph group add my-platform frontend my-frontend
codragraph group add my-platform backend  my-backend
codragraph group sync my-platform`}
        </pre>
      </div>
    </CardContent>
  </Card>
);

const GroupsUnavailable = ({ reason }: { reason: string }): React.JSX.Element => (
  <div className="flex h-full items-center justify-center p-6">
    <Card className="max-w-lg">
      <CardContent className="p-6">
        <h3 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <Network className="h-5 w-5 text-amber-400" />
          Group endpoints not wired
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          The codragraph server hasn't exposed{' '}
          <code className="font-mono">/api/groups</code>. The Projects view will
          populate once the backend ships these routes.
        </p>
        <p className="mt-2 font-mono text-[11px] text-text-muted">reason: {reason}</p>
      </CardContent>
    </Card>
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
  return iso.slice(0, 10);
};
