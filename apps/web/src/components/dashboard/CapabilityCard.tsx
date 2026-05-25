import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight } from '@/lib/lucide-icons';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/**
 * Capability cards surface one of CodraGraph's four headline
 * capabilities (token savings / dynamic harness / versioned graph /
 * agent swarm) in a self-contained tile with status, primary metric,
 * and a single CTA. Used on the Overview marquee.
 */
export interface CapabilityCardProps {
  /** Headline like "Versioned code graph". */
  title: string;
  /** One-line value prop. */
  tagline: string;
  /** Status: "active" (green) | "ready" (violet) | "idle" (muted). */
  status: 'active' | 'ready' | 'idle';
  /** Lucide icon rendered in the corner. */
  icon: LucideIcon;
  /** Primary metric (e.g. "5,612 nodes"). */
  metric?: React.ReactNode;
  /** Smaller supporting line (e.g. "HEAD a1b2c3d on main"). */
  detail?: React.ReactNode;
  /** Optional CTA — typically navigates to the dedicated section. */
  cta?: { label: string; onClick: () => void };
  className?: string;
}

const STATUS_LABEL: Record<CapabilityCardProps['status'], string> = {
  active: 'active',
  ready: 'ready',
  idle: 'not yet wired',
};

const STATUS_VARIANT: Record<CapabilityCardProps['status'], 'success' | 'default' | 'secondary'> = {
  active: 'success',
  ready: 'default',
  idle: 'secondary',
};

export const CapabilityCard = ({
  title,
  tagline,
  status,
  icon: Icon,
  metric,
  detail,
  cta,
  className,
}: CapabilityCardProps): React.JSX.Element => (
  <Card className={cn('flex h-full flex-col', className)}>
    <CardHeader className="pb-3">
      <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/20 bg-accent/10">
          <Icon className="h-5 w-5 text-accent" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="truncate text-sm">{title}</CardTitle>
            <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{tagline}</p>
        </div>
      </div>
    </CardHeader>
    <CardContent className="flex-1">
      {metric !== undefined && (
        <div className="font-mono text-xl font-semibold text-text-primary tabular-nums">
          {metric}
        </div>
      )}
      {detail !== undefined && (
        <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{detail}</p>
      )}
    </CardContent>
    {cta && (
      <div className="border-t border-border-subtle p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={cta.onClick}
          className="w-full justify-start text-text-secondary hover:text-text-primary"
        >
          {cta.label}
          <ArrowRight className="ml-auto h-3.5 w-3.5" />
        </Button>
      </div>
    )}
  </Card>
);
