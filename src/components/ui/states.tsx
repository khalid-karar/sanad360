import type { ReactNode } from 'react';
import { Loader2Icon, AlertTriangleIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Shared view-state layer (design system): every key screen renders loading,
 * empty and error through these so the affordances stay consistent.
 * Conventions: logical spacing only (works in RTL), SR labels included.
 */

export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="flex justify-center py-10" role="status" aria-live="polite">
      <Loader2Icon className="w-6 h-6 animate-spin text-primary" aria-hidden />
      <span className="sr-only">{label ?? 'Loading'}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  /** "What do I do next" — every role's empty state must answer this. */
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Card className="bg-card text-card-foreground border-border border-dashed">
      <CardContent className="pt-10 pb-10 text-center space-y-3">
        {icon && <div className="flex justify-center text-muted-foreground [&>svg]:w-10 [&>svg]:h-10">{icon}</div>}
        <p className="text-foreground font-medium">{title}</p>
        {hint && <p className="text-sm text-muted-foreground max-w-md mx-auto">{hint}</p>}
        {action && (
          <Button onClick={action.onClick} className="mt-2 bg-primary text-primary-foreground">
            {action.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function ErrorState({
  message,
  retry,
  retryLabel,
}: {
  message: string;
  retry?: () => void;
  retryLabel?: string;
}) {
  return (
    <Card className="bg-destructive/5 text-card-foreground border-destructive/30">
      <CardContent className="pt-6 pb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <AlertTriangleIcon className="w-5 h-5 text-destructive flex-shrink-0" aria-hidden />
          <p className="text-sm text-destructive">{message}</p>
        </div>
        {retry && (
          <Button size="sm" variant="outline" onClick={retry} className="border-destructive/40 text-destructive">
            {retryLabel ?? 'Retry'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
