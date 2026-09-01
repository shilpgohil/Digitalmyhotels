"use client";

/**
 * Guest Check-out Detail — full-page checkout experience.
 *
 * Layout (client Figma "Guest Check-out Detail"):
 *  LEFT (2/3):  Find Booking → Guest & Stay Details → Additional Charges
 *  RIGHT (1/3): Settlement Summary (payment status/method, UPI QR, totals,
 *               Check Out / Print Invoice / Download PDF / Email / WhatsApp)
 *
 * Reuses the settlement engine extracted from CheckoutDialog into
 * `@/components/stay/checkout-summary` (bill calculation) plus the same API
 * patterns: POST /payments → POST /checkouts (with allow_due authorization),
 * POST /invoices + GET /invoices/{id}/pdf, GET /hotels/me/payment-qr/image.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  Download,
  FileText,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  Printer,
  QrCode,
  Search,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE, ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { RequirePermission } from "@/components/auth/require-permission";
import { fmtApiDate } from "@/lib/formatting";
import {
  activeCharges,
  computeSettlement,
  fmtMoney,
  money,
} from "@/components/stay/checkout-summary";
import type { ListOut, HotelOut } from "@/types/hotel";
import type { BookingOut, CheckOutOut, CurrentGuestOut } from "@/types/stay";
import type { ChargeOut, PaymentOut } from "@/types/money";

interface HotelQr {
  qr_available: boolean;
  payment_label: string;
}

type PayMethod = "cash" | "upi" | "card" | "bank_transfer" | "other";
type PayStatus = "pending" | "paid";

const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Net Banking" },
  { value: "other", label: "Other" },
];

/** Extra charges entered at checkout, keyed by backend charge category. */
const EXTRA_CHARGE_FIELDS = [
  { key: "restaurant", label: "Restaurant Charges", description: "Restaurant charges at checkout" },
  { key: "damage", label: "Damage Charges", description: "Damage charges at checkout" },
  { key: "other", label: "Other Charges", description: "Other charges at checkout" },
] as const;

type ExtraChargeKey = (typeof EXTRA_CHARGE_FIELDS)[number]["key"];

/** Actual nights stayed so far (check-in → now), minimum 1. */
function actualNights(checkedInAt: string): number {
  const ms = Date.now() - new Date(checkedInAt).getTime();
  return Math.max(Math.ceil(ms / 86_400_000), 1);
}

/** Normalize an Indian phone for wa.me: keep digits, ensure 91 prefix. */
function waPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return `91${digits.slice(-10)}`;
}

