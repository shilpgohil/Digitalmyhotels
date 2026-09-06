"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Slice a full client-side list down to the rows for a (1-based) page.
 * Out-of-range pages are clamped to the last available page.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  return items.slice((current - 1) * pageSize, current * pageSize);
}

/**
 * Client-side pagination footer — same pattern as the current-guests page:
 * "Showing X to Y of Z entries" + Previous / Page N of M / Next.
 * Renders nothing when everything fits on a single page.
 */
export function PaginationFooter({
  page,
  total,
  pageSize,
  onPageChange,
  className,
}: {
  /** 1-based current page (clamped internally when out of range). */
  page: number;
  /** Total number of rows across all pages. */
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const tc = useTranslations("common");
  const tm = useTranslations("money");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  if (total <= pageSize) return null;
  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">
        {tm("showingEntries", { from, to, total })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          {tc("previous")}
        </Button>
        <span className="text-sm tabular-nums">
          {tc("page")} {currentPage} {tc("of")} {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          {tc("next")}
        </Button>
      </div>
    </div>
  );
}
