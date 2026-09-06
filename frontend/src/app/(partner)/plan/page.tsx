"use client";

/**
 * Plan & Subscription — Figma "Choose Your Plan" redesign.
 *
 * 4 duration-tier cards (sorted by duration from the API — prices are never
 * hardcoded here), a "Best Value" ribbon on the longest plan, and a
 * "Complete Your Payment" Scan & Pay modal that pays the PLATFORM collection
 * UPI (not the hotel's own) and then files a renewal request the super admin
 * verifies and approves.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, CheckCircle2, Copy, Crown, Hourglass } from "lucide-react";
import { fmtApiDate, fmtINR } from "@/lib/formatting";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/feedback/status-badge";
import { useSubscription } from "@/components/subscription/subscription-gate";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE, ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type {
  RenewalRequestOut,
  SubscriptionPaymentInfoOut,
  SubscriptionPlanOut,
} from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Whole months for a plan duration (30 → 1, 90 → 3, 365 → 12). */
function monthsOf(plan: SubscriptionPlanOut): number {
  return Math.max(1, Math.round(plan.duration_days / 30.4));
}

/** Nearest feature tier defined in i18n for a plan's month count. */
function featureTier(months: number): "m1" | "m3" | "m6" | "m12" {
  if (months >= 12) return "m12";
  if (months >= 6) return "m6";
  if (months >= 3) return "m3";
  return "m1";
}

