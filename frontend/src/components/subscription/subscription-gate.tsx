"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, CalendarX2, Clock, LogOut, Phone } from "lucide-react";
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
      <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-danger/10">
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

/**
 * Wind-down page allowlist (plan Part 2 / scenario S1) — mirrors the backend
 * whitelist: an EXPIRED hotel keeps access to the pages needed to close out
 * in-house guests and renew; every other page is covered by the blocking
 * panel below. Keep in sync with `_EXPIRED_ALLOWED_PREFIXES` (backend deps).
 */
const WIND_DOWN_PATHS = [
  "/plan",
  "/checkout",
  "/current-guests", // the route staff use to reach a guest's checkout
  "/payments",
  "/invoices",
];

/** Shows the expired wind-down gate, plus the expiring-soon banner. */
export function SubscriptionGate() {
  const t = useTranslations("plan");
  const api = useApi();
  const { activeHotelId, logout, user } = useAuth();
  const pathname = usePathname();
  const sub = useSubscription();

  const status = sub.data?.status;
  const blocked = status === "expired" || status === "suspended";
  const expiring = status === "expiring_soon";
  const [detailOpen, setDetailOpen] = useState(false);

  // Pending renewal request → surfaced on the blocking panel (client:
  // "Pending needed in the expired modal popup").
  const myRenewal = useQuery({
    queryKey: ["renewal-request-mine", activeHotelId],
    queryFn: () =>
      api<{ status: string } | null>("/api/v1/subscriptions/renewal-requests/mine"),
    enabled: !!activeHotelId && blocked,
    staleTime: 60_000,
  });
  const renewalPending = myRenewal.data?.status === "pending";

  if (!sub.data || (!blocked && !expiring)) return null;

  const onWindDownPage = WIND_DOWN_PATHS.some((p) => pathname.startsWith(p));

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

      {/* ── Wind-down blocking panel (plan Part 2/S1) ──────────────────────
          Non-dismissible, replaces page access on NON-wind-down routes.
          Staff can still open Checkout / Current Guests / Payments /
          Invoices / Plan (the banner above stays visible there). */}
      {blocked && !onWindDownPage && (
        <div className="fixed inset-0 z-[150] flex flex-col items-center justify-center overflow-y-auto bg-navy-950/[0.97] px-6 py-10 text-center">
          <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-danger/10">
            <CalendarX2 className="size-8 text-danger" aria-hidden />
          </div>
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">
            {t("expiredTitle")}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-white/60">
            {t("expiredBody", { date: fmtApiDate(sub.data.expiry_date) })}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/50">
            {t("windDownHint")}
          </p>

          {/* Renewal request status — "Pending" once submitted (client ask) */}
          {renewalPending && (
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning-bg px-4 py-1.5 text-sm font-semibold text-warning">
              <Clock className="size-4" aria-hidden />
              {t("renewalPendingBadge")}
            </div>
          )}

          <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
            <Link
              href="/plan"
              className={cn(
                buttonVariants(),
                "h-[42px] w-full bg-gold-500 text-navy-900 hover:bg-gold-400",
              )}
            >
              {t("renewPlan")}
            </Link>
            <Link
              href="/checkout"
              className="inline-flex h-[42px] w-full items-center justify-center rounded-lg border border-white/20 text-sm text-white/70 transition-colors hover:border-white/40 hover:text-white"
            >
              {t("goToCheckouts")}
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-lg text-sm text-white/40 transition-colors hover:text-white"
            >
              <LogOut className="size-4" aria-hidden />
              {t("signOutExpired")}
            </button>
          </div>
          {user && (
            <p className="mt-6 text-xs text-white/30">
              {t("loggedInAsExpired", { name: user.full_name })}
            </p>
          )}
        </div>
      )}
    </>
  );
}
