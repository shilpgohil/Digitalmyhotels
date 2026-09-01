"use client";

/**
 * TimeInput — always displays in 24-hour HH:MM format regardless of the
 * browser's OS locale (Windows/macOS often default to 12-hour AM/PM).
 *
 * Same pattern as DateInput: a styled text overlay sits on top of a
 * fully-transparent native <input type="time"> so the OS time picker
 * still opens on click. The value and onChange always use HH:MM (24-hr).
 */

import { useRef } from "react";
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

/** Ensure the value is displayed as HH:MM (24-hour). */
function toDisplay(hhmm: string): string {
  if (!hhmm || !/^\d{2}:\d{2}/.test(hhmm)) return "";
  return hhmm.slice(0, 5); // already 24-hour — just truncate seconds if present
}

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
  const nativeRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = nativeRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try { el.showPicker(); } catch { el.focus(); }
    } else {
      el.focus();
    }
  };

  const displayValue = toDisplay(value);

  return (
    <div
      className={cn(
        "relative flex h-9 w-full cursor-pointer items-center rounded-lg border border-input bg-background px-2.5 text-sm",
        "hover:border-gold-400 focus-within:border-gold-500 focus-within:ring-2 focus-within:ring-gold-500/20",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
      onClick={openPicker}
    >
      {/* 24-hour display text */}
      <span
        className={cn(
          "flex-1 tabular-nums select-none pointer-events-none font-mono",
          !displayValue && "text-muted-foreground text-[13px] font-sans",
        )}
      >
        {displayValue || placeholder}
      </span>

      {/* Clock icon */}
      <Clock className="size-3.5 shrink-0 text-muted-foreground pointer-events-none" aria-hidden />

      {/* Transparent native time picker — provides OS time picker on click */}
      <input
        ref={nativeRef}
        type="time"
        id={id}
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        aria-label={id}
      />
    </div>
  );
}
