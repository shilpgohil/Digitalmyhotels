/**
 * EmptyState — rich empty state with icon, title, subtitle, and optional
 * action button. Used whenever a list or table has no data to show.
 *
 * Usage:
 *   <EmptyState
 *     icon={Inbox}
 *     title="No bookings yet"
 *     subtitle="Create a booking to get started"
 *     action={<Button>New Booking</Button>}
 *   />
 */
import { type ComponentType, type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Lucide icon component — defaults to Inbox */
  icon?: ComponentType<{ className?: string }>;
  /** Required heading */
  title: string;
  /** Optional supporting text */
  subtitle?: string;
  /** Optional CTA button or link */
  action?: ReactNode;
  /** Extra classes on the wrapper (e.g. for padding control) */
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  subtitle,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-4 py-12 text-center", className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted/60 shadow-surface">
        <Icon className="size-6 text-muted-foreground/50" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {subtitle && (
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">{subtitle}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
