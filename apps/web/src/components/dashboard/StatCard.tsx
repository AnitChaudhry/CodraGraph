import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/**
 * One-line KPI card. Used in the Overview marquee for the four core
 * stats (files / nodes / edges / processes) and anywhere else we need a
 * small "label + big number + supporting detail" tile.
 */
export interface StatCardProps {
  label: string;
  value: number | string | null | undefined;
  /** Lucide icon rendered in the top-right. */
  icon?: LucideIcon;
  /** Small text below the value — units, secondary stat, deltas. */
  hint?: React.ReactNode;
  /** Tailwind class for the icon's accent color. */
  accentClassName?: string;
  className?: string;
  loading?: boolean;
}

export const StatCard = ({
  label,
  value,
  icon: Icon,
  hint,
  accentClassName = 'text-accent',
  className,
  loading,
}: StatCardProps): React.JSX.Element => {
  const displayValue = formatValue(value);
  return (
    <Card className={cn('relative p-4', className)}>
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border-subtle bg-elevated/70">
          {Icon && <Icon className={cn('h-5 w-5', accentClassName)} aria-hidden />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-text-secondary uppercase">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className="mt-1 truncate font-mono text-2xl font-semibold text-text-primary tabular-nums">
              {displayValue}
            </p>
          )}
          {hint && !loading && <p className="mt-0.5 truncate text-xs text-text-muted">{hint}</p>}
        </div>
      </div>
    </Card>
  );
};

const formatValue = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v;
  // Compact number formatting at thresholds humans can scan.
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return v.toLocaleString();
};
