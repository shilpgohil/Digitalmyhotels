"use client";

/**
 * Guest Check-out Detail — full-page checkout experience.
 *
 * Layout (client Figma "Guest Check-out Detail"):
 *  LEFT (2/3):  Find Booking → Guest & Stay Details → Additional Charges
 *  RIGHT (1/3): Settlement Summary (payment status/method, UPI QR, totals,
 *               Check Out / Print Invoice / Download PDF / Email / WhatsApp)
 *
 * Settlement is fully server-authoritative: every draft edit (extra charges,
 * expected/actual checkout time) is priced by POST /checkouts/{id}/quote and
 * the numbers are displayed verbatim — no client-side arithmetic. The commit
 * is ONE atomic POST /checkouts carrying the same draft plus the payment
 * instruction, so a failure anywhere leaves nothing behind.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  Copy,
  Download,
  FileText,
  LogOut,
  Mail,
  MessageCircle,
  Printer,
  QrCode,
  Search,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { InlineSpinner } from "@/components/ui/inline-spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/time-input";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE, ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { RequirePermission } from "@/components/auth/require-permission";
import { fmtApiDate, fmtINR } from "@/lib/formatting";
import { fmtMoney, money } from "@/components/stay/checkout-summary";
import type { ListOut, HotelOut, HotelSettingsOut } from "@/types/hotel";
import type {
  BookingOut,
  CheckOutOut,
  CheckoutChargeDraft,
  CheckoutQuoteOut,
  CurrentGuestOut,
} from "@/types/stay";

interface HotelQr {
  qr_available: boolean;
  payment_label: string;
}

type PayMethod = "cash" | "upi" | "credit_card" | "debit_card" | "bank_transfer" | "other";
type PayStatus = "pending" | "paid";

/** Payment methods offered for NEW payments (client 9-08 item 14: Cash, UPI,
 *  Credit Card, Debit Card, Net Banking, Other). Legacy "card" records stay
 *  valid and display as "Card" in histories, but it is not offered here. */
const PAY_METHODS: {
  value: PayMethod;
  labelKey: "cash" | "upi" | "creditCard" | "debitCard" | "bankTransfer" | "otherMethod";
}[] = [
  { value: "cash", labelKey: "cash" },
  { value: "upi", labelKey: "upi" },
  { value: "credit_card", labelKey: "creditCard" },
  { value: "debit_card", labelKey: "debitCard" },
  { value: "bank_transfer", labelKey: "bankTransfer" },
  { value: "other", labelKey: "otherMethod" },
];

/** Extra charges entered at checkout, keyed by backend charge category.
 *  `description` is the API payload value (not user-facing UI text);
 *  `labelKey` resolves the visible label from the checkoutPage namespace. */
