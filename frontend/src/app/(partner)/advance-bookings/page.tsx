"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, MoreVertical, LogIn, XCircle, UserX } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { fmtApiDate } from "@/lib/formatting";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { ListOut } from "@/types/hotel";
import type { BookingOut } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useRouter, useSearchParams } from "next/navigation";

type StatusFilter = "all" | "pending" | "confirmed";

function AdvanceBookingsContent() {
  const t = useTranslations("bookings");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Persist filters in URL search params so refresh/back restores the view.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") ?? "");
  const [toDate, setToDate] = useState(() => searchParams.get("to") ?? "");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [cancelTarget, setCancelTarget] = useState<BookingOut | null>(null);
  const cancelConfirm = useConfirmDialog();

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
    const url = qs ? `/advance-bookings?${qs}` : "/advance-bookings";
    router.replace(url, { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, fromDate, toDate]);

  // The API accepts a single status per call, so upcoming stays
  // (pending + confirmed) are fetched with two parallel queries and merged.
  const pendingBookings = useQuery({
    queryKey: ["bookings", activeHotelId, "pending", filterQs],
    queryFn: () =>
      api<ListOut<BookingOut>>(`/api/v1/bookings?status=pending&limit=100${filterQs}`),
    enabled: !!activeHotelId && statusFilter !== "confirmed",
  });
  const confirmedBookings = useQuery({
    queryKey: ["bookings", activeHotelId, "confirmed-list", filterQs],
    queryFn: () =>
      api<ListOut<BookingOut>>(`/api/v1/bookings?status=confirmed&limit=100${filterQs}`),
    enabled: !!activeHotelId && statusFilter !== "pending",
  });

  const isLoading =
    (statusFilter !== "confirmed" && pendingBookings.isLoading) ||
    (statusFilter !== "pending" && confirmedBookings.isLoading);
  const isError =
    (statusFilter !== "confirmed" && pendingBookings.isError) ||
    (statusFilter !== "pending" && confirmedBookings.isError);

  const items = useMemo(() => {
    const merged: BookingOut[] = [];
    if (statusFilter !== "confirmed" && pendingBookings.data) {
      merged.push(...pendingBookings.data.items);
    }
    if (statusFilter !== "pending" && confirmedBookings.data) {
      merged.push(...confirmedBookings.data.items);
    }
    return merged.sort((a, b) => a.check_in_date.localeCompare(b.check_in_date));
  }, [statusFilter, pendingBookings.data, confirmedBookings.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
  };

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<BookingOut>(`/api/v1/bookings/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: () => {
      toast.success(t("bookingCancelled"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const noShowMutation = useMutation({
    mutationFn: (id: string) =>
      api<BookingOut>(`/api/v1/bookings/${id}/no-show`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("markedNoShow"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const statusChips: { value: StatusFilter; label: string }[] = [
    { value: "all", label: t("statusAll") },
    { value: "pending", label: t("status_pending") },
    { value: "confirmed", label: t("status_confirmed") },
  ];

  return (
    <>
      <PartnerHeader title={t("advanceBookingsTitle")} subtitle={tn("frontDesk")} />
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
              onChange={setFromDate}
            />
            <DateInput
              className="w-40"
              aria-label={t("checkoutDate")}
              value={toDate}
              onChange={setToDate}
            />
          </div>
          <button
            type="button"
            onClick={() => router.push("/advance-booking")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gold-500 px-2.5 text-sm font-medium text-navy-900 hover:bg-gold-400"
          >
            <Plus className="size-4" aria-hidden />
            {t("newBooking")}
          </button>

          <ConfirmDialog
            open={cancelConfirm.open}
            title={t("cancelBooking")}
            message={cancelTarget ? `${cancelTarget.booking_number} — ${cancelTarget.primary_guest_name ?? ""}` : undefined}
            requireText
            textLabel={t("cancelReason")}
            textPlaceholder={t("cancelReason")}
            confirmLabel={t("cancelBooking")}
            confirmVariant="destructive"
            isPending={cancelMutation.isPending}
            onConfirm={(reason) => {
              if (cancelTarget) {
                cancelMutation.mutate({ id: cancelTarget.id, reason });
                cancelConfirm.hide();
                setCancelTarget(null);
              }
            }}
            onCancel={() => {
              cancelConfirm.hide();
              setCancelTarget(null);
            }}
          />
        </div>

        {/* Status filter chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          {statusChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setStatusFilter(chip.value)}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-colors",
                statusFilter === chip.value
                  ? "border-navy-900 bg-navy-900 font-medium text-white"
                  : "border-border text-muted-foreground hover:border-navy-900 hover:text-navy-900",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="rounded-lg border bg-card">
          {isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {!isLoading && isError && (
            <div className="p-8 text-center text-sm text-danger">
              {tc("error")}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  pendingBookings.refetch();
                  confirmedBookings.refetch();
                }}
              >
                {tc("retry")}
              </button>
            </div>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {t("noBookings")}
            </p>
          )}
          {!isLoading && !isError && items.length > 0 && (
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
                  <TableHead className="text-right text-white">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">{booking.booking_number}</TableCell>
                    <TableCell>{booking.primary_guest_name ?? "—"}</TableCell>
                    <TableCell>
                      {booking.rooms
                        .filter((r) => r.is_current)
                        .map((r) => r.room_number)
                        .join(", ")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtApiDate(booking.check_in_date)} → {fmtApiDate(booking.check_out_date)}
                    </TableCell>
                    <TableCell className="tabular-nums">₹{booking.total_amount}</TableCell>
                    <TableCell>
                      <BookingStatusBadge status={booking.status} />
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={booking.payment_status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {(booking.status === "pending" || booking.status === "confirmed") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                            aria-label={tc("actions")}
                          >
                            <MoreVertical className="size-4" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {booking.status === "confirmed" && (
                              <DropdownMenuItem
                                onClick={() => router.push(`/checkin?booking=${booking.id}`)}
                              >
                                <LogIn className="size-4" aria-hidden />
                                {t("checkInAction")}
                              </DropdownMenuItem>
                            )}
                            {booking.status === "confirmed" && (
                              <DropdownMenuItem
                                onClick={() => noShowMutation.mutate(booking.id)}
                              >
                                <UserX className="size-4" aria-hidden />
                                {t("markNoShow")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                setCancelTarget(booking);
                                cancelConfirm.show();
                              }}
                            >
                              <XCircle className="size-4" aria-hidden />
                              {t("cancelBooking")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </main>
    </>
  );
}

export default function AdvanceBookingsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.bookingsView}>
      {/* Suspense is required by Next.js App Router for useSearchParams() */}
      <Suspense fallback={<div className="flex-1 p-6"><Skeleton className="h-10 w-full" /></div>}>
        <AdvanceBookingsContent />
      </Suspense>
    </RequirePermission>
  );
}
