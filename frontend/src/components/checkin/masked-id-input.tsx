"use client";
/**
 * MaskedIdInput — ID-number field that renders masked (••••••••1234)
 * with a "Show" checkbox beside the label.
 * Raw value stays in parent state — only display toggles.
 * Focusing the input reveals the raw value so it stays editable.
 */
import { type ReactNode, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MaskedIdInputProps {
  label: string;
  labelClassName?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  trailing?: ReactNode;
}

/** Mask an ID number, keeping only the last 4 characters visible. */
function maskIdValue(v: string): string {
  if (!v) return "";
  const visible = v.slice(-4);
  return "•".repeat(Math.max(v.length - visible.length, 0)) + visible;
}

export function MaskedIdInput({
  label,
  labelClassName = "text-label font-semibold uppercase tracking-wide text-muted-foreground",
  value,
  onChange,
  placeholder,
  trailing,
}: MaskedIdInputProps) {
  const t = useTranslations("checkin");
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  const masked = !show && !focused;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className={labelClassName}>{label}</Label>
        <label className="flex cursor-pointer select-none items-center gap-1 text-label text-muted-foreground">
          <input
            type="checkbox"
            className="size-3 rounded border-input"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
          />{t("show")}
        </label>
      </div>
      <div className="flex gap-2">
        <Input
          value={masked ? maskIdValue(value) : value}
          onChange={(e) => {
            if (!masked) onChange(e.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete="off"
          className="flex-1"
        />
        {trailing}
      </div>
    </div>
  );
}
