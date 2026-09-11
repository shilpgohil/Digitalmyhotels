"use client";
/**
 * AutofillBanner — OCR autofill result panel shown after scanning a guest's
 * ID document. Two states:
 *  - Success: shows detected fields with confidence % + Accept/Skip buttons
 *  - Failure: warning panel explaining why autofill isn't available
 */
import { useTranslations } from "next-intl";
import { AlertTriangle, BadgeCheck } from "lucide-react";
import type { IdOcrResult, ParsedIdFields } from "@/lib/id-ocr";

interface AutofillBannerProps {
  result: IdOcrResult;
  onAccept: (fields: ParsedIdFields) => void;
  onDismiss: () => void;
}

export function AutofillBanner({ result, onAccept, onDismiss }: AutofillBannerProps) {
  const t = useTranslations("checkin");

  if (!result.can_autofill) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-warning/20 bg-warning-bg px-4 py-3 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-warning mt-0.5" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold text-warning">{t("unableAutofill")}</p>
          <p className="mt-0.5 text-warning/80 text-xs">{result.message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-warning hover:text-warning/70 text-sm leading-none"
          aria-label={t("dismiss")}
        >
          ×
        </button>
      </div>
    );
  }

  const { fields } = result;
  const detectedItems = [
    fields.name && { label: t("fieldName"), value: fields.name },
    fields.id_number && { label: t("fieldIdNumber"), value: fields.id_number },
    fields.date_of_birth && { label: t("fieldDob"), value: fields.date_of_birth },
    fields.gender && { label: t("fieldGender"), value: fields.gender },
    fields.address && { label: t("fieldAddress"), value: fields.address.slice(0, 60) + (fields.address.length > 60 ? "…" : "") },
    fields.pincode && { label: t("pincode"), value: fields.pincode },
    fields.city && { label: t("fieldCity"), value: fields.city },
    fields.state && { label: t("fieldState"), value: fields.state },
  ].filter(Boolean) as { label: string; value: string }[];

  const pct = Math.round(result.confidence * 100);

  return (
    <div className="rounded-xl border border-success/20 bg-success-bg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-success/20">
        <div className="flex items-center gap-2">
          <BadgeCheck className="size-4 text-success" aria-hidden />
          <span className="text-sm font-semibold text-success">{t("idDetected")}</span>
          <span className="rounded-full bg-success-bg px-2 py-0.5 text-micro font-bold text-success">
            {t("confidencePct", { pct })}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-success/60 hover:text-success text-sm leading-none"
          aria-label={t("dismiss")}
        >
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {detectedItems.map((item) => (
          <div key={item.label} className="flex gap-2 text-xs">
            <span className="w-24 shrink-0 font-semibold text-success">{item.label}</span>
            <span className="text-success truncate">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-success/20 bg-success-bg/50">
        <button
          type="button"
          onClick={() => onAccept(fields)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-success px-3 text-xs font-semibold text-white hover:bg-success/90 transition-colors"
        >
          <BadgeCheck className="size-3.5" aria-hidden />
          {t("autofillForm")}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-8 items-center px-3 text-xs font-medium text-success hover:underline"
        >
          {t("skipManual")}
        </button>
      </div>
    </div>
  );
}
