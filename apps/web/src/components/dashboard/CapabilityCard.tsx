import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      <div className="flex items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="mt-1 text-xs text-text-secondary">{tagline}</p>
        </div>
        <Icon className="h-5 w-5 text-accent" aria-hidden />
      </div>
    </CardHeader>
    <CardContent className="flex-1">
      <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
      {metric !== undefined && (
        <div className="mt-3 font-mono text-2xl font-semibold text-text-primary tabular-nums">
          {metric}
        </div>
      )}
      {detail !== undefined && <p className="mt-1 text-xs text-text-secondary">{detail}</p>}
    </CardContent>
    {cta && (
      <div className="border-t border-border-subtle p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={cta.onClick}
          className="w-full justify-start text-text-secondary hover:text-text-primary"
        >
          {cta.label} →
        </Button>
      </div>
    )}
  </Card>
);
