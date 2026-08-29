"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api/client";
import type { SubscriptionPlanOut } from "@/types/money";

export default function AdminPlansPage() {
  const t = useTranslations("admin");
  const plans = useQuery({
    queryKey: ["admin-plans"],
    queryFn: () => apiFetch<SubscriptionPlanOut[]>("/api/v1/super-admin/plans"),
  });

  return (
    <>
      <PartnerHeader title={t("plans")} subtitle={t("portal")} />
      <main className="flex-1 overflow-y-auto p-6">
        {plans.isLoading && <Skeleton className="h-32" />}
        <div className="grid gap-3 md:grid-cols-2">
          {plans.data?.map((p) => (
            <div key={p.id} className="rounded-lg border bg-card p-5">
              <p className="font-display text-xl">{p.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{p.code}</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums">₹{p.price}</p>
              <p className="text-sm text-muted-foreground">
                {p.duration_days} {t("days")} · {p.trial_days} {t("trialDays")}
              </p>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
