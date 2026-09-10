"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, CalendarX2, LogOut, Phone } from "lucide-react";
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

/**
 * HotelSuspendedOverlay — full-screen blocker shown the instant the
 * backend returns `hotel_suspended`. Listens for the CustomEvent emitted
 * by api/client.ts so it appears without a full-page redirect (no flash
 * of normal UI). The /suspended route handles the hard-navigation fallback.
 */
export function HotelSuspendedOverlay() {
  const ts = useTranslations("suspension");
  const { user, logout } = useAuth();
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    const handler = () => setSuspended(true);
    window.addEventListener("dmh:hotel-suspended", handler);
    return () => window.removeEventListener("dmh:hotel-suspended", handler);
  }, []);

  if (!suspended) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-navy-950/98 px-6 text-center">
      {/* DMH brand mark — white-tinted version on dark overlay */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/dmh-icon.png"
        alt="DigitalMyHotels"
        width={72}
        height={72}
        className="mb-4 select-none object-contain opacity-80"
        draggable={false}
        style={{ filter: "brightness(0) invert(1) opacity(0.7)" }}
      />
      <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-red-500/10">
        <AlertOctagon className="size-8 text-danger" aria-hidden />
      </div>
      <h1 className="font-display text-3xl font-bold text-white">{ts("title")}</h1>
      <p className="mt-3 max-w-md text-base text-white/60 leading-relaxed">{ts("body")}</p>
      <div className="mt-8 rounded-xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/70 max-w-sm w-full">
        <p className="font-semibold text-white/90 mb-2">{ts("contactTitle")}</p>
        <div className="flex items-center justify-center gap-2">
          <Phone className="size-4 shrink-0" aria-hidden />
          <a href="mailto:support@digitalmyhotels.in" className="text-gold-400 hover:underline">
            support@digitalmyhotels.in
          </a>
        </div>
      </div>
      {user && (
        <p className="mt-6 text-xs text-white/30">{ts("loggedInAs", { name: user.full_name })}</p>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white/60 hover:border-white/40 hover:text-white transition-colors"
      >
        <LogOut className="size-4" aria-hidden />
        {ts("signOut")}
      </button>
    </div>
  );
}

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
  const [detailOpen, setDetailOpen] = useState(false);

  if (!sub.data || (!blocked && !expiring)) return null;

  return (
    <>
      {(blocked || expiring) && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-sm",
            blocked ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning",
          )}
        >
          {/* Client request: clicking the banner shows expiry details in a popup. */}
          <button
            type="button"
            className="text-left hover:underline"
            onClick={() => setDetailOpen(true)}
          >
            {blocked
              ? t("expiredBanner", { date: fmtApiDate(sub.data.expiry_date) })
              : t("expiringBanner", { date: fmtApiDate(sub.data.expiry_date) })}
          </button>
          <Link href="/plan" className="font-semibold underline">
            {t("viewPlans")}
          </Link>
        </div>
      )}

      {/* Expiry-detail popup (banner click) — reuses the expired-modal layout. */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="items-center text-center">
            <div
              className={cn(
                "flex size-12 items-center justify-center rounded-full",
                blocked ? "bg-danger-bg" : "bg-warning-bg",
              )}
            >
              <CalendarX2
                className={cn("size-6", blocked ? "text-danger" : "text-warning")}
                aria-hidden
              />
            </div>
            <DialogTitle className="font-display text-xl">
              {blocked ? t("expiredTitle") : t("viewPlans")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-center text-sm text-muted-foreground">
            {blocked
              ? t("expiredBody", { date: fmtApiDate(sub.data.expiry_date) })
              : t("expiringBanner", { date: fmtApiDate(sub.data.expiry_date) })}
          </p>
          <Link
            href="/plan"
            onClick={() => setDetailOpen(false)}
            className={cn(
              buttonVariants(),
              "w-full bg-gold-500 text-navy-900 hover:bg-gold-400",
            )}
          >
            {t("renewPlan")}
          </Link>
        </DialogContent>
      </Dialog>

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