function PaymentModal({
  plan,
  open,
  onClose,
}: {
  readonly plan: SubscriptionPlanOut;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const t = useTranslations("plan");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();
  const [submitted, setSubmitted] = useState(false);
  const months = monthsOf(plan);

  const info = useQuery({
    queryKey: ["sub-payment-info", activeHotelId],
    queryFn: () => api<SubscriptionPaymentInfoOut>("/api/v1/subscriptions/payment-info"),
    enabled: open && !!activeHotelId,
    staleTime: 300_000,
  });

  const qr = useQuery({
    queryKey: ["sub-payment-qr", activeHotelId, plan.id],
    queryFn: async () => {
      const token = getAccessToken();
      const resp = await fetch(
        `${API_BASE}/api/v1/subscriptions/payment-qr?plan_id=${plan.id}`,
        {
          headers: {
            Authorization: `Bearer ${token ?? ""}`,
            "X-Hotel-Id": activeHotelId ?? "",
          },
          credentials: "include",
        },
      );
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    },
    enabled: open && !!activeHotelId && info.data?.configured === true,
    staleTime: 300_000,
  });

  const submit = useMutation({
    mutationFn: () =>
      api("/api/v1/subscriptions/renewal-requests", {
        method: "POST",
        body: { plan_id: plan.id },
      }),
    onSuccess: () => {
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["renewal-request-mine"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const copyUpi = async () => {
    if (!info.data?.upi_id) return;
    try {
      await navigator.clipboard.writeText(info.data.upi_id);
      toast.success(t("copied"));
    } catch {
      toast.error(tc("error"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-12 text-green-600" aria-hidden />
            <h2 className="font-display text-xl">{t("verifyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("verifyBody")}</p>
            <Button className="mt-2" onClick={onClose}>
              {tc("close")}
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-center font-display text-xl">
                {t("payTitle")}
              </DialogTitle>
              <p className="text-center text-xs text-muted-foreground">
                {t("paySubtitle", { name: plan.name })}
              </p>
            </DialogHeader>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground">{t("selectedPlan")}</span>
                <span className="font-medium">{plan.name}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground">{t("duration")}</span>
                <span className="font-medium">{t("monthsLabel", { months })}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground">{t("amount")}</span>
                <span className="font-medium">{fmtINR(plan.price)}</span>
              </div>
            </div>

            {info.data?.configured ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-semibold">{t("scanPay")}</p>
                {qr.data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qr.data}
                    alt={t("scanPay")}
                    className="size-44 rounded-lg border p-1"
                  />
                ) : (
                  <Skeleton className="size-44 rounded-lg" />
                )}
                <button
                  type="button"
                  onClick={copyUpi}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium hover:bg-muted"
                >
                  <span className="text-muted-foreground">{t("upiIdLabel")}:</span>
                  <span>{info.data.upi_id}</span>
                  <Copy className="size-3" aria-hidden />
                </button>
              </div>
            ) : (
              !info.isLoading && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
                  {t("contactTeam")}
                </p>
              )
            )}

            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="font-medium">{t("totalPayable")}</span>
              <span className="text-lg font-semibold text-gold-600">
                {fmtINR(plan.price)}
              </span>
            </div>
            <p className="text-center text-xs text-muted-foreground">{t("payNote")}</p>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {tc("cancel")}
              </Button>
              <Button
                className="bg-navy-900 text-white hover:bg-navy-800"
                disabled={submit.isPending}
                onClick={() => submit.mutate()}
              >
                {t("completedPayment")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanContent() {
  const t = useTranslations("plan");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const sub = useSubscription();
  const [selected, setSelected] = useState<SubscriptionPlanOut | null>(null);

  const plans = useQuery({
    queryKey: ["plans", activeHotelId],
    queryFn: () => api<SubscriptionPlanOut[]>("/api/v1/subscriptions/plans"),
    enabled: !!activeHotelId,
  });

  const mine = useQuery({
    queryKey: ["renewal-request-mine", activeHotelId],
    queryFn: () =>
      api<RenewalRequestOut | null>("/api/v1/subscriptions/renewal-requests/mine"),
    enabled: !!activeHotelId,
  });

  const status = sub.data?.status;
  const tone =
    status === "expired" || status === "suspended"
      ? "danger"
      : status === "expiring_soon"
        ? "warning"
        : "success";

  const visiblePlans = (plans.data ?? [])
    .filter((p) => p.is_active && Number.parseFloat(p.price) > 0)
    .sort((a, b) => a.duration_days - b.duration_days);

  // Savings baseline: the shortest (monthly) plan's price × months.
  const monthlyPlan = visiblePlans.find((p) => monthsOf(p) === 1);
  const monthlyPrice = monthlyPlan ? Number.parseFloat(monthlyPlan.price) : null;

  const pending = mine.data?.status === "pending";
  const canRequest = can(PERMISSIONS.hotelManageSettings);

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("overview")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h1 className="font-display text-3xl">{t("chooseTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("chooseSubtitle")}</p>
          </div>

          {sub.isError && (
            <p className="mx-auto mt-6 max-w-md rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {tc("error")}
            </p>
          )}

          {sub.data && (
            <div className="mx-auto mt-6 flex max-w-md items-center justify-between rounded-lg border bg-card px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("currentPlan")}
                </p>
                <p className="text-sm font-medium">
                  {t("validUntil")} {fmtApiDate(sub.data.expiry_date)}
                </p>
              </div>
              <StatusBadge tone={tone}>{status}</StatusBadge>
            </div>
          )}

          {pending && (
            <div className="mx-auto mt-4 flex max-w-2xl items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <Hourglass className="size-4 shrink-0" aria-hidden />
              {t("pendingBanner")}
            </div>
          )}

          {plans.isLoading && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-96 rounded-lg" />
              ))}
            </div>
          )}

          {plans.isError && (
            <p className="mt-8 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {tc("error")}
            </p>
          )}

          {plans.data && visiblePlans.length === 0 && (
            <p className="mt-8 py-6 text-center text-sm text-muted-foreground">
              {t("noPlans")}
            </p>
          )}

          <div className="mt-8 grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {visiblePlans.map((plan, index) => {
              const best = index === visiblePlans.length - 1 && visiblePlans.length > 1;
              const months = monthsOf(plan);
              const durationLabel =
                months === 1
                  ? t("perMonth")
                  : months >= 12
                    ? t("perYear")
                    : t("perMonths", { months });
              const savings =
                monthlyPrice !== null && months > 1
                  ? Math.round(monthlyPrice * months - Number.parseFloat(plan.price))
                  : 0;
              const features = t.raw(`features.${featureTier(months)}`) as string[];
              return (
                <div
                  key={plan.id}
                  className={cn(
                    "relative flex flex-col rounded-lg border bg-card p-6",
                    best && "border-gold-500 shadow-md",
                  )}
                >
                  {best && (
                    <span className="absolute -top-3 right-4 inline-flex items-center gap-1 rounded-full bg-gold-500 px-2.5 py-0.5 text-[10px] font-bold uppercase text-navy-900">
                      <Crown className="size-3" aria-hidden />
                      {t("bestValue")}
                    </span>
                  )}
                  <h2 className="font-display text-xl">{plan.name}</h2>
                  <p className="mt-2">
                    <span className="text-3xl font-semibold text-gold-600">
                      {fmtINR(plan.price)}
                    </span>
                    <span className="text-sm text-muted-foreground"> {durationLabel}</span>
                  </p>
                  <p
                    className={cn(
                      "mt-2 min-h-10 text-sm",
                      best ? "font-medium text-gold-600" : "text-muted-foreground",
                    )}
                  >
                    {months === 1
                      ? t("monthlyTagline")
                      : savings > 0
                        ? t("saveLine", { amount: fmtINR(savings) })
                        : ""}
                  </p>
                  <hr className="my-4" />
                  <ul className="flex-1 space-y-2 text-sm">
                    {features.map((feature, fi) => (
                      <li key={feature} className="flex items-start gap-2">
                        <BadgeCheck
                          className="mt-0.5 size-4 shrink-0 text-gold-600"
                          aria-hidden
                        />
                        <span className={cn(fi === 0 && months > 1 && "font-semibold")}>
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {canRequest && (
                    <Button
                      className={cn(
                        "mt-6 w-full",
                        best && "bg-gold-500 text-navy-900 hover:bg-gold-400",
                      )}
                      variant={best ? "default" : "outline"}
                      disabled={pending}
                      onClick={() => setSelected(plan)}
                    >
                      {months === 1 ? t("getStarted") : t("chooseMonths", { months })}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">{t("renewHint")}</p>
        </div>
      </main>
      {selected && (
        <PaymentModal plan={selected} open onClose={() => setSelected(null)} />
      )}
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
