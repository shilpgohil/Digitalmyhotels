"use client";

/**
 * TimeInput — opens the platform's CUSTOM 24-hour clock panel (the same
 * scrollable hour/minute columns used inside DateTimePicker) instead of the
 * OS-native time picker, so every time field looks identical across the
 * system (client 09/2026).
 *
 * - Display: HH:MM (24-hour), clock icon, 42px field per the form spec.
 * - Panel: fixed-position (viewport coords from the trigger rect — ancestor
 *   overflow can't clip it), hour column 00–23, minute column in 5-minute
 *   steps, gold selection, Done footer.
 * - Value contract unchanged: `value`/`onChange` use "HH:MM" (24-hour).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimeInputProps {
  readonly value: string;              // HH:MM (24-hour)
  readonly onChange: (v: string) => void;
  readonly id?: string;
  readonly name?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly placeholder?: string;
}

const HOURS: readonly string[] = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);
const MINUTES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);

/** Ensure the value is displayed as HH:MM (24-hour). */
function toDisplay(hhmm: string): string {
  if (!hhmm || !/^\d{2}:\d{2}/.test(hhmm)) return "";
  return hhmm.slice(0, 5); // already 24-hour — just truncate seconds if present
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
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const PANEL_W = 176;
const PANEL_H = 300;

export function TimeInput({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  className,
  placeholder = "HH:MM",
}: TimeInputProps) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hourColRef = useRef<HTMLDivElement>(null);
  const minuteColRef = useRef<HTMLDivElement>(null);
  // Fallback highlighted when value is empty — captured at open time.
  const [fallbackTime, setFallbackTime] = useState("12:00");

  const displayValue = toDisplay(value);
  const effective = toDisplay(value) || fallbackTime;
  const selHour = effective.slice(0, 2);
  const selMinute = effective.slice(3, 5);

  const close = useCallback(() => setPanelPos(null), []);

  const toggleOpen = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      close();
      return;
    }
    setFallbackTime(roundedNowTime());
    setOpen(true);
  };

  // Position the fixed panel from the trigger rect (mirror of DateTimePicker).
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= PANEL_H + 8 || rect.top < PANEL_H + 8
        ? Math.min(rect.bottom + 4, window.innerHeight - PANEL_H - 8)
        : rect.top - PANEL_H - 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_W - 8));
    setPanelPos({ top: Math.max(8, top), left });
  }, [open]);

  // Scroll the selected hour/minute into view when the panel opens.
  useEffect(() => {
    if (!open || !panelPos) return;
    for (const col of [hourColRef.current, minuteColRef.current]) {
      const sel = col?.querySelector<HTMLElement>("[data-selected]");
      sel?.scrollIntoView({ block: "center" });
    }
  }, [open, panelPos]);

  // Close on outside click, outside scroll, or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        close();
      }
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  const pickHour = (h: string) => onChange(`${h}:${selMinute}`);
  const pickMinute = (m: string) => onChange(`${selHour}:${m}`);

  return (
    <div
      ref={triggerRef}
      className={cn(
        "relative flex h-[42px] w-full cursor-pointer items-center rounded-md border border-input bg-white px-2.5 text-sm",
        "hover:border-gold-400 focus-within:border-gold-500 focus-within:ring-2 focus-within:ring-gold-500/20",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
      onClick={toggleOpen}
    >
      {/* 24-hour display text */}
      <span
        className={cn(
          "flex-1 tabular-nums select-none pointer-events-none font-mono",
          !displayValue && "text-muted-foreground text-caption font-sans",
        )}
      >
        {displayValue || placeholder}
      </span>

      {/* Clock icon */}
      <Clock className="size-3.5 shrink-0 text-muted-foreground pointer-events-none" aria-hidden />

      {/* Hidden input keeps form semantics (required, name, focusability). */}
      <input
        type="text"
        id={id}
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        readOnly
        onFocus={() => {
          if (!open) toggleOpen();
        }}
        onChange={() => undefined}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={id}
        aria-haspopup="dialog"
        aria-expanded={open}
      />

      {/* Custom 24h clock panel — same columns as DateTimePicker */}
      {open && panelPos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Time"
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[70] rounded-lg border border-input bg-white shadow-lg"
          style={{ top: panelPos.top, left: panelPos.left, width: PANEL_W }}
        >
          <div className="p-3">
            <span className="mb-2 block text-center text-sm font-semibold">
              Time (24h)
            </span>
            <div className="flex justify-center gap-2">
              {/* Hours */}
              <div
                ref={hourColRef}
                className="h-48 w-14 overflow-y-auto rounded-md border border-input"
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
                className="h-48 w-14 overflow-y-auto rounded-md border border-input"
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
          {/* Footer */}
          <div className="flex items-center justify-between border-t border-input px-3 py-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {effective}
            </span>
            <button
              type="button"
              onClick={() => {
                // Commit the highlighted time even if untouched (empty value).
                if (!displayValue) onChange(effective);
                setOpen(false);
                close();
              }}
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
