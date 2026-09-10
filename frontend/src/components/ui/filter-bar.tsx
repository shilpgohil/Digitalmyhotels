/**
 * FilterBar — standardized filter row used on Advance Bookings, Completed
 * Bookings, Payments, and Expenses.
 *
 * Features:
 *  - Date-range pickers (from / to)
 *  - Optional category / status select
 *  - Optional freetext search input
 *  - "Active filters" chip strip with individual remove buttons
 *  - "Clear all" button when any filter is active
 *  - Compact responsive layout (stacks on mobile)
 */
"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  /** From-date ISO string */
  fromDate?: string;
  onFromDateChange?: (v: string) => void;
  fromLabel?: string;

  /** To-date ISO string */
  toDate?: string;
  onToDateChange?: (v: string) => void;
  toLabel?: string;

  /** Optional single select (e.g. Category, Status) */
  selectValue?: string;
  onSelectChange?: (v: string) => void;
  selectOptions?: SelectOption[];
  selectPlaceholder?: string;
  selectLabel?: string;

  /** Optional second select (e.g. Payment Mode) */
  select2Value?: string;
  onSelect2Change?: (v: string) => void;
  select2Options?: SelectOption[];
  select2Placeholder?: string;
  select2Label?: string;

  /** Optional search input */
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;

  /** Called when the user clicks "Clear all" */
  onClear?: () => void;

  /** Whether any filter is currently active (controls Clear All visibility) */
  hasActiveFilters?: boolean;

  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function FilterBar({
  fromDate,
  onFromDateChange,
  fromLabel = "From",
  toDate,
  onToDateChange,
  toLabel = "To",
  selectValue,
  onSelectChange,
  selectOptions,
  selectPlaceholder = "All",
  selectLabel,
  select2Value,
  onSelect2Change,
  select2Options,
  select2Placeholder = "All",
  select2Label,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  onClear,
  hasActiveFilters,
  className,
}: FilterBarProps) {
  const showClear =
    hasActiveFilters ??
    !!(fromDate || toDate || selectValue || select2Value || searchValue);

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {/* Date range */}
      {onFromDateChange !== undefined && (
        <div className="min-w-[130px]">
          <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
            {fromLabel}
          </Label>
          <DatePicker
            className="mt-1"
            value={fromDate ?? ""}
            onChange={onFromDateChange}
          />
        </div>
      )}
      {onToDateChange !== undefined && (
        <div className="min-w-[130px]">
          <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
            {toLabel}
          </Label>
          <DatePicker
            className="mt-1"
            value={toDate ?? ""}
            onChange={onToDateChange}
          />
        </div>
      )}

      {/* Primary select */}
      {onSelectChange !== undefined && selectOptions && (
        <div className="min-w-[140px]">
          {selectLabel && (
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {selectLabel}
            </Label>
          )}
          <select
            className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={selectValue ?? ""}
            onChange={(e) => onSelectChange(e.target.value)}
          >
            <option value="">{selectPlaceholder}</option>
            {selectOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Secondary select */}
      {onSelect2Change !== undefined && select2Options && (
        <div className="min-w-[140px]">
          {select2Label && (
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {select2Label}
            </Label>
          )}
          <select
            className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={select2Value ?? ""}
            onChange={(e) => onSelect2Change(e.target.value)}
          >
            <option value="">{select2Placeholder}</option>
            {select2Options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Search */}
      {onSearchChange !== undefined && (
        <div className="min-w-[180px] flex-1">
          <div className="relative mt-5">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="pl-8 h-8"
              placeholder={searchPlaceholder}
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Clear all */}
      {showClear && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-5 flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="size-3" aria-hidden />
          Clear
        </button>
      )}
    </div>
  );
}
