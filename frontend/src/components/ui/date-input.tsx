"use client";

/**
 * DateInput — shows DD/MM/YYYY format regardless of browser locale.
 *
 * Uses a transparent native `<input type="date">` overlay for the calendar
 * picker, while displaying the formatted value in a styled div on top.
 * The hidden input carries the `name` attribute for form submissions.
 * `value` and `onChange` always use YYYY-MM-DD (ISO format).
 */

import { useRef } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface DateInputProps {
  readonly value: string;              // YYYY-MM-DD
  readonly onChange: (v: string) => void;
  readonly id?: string;
  readonly name?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly min?: string;               // YYYY-MM-DD
  readonly max?: string;               // YYYY-MM-DD
  readonly placeholder?: string;
}

/** Convert YYYY-MM-DD → DD/MM/YYYY for display. */
function toDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function DateInput({
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
}: DateInputProps) {
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
      {/* DD/MM/YYYY display text */}
      <span
        className={cn(
          "flex-1 tabular-nums select-none pointer-events-none",
          !displayValue && "text-muted-foreground text-[13px]",
        )}
      >
        {displayValue || placeholder}
      </span>

      {/* Calendar icon */}
      <Calendar className="size-3.5 shrink-0 text-muted-foreground pointer-events-none" aria-hidden />

      {/* Transparent native date input — provides OS calendar picker */}
      <input
        ref={nativeRef}
        type="date"
        id={id}
        name={name}
        value={value}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        aria-label={id}
      />
    </div>
  );
}
