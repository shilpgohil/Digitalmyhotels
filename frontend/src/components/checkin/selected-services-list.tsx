"use client";
/**
 * SelectedServicesList — summary of chosen special requirements/services
 * displayed below the service chips. Shows name + ₹amount per line.
 * Returns null when nothing is selected.
 */
import { useTranslations } from "next-intl";
import { fmtINR } from "@/lib/formatting";
import { serviceChargeAmount } from "@/components/checkin/service-utils";
import type { ServiceItem } from "@/components/checkin/types";

interface SelectedServicesListProps {
  services: ServiceItem[];
  selectedIds: string[];
  /** Staff-edited amounts keyed by service id. */
  amounts?: Record<string, string>;
}

export function SelectedServicesList({ services, selectedIds, amounts }: SelectedServicesListProps) {
  const t = useTranslations("checkin");
  const chosen = services.filter((s) => selectedIds.includes(s.id));
  if (chosen.length === 0) return null;
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
      <p className="mb-1.5 text-label font-semibold uppercase tracking-wide text-muted-foreground">
        {t("selectedRequirements")}
      </p>
      <ul className="space-y-1">
        {chosen.map((s) => (
          <li key={s.id} className="flex items-center justify-between text-sm">
            <span>{s.name}</span>
            <span className="tabular-nums font-medium">
              {fmtINR(serviceChargeAmount(s, amounts ?? {}))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
