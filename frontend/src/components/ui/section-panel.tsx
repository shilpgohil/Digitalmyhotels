/**
 * SectionPanel — shared card container with icon · title · optional subtitle
 * and an optional right-side action slot.
 *
 * Replaces 27+ hand-rolled `rounded-xl border bg-white shadow-sm` boxes and
 * the locally-defined `function Card()` in advance-booking/page.tsx.
 *
 * Usage:
 *   <SectionPanel title="In-House Guests" icon={Users} action={<Link>View All</Link>}>
 *     ...
 *   </SectionPanel>
 */
import { type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionPanelProps {
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Right-side content: a button, link, or badge */
  action?: ReactNode;
  children: ReactNode;
  /** Extra classes on the outer wrapper */
  className?: string;
  /** Extra classes on the content area (below the header) */
  contentClassName?: string;
  /** Remove the border-t separator and use a single padded area instead */
  flat?: boolean;
  /** Collapse internal padding (for tables that want edge-to-edge rows) */
  noPadding?: boolean;
}

export function SectionPanel({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
  flat = false,
  noPadding = false,
}: SectionPanelProps) {
  return (
    <div className={cn("rounded-xl border bg-white shadow-sm overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gold-50">
              <Icon className="size-4 text-gold-600" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {action && (
          <div className="shrink-0">{action}</div>
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          !flat && "border-t",
          !noPadding && "px-5 py-5",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
