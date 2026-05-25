import * as React from 'react';
import { useEffect, useState } from 'react';
import {
  GitCommit,
  History,
  Layers,
  LayoutDashboard,
  Network,
  Server,
  Settings,
  Sparkles,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useAppState } from '@/hooks/useAppState';
import { useGraphstoreContext } from '@/hooks/useGraphstoreContext';
import type { DashboardSection } from '@/hooks/useDashboardSection';

/**
 * Global command palette (Cmd+K / Ctrl+K). Lets the user jump between
 * sections, switch repos, and dive into specific commits or recipes
 * without leaving the keyboard. The palette pulls live data from the
 * graphstore + recipe context so the commit / recipe entries are real
 * (no mock).
 */
export interface CommandPaletteProps {
  onJumpToSection: (section: DashboardSection) => void;
  onOpenSettings: () => void;
  /** Optional repo switcher; called with the registry name. */
  onSwitchRepo?: (repoName: string) => Promise<void> | void;
}

export const CommandPalette = ({
  onJumpToSection,
  onOpenSettings,
  onSwitchRepo,
}: CommandPaletteProps): React.JSX.Element => {
  const { availableRepos, projectName } = useAppState();
  const ctx = useGraphstoreContext(projectName || null);
  const [open, setOpen] = useState(false);

  // Global keyboard shortcut: Cmd+K (mac) or Ctrl+K (everywhere else).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const close = () => setOpen(false);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search sections, repos, commits, recipes..." />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <NavItem
            icon={LayoutDashboard}
            label="Overview"
            onSelect={() => {
              onJumpToSection('overview');
              close();
            }}
          />
          <NavItem
            icon={Network}
            label="Graph"
            onSelect={() => {
              onJumpToSection('graph');
              close();
            }}
          />
          <NavItem
            icon={Layers}
            label="Features"
            onSelect={() => {
              onJumpToSection('features');
              close();
            }}
          />
          <NavItem
            icon={Layers}
            label="Projects"
            onSelect={() => {
              onJumpToSection('projects');
              close();
            }}
          />
          <NavItem
            icon={History}
            label="History"
            onSelect={() => {
              onJumpToSection('history');
              close();
            }}
          />
          <NavItem
            icon={Sparkles}
            label="Recipes"
            onSelect={() => {
              onJumpToSection('recipes');
              close();
            }}
          />
          <NavItem
            icon={Settings}
            label="Settings"
            onSelect={() => {
              onOpenSettings();
              close();
            }}
            shortcut="Ctrl ,"
          />
        </CommandGroup>

        {availableRepos.length > 0 && onSwitchRepo && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch repo">
              {availableRepos.slice(0, 10).map((r) => (
                <CommandItem
                  key={r.name}
                  value={`repo ${r.name}`}
                  onSelect={async () => {
                    await onSwitchRepo(r.name);
                    close();
                  }}
                >
                  <Server className="text-accent" />
                  <span>{r.name}</span>
                  <span className="ml-auto truncate font-mono text-[10px] text-text-muted">
                    {r.path}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {ctx.commits.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent commits">
              {ctx.commits.slice(0, 8).map((c) => (
                <CommandItem
                  key={c.id}
                  value={`commit ${c.short} ${c.message}`}
                  onSelect={() => {
                    onJumpToSection('history');
                    close();
                  }}
                >
                  <GitCommit className="text-accent" />
                  <span className="font-mono text-xs text-text-secondary">{c.short}</span>
                  <span className="truncate">{c.message}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {ctx.recipes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recipes">
              {ctx.recipes.slice(0, 8).map((r) => (
                <CommandItem
                  key={r.id}
                  value={`recipe ${r.harnessName} ${r.taskFamily}`}
                  onSelect={() => {
                    onJumpToSection('recipes');
                    close();
                  }}
                >
                  <Sparkles className="text-accent" />
                  <span>{r.harnessName}</span>
                  <span className="ml-auto text-[10px] text-text-muted">{r.taskFamily}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
};

const NavItem = ({
  icon: Icon,
  label,
  onSelect,
  shortcut,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
  shortcut?: string;
}): React.JSX.Element => (
  <CommandItem value={`nav ${label}`} onSelect={onSelect}>
    <Icon className="text-accent" />
    <span>{label}</span>
    {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
  </CommandItem>
);