const EXTRA_CHARGE_FIELDS = [
  { key: "restaurant", labelKey: "chargeRestaurant", description: "Restaurant charges at checkout" },
  { key: "damage", labelKey: "chargeDamage", description: "Damage charges at checkout" },
  { key: "other", labelKey: "chargeOther", description: "Other charges at checkout" },
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

/** Today's date as YYYY-MM-DD in the browser's local timezone. */
function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function CheckoutContent() {
  const t = useTranslations("stay");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const tp = useTranslations("checkoutPage");
  const tm = useTranslations("money");
  const ti = useTranslations("invoices");
  const tb = useTranslations("bookings");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  // Raw UPI ID is restricted — workers may see the QR but never the raw ID.
  const canViewUpiId = can(PERMISSIONS.hotelViewUpiId);
  // Owner/Manager can authorize discounts at checkout (client 9-08 #13).
  const canReverse = can(PERMISSIONS.paymentsCorrect);

  // ── Selection state ────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState("");
  const [entry, setEntry] = useState<CurrentGuestOut | null>(null);
  // ?booking=<id> lets other pages (Current Guests) deep-link straight into
  // the checkout flow for a specific in-house booking.
  const [deepLinkId, setDeepLinkId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("booking");
  });

  // ── Form state ─────────────────────────────────────────────────────────
  const [actualCheckoutTime, setActualCheckoutTime] = useState("");
  // Editable expected check-out date/time — staff may extend/shorten the
  // stay right at checkout; PATCHed to the booking before the checkout POST.
  const [expectedOutDate, setExpectedOutDate] = useState("");
  const [expectedOutTime, setExpectedOutTime] = useState("");
  const [extras, setExtras] = useState<Record<ExtraChargeKey, string>>({
    restaurant: "",
    damage: "",
    other: "",
  });
  const [payStatus, setPayStatus] = useState<PayStatus>("paid");
  const [payMethod, setPayMethod] = useState<PayMethod>("cash");
  const [dueReason, setDueReason] = useState("");
  // Authorized discount at checkout — reduces Grand Total (client 9-08 #13).
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckOutOut | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const resetForm = () => {
    setActualCheckoutTime(settingsQuery.data?.check_out_time?.slice(0, 5) ?? "");
    setExpectedOutDate("");
    setExpectedOutTime("");
    setExtras({ restaurant: "", damage: "", other: "" });
    setPayStatus("paid");
    setPayMethod("cash");
    setDueReason("");
    setDiscountAmount("");
    setDiscountReason("");
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

  const hotelQuery = useQuery({
    queryKey: ["hotel-profile", activeHotelId],
    queryFn: () => api<HotelOut>("/api/v1/hotels/me"),
    enabled: !!activeHotelId,
    staleTime: 300_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["hotel-settings", activeHotelId],
    queryFn: () => api<HotelSettingsOut>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
    staleTime: 300_000,
  });

  // When a booking is loaded and settings arrive (race-safe), default the
  // actual checkout time to the hotel's standard checkout time.
  useEffect(() => {
    if (entry && settingsQuery.data?.check_out_time && !actualCheckoutTime) {
      setActualCheckoutTime(settingsQuery.data.check_out_time.slice(0, 5));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data?.check_out_time, entry?.booking_id]);

  // Seed the editable expected check-out date/time from the loaded booking.
  useEffect(() => {
    if (bookingQuery.data) {
      setExpectedOutDate(bookingQuery.data.check_out_date);
      setExpectedOutTime(bookingQuery.data.check_out_time?.slice(0, 5) ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingQuery.data?.id]);

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
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr/image?v=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "X-Hotel-Id": activeHotelId ?? "",
        },
        credentials: "include",
        cache: "no-store",
      });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    },
    enabled: showQr && !!activeHotelId,
    staleTime: 300_000,
  });

  // ── Server-authoritative settlement (checkout draft → quote) ───────────

  const booking = bookingQuery.data;

  // True when staff changed the expected check-out date/time vs the booking.
  const expectedOutChanged =
    !!booking &&
    !!expectedOutDate &&
    (expectedOutDate !== booking.check_out_date ||
      (expectedOutTime !== "" &&
        expectedOutTime !== (booking.check_out_time?.slice(0, 5) ?? "")));

  /** New charges entered at the desk — part of the draft, priced server-side. */
  const draftCharges = useMemo<CheckoutChargeDraft[]>(
    () =>
      EXTRA_CHARGE_FIELDS.flatMap((field) => {
        const amount = Number.parseFloat(extras[field.key]) || 0;
        return amount > 0
          ? [
              {
                category: field.key,
                description: field.description,
                amount: amount.toFixed(2),
                apply_gst: true,
              },
            ]
          : [];
      }),
    [extras],
  );

  /** The complete checkout draft — the quote and the commit send the SAME
   *  object, so the numbers on screen are the numbers that get recorded. */
  const draft = useMemo(
    () => ({
      // Actual departure moment: today at the staff-entered time (naive
      // local time — the server interprets it in the hotel's timezone).
      checked_out_at: actualCheckoutTime
        ? `${todayLocalDate()}T${actualCheckoutTime}:00`
        : null,
      expected_check_out_date: expectedOutChanged ? expectedOutDate : null,
      expected_check_out_time:
        expectedOutChanged && expectedOutTime ? expectedOutTime : null,
      charges: draftCharges,
      // Desk-entered authorized discount (client 9-08 #13).
      discount_amount:
        Number.parseFloat(discountAmount) > 0
          ? Number.parseFloat(discountAmount).toFixed(2)
          : null,
      discount_reason: discountReason.trim() || null,
    }),
    [actualCheckoutTime, expectedOutChanged, expectedOutDate, expectedOutTime, draftCharges, discountAmount, discountReason],
  );

  // Live server pricing of the draft. keepPreviousData avoids flicker while
  // an edited draft is being re-priced.
  const quoteQuery = useQuery({
    queryKey: ["checkout-quote", entry?.booking_id, JSON.stringify(draft)],
    queryFn: () =>
      api<CheckoutQuoteOut>(`/api/v1/checkouts/${entry!.booking_id}/quote`, {
        method: "POST",
        body: draft,
      }),
    enabled: !!entry?.booking_id && !checkoutResult,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const quote = quoteQuery.data;
  const previewLoading = !!entry && quoteQuery.isLoading && !quote;

  const lateHoursNum = quote?.overtime_hours ?? 0;
  const lateFeeNum = money(quote?.late_fee);

  /** Totals for display — server quote verbatim, no client arithmetic. */
  const totals = {
    roomSubtotal: money(quote?.room_subtotal),
    gst: money(quote?.gst_amount),
    chargesTotal: money(quote?.charges_total),
    lateFee: lateFeeNum,
    discount: money(quote?.discount),
    finalTotal: money(quote?.final_total),
    advancePaid: money(quote?.advance_paid),
    secDeposit: money(quote?.security_deposit),
    effectivePaid: money(quote?.effective_paid),
  };

  const grandTotal = totals.finalTotal;
  const pendingAmount = money(quote?.due);
  const refundAmount = money(quote?.refund);
  const needsDueAuth = payStatus === "pending" && pendingAmount > 0;

  // ── Actions ────────────────────────────────────────────────────────────

  const loadGuest = () => {
    const found = guests.data?.items.find((g) => g.booking_id === selectedId) ?? null;
    resetForm();
    setEntry(found);
  };

  // Deep link: auto-select the booking once the in-house guest list loads,
  // then strip the param so back-navigation doesn't re-trigger it.
  useEffect(() => {
    if (!deepLinkId || entry || !guests.data) return;
    const found = guests.data.items.find((g) => g.booking_id === deepLinkId);
    if (found) {
      setSelectedId(deepLinkId);
      setEntry(found);
    }
    setDeepLinkId(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("booking")) {
      url.searchParams.delete("booking");
      window.history.replaceState(null, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId, guests.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No booking loaded");

      // ONE atomic request: the same draft the quote priced, plus the payment
      // instruction. Charges, payment collection, date corrections and the
      // checkout itself commit (or roll back) together on the server.
      // When staff selects "Paid" and there is a pending amount, we:
      //  1. collect_payment=true  → server posts a payment entry for the due
      //  2. allow_due=true        → authorizes any tiny rounding residual
      //     after the payment is recorded, preventing the spurious
      //     "Outstanding balance of X must be collected" 409 error.
      // When staff selects "Pending" with a due, they must enter a reason
      // (needsDueAuth=true) and the amount stays outstanding.
      const isPaidWithDue = payStatus === "paid" && pendingAmount > 0;
      return api<CheckOutOut>("/api/v1/checkouts", {
        method: "POST",
        body: {
          ...draft,
          booking_id: entry.booking_id,
          collect_payment: isPaidWithDue,
          payment_method: isPaidWithDue ? payMethod : null,
          allow_due: needsDueAuth || isPaidWithDue,
          due_reason: needsDueAuth
            ? dueReason.trim()
            : isPaidWithDue
              ? "Payment collected at checkout"
              : null,
        },
      });
    },
    onSuccess: (result) => {
      setCheckoutResult(result);
      setError(null);
      invalidate();
      toast.success(t("checkedOutToast"));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tp("checkoutFailed")),
  });

  const handleCheckout = () => {
    setError(null);
    if (needsDueAuth && !dueReason.trim()) {
      setError(tp("dueReasonRequired"));
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
      toast.success(ti("generated"));
      return inv.id;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tp("invoiceGenerationFailed"));
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

  const emailInvoice = async () => {
    const id = await ensureInvoice();
    if (!id) return;
    setInvoiceBusy(true);
    try {
      const res = await api<{ message: string }>(`/api/v1/invoices/${id}/email`, {
        method: "POST",
      });
      toast.success(res.message);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : tp("emailFailed"),
      );
    } finally {
      setInvoiceBusy(false);
    }
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

  /** Fetch invoice PDF and return as a Blob (without creating an object URL). */
  const fetchInvoicePdfBlob = async (id: string): Promise<Blob | null> => {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE}/api/v1/invoices/${id}/pdf`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "X-Hotel-Id": activeHotelId ?? "",
      },
      credentials: "include",
    });
    if (!res.ok) return null;
    return res.blob();
  };

  const openWhatsApp = async () => {
    const phone = booking?.primary_guest_phone;
    if (!phone) {
      toast.error(tp("noGuestPhone"));
      return;
    }
    const total = checkoutResult ? money(checkoutResult.final_total) : grandTotal;
    const hotelName = hotelQuery.data?.name ?? tp("waHotelFallback");
    const text = [
      tp("waThanks", { hotel: hotelName }),
      `${tp("booking")}: ${entry?.booking_number}`,
      `${tp("grandTotal")}: ${fmtMoney(total)}`,
    ].join("\n");

    // Sharing requires a completed checkout AND an invoice (generated on
    // demand if needed) — the button is also gated on `done` below.
    const id = invoiceId ?? (done ? await ensureInvoice() : null);
    if (!id) return;

    // On mobile: try Web Share API with the PDF file attached.
    // Navigator.share with files is supported on Android Chrome + iOS Safari.
    // On desktop (where file-sharing via WhatsApp URL is impossible anyway)
    // we fall back to the text-only wa.me link.
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        setInvoiceBusy(true);
        const blob = await fetchInvoicePdfBlob(id);
        if (blob) {
          const file = new File(
            [blob],
            `invoice-${entry?.booking_number ?? id}.pdf`,
            { type: "application/pdf" },
          );
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: `${hotelName} — Invoice`,
              text,
            });
            return; // successfully shared via native sheet
          }
        }
      } catch (e) {
        // AbortError = user dismissed the share sheet — don't fall through.
        if (e instanceof Error && e.name === "AbortError") return;
        // Any other error: fall through to URL link below.
      } finally {
        setInvoiceBusy(false);
      }
    }

    // Fallback: open wa.me with text-only (desktop / unsupported browsers).
    window.open(
      `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  /** Copy the raw UPI ID (owner/admin only — button lives behind canViewUpiId). */
  const copyUpiId = async () => {
    const upi = upiConfigQuery.data?.upi_id;
    if (!upi) return;
    try {
      await navigator.clipboard.writeText(upi);
      toast.success(tp("upiIdCopied"));
    } catch {
      toast.error(tc("error"));
    }
  };

  const detailsLoading = !!entry && bookingQuery.isLoading;
  const isPending = checkoutMutation.isPending;
  const done = !!checkoutResult;

  // ── Render ─────────────────────────────────────────────────────────────

  // UPI QR panel body — loading skeleton, then QR image, then "not configured".
  let upiQrContent: React.ReactNode;
  if (qrImageQuery.isLoading) {
    upiQrContent = <Skeleton className="h-52 w-52 rounded-lg" />;
  } else if (qrImageQuery.data) {
    upiQrContent = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrImageQuery.data}
          alt={tp("upiQrAlt")}
          className="h-56 w-56 rounded-lg object-contain"
        />
        <p className="text-center text-sm font-semibold text-navy-900">
          {qrInfoQuery.data?.payment_label ?? tp("scanToPay")}
        </p>
        {/* UPI ID — restricted to owner/admin (canViewUpiId) */}
        {canViewUpiId && upiConfigQuery.data?.upi_id && (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-gold-400 bg-gold-50 px-3 py-2">
            <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-gold-700">
              {tp("upiId")}
            </span>
            <span className="select-all font-mono text-sm font-semibold text-navy-900">
              {upiConfigQuery.data.upi_id}
            </span>
            <button
              type="button"
              onClick={() => void copyUpiId()}
              aria-label={tp("copyUpiId")}
              title={tp("copyUpiId")}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-gold-700 transition-colors hover:bg-gold-100"
            >
              <Copy className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
      </>
    );
  } else {
    upiQrContent = (
      <div className="py-4 text-center">
        <QrCode
          className="mx-auto mb-2 size-10 text-muted-foreground/30"
          aria-hidden
        />
        <p className="text-xs text-muted-foreground">
          {tp("qrNotConfigured")}
          <br />
          {tp("qrSetupHint")}
        </p>
      </div>
    );
  }

  return (
    <>
      <PartnerHeader title={t("checkoutTitle")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* ══ LEFT COLUMN (2/3) ══════════════════════════════════════ */}
          <div className="space-y-6 lg:col-span-2">
            {/* ── Find Booking ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="size-4 text-gold-600" aria-hidden />
                  {tp("findBooking")}
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
                      <Label htmlFor="co-booking">{tp("booking")}</Label>
                      <select
                        id="co-booking"
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                        className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                        disabled={isPending}
                      >
                        <option value="">{tp("selectBookingOption")}</option>
                        {guests.data.items.map((g) => (
                          <option key={g.booking_id} value={g.booking_id}>
                            {g.booking_number} — {g.primary_guest_name} ({tp("room")} {g.rooms.join(", ")})
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      className="bg-navy-900 text-white hover:bg-navy-900/90"
                      onClick={loadGuest}
                      disabled={!selectedId || isPending}
                    >
                      {tp("loadGuest")}
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
                    <p className="text-lg font-bold">{tp("guestCheckedOut")}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {entry?.primary_guest_name} · {checkoutResult.booking_number}
                    </p>
                  </div>
                  <div className="rounded-xl border text-left text-sm divide-y">
                    <div className="flex justify-between px-4 py-2">
                      <span className="text-muted-foreground">{t("finalTotal")}</span>
                      <span className="font-semibold tabular-nums">
                        {fmtMoney(money(checkoutResult.final_total))}
                      </span>
                    </div>
                    <div className="flex justify-between px-4 py-2">
                      <span className="text-muted-foreground">{t("paid")}</span>
                      <span className="font-semibold text-green-700 tabular-nums">
                        {fmtMoney(money(checkoutResult.paid_amount))}
                      </span>
                    </div>
                    {money(checkoutResult.due_amount) > 0 && (
                      <div className="flex justify-between px-4 py-2">
                        <span className="text-muted-foreground">{tp("outstandingAuthorized")}</span>
                        <span className="font-semibold text-orange-600 tabular-nums">
                          {fmtMoney(money(checkoutResult.due_amount))}
                        </span>
                      </div>
                    )}
                    {money(checkoutResult.refund_amount) > 0 && (
                      <div className="flex flex-col gap-1 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                        <div className="flex justify-between">
                          <span className="font-semibold text-blue-800">{tp("refundDueToGuest")}</span>
                          <span className="font-bold text-blue-700 tabular-nums">
                            {fmtMoney(money(checkoutResult.refund_amount))}
                          </span>
                        </div>
                        <p className="text-xs text-blue-600">
                          Return this amount to the guest in the same payment mode used at check-in (cash / UPI).
                        </p>
                      </div>
                    )}
                    <div className="flex justify-between px-4 py-2">
                      <span className="text-muted-foreground">{tp("room")}</span>
                      <span className="text-xs text-muted-foreground">{tp("nowInCleaningQueue")}</span>
                    </div>
                  </div>
                  {invoiceId ? (
                    <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                      ✓ {ti("generated")}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void ensureInvoice()}
                      disabled={invoiceBusy}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gold-400 px-4 py-2.5 text-sm font-semibold text-gold-700 transition-colors hover:bg-gold-50 disabled:opacity-50"
                    >
                      <FileText className="size-4" aria-hidden />
                      {invoiceBusy ? tp("generating") : ti("generate")}
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
                    {tp("newCheckout")}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ── Guest & Stay Details ── */}
            {!done && (
              <Card>
                <CardHeader>
                  <CardTitle>{tp("guestStayDetails")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {!entry && (
                    <p className="text-sm text-muted-foreground">
                      {tp("selectBookingHint")}
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
                        <Label>{tp("guestName")}</Label>
                        <Input value={entry.primary_guest_name} readOnly className="bg-muted/40" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{tp("roomNumbers")}</Label>
                        <Input value={entry.rooms.join(", ")} readOnly className="bg-muted/40" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t("contactNumber")}</Label>
                        <Input
                          value={
                            booking?.primary_guest_phone ?? entry.primary_guest_phone_masked
                          }
                          readOnly
                          className="bg-muted/40 tabular-nums"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{tp("actualStayNights")}</Label>
                        <Input
                          value={actualNights(entry.checked_in_at)}
                          readOnly
                          className="bg-muted/40 tabular-nums"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{tb("checkinDate")}</Label>
                        <Input
                          value={`${fmtApiDate(booking?.check_in_date)}, ${
                            booking?.check_in_time?.slice(0, 5) ??
                            new Date(entry.checked_in_at).toTimeString().slice(0, 5)
                          }`}
                          readOnly
                          className="bg-muted/40 tabular-nums"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="co-expected-checkout">{tp("expectedCheckoutDate")}</Label>
                        <DateTimePicker
                          id="co-expected-checkout"
                          dateValue={expectedOutDate}
                          timeValue={expectedOutTime}
                          onDateChange={setExpectedOutDate}
                          onTimeChange={setExpectedOutTime}
                          min={booking?.check_in_date}
                          disabled={isPending}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="co-actual-checkout-time">Actual Checkout Time</Label>
                        <TimeInput
                          id="co-actual-checkout-time"
                          value={actualCheckoutTime}
                          onChange={setActualCheckoutTime}
                          disabled={isPending}
                        />
                      </div>
                      {lateFeeNum > 0 && (
                        <div className="col-span-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                          Late checkout by {lateHoursNum} hr{lateHoursNum !== 1 ? "s" : ""} —{" "}
                          {fmtINR(lateFeeNum)} late fee added
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Special Requirements (extra charges entered at checkout) ── */}
            {!done && (
              <Card>
                <CardHeader>
                  <CardTitle>{tp("specialRequirements")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {!entry ? (
                    <p className="text-sm text-muted-foreground">{tp("loadGuestForCharges")}</p>
                  ) : (
                    <>
                      <div className="grid gap-4 sm:grid-cols-3">
                        {EXTRA_CHARGE_FIELDS.map((field) => (
                          <div key={field.key} className="space-y-1.5">
                            <Label htmlFor={`co-extra-${field.key}`}>{tp(field.labelKey)}</Label>
                            <Input
                              id={`co-extra-${field.key}`}
                              type="number"
                              min={0}
                              step="1"
                              placeholder="0"
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

                      {/* Authorized discount — Owner/Manager only (client 9-08 #13) */}
                      {canReverse && (
                        <div className="grid gap-4 sm:grid-cols-2 border-t pt-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="co-discount">{tp("discountLabel")}</Label>
                            <Input
                              id="co-discount"
                              type="number"
                              min={0}
                              step="1"
                              placeholder="0"
                              value={discountAmount}
                              onChange={(e) => setDiscountAmount(e.target.value)}
                              className="tabular-nums"
                              disabled={isPending}
                            />
                          </div>
                          {Number.parseFloat(discountAmount) > 0 && (
                            <div className="space-y-1.5">
                              <Label htmlFor="co-discount-reason">{tp("discountReason")}</Label>
                              <Input
                                id="co-discount-reason"
                                placeholder={tp("discountReasonPlaceholder")}
                                value={discountReason}
                                onChange={(e) => setDiscountReason(e.target.value)}
                                disabled={isPending}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ══ RIGHT COLUMN (1/3): Settlement Summary ══════════════════ */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>{tp("settlementSummary")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!entry && (
                  <p className="text-sm text-muted-foreground">
                    {tp("loadGuestForSettlement")}
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
                    {/* Totals — server-computed settlement preview */}
                    {previewLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Skeleton key={i} className="h-7 w-full" />
                        ))}
                      </div>
                    ) : !quote && !done ? (
                      <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
                        {quoteQuery.error instanceof ApiError
                          ? quoteQuery.error.message
                          : tc("error")}{" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => quoteQuery.refetch()}
                        >
                {tc("retry")}
              </button>
                      </p>
                    ) : (
                      <div className="rounded-xl border text-sm divide-y">
                        <div className="flex justify-between px-3 py-2">
                          <span className="text-muted-foreground">{tp("roomSubtotal")}</span>
                          <span className="font-medium tabular-nums">
                            {fmtMoney(totals.roomSubtotal)}
                          </span>
                        </div>
                        <div className="flex justify-between px-3 py-2">
                          <span className="text-muted-foreground">{tp("gst")}</span>
                          <span className="font-medium tabular-nums">{fmtMoney(totals.gst)}</span>
                        </div>
                        {totals.chargesTotal > 0 && (
                          <div className="flex justify-between px-3 py-2">
                            <span className="text-muted-foreground">{tp("additionalCharges")}</span>
                            <span className="font-medium tabular-nums">
                              {fmtMoney(totals.chargesTotal)}
                            </span>
                          </div>
                        )}
                        {totals.lateFee > 0 && (
                          <div className="flex justify-between px-3 py-2">
                            <span className="text-muted-foreground">{t("lateFee")}</span>
                            <span className="font-medium text-orange-600 tabular-nums">
                              {fmtMoney(totals.lateFee)}
                            </span>
                          </div>
                        )}
                        {totals.discount > 0 && (
                          <div className="flex justify-between px-3 py-2">
                            <span className="text-muted-foreground">{tp("discount")}</span>
                            <span className="font-medium text-green-700 tabular-nums">
                              −{fmtMoney(totals.discount)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between px-3 py-2">
                          <span className="text-muted-foreground">{tp("advancePayment")}</span>
                          <span className="font-medium text-green-700 tabular-nums">
                            {fmtMoney(totals.advancePaid)}
                          </span>
                        </div>
                        {totals.secDeposit > 0 && (
                          <div className="flex justify-between px-3 py-2">
                            <span className="text-muted-foreground">{tp("securityDeposit")}</span>
                            <span className="font-medium text-green-700 tabular-nums">
                              {fmtMoney(totals.secDeposit)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between px-3 py-2">
                          <span className="text-muted-foreground">
                            {refundAmount > 0 ? tp("refundToGuest") : tp("pendingPayment")}
                          </span>
                          <span
                            className={
                              refundAmount > 0
                                ? "font-medium text-blue-600 tabular-nums"
                                : pendingAmount > 0
                                  ? "font-medium text-red-600 tabular-nums"
                                  : "font-medium text-green-700 tabular-nums"
                            }
                          >
                            {fmtMoney(refundAmount > 0 ? refundAmount : pendingAmount)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Payment status / method */}
                    {!done && (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor="co-pay-status">{tp("paymentStatus")}</Label>
                          <select
                            id="co-pay-status"
                            value={payStatus}
                            onChange={(e) => setPayStatus(e.target.value as PayStatus)}
                            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                            disabled={isPending}
                          >
                            <option value="pending">{tp("statusPending")}</option>
                            <option value="paid">{tp("statusPaid")}</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="co-pay-method">{tp("paymentMethod")}</Label>
                          <select
                            id="co-pay-method"
                            value={payMethod}
                            onChange={(e) => setPayMethod(e.target.value as PayMethod)}
                            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                            disabled={isPending}
                          >
                            {PAY_METHODS.map((m) => (
                              <option key={m.value} value={m.value}>
                                {tm(m.labelKey)}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Card/bank info note */}
                        {payMethod !== "cash" && payMethod !== "upi" && (
                          <p className="text-label text-blue-600 flex items-center gap-1">
                            <span>ℹ</span>
                            {payMethod === "credit_card" || payMethod === "debit_card"
                              ? "Collect via card machine, then record here"
                              : payMethod === "bank_transfer"
                              ? "Collect via net banking, then record here"
                              : "Collect externally, then record here"}
                          </p>
                        )}

                        {/* UPI QR */}
                        {payMethod === "upi" && (
                          <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
                            <p className="text-sm font-semibold text-navy-900 tabular-nums">
                              {tp("amountLabel", { amount: fmtMoney(pendingAmount) })}
                            </p>
                            {upiQrContent}
                          </div>
                        )}

                        {/* Due authorization */}
                        {needsDueAuth && (
                          <div className="space-y-1.5 rounded-xl border border-orange-200 bg-orange-50 p-3">
                            <p className="text-xs font-medium text-orange-700">
                              {tp("dueAuthHint")}
                            </p>
                            <Input
                              value={dueReason}
                              onChange={(e) => setDueReason(e.target.value)}
                              placeholder={tp("dueReasonPlaceholder")}
                              disabled={isPending}
                            />
            </div>
          )}
                      </>
                    )}

                    {/* Grand total */}
                    <div className="flex items-center justify-between rounded-xl bg-navy-900 px-4 py-3 font-semibold text-white">
                      <span>{tp("grandTotal")}</span>
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
                          disabled={isPending || !quote || (needsDueAuth && !dueReason.trim())}
                        >
                          {isPending ? (
                            <InlineSpinner size={16} className="mr-2" />
                          ) : (
                            <LogOut className="mr-2 size-4" aria-hidden />
                          )}
                        {t("checkOutAction")}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => void printInvoice()}
                        disabled={!done || invoiceBusy}
                      >
                        <Printer className="mr-2 size-4" aria-hidden />
                        {tp("printInvoice")}
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => void downloadPdf()}
                        disabled={!done || invoiceBusy}
                      >
                        <Download className="mr-2 size-4" aria-hidden />
                        {ti("downloadPdf")}
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => void emailInvoice()}
                        disabled={!done || invoiceBusy}
                      >
                        <Mail className="mr-2 size-4" aria-hidden />
                        {tp("emailInvoice")}
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full text-green-700 hover:text-green-800"
                        onClick={() => void openWhatsApp()}
                        disabled={!done || !booking?.primary_guest_phone || invoiceBusy}
                      >
                        <MessageCircle className="mr-2 size-4" aria-hidden />
                        WhatsApp
                      </Button>
                      {!done && (
                        <p className="text-center text-xs text-muted-foreground">
                          {tp("completeCheckoutToShare")}
                        </p>
                      )}
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
