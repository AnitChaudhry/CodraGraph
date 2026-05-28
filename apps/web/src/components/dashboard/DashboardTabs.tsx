import * as React from 'react';
import { GitBranch, History, Layers, LayoutDashboard, Network, Sparkles } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DashboardSection } from '@/hooks/useDashboardSection';
import { ThemeToggle } from './ThemeToggle';

/**
 * Top-nav tab strip that drives the section the user sees. Sits below
 * the existing Header, above the main content. Lives in the dashboard
 * subdirectory so the rest of the dashboard primitives (StatCard,
 * CapabilityCard, sections) share a co-located home.
 */
export interface DashboardTabsProps {
  section: DashboardSection;
  onChange: (next: DashboardSection) => void;
}

interface TabDef {
  value: DashboardSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'graph', label: 'Graph', icon: Network },
  { value: 'features', label: 'Features', icon: Layers },
  { value: 'projects', label: 'Projects', icon: Layers },
  { value: 'history', label: 'History', icon: History },
  { value: 'recipes', label: 'Recipes', icon: Sparkles },
];

export const DashboardTabs = ({ section, onChange }: DashboardTabsProps): React.JSX.Element => (
  <div className="border-b border-border-subtle bg-deep">
    <div className="mx-auto flex max-w-screen-2xl scrollbar-none items-center gap-2 overflow-x-auto px-4 py-2">
      <Tabs value={section} onValueChange={(v) => onChange(v as DashboardSection)}>
        <TabsList className="shrink-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                <Icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-2 text-xs text-text-muted">
          <GitBranch className="h-3.5 w-3.5" />
          <span className="font-mono">main</span>
        </span>
        <ThemeToggle />
      </div>
    </div>
  </div>
);