function CheckoutContent() {
  const t = useTranslations("stay");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  // Raw UPI ID is restricted — workers may see the QR but never the raw ID.
  const canViewUpiId = can(PERMISSIONS.hotelViewUpiId);

  // ── Selection state ────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState("");
  const [entry, setEntry] = useState<CurrentGuestOut | null>(null);

  // ── Form state ─────────────────────────────────────────────────────────
  const [lateHours, setLateHours] = useState("0");
  const [lateFee, setLateFee] = useState("0");
  const [extras, setExtras] = useState<Record<ExtraChargeKey, string>>({
    restaurant: "",
    damage: "",
    other: "",
  });
  const [payStatus, setPayStatus] = useState<PayStatus>("paid");
  const [payMethod, setPayMethod] = useState<PayMethod>("cash");
  const [dueReason, setDueReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckOutOut | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const resetForm = () => {
    setLateHours("0");
    setLateFee("0");
    setExtras({ restaurant: "", damage: "", other: "" });
    setPayStatus("paid");
    setPayMethod("cash");
    setDueReason("");
    setError(null);
    setCheckoutResult(null);
    setInvoiceId(null);
  };

  // ── Queries ────────────────────────────────────────────────────────────

  const guests = useQuery({
    queryKey: ["current-guests", activeHotelId, "for-checkout"],
    queryFn: () => api<ListOut<CurrentGuestOut>>("/api/v1/current-guests?limit=100"),
    enabled: !!activeHotelId,
  });

  const bookingQuery = useQuery({
    queryKey: ["booking-for-checkout", entry?.booking_id],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${entry!.booking_id}`),
    enabled: !!entry?.booking_id,
    staleTime: 0,
  });

  const chargesQuery = useQuery({
    queryKey: ["charges-for-checkout", entry?.booking_id],
    queryFn: () =>
      api<{ items: ChargeOut[]; total: number }>(`/api/v1/charges?booking_id=${entry!.booking_id}`),
    enabled: !!entry?.booking_id,
    staleTime: 0,
  });

  const paymentsQuery = useQuery({
    queryKey: ["payments-for-checkout", entry?.booking_id],
    queryFn: () =>
      api<{ items: PaymentOut[]; total: number }>(
        `/api/v1/payments?booking_id=${entry!.booking_id}&limit=50`,
      ),
    enabled: !!entry?.booking_id,
    staleTime: 0,
  });

  const hotelQuery = useQuery({
    queryKey: ["hotel-profile", activeHotelId],
    queryFn: () => api<HotelOut>("/api/v1/hotels/me"),
    enabled: !!activeHotelId,
    staleTime: 300_000,
  });

  const showQr = payMethod === "upi" && !!entry;

  const qrInfoQuery = useQuery({
    queryKey: ["hotel-qr-info", activeHotelId],
    queryFn: () => api<HotelQr>("/api/v1/hotels/me/payment-qr"),
    enabled: !!activeHotelId && showQr,
    staleTime: 60_000,
  });

  // UPI ID — only for roles allowed to see the raw UPI ID (owner/admin).
  const upiConfigQuery = useQuery({
    queryKey: ["hotel-payment-config", activeHotelId],
    queryFn: () =>
      api<{ upi_id: string | null; config_version: number; has_logo: boolean; qr_version: number }>(
        "/api/v1/hotels/me/payment-config",
      ),
    enabled: showQr && !!activeHotelId && canViewUpiId,
    staleTime: 300_000,
  });

  // QR PNG as a blob URL (same pattern as CheckoutDialog).
  const qrImageQuery = useQuery({
    queryKey: ["hotel-qr-png", activeHotelId],
    queryFn: async () => {
      const token = getAccessToken();
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr/image`, {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "X-Hotel-Id": activeHotelId ?? "",
        },
        credentials: "include",
      });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    },
    enabled: showQr && !!activeHotelId,
    staleTime: 300_000,
  });

  // ── Settlement math ────────────────────────────────────────────────────

  const booking = bookingQuery.data;
  const charges = activeCharges(chargesQuery.data?.items);
  const lateHoursNum = parseFloat(lateHours) || 0;
  const lateFeeNum = lateHoursNum > 0 ? parseFloat(lateFee) || 0 : 0;
  const settlement = computeSettlement(booking, charges, lateFeeNum);

  // Extras entered locally — not on the booking until POSTed at checkout.
  const extrasTotal = useMemo(
    () =>
      EXTRA_CHARGE_FIELDS.reduce((sum, f) => sum + Math.max(parseFloat(extras[f.key]) || 0, 0), 0),
    [extras],
  );

  const grandTotal = settlement.finalTotal + extrasTotal;
  const pendingAmount = Math.max(grandTotal - settlement.effectivePaid, 0);
  const refundAmount = Math.max(settlement.effectivePaid - grandTotal, 0);
  const needsDueAuth = payStatus === "pending" && pendingAmount > 0;

  // ── Actions ────────────────────────────────────────────────────────────

  const loadGuest = () => {
    const found = guests.data?.items.find((g) => g.booking_id === selectedId) ?? null;
    resetForm();
    setEntry(found);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No booking loaded");

      // 1. Post additional charges entered at checkout (before settlement).
      for (const field of EXTRA_CHARGE_FIELDS) {
        const amount = parseFloat(extras[field.key]) || 0;
        if (amount > 0) {
          await api("/api/v1/charges", {
            method: "POST",
            body: {
              booking_id: entry.booking_id,
              category: field.key,
              description: field.description,
              quantity: 1,
              rate: amount.toFixed(2),
              apply_gst: false,
            },
          });
        }
      }

      // 2. Collect the pending payment if staff marked it as paid.
      //    (grandTotal already includes the extras posted above.)
      if (payStatus === "paid" && pendingAmount > 0) {
        await api("/api/v1/payments", {
          method: "POST",
          body: {
            booking_id: entry.booking_id,
            amount: pendingAmount.toFixed(2),
            method: payMethod,
            purpose: "stay",
          },
        });
      }

      // 3. Check out — authorize outstanding balance when left pending.
      return api<CheckOutOut>("/api/v1/checkouts", {
        method: "POST",
        body: {
          booking_id: entry.booking_id,
          is_late: lateHoursNum > 0,
          late_fee: lateFeeNum.toFixed(2),
          allow_due: needsDueAuth,
          due_reason: needsDueAuth ? dueReason.trim() : null,
        },
      });
    },
    onSuccess: (result) => {
      setCheckoutResult(result);
      setError(null);
      invalidate();
      toast.success("Guest checked out");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Checkout failed"),
  });

  const handleCheckout = () => {
    setError(null);
    if (needsDueAuth && !dueReason.trim()) {
      setError("A reason is required to check out with an outstanding balance.");
      return;
    }
    checkoutMutation.mutate();
  };

  /** Generate the invoice once (after checkout) and cache its id. */
  const ensureInvoice = async (): Promise<string | null> => {
    if (!checkoutResult) return null;
    if (invoiceId) return invoiceId;
    setInvoiceBusy(true);
    try {
      const inv = await api<{ id: string }>("/api/v1/invoices", {
        method: "POST",
        body: { booking_id: checkoutResult.booking_id, interstate: false },
      });
      setInvoiceId(inv.id);
      toast.success("Invoice generated");
      return inv.id;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Invoice generation failed");
      return null;
    } finally {
      setInvoiceBusy(false);
    }
  };

  const fetchInvoicePdf = async (id: string): Promise<string | null> => {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE}/api/v1/invoices/${id}/pdf`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "X-Hotel-Id": activeHotelId ?? "",
      },
      credentials: "include",
    });
    if (!res.ok) {
      toast.error(tc("error"));
      return null;
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  };

  const printInvoice = async () => {
    const id = await ensureInvoice();
    if (!id) return;
    const url = await fetchInvoicePdf(id);
    if (url) window.open(url, "_blank");
  };

  const downloadPdf = async () => {
    const id = await ensureInvoice();
    if (!id) return;
    const url = await fetchInvoicePdf(id);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${entry?.booking_number ?? id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openWhatsApp = () => {
    const phone = booking?.primary_guest_phone;
    if (!phone) {
      toast.error("Guest phone number not available");
      return;
    }
    const total = checkoutResult ? money(checkoutResult.final_total) : grandTotal;
    const text = [
      `Thank you for staying at ${hotelQuery.data?.name ?? "our hotel"}!`,
      `Booking: ${entry?.booking_number}`,
      `Grand Total: ${fmtMoney(total)}`,
    ].join("\n");
    window.open(
      `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const detailsLoading =
    !!entry && (bookingQuery.isLoading || chargesQuery.isLoading || paymentsQuery.isLoading);
  const isPending = checkoutMutation.isPending;
  const done = !!checkoutResult;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      <PartnerHeader title={t("checkoutTitle")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* ══ LEFT COLUMN (2/3) ══════════════════════════════════════ */}
          <div className="space-y-6 lg:col-span-2">
            {/* ── Find Booking ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="size-4 text-gold-600" aria-hidden />
                  Find Booking
                </CardTitle>
              </CardHeader>
              <CardContent>
                {guests.isLoading && <Skeleton className="h-9 w-full" />}
                {guests.isError && (
                  <p className="text-sm text-danger">
                    {tc("error")}{" "}
                    <button type="button" className="underline" onClick={() => guests.refetch()}>
                      {tc("retry")}
                    </button>
                  </p>
                )}
                {guests.data && guests.data.items.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("noCheckoutReady")}</p>
                )}
                {guests.data && guests.data.items.length > 0 && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor="co-booking">Booking</Label>
                      <select
                        id="co-booking"
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                        className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                        disabled={isPending}
                      >
                        <option value="">— Select booking —</option>
                        {guests.data.items.map((g) => (
                          <option key={g.booking_id} value={g.booking_id}>
                            {g.booking_number} — {g.primary_guest_name} (Room {g.rooms.join(", ")})
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      className="bg-navy-900 text-white hover:bg-navy-900/90"
                      onClick={loadGuest}
                      disabled={!selectedId || isPending}
                    >
                      Load Guest
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Success state (replaces detail cards after checkout) ── */}
            {done && checkoutResult && (
              <Card>
                <CardContent className="space-y-4 py-4 text-center">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100">
                    <BadgeCheck className="size-8 text-green-600" aria-hidden />
                  </div>
                  <div>
                    <p className="text-lg font-bold">Guest Checked Out</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {entry?.primary_guest_name} · {checkoutResult.booking_number}
                    </p>
                  </div>
                  <div className="rounded-xl border text-left text-sm divide-y">
                    <div className="flex justify-between px-4 py-2">
                      <span className="text-muted-foreground">Final total</span>
                      <span className="font-semibold tabular-nums">
                        {fmtMoney(money(checkoutResult.final_total))}
                      </span>
                    </div>
                    <div className="flex justify-between px-4 py-2">
                      <span className="text-muted-foreground">Paid</span>
                      <span className="font-semibold text-green-700 tabular-nums">
                        {fmtMoney(money(checkoutResult.paid_amount))}
                      </span>
                    </div>
                    {money(checkoutResult.due_amount) > 0 && (
                      <div className="flex justify-between px-4 py-2">
                        <span className="text-muted-foreground">Outstanding (authorized)</span>
                        <span className="font-semibold text-orange-600 tabular-nums">
                          {fmtMoney(money(checkoutResult.due_amount))}
                        </span>
                      </div>
                    )}
                    {money(checkoutResult.refund_amount) > 0 && (
                      <div className="flex justify-between px-4 py-2">
                        <span className="text-muted-foreground">Refund due to guest</span>
                        <span className="font-semibold text-blue-600 tabular-nums">
                          {fmtMoney(money(checkoutResult.refund_amount))}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between px-4 py-2">
                      <span className="text-muted-foreground">Room</span>
                      <span className="text-xs text-muted-foreground">Now in cleaning queue</span>
                    </div>
                  </div>
                  {invoiceId ? (
                    <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                      ✓ Invoice generated
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void ensureInvoice()}
                      disabled={invoiceBusy}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gold-400 px-4 py-2.5 text-sm font-semibold text-gold-700 transition-colors hover:bg-gold-50 disabled:opacity-50"
                    >
                      <FileText className="size-4" aria-hidden />
                      {invoiceBusy ? "Generating…" : "Generate Invoice"}
                    </button>
                  )}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      resetForm();
                      setEntry(null);
                      setSelectedId("");
                    }}
                  >
                    New Checkout
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ── Guest & Stay Details ── */}
            {!done && (
              <Card>
                <CardHeader>
                  <CardTitle>Guest &amp; Stay Details</CardTitle>
                </CardHeader>
                <CardContent>
                  {!entry && (
                    <p className="text-sm text-muted-foreground">
                      Select a booking above and click “Load Guest”.
                    </p>
                  )}
                  {detailsLoading && (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                      ))}
                    </div>
                  )}
                  {entry && !detailsLoading && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Guest Name</Label>
                        <Input value={entry.primary_guest_name} readOnly className="bg-muted/40" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Room Number(s)</Label>
                        <Input value={entry.rooms.join(", ")} readOnly className="bg-muted/40" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Actual Stay (Nights)</Label>
                        <Input
                          value={actualNights(entry.checked_in_at)}
                          readOnly
                          className="bg-muted/40 tabular-nums"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Check-in Date</Label>
                        <Input
                          value={fmtApiDate(booking?.check_in_date)}
                          readOnly
                          className="bg-muted/40"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Expected Check-out Date</Label>
                        <Input
                          value={fmtApiDate(booking?.check_out_date ?? entry.check_out_date)}
                          readOnly
                          className="bg-muted/40"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="co-late-hours">Late Checkout (Hours)</Label>
                        <Input
                          id="co-late-hours"
                          type="number"
                          min={0}
                          step="1"
                          value={lateHours}
                          onChange={(e) => setLateHours(e.target.value)}
                          className="tabular-nums"
                          disabled={isPending}
                        />
                      </div>
                      {lateHoursNum > 0 && (
                        <div className="space-y-1.5">
                          <Label htmlFor="co-late-fee">Late Checkout Fee (₹)</Label>
                          <Input
                            id="co-late-fee"
                            type="number"
                            min={0}
                            step="0.01"
                            value={lateFee}
                            onChange={(e) => setLateFee(e.target.value)}
                            className="tabular-nums"
                            disabled={isPending}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Additional Charges ── */}
            {!done && (
              <Card>
                <CardHeader>
                  <CardTitle>Additional Charges</CardTitle>
                </CardHeader>
                <CardContent>
                  {!entry ? (
                    <p className="text-sm text-muted-foreground">Load a guest to add charges.</p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-3">
                      {EXTRA_CHARGE_FIELDS.map((field) => (
                        <div key={field.key} className="space-y-1.5">
                          <Label htmlFor={`co-extra-${field.key}`}>{field.label}</Label>
                          <Input
                            id={`co-extra-${field.key}`}
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="0.00"
                            value={extras[field.key]}
                            onChange={(e) =>
                              setExtras((prev) => ({ ...prev, [field.key]: e.target.value }))
                            }
                            className="tabular-nums"
                            disabled={isPending}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ══ RIGHT COLUMN (1/3): Settlement Summary ══════════════════ */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Settlement Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!entry && (
                  <p className="text-sm text-muted-foreground">
                    Load a guest to see the settlement.
                  </p>
                )}
                {entry && detailsLoading && (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                )}
                {entry && !detailsLoading && (
                  <>
                    {/* Totals */}
                    <div className="rounded-xl border text-sm divide-y">
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-muted-foreground">Advance Payment</span>
                        <span className="font-medium text-green-700 tabular-nums">
                          {fmtMoney(settlement.effectivePaid)}
                        </span>
                      </div>
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-muted-foreground">Pending Payment</span>
                        <span
                          className={
                            pendingAmount > 0
                              ? "font-medium text-red-600 tabular-nums"
                              : "font-medium text-green-700 tabular-nums"
                          }
                        >
                          {fmtMoney(pendingAmount)}
                        </span>
                      </div>
                      {refundAmount > 0 && (
                        <div className="flex justify-between px-3 py-2">
                          <span className="text-muted-foreground">Refund to Guest</span>
                          <span className="font-medium text-blue-600 tabular-nums">
                            {fmtMoney(refundAmount)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Payment status / method */}
                    {!done && (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor="co-pay-status">Payment Status</Label>
                          <select
                            id="co-pay-status"
                            value={payStatus}
                            onChange={(e) => setPayStatus(e.target.value as PayStatus)}
                            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                            disabled={isPending}
                          >
                            <option value="pending">Pending</option>
                            <option value="paid">Paid</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="co-pay-method">Payment Method</Label>
                          <select
                            id="co-pay-method"
                            value={payMethod}
                            onChange={(e) => setPayMethod(e.target.value as PayMethod)}
                            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                            disabled={isPending}
                          >
                            {PAY_METHODS.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* UPI QR */}
                        {payMethod === "upi" && (
                          <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
                            <p className="text-sm font-semibold text-navy-900 tabular-nums">
                              Amount: {fmtMoney(pendingAmount)}
                            </p>
                            {qrImageQuery.isLoading ? (
                              <Skeleton className="h-40 w-40 rounded-lg" />
                            ) : qrImageQuery.data ? (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={qrImageQuery.data}
                                  alt="UPI QR Code"
                                  className="h-44 w-44 rounded-lg object-contain"
                                />
                                <p className="text-center text-sm font-semibold text-navy-900">
                                  {qrInfoQuery.data?.payment_label ?? "Scan to pay via UPI"}
                                </p>
                                {/* UPI ID — restricted to owner/admin (canViewUpiId) */}
                                {canViewUpiId && upiConfigQuery.data?.upi_id && (
                                  <div className="flex items-center gap-2 rounded-lg border border-dashed border-gold-400 bg-gold-50 px-3 py-2">
                                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gold-700">
                                      UPI ID
                                    </span>
                                    <span className="select-all font-mono text-sm font-semibold text-navy-900">
                                      {upiConfigQuery.data.upi_id}
                                    </span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="py-4 text-center">
                                <QrCode
                                  className="mx-auto mb-2 size-10 text-muted-foreground/30"
                                  aria-hidden
                                />
                                <p className="text-xs text-muted-foreground">
                                  UPI QR not configured.
                                  <br />
                                  Set it up in Settings → Payments.
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Due authorization */}
                        {needsDueAuth && (
                          <div className="space-y-1.5 rounded-xl border border-orange-200 bg-orange-50 p-3">
                            <p className="text-xs font-medium text-orange-700">
                              Checkout with outstanding balance requires a reason
                              (corporate/later billing).
                            </p>
                            <Input
                              value={dueReason}
                              onChange={(e) => setDueReason(e.target.value)}
                              placeholder="e.g. Corporate billing, Guest will pay online…"
                              disabled={isPending}
                            />
                          </div>
                        )}
                      </>
                    )}

                    {/* Grand total */}
                    <div className="flex items-center justify-between rounded-xl bg-navy-900 px-4 py-3 font-semibold text-white">
                      <span>Grand Total</span>
                      <span className="tabular-nums">
                        {fmtMoney(done && checkoutResult ? money(checkoutResult.final_total) : grandTotal)}
                      </span>
                    </div>

                    {error && (
                      <p
                        className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger"
                        role="alert"
                      >
                        {error}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="space-y-2">
                      {!done && (
                        <Button
                          className="w-full bg-navy-900 text-white hover:bg-navy-900/90"
                          onClick={handleCheckout}
                          disabled={isPending || (needsDueAuth && !dueReason.trim())}
                        >
                          {isPending ? (
                            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                          ) : (
                            <LogOut className="mr-2 size-4" aria-hidden />
                          )}
                          Check Out
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => void printInvoice()}
                        disabled={!done || invoiceBusy}
                      >
                        <Printer className="mr-2 size-4" aria-hidden />
                        Print Invoice
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => void downloadPdf()}
                        disabled={!done || invoiceBusy}
                      >
                        <Download className="mr-2 size-4" aria-hidden />
                        Download PDF
                      </Button>
                      {/* Email invoice — no backend endpoint yet */}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            render={<span className="block w-full" />}
                          >
                            <Button variant="outline" className="w-full" disabled>
                              <Mail className="mr-2 size-4" aria-hidden />
                              Email Invoice
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Coming soon</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button
                        variant="outline"
                        className="w-full text-green-700 hover:text-green-800"
                        onClick={openWhatsApp}
                        disabled={!booking?.primary_guest_phone}
                      >
                        <MessageCircle className="mr-2 size-4" aria-hidden />
                        WhatsApp
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}

export default function CheckoutPage() {
  return (
    <RequirePermission permission={PERMISSIONS.checkout}>
      <CheckoutContent />
    </RequirePermission>
  );
}
