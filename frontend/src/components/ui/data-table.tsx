/**
 * DataTable — standardized table wrapper with skeleton, empty, and error
 * states built in. Eliminates the copy-pasted pattern across every page:
 *
 *   {isLoading && <Skeleton />}
 *   {isError && <p>error</p>}
 *   {data?.items.length === 0 && <p>none</p>}
 *   {data && <Table>...}
 *
 * Usage:
 *   <DataTable
 *     isLoading={query.isLoading}
 *     isError={query.isError}
 *     onRetry={() => query.refetch()}
 *     isEmpty={data?.items.length === 0}
 *     emptyTitle="No bookings yet"
 *     emptySubtitle="Create a booking to get started"
 *     columns={["Guest", "Room", "Dates", "Total", "Status", ""]}
 *   >
 *     {data?.items.map(row => <TableRow>...</TableRow>)}
 *   </DataTable>
 */
import { type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DataTableProps {
  /** Column header labels */
  columns: (string | ReactNode)[];
  /** Right-aligned columns by index (0-based) */
  rightAlignCols?: number[];
  /** Show skeleton rows while loading */
  isLoading?: boolean;
  /** Number of skeleton rows to show */
  skeletonRows?: number;
  /** Show error state */
  isError?: boolean;
  /** Custom error message */
  errorMessage?: string;
  /** Retry callback when isError */
  onRetry?: () => void;
  /** Show empty state */
  isEmpty?: boolean;
  /** Empty state heading */
  emptyTitle?: string;
  /** Empty state sub-text */
  emptySubtitle?: string;
  /** Empty state action (e.g. a "Create" button) */
  emptyAction?: ReactNode;
  /** Table row children — rendered when not loading/error/empty */
  children?: ReactNode;
  /** Extra class on the outer wrapper */
  className?: string;
  /** Extra class on the <table> */
  tableClassName?: string;
  /** Sticky navy header like the existing design */
  darkHeader?: boolean;
}

export function DataTable({
  columns,
  rightAlignCols = [],
  isLoading = false,
  skeletonRows = 5,
  isError = false,
  errorMessage = "Something went wrong.",
  onRetry,
  isEmpty = false,
  emptyTitle = "No records found",
  emptySubtitle,
  emptyAction,
  children,
  className,
  tableClassName,
  darkHeader = false,
}: DataTableProps) {
  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className={cn("rounded-lg border bg-card overflow-hidden", className)}>
        <div className="space-y-px">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-none first:rounded-t-lg last:rounded-b-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className={cn("rounded-lg border border-danger/30 bg-danger-bg px-4 py-8 text-center", className)}>
        <AlertCircle className="mx-auto mb-2 size-5 text-danger" aria-hidden />
        <p className="text-sm font-medium text-danger">{errorMessage}</p>
        {onRetry && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (isEmpty) {
    return (
      <div className={cn("rounded-lg border bg-card", className)}>
        <EmptyState title={emptyTitle} subtitle={emptySubtitle} action={emptyAction} />
      </div>
    );
  }

  // ── Table ────────────────────────────────────────────────────────────────
  return (
    <div className={cn("rounded-lg border bg-card overflow-x-auto", className)}>
      <Table className={tableClassName}>
        <TableHeader>
          <TableRow
            className={cn(
              darkHeader && "bg-navy-900 hover:bg-navy-900",
            )}
          >
            {columns.map((col, i) => (
              <TableHead
                key={i}
                className={cn(
                  "whitespace-nowrap",
                  darkHeader && "text-white",
                  rightAlignCols.includes(i) && "text-right",
                )}
              >
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}
