"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { CalendarX2 } from "lucide-react";
import { fmtApiDate } from "@/lib/formatting";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";

export interface SubscriptionMe {
  id: string;
  status: string;
  start_date: string;
  expiry_date: string;
  grace_days: number;
  block_transactions_after_expiry: boolean;
}

export function useSubscription() {
  const api = useApi();
  const { activeHotelId } = useAuth();
  return useQuery({
    queryKey: ["subscription-me", activeHotelId],
    queryFn: () => api<SubscriptionMe | null>("/api/v1/subscriptions/me"),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });
}

/** sessionStorage flag so the expired modal shows at most once per browser session. */
const EXPIRED_MODAL_FLAG = "dmh.expiredModalShown";

/** Shows the plan-expired modal once per session, plus a persistent banner. */
export function SubscriptionGate() {
  const t = useTranslations("plan");
  const sub = useSubscription();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(EXPIRED_MODAL_FLAG) === "1";
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(EXPIRED_MODAL_FLAG, "1");
    } catch {
      // sessionStorage unavailable (private mode) — in-memory dismissal is enough.
    }
  };

  const status = sub.data?.status;
  const blocked = status === "expired" || status === "suspended";
  const expiring = status === "expiring_soon";

  if (!sub.data || (!blocked && !expiring)) return null;

  return (
    <>
      {(blocked || expiring) && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-sm",
            blocked ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning",
          )}
          role="status"
        >
          <span>
            {blocked
              ? t("expiredBanner", { date: fmtApiDate(sub.data.expiry_date) })
              : t("expiringBanner", { date: fmtApiDate(sub.data.expiry_date) })}
          </span>
          <Link href="/plan" className="font-semibold underline">
            {t("viewPlans")}
          </Link>
        </div>
      )}

      <Dialog open={blocked && !dismissed} onOpenChange={(open) => !open && dismiss()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="items-center text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-danger-bg">
              <CalendarX2 className="size-6 text-danger" aria-hidden />
            </div>
            <DialogTitle className="font-display text-xl">{t("expiredTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-center text-sm text-muted-foreground">
            {t("expiredBody", { date: fmtApiDate(sub.data.expiry_date) })}
          </p>
          <Link
            href="/plan"
            onClick={dismiss}
            className={cn(
              buttonVariants(),
              "w-full bg-gold-500 text-navy-900 hover:bg-gold-400",
            )}
          >
            {t("renewPlan")}
          </Link>
        </DialogContent>
      </Dialog>
    </>
  );
}
