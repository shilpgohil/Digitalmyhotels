"use client";

import { Suspense, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PartnerHeader } from "@/components/layout/partner-header";
import { fmtApiDate, fmtINR } from "@/lib/formatting";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BookingStatusBadge,
  PaymentStatusBadge,
} from "@/components/stay/booking-badges";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";
import type { ListOut } from "@/types/hotel";
import type { BookingOut } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { useRouter, useSearchParams } from "next/navigation";

type CompletedStatus = "checked_out" | "cancelled" | "no_show";
type QuickRange = "all" | "today" | "last5" | "month" | "year";

const PAGE_SIZE = 50;

/** Format a Date as local YYYY-MM-DD (avoids UTC off-by-one). */
function toLocalIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Compute from/to dates for a quick-filter chip. */
function rangeFor(range: QuickRange): { from: string; to: string } {
  const now = new Date();
  const today = toLocalIso(now);
  switch (range) {
    case "today":
      return { from: today, to: today };
    case "last5": {
      const d = new Date(now);
      d.setDate(d.getDate() - 4);
      return { from: toLocalIso(d), to: today };
    }
    case "month":
      return { from: toLocalIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "year":
      return { from: toLocalIso(new Date(now.getFullYear(), 0, 1)), to: today };
    default:
      return { from: "", to: "" };
  }
}

function CompletedBookingsContent() {
  const t = useTranslations("bookings");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Persist filters in URL search params so refresh/back restores the view.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") ?? "");
  const [toDate, setToDate] = useState(() => searchParams.get("to") ?? "");
  const [status, setStatus] = useState<CompletedStatus>("checked_out");
  const [quickRange, setQuickRange] = useState<QuickRange>("all");
  const [page, setPage] = useState(0);

  const filterQs =
    (search ? `&q=${encodeURIComponent(search)}` : "") +
    (fromDate ? `&from_date=${fromDate}` : "") +
    (toDate ? `&to_date=${toDate}` : "");

  // Keep URL in sync with filters so refresh/share preserves state.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const qs = params.toString();
    const url = qs ? `/completed-bookings?${qs}` : "/completed-bookings";
    router.replace(url, { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, fromDate, toDate]);

  // Reset pagination whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [search, fromDate, toDate, status]);

  const bookings = useQuery({
    queryKey: ["bookings", activeHotelId, status, filterQs, page],
    queryFn: () =>
      api<ListOut<BookingOut>>(
        `/api/v1/bookings?status=${status}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${filterQs}`,
      ),
    enabled: !!activeHotelId,
  });

  const statusChips: { value: CompletedStatus; label: string }[] = [
    { value: "checked_out", label: t("status_checked_out") },
    { value: "cancelled", label: t("status_cancelled") },
    { value: "no_show", label: t("status_no_show") },
  ];

  const quickChips: { value: QuickRange; label: string }[] = [
    { value: "all", label: t("allTime") },
    { value: "today", label: t("today") },
    { value: "last5", label: t("last5Days") },
    { value: "month", label: t("thisMonth") },
    { value: "year", label: t("thisYear") },
  ];

  return (
    <>
      <PartnerHeader title={t("completedBookingsTitle")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <Input
              placeholder={t("searchPlaceholder")}
              className="max-w-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <DateInput
              className="w-40"
              aria-label={t("checkinDate")}
              value={fromDate}
              onChange={(v) => {
                setQuickRange("all");
                setFromDate(v);
              }}
            />
            <DateInput
              className="w-40"
              aria-label={t("checkoutDate")}
              value={toDate}
              onChange={(v) => {
                setQuickRange("all");
                setToDate(v);
              }}
            />
          </div>
        </div>

        {/* Quick date-range chips */}
        <div className="mb-3 flex flex-wrap gap-2">
          {quickChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => {
                setQuickRange(chip.value);
                const { from, to } = rangeFor(chip.value);
                setFromDate(from);
                setToDate(to);
              }}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-colors",
                quickRange === chip.value
                  ? "border-gold-500 bg-gold-500 font-medium text-navy-900"
                  : "border-border text-muted-foreground hover:border-gold-500 hover:text-gold-600",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Status toggle chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          {statusChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setStatus(chip.value)}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-colors",
                status === chip.value
                  ? "border-navy-900 bg-navy-900 font-medium text-white"
                  : "border-border text-muted-foreground hover:border-navy-900 hover:text-navy-900",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="rounded-lg border bg-card">
          {bookings.isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {bookings.isError && (
            <div className="p-8 text-center text-sm text-danger">
              {tc("error")}{" "}
              <button type="button" className="underline" onClick={() => bookings.refetch()}>
                {tc("retry")}
              </button>
            </div>
          )}
          {bookings.data && bookings.data.items.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {t("noBookings")}
            </p>
          )}
          {bookings.data && bookings.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">{t("bookingNumber")}</TableHead>
                  <TableHead className="text-white">{t("guest")}</TableHead>
                  <TableHead className="text-white">{t("roomsCol")}</TableHead>
                  <TableHead className="text-white">{t("dates")}</TableHead>
                  <TableHead className="text-white">{t("total")}</TableHead>
                  <TableHead className="text-white">{t("statusCol")}</TableHead>
                  <TableHead className="text-white">{t("payment")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.data.items.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">{booking.booking_number}</TableCell>
                    <TableCell>{booking.primary_guest_name ?? "—"}</TableCell>
                    <TableCell>
                      {booking.rooms.map((r) => r.room_number).join(", ")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtApiDate(booking.check_in_date)} → {fmtApiDate(booking.check_out_date)}
                    </TableCell>
                    <TableCell className="tabular-nums">{fmtINR(booking.total_amount)}</TableCell>
                    <TableCell>
                      <BookingStatusBadge status={booking.status} />
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={booking.payment_status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {bookings.data && bookings.data.total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, bookings.data.total)} of{" "}
              {bookings.data.total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE_SIZE >= bookings.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default function CompletedBookingsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.bookingsView}>
      {/* Suspense is required by Next.js App Router for useSearchParams() */}
      <Suspense fallback={<div className="flex-1 p-6"><Skeleton className="h-10 w-full" /></div>}>
        <CompletedBookingsContent />
      </Suspense>
    </RequirePermission>
  );
}
