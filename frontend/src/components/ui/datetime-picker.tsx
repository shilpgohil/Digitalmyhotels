"use client";

/**
 * DateTimePicker — ONE field that opens ONE panel containing BOTH a
 * calendar AND a 24-hour time selection (no native pickers, no date libs).
 *
 * - Display field styled like DateInput: shows "DD/MM/YYYY, HH:MM".
 * - Panel: month calendar grid (manual Date math) + scrollable 24h
 *   hour/minute columns (5-minute steps).
 * - `dateValue`/`onDateChange` use YYYY-MM-DD; `timeValue`/`onTimeChange`
 *   use HH:MM (24-hour).
 * - Panel renders with `position: fixed` (viewport coordinates from the
 *   trigger rect) so ancestor `overflow: hidden` cannot clip it.
 * - When empty, defaults to today + current time rounded to 5 minutes.
 * - Closes on outside click, outside scroll, Escape, or the Done button.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DateTimePickerProps {
  readonly dateValue: string;               // YYYY-MM-DD
  readonly timeValue: string;               // HH:MM (24h)
  readonly onDateChange: (v: string) => void;
  readonly onTimeChange: (v: string) => void;
  readonly id?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly min?: string;                    // YYYY-MM-DD optional min date
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const HOURS: readonly string[] = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);

const MINUTES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);

/** Pad a number to 2 digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Build YYYY-MM-DD from parts. */
function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/** Validate YYYY-MM-DD. */
function isValidIsoDate(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

/** Convert YYYY-MM-DD → DD/MM/YYYY. */
function toDisplayDate(iso: string): string {
  if (!isValidIsoDate(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Validate HH:MM (24h). */
function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** Current time rounded to the nearest 5 minutes, as HH:MM (24h). */
function roundedNowTime(): string {
  const now = new Date();
  let hours = now.getHours();
  let minutes = Math.round(now.getMinutes() / 5) * 5;
  if (minutes === 60) {
    minutes = 0;
    hours = (hours + 1) % 24;
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function DateTimePicker({
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
  id,
  required,
  disabled,
  className,
  min,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  // Viewport coordinates for the fixed-position panel; null until measured.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  // Fallback time highlighted when timeValue is empty; captured at open time
  // so the panel defaults to "now" (rounded to 5 minutes) instead of 12:00.
  const [fallbackTime, setFallbackTime] = useState("12:00");

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hourColRef = useRef<HTMLDivElement>(null);
  const minuteColRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  // Month shown in the calendar grid.
  const initialViewDate = isValidIsoDate(dateValue)
    ? new Date(Number(dateValue.slice(0, 4)), Number(dateValue.slice(5, 7)) - 1, 1)
    : new Date(today.getFullYear(), today.getMonth(), 1);
  const [viewYear, setViewYear] = useState(initialViewDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialViewDate.getMonth());

  // Highlighted (not yet emitted) time when timeValue is empty.
  const effectiveTime = isValidTime(timeValue) ? timeValue : fallbackTime;
  const [selHour, selMinute] = effectiveTime.split(":");

  // --- open/close handling ---------------------------------------------

  const openPanel = () => {
    if (disabled) return;
    // Reset calendar view to selected date (or current month).
    if (isValidIsoDate(dateValue)) {
      setViewYear(Number(dateValue.slice(0, 4)));
      setViewMonth(Number(dateValue.slice(5, 7)) - 1);
    } else {
      const now = new Date();
      setViewYear(now.getFullYear());
      setViewMonth(now.getMonth());
    }
    // Default the highlighted time to "now" (rounded) when no time is set.
    setFallbackTime(roundedNowTime());
    setOpen(true);
  };

  /** Close the panel, committing today + current time for empty parts. */
  const commitAndClose = () => {
    if (!isValidIsoDate(dateValue)) onDateChange(todayIso);
    if (!isValidTime(timeValue)) onTimeChange(effectiveTime);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // --- fixed positioning -------------------------------------------------
  //
  // The panel uses `position: fixed` with coordinates computed from the
  // trigger's getBoundingClientRect(), so it escapes any ancestor
  // `overflow: hidden` clipping (e.g. the check-in page Section cards).
  // NOTE: `fixed` is measured from the nearest transformed ancestor if one
  // exists; the current page chains contain no CSS transforms on containers
  // wrapping this picker, so viewport coordinates are correct.

  /** Measure the trigger + panel and place the panel in the viewport. */
  const positionPanel = useCallback(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    const rect = root.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const margin = 8;
    const gap = 4;

    // Horizontal: left-align with the field; flip to right-align if the
    // panel would overflow the right viewport edge.
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - margin) {
      left = Math.max(margin, rect.right - panelWidth);
    }

    // Vertical: below the field; flip above if it would overflow the
    // bottom of the viewport and there is room above.
    let top = rect.bottom + gap;
    if (
      top + panelHeight > window.innerHeight - margin &&
      rect.top - gap - panelHeight >= margin
    ) {
      top = rect.top - gap - panelHeight;
    }

    setPanelPos({ top, left });
  }, []);

  /**
   * Center the selected item inside its own scroll column WITHOUT
   * scrollIntoView, which would also scroll every scrollable ancestor
   * (including the page — the reported "field scrolls the page" bug).
   */
  const centerSelected = (column: HTMLDivElement | null) => {
    if (!column) return;
    const item = column.querySelector<HTMLElement>('[data-selected="true"]');
    if (!item) return;
    column.scrollTop =
      item.offsetTop - column.clientHeight / 2 + item.clientHeight / 2;
  };

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    positionPanel();
    centerSelected(hourColRef.current);
    centerSelected(minuteColRef.current);
  }, [open, positionPanel]);

  // Keep the panel anchored: reposition on window resize; close on any
  // scroll outside the panel (simpler and robust — capture phase catches
  // scrolling of any ancestor container, not just the window).
  useEffect(() => {
    if (!open) return;
    const onResize = () => positionPanel();
    const onScroll = (e: Event) => {
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && panel.contains(e.target)) {
        return; // internal hour/minute column scrolling — keep open
      }
      setOpen(false);
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, positionPanel]);

  // --- calendar math ----------------------------------------------------

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const isDayDisabled = (iso: string): boolean =>
    Boolean(min && isValidIsoDate(min) && iso < min);

  const pickDay = (day: number) => {
    const iso = toIso(viewYear, viewMonth, day);
    if (isDayDisabled(iso)) return;
    onDateChange(iso);
  };

  const pickHour = (h: string) => {
    onTimeChange(`${h}:${selMinute}`);
  };

  const pickMinute = (m: string) => {
    onTimeChange(`${selHour}:${m}`);
  };

  // --- display ----------------------------------------------------------

  const displayDate = toDisplayDate(dateValue);
  const displayTime = isValidTime(timeValue) ? timeValue : "";
  const hasValue = Boolean(displayDate || displayTime);
  const fieldText = hasValue
    ? `${displayDate || "DD/MM/YYYY"}, ${displayTime || "HH:MM"}`
    : "";

  // Preview reflects what Done will commit: today + current rounded time
  // when the field is empty.
  const previewText = `${displayDate || toDisplayDate(todayIso)}, ${effectiveTime}`;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* Display field (button) */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label="Choose date and time"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-required={required || undefined}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center rounded-lg border border-input bg-background px-2.5 text-sm text-left",
          "hover:border-gold-400 focus:outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn(
            "flex-1 tabular-nums select-none",
            !fieldText && "text-muted-foreground text-[13px]",
          )}
        >
          {fieldText || "DD/MM/YYYY, HH:MM"}
        </span>
        <CalendarClock
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </button>

      {/* Popover panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Date and time picker"
          style={{
            top: panelPos?.top ?? 0,
            left: panelPos?.left ?? 0,
            visibility: panelPos ? undefined : "hidden",
          }}
          className={cn(
            "fixed z-50 w-max rounded-xl border border-input bg-white shadow-lg",
            "dark:bg-background",
          )}
        >
          <div className="flex flex-col gap-3 p-3 sm:flex-row">
            {/* Calendar */}
            <div className="w-[248px]">
              {/* Month/year header */}
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={goPrevMonth}
                  aria-label="Previous month"
                  className="flex size-7 items-center justify-center rounded-md hover:bg-gold-500/10"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <span className="text-sm font-semibold">
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <button
                  type="button"
                  onClick={goNextMonth}
                  aria-label="Next month"
                  className="flex size-7 items-center justify-center rounded-md hover:bg-gold-500/10"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>

              {/* Weekday row */}
              <div className="grid grid-cols-7 text-center">
                {WEEKDAYS.map((wd) => (
                  <span
                    key={wd}
                    className="py-1 text-[11px] font-medium text-muted-foreground"
                  >
                    {wd}
                  </span>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7">
                {Array.from({ length: firstWeekday }, (_, i) => (
                  <span key={`blank-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const iso = toIso(viewYear, viewMonth, day);
                  const isSelected = iso === dateValue;
                  const isToday = iso === todayIso;
                  const dayDisabled = isDayDisabled(iso);
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={dayDisabled}
                      onClick={() => pickDay(day)}
                      aria-label={`Select ${toDisplayDate(iso)}`}
                      aria-pressed={isSelected}
                      className={cn(
                        "mx-auto flex size-8 items-center justify-center rounded-md text-sm tabular-nums",
                        isSelected
                          ? "bg-gold-500 font-semibold text-navy-900"
                          : "hover:bg-gold-500/10",
                        !isSelected && isToday && "ring-1 ring-inset ring-gold-500",
                        dayDisabled &&
                          "cursor-not-allowed text-muted-foreground/40 hover:bg-transparent",
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 24-hour time section */}
            <div className="flex flex-col sm:w-[140px]">
              <span className="mb-2 text-center text-sm font-semibold">
                Time (24h)
              </span>
              <div className="flex flex-1 justify-center gap-2">
                {/* Hours */}
                <div
                  ref={hourColRef}
                  className="h-56 w-14 overflow-y-auto rounded-md border border-input"
                  aria-label="Hours"
                >
                  {HOURS.map((h) => {
                    const isSelected = h === selHour;
                    return (
                      <button
                        key={h}
                        type="button"
                        data-selected={isSelected || undefined}
                        onClick={() => pickHour(h)}
                        aria-label={`${h} hours`}
                        aria-pressed={isSelected}
                        className={cn(
                          "block w-full py-1.5 text-center text-sm tabular-nums",
                          isSelected
                            ? "bg-gold-500 font-semibold text-navy-900"
                            : "hover:bg-gold-500/10",
                        )}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>
                {/* Minutes (5-min steps) */}
                <div
                  ref={minuteColRef}
                  className="h-56 w-14 overflow-y-auto rounded-md border border-input"
                  aria-label="Minutes"
                >
                  {MINUTES.map((m) => {
                    const isSelected = m === selMinute;
                    return (
                      <button
                        key={m}
                        type="button"
                        data-selected={isSelected || undefined}
                        onClick={() => pickMinute(m)}
                        aria-label={`${m} minutes`}
                        aria-pressed={isSelected}
                        className={cn(
                          "block w-full py-1.5 text-center text-sm tabular-nums",
                          isSelected
                            ? "bg-gold-500 font-semibold text-navy-900"
                            : "hover:bg-gold-500/10",
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-input px-3 py-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {previewText}
            </span>
            <button
              type="button"
              onClick={commitAndClose}
              className="rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-navy-900 hover:bg-gold-400"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
