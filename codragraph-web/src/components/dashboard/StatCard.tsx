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
    <Card className={cn('relative p-5', className)}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium tracking-wider text-text-secondary uppercase">{label}</p>
        {Icon && <Icon className={cn('h-4 w-4', accentClassName)} aria-hidden />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-3 font-mono text-3xl font-semibold text-text-primary tabular-nums">
          {displayValue}
        </p>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-text-secondary">{hint}</p>}
    </Card>
  );
};

const formatValue = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  // Compact number formatting at thresholds humans can scan.
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return v.toLocaleString();
};
