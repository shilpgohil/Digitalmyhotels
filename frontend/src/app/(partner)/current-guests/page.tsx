"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MoreVertical,
  ArrowLeftRight,
  LogOut,
  Eye,
  Pencil,
  Printer,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { PaymentStatusBadge } from "@/components/stay/booking-badges";
import { StatusBadge, ROOM_STATUS_TONE } from "@/components/feedback/status-badge";
import { fmtDateTime, fmtDate, fmtApiDate, fmtINR } from "@/lib/formatting";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { ApiError } from "@/lib/api/client";
import { API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import type { ListOut, RoomOut } from "@/types/hotel";
import type { BookingGuestDocOut, BookingGuestOut, BookingOut, CurrentGuestOut, GuestOut } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";

/** `DD/MM/YYYY` plus `, HH:MM` when a time is present (no dangling comma). */
function fmtApiDateTime(date: string, time?: string | null): string {
  return time ? `${fmtApiDate(date)}, ${time}` : fmtApiDate(date);
}

/**
 * Whether the expected checkout moment (local time) is already past.
 * Missing time falls back to 23:59 so guests aren't flagged early.
 */
function isCheckoutOverdue(date: string, time?: string | null): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "23:59").split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime() < Date.now();
}

/** Client-side page size for the current-guests table (figma pagination footer). */
const PAGE_SIZE = 10;

/**
 * Compact room-status labels for the dense Current Guests table.
 * Full labels ("Inspection Required" = 19 chars) force the Room Status
 * column too wide; these table-context short forms keep columns tight.
 * Missing keys fall back to the full i18n label.
 */
const COMPACT_ROOM_STATUS: Record<string, string> = {
  cleaning_required: "Cleaning",
  cleaning_in_progress: "Cleaning",
  inspection_required: "Inspection",
  clean_ready: "Ready",
  out_of_service: "Out of service",
};

/** Day use (same check-in/out date) with both times known. */
function isDayUseWithTimes(b: BookingOut): boolean {
  return (
    b.check_in_date === b.check_out_date && !!b.check_in_time && !!b.check_out_time
  );
}

