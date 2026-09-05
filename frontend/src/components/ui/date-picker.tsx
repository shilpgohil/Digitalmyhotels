"use client";

/**
 * DatePicker — custom calendar-only picker (NO time selection).
 *
 * Same visual design as DateTimePicker (same calendar grid, same fixed-
 * position panel that escapes ancestor `overflow:hidden`, same gold highlight
 * on today/selected) — just without the hour/minute columns.
 *
 * API: `value` / `onChange` use YYYY-MM-DD (ISO).
 * Display: shows DD/MM/YYYY in the trigger field (same as DateInput).
 * Client request: replace all DateInput native-OS pickers with this custom
 * calendar so the UI is consistent across every date-input surface.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  readonly value: string;                // YYYY-MM-DD
  readonly onChange: (v: string) => void;
  readonly id?: string;
  readonly name?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly min?: string;                 // YYYY-MM-DD optional min date
  readonly max?: string;                 // YYYY-MM-DD optional max date
  readonly placeholder?: string;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function isValidIsoDate(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

function toDisplayDate(iso: string): string {
  if (!isValidIsoDate(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function DatePicker({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  className,
  min,
  max,
  placeholder = "DD/MM/YYYY",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; right?: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  const initialViewDate = isValidIsoDate(value)
    ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1)
    : new Date(today.getFullYear(), today.getMonth(), 1);
  const [viewYear, setViewYear] = useState(initialViewDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialViewDate.getMonth());

  const openPanel = () => {
    if (disabled) return;
    if (isValidIsoDate(value)) {
      setViewYear(Number(value.slice(0, 4)));
      setViewMonth(Number(value.slice(5, 7)) - 1);
    } else {
      setViewYear(today.getFullYear());
      setViewMonth(today.getMonth());
    }
    setOpen(true);
  };

  const close = () => setOpen(false);

  // Outside click / Escape close.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Close on outside scroll (panel is fixed; page scroll misaligns it).
    const onScroll = (e: Event) => {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Reposition panel on resize.
  const positionPanel = useCallback(() => {
    if (!rootRef.current || !open) return;
    const rect = rootRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const panelW = 272; // calendar-only panel is narrower
    const spaceRight = vw - rect.left;
    if (spaceRight >= panelW) {
      setPanelPos({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPanelPos({ top: rect.bottom + 4, left: rect.right - panelW });
    }
  }, [open]);

  useLayoutEffect(() => {
    positionPanel();
  }, [open, positionPanel]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [open, positionPanel]);

  // Calendar grid.
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const selectDay = (day: number) => {
    const iso = toIso(viewYear, viewMonth, day);
    onChange(iso);
    close();
  };

  const isDisabledDay = (day: number): boolean => {
    const iso = toIso(viewYear, viewMonth, day);
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  };

  const selYear = isValidIsoDate(value) ? Number(value.slice(0, 4)) : null;
  const selMonth = isValidIsoDate(value) ? Number(value.slice(5, 7)) - 1 : null;
  const selDay   = isValidIsoDate(value) ? Number(value.slice(8, 10)) : null;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        data-required={required}
        onClick={openPanel}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-sm",
          "hover:border-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn(
            "flex-1 text-left tabular-nums",
            !value && "text-muted-foreground",
          )}
        >
          {toDisplayDate(value) || placeholder}
        </span>
        <Calendar className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {/* Hidden input so the value participates in form submissions */}
      {name && (
        <input type="hidden" name={name} value={value} />
      )}

      {/* Fixed-position calendar panel (escapes overflow:hidden) */}
      {open && panelPos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose date"
          style={{ position: "fixed", top: panelPos.top, left: panelPos.left, zIndex: 50 }}
          className="w-[272px] rounded-xl border border-input bg-white shadow-lg"
        >
          {/* Month header */}
          <div className="flex items-center justify-between border-b px-3 py-2">
            <button
              type="button"
              onClick={prevMonth}
              className="rounded-lg p-1 hover:bg-muted"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold tabular-nums">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="rounded-lg p-1 hover:bg-muted"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Calendar grid */}
          <div className="p-3">
            {/* Weekday header */}
            <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
              {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-y-0.5 text-center text-sm">
              {cells.map((day, idx) => {
                if (day === null) return <span key={`e-${idx}`} />;
                const iso = toIso(viewYear, viewMonth, day);
                const isSelected =
                  selYear === viewYear && selMonth === viewMonth && selDay === day;
                const isToday = iso === todayIso;
                const isOff = isDisabledDay(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={isOff}
                    onClick={() => selectDay(day)}
                    className={cn(
                      "mx-auto flex size-8 items-center justify-center rounded-full text-sm transition-colors",
                      isSelected
                        ? "bg-gold-500 font-semibold text-navy-900"
                        : isToday
                          ? "ring-2 ring-gold-400 font-medium"
                          : "hover:bg-muted",
                      isOff && "cursor-not-allowed opacity-30",
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
