"use client";
/**
 * MaskedIdInput — ID-number field that renders masked (••••••••1234)
 * with a "Show" checkbox beside the label.
 * Raw value stays in parent state — only display toggles.
 * Focusing the input reveals the raw value so it stays editable.
 *
 * When the stored value is a masked placeholder (contains •) and onReveal
 * is provided, checking "Show" calls onReveal() to decrypt the full ID.
 * This replaces the separate "Show saved ID" button (image 6 fix).
 */
import { type ReactNode, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idRuleFor } from "@/lib/input-discipline";

interface MaskedIdInputProps {
  label: string;
  labelClassName?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  trailing?: ReactNode;
  /** ID type — applies the per-type digit/char cap and format (plan Phase 5:
   *  Aadhaar 12 digits, PAN 10 uppercase, Passport 8, DL 16, Voter 10). */
  idType?: string | null;
  /**
   * Optional async function that decrypts + returns the full ID number.
   * When provided and the current value is a masked placeholder (contains •),
   * checking "Show" calls this instead of just toggling display — so the user
   * sees the actual number, not just ••••4777. Replaces RevealIdButton.
   */
  onReveal?: () => Promise<string | null>;
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
  idType,
  onReveal,
}: MaskedIdInputProps) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const masked = !show && !focused;
  const rule = idRuleFor(idType);

  const handleChange = (raw: string) => {
    // Saved-ID hints look like "••••••••1234" — never sanitize a value that
    // still carries mask bullets, or the hint gets destroyed mid-edit.
    if (raw.includes("•")) {
      onChange(raw);
      return;
    }
    onChange(idType ? rule.sanitize(raw) : raw);
  };

  const handleShowToggle = async (checked: boolean) => {
    if (checked && value.includes("•") && onReveal) {
      // Value is a masked placeholder — call onReveal() to decrypt the full ID.
      setRevealing(true);
      try {
        const full = await onReveal();
        if (full) {
          onChange(full);   // replace placeholder with the real ID number
          setShow(true);    // now show the revealed value
        } else {
          toast.info(t("noSavedId"));
          setShow(true);    // show as-is (still masked)
        }
      } catch {
        toast.error(tc("error"));
      } finally {
        setRevealing(false);
      }
    } else {
      setShow(checked);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className={labelClassName}>{label}</Label>
        <label className="flex cursor-pointer select-none items-center gap-1 text-label text-muted-foreground">
          <input
            type="checkbox"
            className="size-3 rounded border-input"
            checked={show}
            disabled={revealing}
            onChange={(e) => void handleShowToggle(e.target.checked)}
          />{revealing ? "…" : t("show")}
        </label>
      </div>
      <div className="flex gap-2">
        <Input
          value={masked ? maskIdValue(value) : value}
          onChange={(e) => {
            if (!masked) handleChange(e.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder || (idType ? rule.placeholder : undefined)}
          inputMode={idType ? rule.inputMode : undefined}
          maxLength={idType ? Math.max(rule.maxLength, value.length) : undefined}
          autoComplete="off"
          className="flex-1"
        />
        {trailing}
      </div>
    </div>
  );
}