function CurrentGuestsContent() {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const tr = useTranslations("rooms");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const router = useRouter();
  const [transferTarget, setTransferTarget] = useState<CurrentGuestOut | null>(null);
  const [viewTarget, setViewTarget] = useState<CurrentGuestOut | null>(null);
  const [editTarget, setEditTarget] = useState<CurrentGuestOut | null>(null);
  // When set, the stay-detail dialog auto-triggers the registration print as
  // soon as the booking detail loads (row "Print" action).
  const [autoPrint, setAutoPrint] = useState(false);

  const guests = useQuery({
    queryKey: ["current-guests", activeHotelId, search],
    queryFn: () =>
      api<ListOut<CurrentGuestOut>>(
        `/api/v1/current-guests?limit=200${search ? `&q=${encodeURIComponent(search)}` : ""}`,
      ),
    enabled: !!activeHotelId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Client-side pagination over the (already search-filtered) full list.
  const allItems = guests.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = allItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

  return (
    <>
      <PartnerHeader title={t("currentGuestsTitle")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <FilterBar
          className="mb-4"
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder={tb("searchPlaceholder")}
        />
        <DataTable
          darkHeader
          isLoading={guests.isLoading}
          isError={guests.isError}
          errorMessage={guests.error instanceof ApiError ? guests.error.message : tc("error")}
          onRetry={() => guests.refetch()}
          isEmpty={guests.data?.items.length === 0}
          emptyTitle={t("noCurrentGuests")}
          columns={[
            tb("bookingNumber"), tb("guest"), t("mobile"), tb("roomsCol"),
            t("roomStatus"), t("checkedInAt"), t("expectedCheckout"),
            tb("payment"), tb("due"), tc("actions"),
          ]}
          rightAlignCols={[9]}
        >
          {/* NOTE: no <TableBody> here — DataTable already wraps children in
              one. Nesting <tbody> inside <tbody> is invalid HTML and breaks
              the table column layout (rows detach from header columns). */}
          {guests.data && guests.data.items.length > 0 &&
                pageItems.map((entry) => (
                  <TableRow key={entry.booking_id}>
                    <TableCell className="font-medium whitespace-nowrap">{entry.booking_number}</TableCell>
                    <TableCell className="max-w-[150px]">
                      <span className="block truncate font-medium">{entry.primary_guest_name}</span>
                      {entry.guest_count > 1 && (
                        <span className="text-xs text-muted-foreground">
                          +{entry.guest_count - 1}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap text-xs">
                      {entry.primary_guest_phone ||
                        entry.primary_guest_phone_masked ||
                        "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {entry.rooms.map((room) => (
                          <span
                            key={room}
                            className="inline-flex rounded-full bg-info-bg px-2 py-0.5 text-xs font-medium text-info"
                          >
                            {room}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const statuses = Array.from(
                          new Set((entry.room_statuses ?? []).filter(Boolean)),
                        );
                        if (statuses.length === 0) return "—";
                        return (
                          <div className="flex flex-wrap gap-1">
                            {statuses.map((status) => (
                              <StatusBadge
                                key={status}
                                tone={ROOM_STATUS_TONE[status] ?? "neutral"}
                              >
                                {COMPACT_ROOM_STATUS[status] ?? tr(`status_${status}`)}
                              </StatusBadge>
                            ))}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                      {fmtDateTime(entry.checked_in_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <span className="whitespace-nowrap">
                        {fmtDate(entry.check_out_date)}
                        {entry.check_out_time ? `, ${entry.check_out_time}` : ""}
                      </span>
                      {isCheckoutOverdue(entry.check_out_date, entry.check_out_time) && (
                        <StatusBadge tone="danger" className="mt-0.5 block w-fit">
                          {t("overdue")}
                        </StatusBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={entry.payment_status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{fmtINR(entry.due_amount)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                          aria-label={tc("actions")}
                        >
                          <MoreVertical className="size-4" aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-48 whitespace-nowrap">
                          <DropdownMenuItem
                            onClick={() => {
                              setAutoPrint(false);
                              setViewTarget(entry);
                            }}
                          >
                            <Eye className="size-4" aria-hidden />
                            {tc("view")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setAutoPrint(true);
                              setViewTarget(entry);
                            }}
                          >
                            <Printer className="size-4" aria-hidden />
                            {t("printAction")}
                          </DropdownMenuItem>
                          {can(PERMISSIONS.bookingsManage) && (
                            <DropdownMenuItem onClick={() => setEditTarget(entry)}>
                              <Pencil className="size-4" aria-hidden />
                              {t("editStay")}
                            </DropdownMenuItem>
                          )}
                          {can(PERMISSIONS.roomTransfer) && (
                            <DropdownMenuItem onClick={() => setTransferTarget(entry)}>
                              <ArrowLeftRight className="size-4" aria-hidden />
                              {t("roomTransfer")}
                            </DropdownMenuItem>
                          )}
                          {can(PERMISSIONS.checkout) && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                router.push(`/checkout?booking=${entry.booking_id}`)
                              }
                            >
                              <LogOut className="size-4" aria-hidden />
                              {t("checkOutAction")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
        </DataTable>
        {guests.data && allItems.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {t("showingActiveGuests", {
                shown: pageItems.length,
                total: allItems.length,
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  {tc("previous")}
                </Button>
                <span className="text-sm tabular-nums">
                  {tc("page")} {currentPage}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  {tc("next")}
                </Button>
              </div>
            </div>
          )}

        <StayDetailDialog
          entry={viewTarget}
          autoPrint={autoPrint}
          onClose={() => {
            setViewTarget(null);
            setAutoPrint(false);
          }}
        />
        <EditStayDialog
          entry={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={invalidate}
        />
        <TransferDialog
          entry={transferTarget}
          onClose={() => setTransferTarget(null)}
          onDone={invalidate}
        />
      </main>
    </>
  );
}

function StayDetailDialog({
  entry,
  autoPrint = false,
  onClose,
}: {
  entry: CurrentGuestOut | null;
  /** Trigger the registration print automatically once the detail loads. */
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tc = useTranslations("common");
  const tm = useTranslations("money");
  const api = useApi();
  const { activeHotelId } = useAuth();

  const booking = useQuery({
    queryKey: ["booking", entry?.booking_id, "detail"],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${entry?.booking_id}`),
    enabled: !!entry,
  });

  // Registered guests with ID documents (full identity view).
  const registeredGuests = useQuery({
    queryKey: ["booking-guests", entry?.booking_id, "stay-dialog"],
    queryFn: () => api<BookingGuestOut[]>(`/api/v1/bookings/${entry?.booking_id}/guests`),
    enabled: !!entry,
  });

  // Latest completed payment → the payment MODE for display (client asked for
  // "Payment Mode: UPI", not just the paid/partial status).
  const payments = useQuery({
    queryKey: ["payments", entry?.booking_id, "stay-dialog"],
    queryFn: () =>
      api<{
        items: {
          method: string;
          status: string;
          amount: string;
          purpose: string;
          created_at: string;
        }[];
      }>(`/api/v1/payments?booking_id=${entry?.booking_id}&limit=50`),
    enabled: !!entry,
  });
  const latestMethod =
    payments.data?.items?.find((p) => p.status === "completed")?.method ??
    payments.data?.items?.[0]?.method;
  const methodLabel = (m: string): string => {
    const keys: Record<string, string> = {
      cash: "cash",
      upi: "upi",
      card: "card",
      credit_card: "creditCard",
      debit_card: "debitCard",
      bank_transfer: "bankTransfer",
      other: "otherMethod",
    };
    return keys[m] ? tm(keys[m]) : m;
  };

  const printRegistration = useCallback(() => {
    const b = booking.data;
    if (!b || !entry) return;
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    const rooms = b.rooms
      .filter((r) => r.is_current)
      .map((r) => `${r.room_number} (${r.room_type_name})`)
      .join(", ");

    // Payment history block — every completed payment with date/purpose/
    // method/amount, plus a Total Paid row (client 09/2026: the card needed
    // "more details about each payment").
    const payList = (payments.data?.items ?? []).filter(
      (p) => p.status === "completed",
    );
    const totalPaid = payList.reduce(
      (sum, p) => sum + (Number.parseFloat(p.amount) || 0),
      0,
    );
    // Purpose enum → readable label (money.purpose_* i18n keys).
    const purposeLabel = (purpose: string): string => {
      const known = ["advance", "stay", "deposit", "charge", "other"];
      return known.includes(purpose) ? tm(`purpose_${purpose}`) : purpose;
    };
    const paymentRows = payList
      .map(
        (p) => `<tr>
          <td>${new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
          <td>${purposeLabel(p.purpose)}</td>
          <td>${methodLabel(p.method)}</td>
          <td style="text-align:right">${fmtINR(p.amount)}</td>
        </tr>`,
      )
      .join("");
    const paymentsBlock = payList.length
      ? `<h2 style="font-size:15px;margin-top:24px">${t("paymentHistory")}</h2>
        <table>
          <tr>
            <td style="color:#666">${tb("dates")}</td>
            <td style="color:#666">${tm("purpose")}</td>
            <td style="color:#666">${tm("method")}</td>
            <td style="color:#666;text-align:right">${tm("amount")}</td>
          </tr>
          ${paymentRows}
          <tr>
            <td colspan="3" style="font-weight:bold">${t("totalPaid")}</td>
            <td style="font-weight:bold;text-align:right">${fmtINR(totalPaid)}</td>
          </tr>
        </table>`
      : `<p style="font-size:12px;color:#666;margin-top:16px">${t("noPaymentsYet")}</p>`;
    win.document.write(`<!doctype html><html><head><title>${b.booking_number}</title>
      <style>
        body{font-family:Georgia,serif;margin:40px;color:#111}
        h1{font-size:20px;border-bottom:2px solid #0a1128;padding-bottom:8px}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        td{padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px}
        td:first-child{color:#666;width:220px}
        .sign{margin-top:60px;display:flex;justify-content:space-between}
        .sign div{border-top:1px solid #333;padding-top:6px;width:200px;text-align:center;font-size:12px}
      </style></head><body>
      <h1>${t("registrationCard")} — ${b.booking_number}</h1>
      <table>
        <tr><td>${tb("guest")}</td><td>${b.primary_guest_name ?? ""}</td></tr>
        ${b.primary_guest_phone ? `<tr><td>${t("contactNumber")}</td><td>${b.primary_guest_phone}</td></tr>` : ""}
        <tr><td>${tb("roomsCol")}</td><td>${rooms}</td></tr>
        ${
          isDayUseWithTimes(b)
            ? `<tr><td>${tb("dates")}</td><td>${fmtApiDate(b.check_in_date)}, ${b.check_in_time} – ${b.check_out_time}</td></tr>`
            : `<tr><td>${tb("checkinDate")}</td><td>${fmtApiDateTime(b.check_in_date, b.check_in_time)}</td></tr>
        <tr><td>${tb("checkoutDate")}</td><td>${fmtApiDateTime(b.check_out_date, b.check_out_time)}</td></tr>`
        }
        <tr><td>${tb("adults")} / ${tb("children")}</td><td>${b.adults} / ${b.children}</td></tr>
        <tr><td>${tb("total")}</td><td>${fmtINR(b.total_amount)}</td></tr>
        <tr><td>${tb("due")}</td><td>${fmtINR(b.due_amount)}</td></tr>
        ${b.emergency_contact_name ? `<tr><td>${t("emergencyContact")}</td><td>${b.emergency_contact_name} (${b.emergency_contact_relation ?? ""}) ${b.emergency_contact_phone ?? ""}</td></tr>` : ""}
        ${b.vehicle_number ? `<tr><td>${t("vehicleDetails")}</td><td>${b.vehicle_number} · ${b.vehicle_type ?? ""} · ${b.parking_slot ?? ""}</td></tr>` : ""}
        ${b.special_requests ? `<tr><td>${tb("specialRequests")}</td><td>${b.special_requests}</td></tr>` : ""}
      </table>
      ${paymentsBlock}
      <div class="sign"><div>${t("guestSignature")}</div><div>${t("frontDeskSignature")}</div></div>
      <script>window.print()</script></body></html>`);
    win.document.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.data, entry, payments.data, t, tb, tm]);

  // Row "Print" action: fire the registration print as soon as the booking
  // detail is available — once per opened entry.
  const printedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!entry) {
      printedForRef.current = null;
      return;
    }
    if (!autoPrint || !booking.data) return;
    // Wait for the payment history too — otherwise the auto-print fires with
    // an empty Payments section (client 09/2026: card printed without them).
    if (!payments.isSuccess && !payments.isError) return;
    if (printedForRef.current === entry.booking_id) return;
    printedForRef.current = entry.booking_id;
    printRegistration();
  }, [autoPrint, booking.data, entry, payments.isSuccess, payments.isError, printRegistration]);

  const b = booking.data;

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("stayDetails")} — {entry?.booking_number}
          </DialogTitle>
        </DialogHeader>
        {booking.isLoading && <Skeleton className="h-48" />}
        {b && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Detail label={tb("guest")} value={b.primary_guest_name ?? "—"} />
            <Detail
              label={t("contactNumber")}
              value={b.primary_guest_phone ?? entry?.primary_guest_phone_masked ?? "—"}
            />
            <Detail
              label={tb("roomsCol")}
              value={b.rooms
                .filter((r) => r.is_current)
                .map((r) => r.room_number)
                .join(", ")}
            />
            {isDayUseWithTimes(b) ? (
              <Detail
                label={tb("dates")}
                value={`${fmtApiDate(b.check_in_date)}, ${b.check_in_time} – ${b.check_out_time}`}
                badge={
                  isCheckoutOverdue(b.check_out_date, b.check_out_time) ? (
                    <StatusBadge tone="danger">{t("overdue")}</StatusBadge>
                  ) : null
                }
              />
            ) : (
              <>
                <Detail
                  label={tb("checkinDate")}
                  value={fmtApiDateTime(b.check_in_date, b.check_in_time)}
                />
                <Detail
                  label={tb("checkoutDate")}
                  value={fmtApiDateTime(b.check_out_date, b.check_out_time)}
                  badge={
                    isCheckoutOverdue(b.check_out_date, b.check_out_time) ? (
                      <StatusBadge tone="danger">{t("overdue")}</StatusBadge>
                    ) : null
                  }
                />
              </>
            )}
            <Detail label={`${tb("adults")} / ${tb("children")}`} value={`${b.adults} / ${b.children}`} />
            <Detail
              label={tb("payment")}
              value={
                latestMethod
                  ? `${b.payment_status} · ${methodLabel(latestMethod)}`
                  : b.payment_status
              }
            />
            <Detail label={tb("total")} value={fmtINR(b.total_amount)} />
            <Detail label={tb("due")} value={fmtINR(b.due_amount)} />
            {b.security_deposit !== "0.00" && (
              <Detail label={tb("securityDeposit")} value={fmtINR(b.security_deposit)} />
            )}
            {b.emergency_contact_name && (
              <Detail
                label={t("emergencyContact")}
                value={`${b.emergency_contact_name} · ${b.emergency_contact_phone ?? ""}`}
              />
            )}
            {b.vehicle_number && (
              <Detail
                label={t("vehicleDetails")}
                value={`${b.vehicle_number} · ${b.parking_slot ?? ""}`}
              />
            )}
            {b.special_requests && (
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {tb("specialRequests")}
                </dt>
                <dd className="mt-0.5">{b.special_requests}</dd>
              </div>
            )}
          </dl>
        )}
        {/* ── Registered Guests + ID Documents ── */}
        {registeredGuests.data && registeredGuests.data.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("registeredGuestsLabel")}
            </p>
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {registeredGuests.data.map((g) => (
                <RegisteredGuestCard key={g.guest_id} guest={g} hotelId={activeHotelId} />
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button onClick={printRegistration} disabled={!b}>
            <Printer className="size-4" aria-hidden />
            {t("printRegistration")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">
        {value}
        {badge && <span className="ml-2 inline-flex align-middle">{badge}</span>}
      </dd>
    </div>
  );
}

/** ID document thumbnail fetched with auth headers. */
function DocThumbnail({
  guestId,
  doc,
  hotelId,
}: {
  guestId: string;
  doc: BookingGuestDocOut;
  hotelId: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [url]);

  useEffect(() => {
    if (url) return;
    let cancelled = false;
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (hotelId) headers["X-Hotel-Id"] = hotelId;
    fetch(`${API_BASE}/api/v1/guests/${guestId}/documents/${doc.id}/file`, {
      headers,
      credentials: "include",
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((blob) => { if (!cancelled) setUrl(URL.createObjectURL(blob)); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, doc.id, hotelId]);

  const label = doc.side === "front" ? "Front" : doc.side === "back" ? "Back" : doc.side === "selfie" ? "Selfie" : "Doc";

  return (
    <div className="flex flex-col items-center gap-1">
      {failed ? (
        <div className="flex h-20 w-20 items-center justify-center rounded-md border bg-muted text-center text-xs text-muted-foreground">
          N/A
        </div>
      ) : url ? (
        <button
          type="button"
          title={label}
          onClick={() => window.open(url, "_blank")}
          className="overflow-hidden rounded-md border hover:opacity-80"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className="h-20 w-20 object-cover" />
        </button>
      ) : (
        <Skeleton className="h-20 w-20 rounded-md" />
      )}
      <span className="text-label text-muted-foreground">{label}</span>
    </div>
  );
}

/** Registered guest card shown in the stay-detail dialog. */
function RegisteredGuestCard({
  guest,
  hotelId,
}: {
  guest: BookingGuestOut;
  hotelId: string | null;
}) {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{guest.full_name}</span>
        {guest.is_primary && (
          <span className="rounded-full bg-gold-500 px-2 py-0.5 text-xs font-medium text-navy-900">
            {t("primaryGuestLabel")}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {guest.phone ?? guest.phone_masked}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">{tb("registrationNumber")}: </span>
          <span className="font-medium">{guest.registration_number}</span>
        </div>
        {guest.id_proof_type && (
          <div>
            <span className="text-muted-foreground">{t("idProofLabel")}: </span>
            <span className="font-medium">{guest.id_proof_type}</span>
          </div>
        )}
        {guest.address && (
          <div className="col-span-2">
            <span className="text-muted-foreground">{t("addressLabel")}: </span>
            <span>
              {guest.address}
              {(guest.city || guest.state) && `, ${[guest.city, guest.state].filter(Boolean).join(", ")}`}
            </span>
          </div>
        )}
      </div>
      {guest.documents.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {guest.documents.map((doc) => (
            <DocThumbnail key={doc.id} guestId={guest.guest_id} doc={doc} hotelId={hotelId} />
          ))}
        </div>
      )}
    </div>
  );
}

function EditStayDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: CurrentGuestOut | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("stay");
  const api = useApi();

  const booking = useQuery({
    queryKey: ["booking", entry?.booking_id, "detail"],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${entry?.booking_id}`),
    enabled: !!entry,
  });

  // Primary guest record (email / address / pincode are not on BookingOut).
  const guestId = booking.data?.primary_guest_id ?? null;
  const guest = useQuery({
    queryKey: ["guest", guestId],
    queryFn: () => api<GuestOut>(`/api/v1/guests/${guestId}`),
    enabled: !!entry && !!guestId,
  });

  // Wait for the guest record (or its failure) so the form initialises once
  // with the right values — the form is keyed and never re-seeds its state.
  const guestSettled = !guestId || !!guest.data || guest.isError;

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("editStayTitle")} — {entry?.booking_number}
          </DialogTitle>
        </DialogHeader>
        {(booking.isLoading || (!!booking.data && !guestSettled)) && (
          <Skeleton className="h-96" />
        )}
        {booking.data && entry && guestSettled && (
          <EditStayForm
            key={entry.booking_id}
            bookingId={entry.booking_id}
            booking={booking.data}
            guest={guest.data ?? null}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditStayForm({
  bookingId,
  booking,
  guest,
  onClose,
  onDone,
}: {
  bookingId: string;
  booking: BookingOut;
  /** Primary guest record, or null when it could not be loaded. */
  guest: GuestOut | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tc = useTranslations("common");
  const tk = useTranslations("checkin");
  const api = useApi();
  const queryClient = useQueryClient();

  const [checkOutDate, setCheckOutDate] = useState(booking.check_out_date);
  const [checkOutTime, setCheckOutTime] = useState(booking.check_out_time ?? "");
  const [adults, setAdults] = useState(String(booking.adults));
  const [children, setChildren] = useState(String(booking.children));
  const [guestType, setGuestType] = useState(booking.guest_type ?? "");
  const [specialRequests, setSpecialRequests] = useState(
    booking.special_requests ?? "",
  );

  // ── Emergency contact + vehicle (PATCH /api/v1/bookings/{id}) ──
  // These are the remaining booking fields the backend allows editing on an
  // in-house stay (client 09/2026: Edit Stay must be the detailed version).
  const [emName, setEmName] = useState(booking.emergency_contact_name ?? "");
  const [emRelation, setEmRelation] = useState(
    booking.emergency_contact_relation ?? "",
  );
  const [emPhone, setEmPhone] = useState(booking.emergency_contact_phone ?? "");
  const [vehNumber, setVehNumber] = useState(booking.vehicle_number ?? "");
  const [vehType, setVehType] = useState(booking.vehicle_type ?? "");
  const [parkingSlot, setParkingSlot] = useState(booking.parking_slot ?? "");

  // ── Primary guest details (PATCH /api/v1/guests/{id}) ──
  const [guestName, setGuestName] = useState(guest?.full_name ?? "");
  const [guestPhone, setGuestPhone] = useState(
    guest?.normalized_phone ?? booking.primary_guest_phone ?? "",
  );
  const [guestEmail, setGuestEmail] = useState(guest?.email ?? "");
  const [guestAddress, setGuestAddress] = useState(guest?.address ?? "");
  const [guestPincode, setGuestPincode] = useState(guest?.postal_code ?? "");
  const [guestCity, setGuestCity] = useState(guest?.city ?? "");
  const [guestState, setGuestState] = useState(guest?.state ?? "");
  const [guestCountry, setGuestCountry] = useState(guest?.country ?? "India");
  const [guestGender, setGuestGender] = useState(guest?.gender ?? "");
  const [guestDob, setGuestDob] = useState(guest?.date_of_birth ?? "");
  const [guestIdProof, setGuestIdProof] = useState(guest?.id_proof_type ?? "");

  const mutation = useMutation({
    mutationFn: async ({
      bookingPatch,
      guestPatch,
    }: {
      bookingPatch: Record<string, unknown>;
      guestPatch: Record<string, unknown>;
    }) => {
      // Guest first so a guest validation error stops before the booking PATCH.
      if (guest && Object.keys(guestPatch).length > 0) {
        await api(`/api/v1/guests/${guest.id}`, { method: "PATCH", body: guestPatch });
      }
      if (Object.keys(bookingPatch).length > 0) {
        await api(`/api/v1/bookings/${bookingId}`, { method: "PATCH", body: bookingPatch });
      }
    },
    onSuccess: () => {
      toast.success(t("stayUpdatedToast"));
      // Refresh the cached booking detail (primary guest name/phone) + guest.
      queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      if (guest) queryClient.invalidateQueries({ queryKey: ["guest", guest.id] });
      onClose();
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    if (checkOutDate !== booking.check_out_date) {
      patch.check_out_date = checkOutDate;
    }
    if (checkOutTime && checkOutTime !== (booking.check_out_time ?? "")) {
      patch.check_out_time = checkOutTime;
    }
    const nAdults = Number(adults);
    const nChildren = Number(children);
    if (Number.isInteger(nAdults) && nAdults >= 1 && nAdults !== booking.adults) {
      patch.adults = nAdults;
    }
    if (
      Number.isInteger(nChildren) &&
      nChildren >= 0 &&
      nChildren !== booking.children
    ) {
      patch.children = nChildren;
    }
    const requests = specialRequests.trim();
    if (requests !== (booking.special_requests ?? "")) {
      patch.special_requests = requests || null;
    }
    if (guestType && guestType !== (booking.guest_type ?? "")) {
      patch.guest_type = guestType;
    }

    // Emergency contact + vehicle — diff-based, null clears a field.
    const diffField = (key: string, next: string, prev: string | null) => {
      const trimmed = next.trim();
      if (trimmed !== (prev ?? "")) patch[key] = trimmed || null;
    };
    diffField("emergency_contact_name", emName, booking.emergency_contact_name);
    diffField(
      "emergency_contact_relation",
      emRelation,
      booking.emergency_contact_relation,
    );
    diffField("emergency_contact_phone", emPhone, booking.emergency_contact_phone);
    diffField("vehicle_number", vehNumber, booking.vehicle_number);
    diffField("vehicle_type", vehType, booking.vehicle_type);
    diffField("parking_slot", parkingSlot, booking.parking_slot);

    // Only changed guest fields are sent (GuestUpdate uses exclude_unset).
    const guestPatch: Record<string, unknown> = {};
    if (guest) {
      const name = guestName.trim();
      if (name && name !== guest.full_name) guestPatch.full_name = name;
      const phone = guestPhone.trim();
      if (phone && phone !== guest.normalized_phone) guestPatch.phone = phone;
      const email = guestEmail.trim();
      if (email !== (guest.email ?? "")) guestPatch.email = email || null;
      const address = guestAddress.trim();
      if (address !== (guest.address ?? "")) guestPatch.address = address || null;
      const pincode = guestPincode.trim();
      if (pincode !== (guest.postal_code ?? "")) {
        guestPatch.postal_code = pincode || null;
      }
      const city = guestCity.trim();
      if (city !== (guest.city ?? "")) guestPatch.city = city || null;
      const state = guestState.trim();
      if (state !== (guest.state ?? "")) guestPatch.state = state || null;
      const country = guestCountry.trim();
      if (country !== (guest.country ?? "")) guestPatch.country = country || null;
      if (guestGender !== (guest.gender ?? "")) {
        guestPatch.gender = guestGender || null;
      }
      if (guestDob !== (guest.date_of_birth ?? "")) {
        guestPatch.date_of_birth = guestDob || null;
      }
      if (guestIdProof !== (guest.id_proof_type ?? "")) {
        guestPatch.id_proof_type = guestIdProof || null;
      }
    }

    if (Object.keys(patch).length === 0 && Object.keys(guestPatch).length === 0) {
      onClose();
      return;
    }
    mutation.mutate({ bookingPatch: patch, guestPatch });
  };

  const currentRooms = booking.rooms.filter((r) => r.is_current);

  return (
    <form className="space-y-4" onSubmit={submit}>
      {/* ── Read-only stay summary: rooms, rates and money ── */}
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="mb-1.5 text-label font-semibold uppercase tracking-wide text-muted-foreground">
          {tb("roomsCol")}
        </p>
        <ul className="space-y-0.5">
          {currentRooms.map((r) => (
            <li key={r.room_number} className="flex justify-between">
              <span>
                {r.room_number} ({r.room_type_name})
              </span>
              <span className="tabular-nums text-muted-foreground">
                {fmtINR(r.rate)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 grid grid-cols-3 gap-2 border-t pt-2">
          <div>
            <p className="text-label text-muted-foreground">{tb("total")}</p>
            <p className="font-semibold tabular-nums">{fmtINR(booking.total_amount)}</p>
          </div>
          <div>
            <p className="text-label text-muted-foreground">{tb("advance")}</p>
            <p className="font-semibold tabular-nums">{fmtINR(booking.advance_amount)}</p>
          </div>
          <div>
            <p className="text-label text-muted-foreground">{tb("due")}</p>
            <p className="font-semibold tabular-nums">{fmtINR(booking.due_amount)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Check-in is read-only: the guest is already in-house. */}
        <div className="space-y-1.5">
          <Label>{tb("checkinDate")}</Label>
          <p className="flex h-9 items-center rounded-lg border border-input bg-muted px-2.5 text-sm text-muted-foreground">
            {fmtApiDateTime(booking.check_in_date, booking.check_in_time)}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-checkout">{tb("checkoutDate")}</Label>
          <DateTimePicker
            id="es-checkout"
            dateValue={checkOutDate}
            timeValue={checkOutTime}
            onDateChange={setCheckOutDate}
            onTimeChange={setCheckOutTime}
            min={booking.check_in_date}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-adults">{tb("adults")}</Label>
          <Input
            id="es-adults"
            type="number"
            min={1}
            required
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-children">{tb("children")}</Label>
          <Input
            id="es-children"
            type="number"
            min={0}
            required
            value={children}
            onChange={(e) => setChildren(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-guest-type">{tk("guestTypeLabel")}</Label>
          <select
            id="es-guest-type"
            className="h-[42px] w-full rounded-md border border-input bg-white px-2.5 text-sm"
            value={guestType}
            onChange={(e) => setGuestType(e.target.value)}
          >
            <option value="">—</option>
            {(["business", "personal", "family", "group", "other"] as const).map(
              (gt) => (
                <option key={gt} value={gt}>
                  {tk(`guestType_${gt}`)}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="col-span-full space-y-1.5">
          <Label htmlFor="es-requests">{tb("specialRequests")}</Label>
          <Textarea
            id="es-requests"
            maxLength={2000}
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
          />
        </div>
      </div>

      {/* ── Emergency contact ── */}
      <div className="space-y-3 border-t pt-3">
        <p className="text-sm font-semibold">{t("emergencyContact")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="es-em-name">{t("contactName")}</Label>
            <Input
              id="es-em-name"
              maxLength={200}
              value={emName}
              onChange={(e) => setEmName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-em-relation">{t("contactRelation")}</Label>
            <Input
              id="es-em-relation"
              maxLength={100}
              value={emRelation}
              onChange={(e) => setEmRelation(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-em-phone">{t("contactPhone")}</Label>
            <Input
              id="es-em-phone"
              type="tel"
              maxLength={32}
              value={emPhone}
              onChange={(e) => setEmPhone(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Vehicle & parking ── */}
      <div className="space-y-3 border-t pt-3">
        <p className="text-sm font-semibold">{t("vehicleDetails")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="es-veh-number">{t("vehicleNumber")}</Label>
            <Input
              id="es-veh-number"
              maxLength={32}
              value={vehNumber}
              onChange={(e) => setVehNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-veh-type">{t("vehicleType")}</Label>
            <Input
              id="es-veh-type"
              maxLength={40}
              value={vehType}
              onChange={(e) => setVehType(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-parking">{t("parkingSlot")}</Label>
            <Input
              id="es-parking"
              maxLength={40}
              value={parkingSlot}
              onChange={(e) => setParkingSlot(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Primary guest details (only when the guest record loaded) ── */}
      {guest && (
        <div className="space-y-3 border-t pt-3">
          <p className="text-sm font-semibold">{t("guestDetails")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-name">{t("guestName")}</Label>
              <Input
                id="es-guest-name"
                required
                minLength={2}
                maxLength={200}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-phone">{t("guestPhone")}</Label>
              <Input
                id="es-guest-phone"
                type="tel"
                required
                minLength={7}
                maxLength={20}
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-email">{t("guestEmail")}</Label>
              <Input
                id="es-guest-email"
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-pincode">{t("guestPincode")}</Label>
              <Input
                id="es-guest-pincode"
                inputMode="numeric"
                maxLength={32}
                value={guestPincode}
                onChange={(e) => setGuestPincode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-city">{t("guestCity")}</Label>
              <Input
                id="es-guest-city"
                value={guestCity}
                onChange={(e) => setGuestCity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-state">{t("guestState")}</Label>
              <Input
                id="es-guest-state"
                value={guestState}
                onChange={(e) => setGuestState(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-country">{t("guestCountry")}</Label>
              <Input
                id="es-guest-country"
                value={guestCountry}
                onChange={(e) => setGuestCountry(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-gender">{tk("fieldGender")}</Label>
              <select
                id="es-guest-gender"
                className="h-[42px] w-full rounded-md border border-input bg-white px-2.5 text-sm"
                value={guestGender}
                onChange={(e) => setGuestGender(e.target.value)}
              >
                <option value="">—</option>
                <option value="Male">{tk("male")}</option>
                <option value="Female">{tk("female")}</option>
                <option value="Other">{tk("genderOther")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-dob">{tk("fieldDob")}</Label>
              <Input
                id="es-guest-dob"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={guestDob}
                onChange={(e) => setGuestDob(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-guest-idproof">{tb("idProofType")}</Label>
              <select
                id="es-guest-idproof"
                className="h-[42px] w-full rounded-md border border-input bg-white px-2.5 text-sm"
                value={guestIdProof}
                onChange={(e) => setGuestIdProof(e.target.value)}
              >
                <option value="">—</option>
                {[
                  "Aadhar Card",
                  "PAN Card",
                  "Passport",
                  "Driving License",
                  "Voter ID",
                  "Other",
                ].map((it) => (
                  <option key={it} value={it}>
                    {it}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-full space-y-1.5">
              <Label htmlFor="es-guest-address">{t("guestAddress")}</Label>
              <Textarea
                id="es-guest-address"
                maxLength={2000}
                value={guestAddress}
                onChange={(e) => setGuestAddress(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
      <DialogFooter>
        <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
          {tc("cancel")}
        </DialogClose>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? tc("saving") : tc("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TransferDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: CurrentGuestOut | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("stay");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const booking = useQuery({
    queryKey: ["booking", entry?.booking_id],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${entry?.booking_id}`),
    enabled: !!entry,
  });
  const rooms = useQuery({
    queryKey: ["rooms", activeHotelId, "for-transfer"],
    queryFn: () => api<ListOut<RoomOut>>("/api/v1/rooms?limit=200"),
    enabled: !!entry,
  });

  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      api("/api/v1/room-transfers", {
        method: "POST",
        body: {
          booking_id: entry?.booking_id,
          from_room_id: String(form.get("from_room_id")),
          to_room_id: String(form.get("to_room_id")),
          reason: String(form.get("reason") || "").trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("transferredToast"));
      setError(null);
      onClose();
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  const currentRooms = (booking.data?.rooms ?? []).filter((r) => r.is_current);
  const targetRooms = (rooms.data?.items ?? []).filter((room) =>
    ["available", "clean_ready"].includes(room.status),
  );

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("roomTransfer")} — {entry?.booking_number}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tr-from">{t("fromRoom")}</Label>
              <select
                id="tr-from"
                name="from_room_id"
                required
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                {currentRooms.map((room) => (
                  <option key={room.room_id} value={room.room_id}>
                    {room.room_number} — {room.room_type_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-to">{t("toRoom")}</Label>
              <select
                id="tr-to"
                name="to_room_id"
                required
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">—</option>
                {targetRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.room_number} — {room.room_type_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-full space-y-1.5">
              <Label htmlFor="tr-reason">{t("transferReason")}</Label>
              <Input id="tr-reason" name="reason" />
            </div>
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              {tc("cancel")}
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? tc("saving") : tc("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CurrentGuestsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.guestsView}>
      <CurrentGuestsContent />
    </RequirePermission>
  );
}
