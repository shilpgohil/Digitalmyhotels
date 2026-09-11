"use client";
/**
 * ServiceChips — horizontal chip row for hotel services (massage, laundry,
 * extra amenities, etc.). Each chip toggles on/off; when active an amount
 * input appears so staff can override the fixed price.
 */
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { fmtINR } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { wholeRupees } from "@/components/checkin/service-utils";
import type { ServiceItem } from "@/components/checkin/types";

interface ServiceChipsProps {
  services: ServiceItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  amounts: Record<string, string>;
  onAmountChange: (id: string, amount: string) => void;
}

export function ServiceChips({
  services,
  selectedIds,
  onToggle,
  amounts,
  onAmountChange,
}: ServiceChipsProps) {
  const t = useTranslations("checkin");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {services.map((svc) => {
        const active = selectedIds.includes(svc.id);
        return (
          <div key={svc.id} className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggle(svc.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                active
                  ? "border-navy-900 bg-navy-900 text-white font-medium"
                  : "border-border text-muted-foreground hover:border-navy-900 hover:text-navy-900",
              )}
            >
              {svc.name}
              {!active && (
                <span className="text-xs opacity-60">{fmtINR(svc.price)}</span>
              )}
            </button>
            {active && (
              <Input
                type="number"
                min={0}
                step="1"
                value={amounts[svc.id] ?? wholeRupees(svc.price)}
                onChange={(e) => onAmountChange(svc.id, e.target.value)}
                aria-label={t("serviceAmountLabel", { name: svc.name })}
                className="h-8 w-24 text-right text-sm tabular-nums"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
