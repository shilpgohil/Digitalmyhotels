"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  DoorOpen,
  DoorClosed,
  Bookmark,
  Sparkles,
  Wrench,
  LogIn,
  LogOut,
  BedDouble,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentStatusBadge } from "@/components/stay/booking-badges";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { fmtApiDate } from "@/lib/formatting";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { RoomStatusSummaryOut } from "@/types/hotel";
import type { CurrentGuestOut } from "@/types/stay";

interface StatCard {
  key: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  className: string;
  value: (summary: RoomStatusSummaryOut) => number;
}

const CARDS: StatCard[] = [
  {
    key: "total",
    labelKey: "totalRooms",
    icon: Building2,
    className: "bg-navy-900 text-white",
    value: (s) => s.total,
  },
  {
    key: "occupied",
    labelKey: "occupied",
    icon: DoorClosed,
    className: "bg-danger text-white",
    value: (s) => s.counts.occupied ?? 0,
  },
  {
    key: "available",
    labelKey: "available",
    icon: DoorOpen,
    className: "bg-success text-white",
    value: (s) => (s.counts.available ?? 0) + (s.counts.clean_ready ?? 0),
  },
  {
    key: "reserved",
    labelKey: "reserved",
    icon: Bookmark,
    className: "bg-info text-white",
    value: (s) => s.counts.reserved ?? 0,
  },
  {
    key: "cleaning",
    labelKey: "cleaning",
    icon: Sparkles,
    className: "bg-warning text-white",
    value: (s) =>
      (s.counts.cleaning_required ?? 0) +
      (s.counts.cleaning_in_progress ?? 0) +
      (s.counts.inspection_required ?? 0),
  },
  {
    key: "maintenance",
    labelKey: "maintenance",
    icon: Wrench,
    className: "bg-navy-700 text-white",
    value: (s) => (s.counts.maintenance ?? 0) + (s.counts.out_of_service ?? 0),
  },
];

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();

  const summary = useQuery({
    queryKey: ["room-status-summary", activeHotelId],
    queryFn: () => api<RoomStatusSummaryOut>("/api/v1/rooms/status-summary"),
    enabled: !!activeHotelId && can(PERMISSIONS.roomsView),
  });

  const inHouse = useQuery({
    queryKey: ["current-guests", activeHotelId, "dashboard"],
    queryFn: () =>
      api<{ items: CurrentGuestOut[]; total: number }>("/api/v1/current-guests?limit=5"),
    enabled: !!activeHotelId && can(PERMISSIONS.guestsView),
  });

  return (
    <>
      <PartnerHeader title={tn("dashboard")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Stat cards */}
        <section
          aria-label={t("totalRooms")}
          data-tour="status-cards"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
        >
          {summary.isLoading &&
            CARDS.map((card) => <Skeleton key={card.key} className="h-28 rounded-lg" />)}
          {summary.isError && (
            <div className="col-span-full rounded-lg border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
              {tc("error")}{" "}
              <button type="button" className="underline" onClick={() => summary.refetch()}>
                {tc("retry")}
              </button>
            </div>
          )}
          {summary.data &&
            CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  className={cn("relative overflow-hidden rounded-lg p-4", card.className)}
                >
                  <Icon className="absolute right-3 bottom-3 size-8 opacity-25" aria-hidden />
                  <p className="text-3xl font-semibold tabular-nums">
                    {card.value(summary.data)}
                  </p>
                  <p className="mt-1 text-xs font-medium tracking-wide uppercase opacity-80">
                    {t(card.labelKey)}
                  </p>
                </div>
              );
            })}
        </section>

        {/* In-house guests + quick actions */}
        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          {can(PERMISSIONS.guestsView) && (
            <div className="rounded-lg border bg-card lg:col-span-2" data-tour="inhouse">
              <div className="flex items-center justify-between px-5 pt-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-gold-600" aria-hidden />
                  {t("inHouseGuests")}
                </h2>
                <Link href="/current-guests" className="text-xs text-muted-foreground underline">
                  {t("viewAll")}
                </Link>
              </div>
              <div className="mt-3">
                {inHouse.isLoading && <Skeleton className="mx-5 mb-5 h-40" />}
                {inHouse.data && inHouse.data.items.length === 0 && (
                  <p className="px-5 pb-6 text-sm text-muted-foreground">
                    {t("noInHouseGuests")}
                  </p>
                )}
                {inHouse.data && inHouse.data.items.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-navy-900 hover:bg-navy-900">
                        <TableHead className="text-white">{t("colBooking")}</TableHead>
                        <TableHead className="text-white">{t("colGuest")}</TableHead>
                        <TableHead className="text-white">{t("colRoom")}</TableHead>
                        <TableHead className="text-white">{t("colCheckout")}</TableHead>
                        <TableHead className="text-white">{t("colPayment")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inHouse.data.items.map((guest) => (
                        <TableRow key={guest.booking_id}>
                          <TableCell className="font-medium">{guest.booking_number}</TableCell>
                          <TableCell>{guest.primary_guest_name}</TableCell>
                          <TableCell>{guest.rooms.join(", ")}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {fmtApiDate(guest.check_out_date)}
                          </TableCell>
                          <TableCell>
                            <PaymentStatusBadge status={guest.payment_status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
          <div className="rounded-lg border bg-card p-5 lg:col-span-1" data-tour="quick-actions">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="size-4 text-gold-600" aria-hidden />
              {t("quickActions")}
            </h2>
            <div className="mt-4 space-y-2.5">
              {can(PERMISSIONS.checkin) && (
                <Link
                  href="/checkin"
                  className={cn(
                    buttonVariants(),
                    "w-full justify-start gap-2 bg-gold-500 text-navy-900 hover:bg-gold-400",
                  )}
                >
                  <LogIn className="size-4" aria-hidden />
                  {t("newCheckin")}
                </Link>
              )}
              {can(PERMISSIONS.checkout) && (
                <Link
                  href="/checkout"
                  className={cn(buttonVariants(), "w-full justify-start gap-2")}
                >
                  <LogOut className="size-4" aria-hidden />
                  {t("processCheckout")}
                </Link>
              )}
              <Link
                href="/rooms"
                className={cn(buttonVariants({ variant: "outline" }), "w-full justify-start gap-2")}
              >
                <BedDouble className="size-4" aria-hidden />
                {t("viewRoomStatus")}
              </Link>
              {can(PERMISSIONS.hotelManageTeam) && (
                <Link
                  href="/team"
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full justify-start gap-2",
                  )}
                >
                  <Users className="size-4" aria-hidden />
                  {t("manageTeam")}
                </Link>
              )}
              {can(PERMISSIONS.paymentsView) && (
                <Link
                  href="/payments"
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full justify-start gap-2",
                  )}
                >
                  <Wallet className="size-4" aria-hidden />
                  {t("billingHistory")}
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
