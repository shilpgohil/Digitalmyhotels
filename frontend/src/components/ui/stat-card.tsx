/**
 * StatCard — unified KPI tile used on Dashboard, Rooms, Payments, and Expenses.
 *
 * Replaces four independent ad-hoc implementations:
 *   - KpiChip (dashboard/page.tsx)
 *   - STAT_CARDS inline buttons (rooms/page.tsx)
 *   - stat array inline divs (expenses/page.tsx)
 *   - stat array inline divs (payments/page.tsx)
 *
 * Supports:
 *   - tone presets that map to the brand palette
 *   - optional click-through href or onClick
 *   - optional trend indicator (+ / - percentage)
 *   - optional subtitle line
 *   - loading skeleton via isLoading
 *   - aria-pressed when used as a filter toggle (active prop)
 */
import { type ComponentType } from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// ── Tone → Tailwind classes ────────────────────────────────────────────────

const TONE_CLASSES: Record<string, string> = {
  navy:    "bg-navy-950 text-white",
  navy2:   "bg-navy-800 text-white",
  gold:    "bg-gold-500 text-navy-900",
  amber:   "bg-warning text-white",
  success: "bg-success text-white",
  danger:  "bg-danger text-white",
  warning: "bg-warning text-white",
  info:    "bg-info text-white",
  // Neutral white surface (for KpiChip-style secondary metrics)
  white:   "bg-white text-foreground shadow-[0_2px_12px_rgba(0,0,0,0.07),0_1px_3px_rgba(0,0,0,0.04)]",
  // "Muted" — lighter surface for less prominent metrics
  muted:   "bg-muted text-foreground border border-border",
};

const ACTIVE_RING: Record<string, string> = {
  navy:    "ring-2 ring-navy-700 ring-offset-1",
  navy2:   "ring-2 ring-navy-700 ring-offset-1",
  gold:    "ring-2 ring-gold-400 ring-offset-1",
  amber:   "ring-2 ring-amber-400 ring-offset-1",
  success: "ring-2 ring-success ring-offset-1",
  danger:  "ring-2 ring-danger ring-offset-1",
  warning: "ring-2 ring-warning ring-offset-1",
  info:    "ring-2 ring-info ring-offset-1",
  white:   "ring-2 ring-gold-500 ring-offset-1",
  muted:   "ring-2 ring-gold-500 ring-offset-1",
};

// ── Types ──────────────────────────────────────────────────────────────────

export type StatCardTone = keyof typeof TONE_CLASSES;

interface StatCardBaseProps {
  /** Displayed large number or value */
  value: string;
  /** Short uppercase label */
  label: string;
  /** Optional second line below the label */
  subtitle?: string;
  /** Optional trend % (positive = up, negative = down) */
  trend?: number;
  /** Lucide icon component */
  icon?: ComponentType<{ className?: string }>;
  /** Colour preset — defaults to "navy" */
  tone?: StatCardTone;
  /** Show skeleton while data loads */
  isLoading?: boolean;
  /** Pressed state (aria + active ring) — for filter-toggle use */
  active?: boolean;
  className?: string;
}

type StatCardProps =
  | (StatCardBaseProps & { href: string; onClick?: never })
  | (StatCardBaseProps & { href?: never; onClick: () => void })
  | (StatCardBaseProps & { href?: never; onClick?: never });

// ── Component ──────────────────────────────────────────────────────────────

export function StatCard({
  value,
  label,
  subtitle,
  trend,
  icon: Icon,
  tone = "navy",
  isLoading = false,
  active = false,
  className,
  href,
  onClick,
}: StatCardProps) {
  const baseClasses = cn(
    "relative overflow-hidden rounded-xl p-4 transition-all duration-200 select-none",
    TONE_CLASSES[tone] ?? TONE_CLASSES.navy,
    (href || onClick) && "cursor-pointer hover:brightness-110 hover:-translate-y-0.5 hover:shadow-elevated active:scale-[0.98] active:translate-y-0",
    active && (ACTIVE_RING[tone] ?? ACTIVE_RING.navy),
    className,
  );

  if (isLoading) {
    return <Skeleton className={cn("h-24 rounded-lg", className)} />;
  }

  const content = (
    <>
      {Icon && (
        <Icon className="absolute right-3 bottom-3 size-8 opacity-20" aria-hidden />
      )}
      <p className="text-2xl font-semibold tabular-nums leading-tight">{value}</p>
      <p className="mt-1 text-micro font-bold uppercase tracking-widest opacity-80">
        {label}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-micro opacity-60">{subtitle}</p>
      )}
      {trend !== undefined && trend !== 0 && (
        <p
          className={cn(
            "mt-1.5 flex items-center gap-0.5 text-label font-semibold",
            trend > 0 ? "text-success" : "text-danger",
          )}
        >
          {trend > 0
            ? <TrendingUp className="size-3" aria-hidden />
            : <TrendingDown className="size-3" aria-hidden />}
          {Math.abs(trend).toFixed(1)}%
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={baseClasses}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={baseClasses}
      >
        {content}
      </button>
    );
  }

  return <div className={baseClasses}>{content}</div>;
}

// ── StatCardGrid ───────────────────────────────────────────────────────────
/** Convenience grid wrapper: 2 cols on mobile → 4 on xl */
export function StatCardGrid({
  children,
  cols = 4,
  className,
}: {
  children: React.ReactNode;
  cols?: 2 | 3 | 4 | 6;
  className?: string;
}) {
  const colClass: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 xl:grid-cols-4",
    6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
  };
  return (
    <div className={cn("grid gap-3", colClass[cols] ?? colClass[4], className)}>
      {children}
    </div>
  );
}
