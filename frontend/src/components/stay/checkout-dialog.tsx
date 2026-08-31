"use client";

/**
 * Comprehensive Checkout Dialog
 *
 * Three-step flow:
 *  Step 1 — BILL REVIEW: Shows itemized charges, payments, balance/refund.
 *  Step 2 — PAYMENT/AUTHORIZATION:
 *              • If balance > 0 → collect payment (Cash / UPI + QR)
 *              • If balance = 0 → skip to step 3
 *              • If "authorize with due" is checked → show reason field
 *  Step 3 — SUCCESS: Show result + Generate Invoice button.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  BanknoteIcon,
  ChevronLeft,
  FileText,
  IndianRupee,
  Loader2,
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import type { CheckOutOut, CurrentGuestOut } from "@/types/stay";
import type { BookingOut } from "@/types/stay";
import type { ChargeOut, PaymentOut } from "@/types/money";

interface HotelQr {
  qr_available: boolean;
  payment_label: string;
}

type Step = "bill" | "payment" | "success";

// ── Helpers ─────────────────────────────────────────────────────────────────

function money(v: string | number): number {
  return typeof v === "string" ? parseFloat(v) || 0 : v;
}

function fmt(v: number): string {
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CHARGE_LABELS: Record<string, string> = {
  food: "Food",
  laundry: "Laundry",
  room_service: "Room Service",
  extra_bed: "Extra Bed",
  minibar: "Minibar",
  transport: "Transport",
  other: "Other",
};

// ── Main component ───────────────────────────────────────────────────────────

export function CheckoutDialog({
  entry,
  onClose,
  onDone,
}: {
  readonly entry: CurrentGuestOut | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [step, setStep] = useState<Step>("bill");
  const [isLate, setIsLate] = useState(false);
  const [lateFee, setLateFee] = useState("0");
  const [allowDue, setAllowDue] = useState(false);
  const [dueReason, setDueReason] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "upi" | "card" | "bank_transfer" | "other">("cash");
  const [payAmount, setPayAmount] = useState("0");
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckOutOut | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);

  // Reset when dialog opens/closes
  useEffect(() => {
    if (!entry) {
      setStep("bill");
      setIsLate(false);
      setLateFee("0");
      setAllowDue(false);
      setDueReason("");
      setPayMethod("cash");
      setPayAmount("0");
      setShowQr(false);
      setError(null);
      setCheckoutResult(null);
      setInvoiceId(null);
    }
  }, [entry]);

  // ── Data fetching ────────────────────────────────────────────────────────

  const bookingQuery = useQuery({
    queryKey: ["booking-for-checkout", entry?.booking_id],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${entry!.booking_id}`),
    enabled: !!entry?.booking_id,
    staleTime: 0, // always fresh when dialog opens
  });

  const chargesQuery = useQuery({
    queryKey: ["charges-for-checkout", entry?.booking_id],
    queryFn: () =>
      api<{ items: ChargeOut[]; total: number }>(
        `/api/v1/charges?booking_id=${entry!.booking_id}`,
      ),
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

  const qrInfoQuery = useQuery({
    queryKey: ["hotel-qr-info", activeHotelId],
    queryFn: () => api<HotelQr>("/api/v1/hotels/me/payment-qr"),
    enabled: !!activeHotelId && showQr,
    staleTime: 60_000,
  });

  // UPI ID — shown alongside QR for staff to read out / verify with guest
  const upiConfigQuery = useQuery({
    queryKey: ["hotel-payment-config", activeHotelId],
    queryFn: () =>
      api<{ upi_id: string | null; config_version: number; has_logo: boolean; qr_version: number }>(
        "/api/v1/hotels/me/payment-config",
      ),
    enabled: showQr && !!activeHotelId,
    staleTime: 300_000,
  });

  // Fetch actual QR PNG image as a blob URL
  const qrImageQuery = useQuery({
    queryKey: ["hotel-qr-png", activeHotelId],
    queryFn: async () => {
      const token = getAccessToken();
      const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
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


  // ── Calculated bill ──────────────────────────────────────────────────────

  const booking = bookingQuery.data;
  const charges = (chargesQuery.data?.items ?? []).filter((c) => !c.voided_at);
  const payments = paymentsQuery.data?.items ?? [];

  const lateFeeNum = parseFloat(lateFee) || 0;
  const finalTotal = money(booking?.total_amount ?? 0) + lateFeeNum;
  const advancePaid = money(booking?.advance_amount ?? 0);
  const secDeposit = money(booking?.security_deposit ?? 0);
  const effectivePaid = advancePaid + secDeposit;
  const balance = Math.max(finalTotal - effectivePaid, 0);
  const refundAmt = Math.max(effectivePaid - finalTotal, 0);

  // Night charge (room total = total - extra charges - tax on extra)
  const extraChargesTotal = charges.reduce((s, c) => s + money(c.total_amount), 0);
  const roomChargesTotal = money(booking?.total_amount ?? 0) - extraChargesTotal - lateFeeNum;

  // Non-deposit payments only
  const nonDepositPayments = payments.filter((p) => p.purpose !== "deposit" && p.status === "completed");

  // ── Mutations ────────────────────────────────────────────────────────────

  const paymentMutation = useMutation({
    mutationFn: () =>
      api("/api/v1/payments", {
        method: "POST",
        body: {
          booking_id: entry?.booking_id,
          amount: payAmount,
          method: payMethod,
          purpose: "stay",
        },
      }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Payment failed"),
  });

  const checkoutMutation = useMutation({
    mutationFn: () =>
      api<CheckOutOut>("/api/v1/checkouts", {
        method: "POST",
        body: {
          booking_id: entry?.booking_id,
          is_late: isLate,
          late_fee: lateFee,
          allow_due: allowDue,
          due_reason: allowDue ? dueReason.trim() : null,
        },
      }),
    onSuccess: (result) => {
      setCheckoutResult(result);
      setStep("success");
      setError(null);
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Checkout failed"),
  });

  const handleCollectAndCheckout = async () => {
    setError(null);
    const amountNum = parseFloat(payAmount) || 0;
    if (amountNum > 0) {
      try {
        await paymentMutation.mutateAsync();
      } catch {
        return; // error already set
      }
    }
    checkoutMutation.mutate();
  };

  const handleCheckoutWithDue = async () => {
    if (!dueReason.trim()) {
      setError("A reason is required to authorize checkout with outstanding balance.");
      return;
    }
    setError(null);
    checkoutMutation.mutate();
  };

  const generateInvoice = async () => {
    if (!checkoutResult) return;
    setGeneratingInvoice(true);
    try {
      const inv = await api<{ id: string }>("/api/v1/invoices", {
        method: "POST",
        body: { booking_id: checkoutResult.booking_id, interstate: false },
      });
      setInvoiceId(inv.id);
      toast.success("Invoice generated");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Invoice generation failed");
    } finally {
      setGeneratingInvoice(false);
    }
  };

  const isLoading =
    bookingQuery.isLoading || chargesQuery.isLoading || paymentsQuery.isLoading;
  const isPending = paymentMutation.isPending || checkoutMutation.isPending;

  // ── Pre-fill pay amount with balance when step changes ───────────────────
  useEffect(() => {
    if (step === "payment" && balance > 0) {
      setPayAmount(balance.toFixed(2));
    }
  }, [step, balance]);

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open && step !== "success") onClose();
        else if (!open) {
          onClose();
          setStep("bill");
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === "success" ? (
              <>
                <BadgeCheck className="size-5 text-green-600" aria-hidden />
                Guest Checked Out
              </>
            ) : (
              <>
                <IndianRupee className="size-4 text-gold-600" aria-hidden />
                Check Out — {entry?.booking_number}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ── STEP 1: BILL REVIEW ─────────────────────────────────────────── */}
        {step === "bill" && (
          <div className="space-y-4">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <>
                {/* Guest + room info */}
                <div className="rounded-xl bg-navy-900 px-4 py-3 text-white">
                  <p className="font-semibold">{entry?.primary_guest_name}</p>
                  <p className="text-xs text-white/70 mt-0.5">
                    Room {entry?.rooms.join(", ")} ·{" "}
                    {booking
                      ? Math.max(
                          (new Date(booking.check_out_date).getTime() -
                            new Date(booking.check_in_date).getTime()) /
                            86_400_000,
                          1,
                        )
                      : "—"}{" "}
                    night(s)
                  </p>
                </div>

                {/* Bill itemization */}
                <div className="rounded-xl border divide-y">
                  {/* Room charges */}
                  {roomChargesTotal > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-muted-foreground">Room charges</span>
                      <span className="font-medium tabular-nums">{fmt(roomChargesTotal)}</span>
                    </div>
                  )}

                  {/* Extra charges */}
                  {charges.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="text-muted-foreground">
                        {CHARGE_LABELS[c.category] ?? c.category}: {c.description}
                        {c.quantity > 1 && (
                          <span className="ml-1 text-xs">×{c.quantity}</span>
                        )}
                      </span>
                      <span className="tabular-nums">{fmt(money(c.total_amount))}</span>
                    </div>
                  ))}

                  {/* Late fee */}
                  {isLate && lateFeeNum > 0 && (
                    <div className="flex items-center justify-between px-4 py-2 text-sm text-orange-600">
                      <span>Late checkout fee</span>
                      <span className="tabular-nums">{fmt(lateFeeNum)}</span>
                    </div>
                  )}

                  {/* Total */}
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/30 font-semibold text-sm">
                    <span>Total</span>
                    <span className="tabular-nums">{fmt(finalTotal)}</span>
                  </div>

                  {/* Payments made */}
                  {nonDepositPayments.length > 0 && (
                    <div className="px-4 py-2 space-y-1">
                      {nonDepositPayments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-sm text-green-700">
                          <span>Paid ({p.method.toUpperCase()}, {p.purpose})</span>
                          <span className="tabular-nums">−{fmt(money(p.amount))}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Security deposit */}
                  {secDeposit > 0 && (
                    <div className="flex items-center justify-between px-4 py-2 text-sm text-green-700">
                      <span>Security deposit applied</span>
                      <span className="tabular-nums">−{fmt(secDeposit)}</span>
                    </div>
                  )}

                  {/* Balance / Refund */}
                  <div
                    className={cn(
                      "flex items-center justify-between px-4 py-3 font-bold text-sm rounded-b-xl",
                      balance > 0
                        ? "bg-red-50 text-red-700"
                        : refundAmt > 0
                        ? "bg-green-50 text-green-700"
                        : "bg-green-50 text-green-700",
                    )}
                  >
                    <span>
                      {balance > 0
                        ? "Balance due from guest"
                        : refundAmt > 0
                        ? "Refund to guest"
                        : "Fully paid ✓"}
                    </span>
                    <span className="tabular-nums text-base">
                      {balance > 0 ? fmt(balance) : refundAmt > 0 ? fmt(refundAmt) : "₹0.00"}
                    </span>
                  </div>
                </div>

                {/* Late checkout toggle */}
                <div className="space-y-3 rounded-xl border px-4 py-3">
                  <label className="flex items-center gap-2.5 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded"
                      checked={isLate}
                      onChange={(e) => setIsLate(e.target.checked)}
                    />
                    <span className="font-medium">Late checkout</span>
                  </label>
                  {isLate && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Late Checkout Fee (₹)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={lateFee}
                        onChange={(e) => setLateFee(e.target.value)}
                        className="max-w-[180px]"
                      />
                    </div>
                  )}
                </div>

                {error && (
                  <p className="text-sm text-danger bg-danger-bg border border-danger/30 px-3 py-2 rounded-lg" role="alert">
                    {error}
                  </p>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button variant="outline" onClick={onClose}>Cancel</Button>
                  <Button
                    className="bg-navy-900 text-white hover:bg-navy-900/90"
                    onClick={() => {
                      if (balance > 0 || refundAmt > 0) {
                        setStep("payment");
                      } else {
                        // Fully paid — skip to checkout
                        checkoutMutation.mutate();
                      }
                    }}
                    disabled={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="size-4 animate-spin mr-2" aria-hidden />
                    ) : null}
                    {balance > 0 ? `Collect ${fmt(balance)} →` : refundAmt > 0 ? `Process Refund ${fmt(refundAmt)} →` : "Check Out"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── STEP 2: PAYMENT / AUTHORIZATION ────────────────────────────── */}
        {step === "payment" && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => { setStep("bill"); setError(null); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden />
              Back to bill
            </button>

            {refundAmt > 0 ? (
              /* Refund mode */
              <div className="rounded-xl border p-4 space-y-4">
                <p className="text-sm font-semibold text-green-700">
                  Guest paid more than billed — issue refund of {fmt(refundAmt)}
                </p>
                <div className="space-y-1.5">
                  <Label>Refund method</Label>
                  <div className="flex gap-2">
                    {(["cash", "upi"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPayMethod(m)}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors",
                          payMethod === m
                            ? "border-navy-900 bg-navy-900 text-white"
                            : "hover:bg-muted",
                        )}
                      >
                        {m === "cash" ? <BanknoteIcon className="size-3.5" aria-hidden /> : <QrCode className="size-3.5" aria-hidden />}
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Refund amount (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={refundAmt.toFixed(2)}
                    readOnly
                    className="tabular-nums bg-muted/40"
                  />
                </div>
                {error && (
                  <p className="text-sm text-danger" role="alert">{error}</p>
                )}
                <Button
                  className="w-full bg-navy-900 text-white hover:bg-navy-900/90"
                  onClick={() => checkoutMutation.mutate()}
                  disabled={isPending}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin mr-2" aria-hidden /> : null}
                  Check Out + Process Refund
                </Button>
              </div>
            ) : (
              /* Collection mode */
              <div className="space-y-4">
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700">
                  Balance due: {fmt(balance)}
                </div>

                {/* Option A: Collect now */}
                <div className="rounded-xl border p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Collect payment from guest
                  </p>

                  {/* Payment method buttons — all methods for record keeping */}
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: "cash",          label: "Cash",        icon: BanknoteIcon },
                      { id: "upi",           label: "UPI / QR",    icon: QrCode },
                      { id: "card",          label: "Card",        icon: IndianRupee },
                      { id: "bank_transfer", label: "Net Banking",  icon: IndianRupee },
                      { id: "other",         label: "Other",       icon: IndianRupee },
                    ] as const).map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setPayMethod(id);
                          setShowQr(id === "upi");
                          setAllowDue(false);
                        }}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 rounded-xl border py-2.5 px-2 text-xs font-medium transition-colors",
                          payMethod === id && !allowDue
                            ? "border-navy-900 bg-navy-900 text-white"
                            : "hover:bg-muted border-border",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden />
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* UPI QR display */}
                  {payMethod === "upi" && !allowDue && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setShowQr(!showQr)}
                        className="text-xs text-gold-600 font-medium underline"
                      >
                        {showQr ? "Hide QR Code" : "Show UPI QR Code"}
                      </button>
                      {showQr && (
                        <div className="flex flex-col items-center rounded-xl border bg-white p-4 gap-3 shadow-sm">
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
                              <p className="text-sm font-semibold text-navy-900 text-center">
                                {qrInfoQuery.data?.payment_label ?? "Scan to pay via UPI"}
                              </p>
                              {/* UPI ID — visible to authorized staff */}
                              {upiConfigQuery.data?.upi_id && (
                                <div className="flex items-center gap-2 rounded-lg border border-dashed border-gold-400 bg-gold-50 px-3 py-2">
                                  <span className="text-[10px] font-semibold text-gold-700 uppercase tracking-wide shrink-0">
                                    UPI ID
                                  </span>
                                  <span className="font-mono text-sm font-semibold text-navy-900 select-all">
                                    {upiConfigQuery.data.upi_id}
                                  </span>
                                </div>
                              )}
                              <p className="text-[11px] text-muted-foreground text-center">
                                Ask guest to scan QR or pay to the UPI ID above
                              </p>
                            </>
                          ) : (
                            <div className="text-center py-4">
                              <QrCode className="size-10 text-muted-foreground/30 mx-auto mb-2" aria-hidden />
                              <p className="text-xs text-muted-foreground">
                                UPI QR not configured.
                                <br />
                                Set it up in Settings → Payments.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Card / Net Banking manual note */}
                  {(payMethod === "card" || payMethod === "bank_transfer" || payMethod === "other") && !allowDue && (
                    <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
                      Manual record — collect {payMethod === "card" ? "via POS/card machine" : payMethod === "bank_transfer" ? "via net banking" : "payment"} from guest and record here for your accounts.
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Amount to collect (₹)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="tabular-nums"
                      disabled={allowDue}
                    />
                  </div>
                </div>

                {/* Option B: Authorize checkout with due */}
                <div className="rounded-xl border p-4 space-y-3">
                  <label className="flex items-center gap-2.5 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded"
                      checked={allowDue}
                      onChange={(e) => {
                        setAllowDue(e.target.checked);
                        if (e.target.checked) setPayAmount("0");
                      }}
                    />
                    <span className="font-medium text-orange-700">
                      Checkout with outstanding balance (corporate/later billing)
                    </span>
                  </label>
                  {allowDue && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reason *</Label>
                      <Input
                        value={dueReason}
                        onChange={(e) => setDueReason(e.target.value)}
                        placeholder="e.g. Corporate billing, Guest will pay online..."
                        required
                      />
                    </div>
                  )}
                </div>

                {error && (
                  <p className="text-sm text-danger bg-danger-bg border border-danger/30 px-3 py-2 rounded-lg" role="alert">
                    {error}
                  </p>
                )}

                <Button
                  className="w-full bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold"
                  onClick={allowDue ? handleCheckoutWithDue : handleCollectAndCheckout}
                  disabled={isPending || (allowDue && !dueReason.trim())}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin mr-2" aria-hidden /> : null}
                  {allowDue
                    ? "Check Out with Outstanding Balance"
                    : `Collect ${fmt(parseFloat(payAmount) || 0)} & Check Out`}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: SUCCESS ──────────────────────────────────────────────── */}
        {step === "success" && checkoutResult && (
          <div className="space-y-4 text-center py-2">
            <div className="flex size-16 items-center justify-center rounded-full bg-green-100 mx-auto">
              <BadgeCheck className="size-8 text-green-600" aria-hidden />
            </div>
            <div>
              <p className="font-bold text-lg">Guest Checked Out</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {entry?.primary_guest_name} · {checkoutResult.booking_number}
              </p>
            </div>

            {/* Summary */}
            <div className="rounded-xl border divide-y text-left text-sm">
              <div className="flex justify-between px-4 py-2">
                <span className="text-muted-foreground">Final total</span>
                <span className="font-semibold">{fmt(money(checkoutResult.final_total))}</span>
              </div>
              <div className="flex justify-between px-4 py-2">
                <span className="text-muted-foreground">Paid</span>
                <span className="text-green-700 font-semibold">{fmt(money(checkoutResult.paid_amount))}</span>
              </div>
              {money(checkoutResult.due_amount) > 0 && (
                <div className="flex justify-between px-4 py-2">
                  <span className="text-muted-foreground">Outstanding (authorized)</span>
                  <span className="text-orange-600 font-semibold">{fmt(money(checkoutResult.due_amount))}</span>
                </div>
              )}
              {money(checkoutResult.refund_amount) > 0 && (
                <div className="flex justify-between px-4 py-2">
                  <span className="text-muted-foreground">Refund due to guest</span>
                  <span className="text-blue-600 font-semibold">{fmt(money(checkoutResult.refund_amount))}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-2">
                <span className="text-muted-foreground">Room</span>
                <span className="text-xs text-muted-foreground">Now in cleaning queue</span>
              </div>
            </div>

            {/* Invoice generation */}
            {invoiceId ? (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 font-medium">
                ✓ Invoice generated
              </div>
            ) : (
              <button
                type="button"
                onClick={generateInvoice}
                disabled={generatingInvoice}
                className="inline-flex items-center gap-2 w-full justify-center rounded-xl border border-gold-400 px-4 py-2.5 text-sm font-semibold text-gold-700 hover:bg-gold-50 transition-colors disabled:opacity-50"
              >
                <FileText className="size-4" aria-hidden />
                {generatingInvoice ? "Generating…" : "Generate Invoice"}
              </button>
            )}

            <Button
              className="w-full bg-navy-900 text-white hover:bg-navy-900/90"
              onClick={() => {
                onClose();
                setStep("bill");
              }}
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
