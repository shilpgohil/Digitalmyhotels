"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/feedback/status-badge";
import { useSubscription } from "@/components/subscription/subscription-gate";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { SubscriptionPlanOut } from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";

function PlanContent() {
  const t = useTranslations("plan");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const sub = useSubscription();

  const plans = useQuery({
    queryKey: ["plans", activeHotelId],
    queryFn: () => api<SubscriptionPlanOut[]>("/api/v1/subscriptions/plans"),
    enabled: !!activeHotelId,
  });

  const renew = useMutation({
    mutationFn: (planCode: string) =>
      api(`/api/v1/subscriptions/me/renewal-request?plan_code=${planCode}`, {
        method: "POST",
      }),
    onSuccess: () => toast.success(t("renewalRequested")),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const status = sub.data?.status;
  const tone =
    status === "expired" || status === "suspended"
      ? "danger"
      : status === "expiring_soon"
        ? "warning"
        : "success";

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("overview")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <div className="text-center">
            <h1 className="font-display text-3xl">{t("chooseTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("chooseSubtitle")}</p>
          </div>

          {sub.data && (
            <div className="mx-auto mt-6 flex max-w-md items-center justify-between rounded-lg border bg-card px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("currentPlan")}
                </p>
                <p className="text-sm font-medium">
                  {t("validUntil")} {sub.data.expiry_date}
                </p>
              </div>
              <StatusBadge tone={tone}>{status}</StatusBadge>
            </div>
          )}

          {plans.isLoading && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-lg" />
              ))}
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.data
              ?.filter((p) => p.is_active)
              .map((plan, index, arr) => {
                const best = index === arr.length - 1 && arr.length > 1;
                return (
                  <div
                    key={plan.id}
                    className={cn(
                      "relative rounded-lg border bg-card p-6",
                      best && "border-gold-500 shadow-md",
                    )}
                  >
                    {best && (
                      <span className="absolute -top-3 right-4 rounded-full bg-gold-500 px-2.5 py-0.5 text-[10px] font-bold uppercase text-navy-900">
                        {t("bestValue")}
                      </span>
                    )}
                    <h2 className="font-display text-xl">{plan.name}</h2>
                    <p className="mt-2">
                      <span className="text-3xl font-semibold text-gold-600">
                        ₹{plan.price}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {" "}
                        / {plan.duration_days} {t("days")}
                      </span>
                    </p>
                    <ul className="mt-4 space-y-2 text-sm">
                      {[
                        t("featureAll"),
                        t("featureBooking"),
                        t("featureMoney"),
                        t("featureReports"),
                        t("featureSupport"),
                      ].map((feature) => (
                        <li key={feature} className="flex items-center gap-2">
                          <BadgeCheck className="size-4 shrink-0 text-gold-600" aria-hidden />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {can(PERMISSIONS.hotelManageSettings) && (
                      <Button
                        className={cn(
                          "mt-6 w-full",
                          best && "bg-gold-500 text-navy-900 hover:bg-gold-400",
                        )}
                        variant={best ? "default" : "outline"}
                        disabled={renew.isPending}
                        onClick={() => renew.mutate(plan.code)}
                      >
                        {t("choosePlan", { name: plan.name })}
                      </Button>
                    )}
                  </div>
                );
              })}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">{t("renewHint")}</p>
        </div>
      </main>
    </>
  );
}

export default function PlanPage() {
  return (
    <RequirePermission permission={PERMISSIONS.hotelView}>
      <PlanContent />
    </RequirePermission>
  );
}
