"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BookingStatusBadge,
  PaymentStatusBadge,
} from "@/components/stay/booking-badges";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { Eye } from "lucide-react";
import type { ListOut } from "@/types/hotel";
import type { BookingGuestDocOut, BookingGuestOut, BookingOut } from "@/types/stay";
import type { ChargeOut, PaymentOut } from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { useRouter, useSearchParams } from "next/navigation";

type CompletedStatus = "checked_out" | "cancelled" | "no_show";
type QuickRange = "all" | "today" | "last5" | "month" | "year";

const PAGE_SIZE = 50;

/** `DD/MM/YYYY` plus `, HH:MM` when a time is present (no dangling comma). */
function fmtApiDateTime(date: string, time?: string | null): string {
  return time ? `${fmtApiDate(date)}, ${time}` : fmtApiDate(date);
}

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

/** "aadhaar" / "Aadhar Card" → readable label. */
function humanizeIdProof(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * ID document thumbnail. The file endpoint requires Authorization + X-Hotel-Id
 * headers, so a plain <img src> cannot be used — fetch as a blob and render an
 * object URL (same pattern as the check-in page), revoking it on unmount.
 */
function DocThumbnail({ guestId, doc }: { guestId: string; doc: BookingGuestDocOut }) {
  const t = useTranslations("bookings");
  const { activeHotelId } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Clean up blob URL when it is replaced or the component unmounts.
  useEffect(() => {
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [url]);

  useEffect(() => {
    if (url) return;
    let cancelled = false;
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
    fetch(`${API_BASE}/api/v1/guests/${guestId}/documents/${doc.id}/file`, {
      headers,
      credentials: "include",
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((blob) => { if (!cancelled) setUrl(URL.createObjectURL(blob)); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, doc.id, activeHotelId]);

  const sideLabel =
    doc.side === "front"
      ? t("docFront")
      : doc.side === "back"
        ? t("docBack")
        : doc.side === "selfie"
          ? t("docSelfie")
          : t("docOther");

  return (
    <div className="flex w-24 flex-col items-center gap-1">
      {failed ? (
        <div className="flex h-24 w-24 items-center justify-center rounded-md border bg-muted p-1 text-center text-xs text-muted-foreground">
          {t("docLoadFailed")}
        </div>
      ) : url ? (
        <button
          type="button"
          title={t("openFullImage")}
          onClick={() => window.open(url, "_blank")}
          className="overflow-hidden rounded-md border transition-opacity hover:opacity-80"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- blob object URL, next/image not applicable */}
          <img src={url} alt={sideLabel} className="h-24 w-24 object-cover" />
        </button>
      ) : (
        <Skeleton className="h-24 w-24 rounded-md" />
      )}
      <span className="text-xs text-muted-foreground">{sideLabel}</span>
    </div>
  );
}

/** One registered guest inside the detail drawer. */
function GuestCard({ guest }: { guest: BookingGuestOut }) {
  const t = useTranslations("bookings");
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{guest.full_name}</span>
        {guest.is_primary && (
          <span className="rounded-full bg-gold-500 px-2 py-0.5 text-xs font-medium text-navy-900">
            {t("primaryBadge")}
          </span>
        )}
        {/* Full contact number when the API provides it, masked otherwise. */}
        <span className="text-sm text-muted-foreground">
          {guest.phone ?? guest.phone_masked}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("registrationNumber")}</dt>
          <dd>{guest.registration_number}</dd>
        </div>
        {guest.address && (
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">{t("addressLabel")}</dt>
            <dd>
              {guest.address}
              {(guest.city || guest.state) && (
                <span className="text-muted-foreground">
                  {", "}
                  {[guest.city, guest.state, guest.country].filter(Boolean).join(", ")}
                </span>
              )}
            </dd>
          </div>
        )}
        {guest.id_proof_type && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("idProofType")}</dt>
            <dd>{humanizeIdProof(guest.id_proof_type)}</dd>
          </div>
        )}
        {guest.purpose_of_visit && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("purposeOfVisit")}</dt>
            <dd>{guest.purpose_of_visit}</dd>
          </div>
        )}
        {guest.company_name && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("companyName")}</dt>
            <dd>{guest.company_name}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("documentsLabel")}</p>
        {guest.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {guest.documents.map((doc) => (
              <DocThumbnail key={doc.id} guestId={guest.guest_id} doc={doc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Label/value row used in the booking summary section. */
function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Right-side drawer with the full booking + registered guests + ID documents. */
function BookingDetailSheet({
  bookingId,
  onClose,
}: {
  bookingId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("bookings");
  const tc = useTranslations("common");
  const tm = useTranslations("money");
  const api = useApi();
  const { activeHotelId } = useAuth();

  const booking = useQuery({
    queryKey: ["booking-detail", activeHotelId, bookingId],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${bookingId}`),
    enabled: !!activeHotelId && !!bookingId,
  });

  const guests = useQuery({
    queryKey: ["booking-guests", activeHotelId, bookingId],
    queryFn: () => api<BookingGuestOut[]>(`/api/v1/bookings/${bookingId}/guests`),
    enabled: !!activeHotelId && !!bookingId,
  });

  // Payments on this booking → "Payments" list + payment-mode summary line
  // (same pattern as the current-guests StayDetailDialog).
  const payments = useQuery({
    queryKey: ["payments", activeHotelId, bookingId, "booking-drawer"],
    queryFn: () =>
      api<{ items: PaymentOut[]; total: number }>(
        `/api/v1/payments?booking_id=${bookingId}&limit=20`,
      ),
    enabled: !!activeHotelId && !!bookingId,
  });

  // Extra charges (non-voided) added during the stay.
  const charges = useQuery({
    queryKey: ["charges", activeHotelId, bookingId, "booking-drawer"],
    queryFn: () =>
      api<{ items: ChargeOut[]; total: number }>(`/api/v1/charges?booking_id=${bookingId}`),
    enabled: !!activeHotelId && !!bookingId,
  });

  const latestMethod =
    payments.data?.items?.find((p) => p.status === "completed")?.method ??
    payments.data?.items?.[0]?.method;
  const methodLabel = (m: string): string => {
    const keys: Record<string, string> = {
      cash: "cash",
      upi: "upi",
      card: "card",
      bank_transfer: "bankTransfer",
      other: "otherMethod",
    };
    return keys[m] ? tm(keys[m]) : m;
  };

  const activeCharges = (charges.data?.items ?? []).filter((c) => !c.voided_at);
  const b = booking.data;

  return (
    <Sheet open={!!bookingId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="overflow-y-auto data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{b ? b.booking_number : t("viewDetails")}</SheetTitle>
          <SheetDescription>{t("bookingSummary")}</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          {/* ── Booking summary ── */}
          {booking.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          )}
          {booking.isError && (
            <div className="text-sm text-danger">
              {tc("error")}{" "}
              <button type="button" className="underline" onClick={() => booking.refetch()}>
                {tc("retry")}
              </button>
            </div>
          )}
          {b && (
            <div className="text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <BookingStatusBadge status={b.status} />
                <PaymentStatusBadge status={b.payment_status} />
              </div>
              <SummaryRow
                label={t("dates")}
                value={
                  <>
                    {fmtApiDateTime(b.check_in_date, b.check_in_time)} →{" "}
                    {fmtApiDateTime(b.check_out_date, b.check_out_time)}
                  </>
                }
              />
              <SummaryRow
                label={t("roomsCol")}
                value={b.rooms
                  .map((r) => `${r.room_number} · ${r.room_type_name}`)
                  .join(", ")}
              />
              <SummaryRow
                label={`${t("adults")} / ${t("children")}`}
                value={`${b.adults} / ${b.children}`}
              />
              <SummaryRow label={t("total")} value={fmtINR(b.total_amount)} />
              <SummaryRow label={t("tax")} value={fmtINR(b.tax_amount)} />
              <SummaryRow label={t("discount")} value={fmtINR(b.discount_amount)} />
              <SummaryRow label={t("advance")} value={fmtINR(b.advance_amount)} />
              <SummaryRow label={t("securityDeposit")} value={fmtINR(b.security_deposit)} />
              <SummaryRow label={t("due")} value={fmtINR(b.due_amount)} />
              {latestMethod && (
                <SummaryRow
                  label={t("paymentMode")}
                  value={`${b.payment_status} · ${methodLabel(latestMethod)}`}
                />
              )}
              {b.special_requests && (
                <SummaryRow label={t("specialRequests")} value={b.special_requests} />
              )}
              {(b.emergency_contact_name || b.emergency_contact_phone) && (
                <SummaryRow
                  label={t("emergencyContact")}
                  value={[
                    b.emergency_contact_name,
                    b.emergency_contact_relation ? `(${b.emergency_contact_relation})` : null,
                    b.emergency_contact_phone,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              )}
              {(b.vehicle_number || b.vehicle_type) && (
                <SummaryRow
                  label={t("vehicle")}
                  value={[b.vehicle_number, b.vehicle_type, b.parking_slot]
                    .filter(Boolean)
                    .join(" · ")}
                />
              )}
            </div>
          )}

          {/* ── Payments ── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("paymentsSection")}</h3>
            {payments.isLoading && <Skeleton className="h-16 w-full" />}
            {payments.data && payments.data.items.length === 0 && (
              <p className="text-sm text-muted-foreground">{tm("noPayments")}</p>
            )}
            {payments.data && payments.data.items.length > 0 && (
              <ul className="divide-y rounded-lg border text-sm">
                {payments.data.items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span>{methodLabel(p.method)}</span>
                    <span className="text-xs text-muted-foreground">{p.status}</span>
                    <span className="tabular-nums">{fmtINR(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Extra charges (non-voided) ── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("extraCharges")}</h3>
            {charges.isLoading && <Skeleton className="h-16 w-full" />}
            {charges.data && activeCharges.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("noExtraCharges")}</p>
            )}
            {activeCharges.length > 0 && (
              <ul className="divide-y rounded-lg border text-sm">
                {activeCharges.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0 truncate">{c.description}</span>
                    <span className="tabular-nums">{fmtINR(c.total_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Registered guests + ID documents ── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("registeredGuests")}</h3>
            {guests.isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            )}
            {guests.isError && (
              <div className="text-sm text-danger">
                {tc("error")}{" "}
                <button type="button" className="underline" onClick={() => guests.refetch()}>
                  {tc("retry")}
                </button>
              </div>
            )}
            {guests.data && guests.data.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("noGuests")}</p>
            )}
            {guests.data && guests.data.length > 0 && (
              <div className="space-y-3">
                {guests.data.map((guest) => (
                  <GuestCard key={guest.guest_id} guest={guest} />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
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
  // Booking id whose detail drawer is open (null = closed).
  const [viewBookingId, setViewBookingId] = useState<string | null>(null);

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
                  <TableHead className="text-white">
                    <span className="sr-only">{t("viewDetails")}</span>
                  </TableHead>
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
                      {fmtApiDateTime(booking.check_in_date, booking.check_in_time)} →{" "}
                      {fmtApiDateTime(booking.check_out_date, booking.check_out_time)}
                    </TableCell>
                    <TableCell className="tabular-nums">{fmtINR(booking.total_amount)}</TableCell>
                    <TableCell>
                      <BookingStatusBadge status={booking.status} />
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={booking.payment_status} />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("viewDetails")}
                        title={t("viewDetails")}
                        onClick={() => setViewBookingId(booking.id)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
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

        <BookingDetailSheet
          bookingId={viewBookingId}
          onClose={() => setViewBookingId(null)}
        />
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
