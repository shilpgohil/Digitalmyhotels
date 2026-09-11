"use client";

/**
 * SegmentedChips — the ONE filter-chip pattern for the whole platform
 * (client 09/2026: every page's quick filters must look like the Hotel
 * Expenses period chips — a bordered pill group with a navy active pill).
 *
 * Used for time-period quick filters (All Time / Today / Last 5 Days /
 * This Month / This Year) and status toggles (All / Pending / Confirmed…).
 */

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedChips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  readonly options: readonly SegmentedOption<T>[];
  /** Currently selected value — null renders no active pill (manual dates). */
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-navy-900 text-white"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Shared period helpers ────────────────────────────────────────────────────

export const PERIODS = ["all", "today", "last5", "month", "year"] as const;
export type Period = (typeof PERIODS)[number];

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** From/to LOCAL dates for a quick-period chip ("" = unbounded). */
export function periodRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const today = localDate(now);
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "last5": {
      const d = new Date(now);
      d.setDate(d.getDate() - 4);
      return { from: localDate(d), to: today };
    }
    case "month":
      return {
        from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
        to: today,
      };
    case "year":
      return { from: `${now.getFullYear()}-01-01`, to: today };
    default:
      return { from: "", to: "" };
  }
}
