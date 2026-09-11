"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Receipt, Wallet } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { SegmentedChips } from "@/components/ui/segmented-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { PaymentStatusBadge } from "@/components/stay/booking-badges";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { fmtINR, localToday } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { PERMISSIONS } from "@/lib/permissions";
import type { ListOut } from "@/types/hotel";
import type { BookingOut } from "@/types/stay";
import type {
  BillingHistoryOut,
  ChargeOut,
  LedgerOut,
  PaymentOut,
} from "@/types/money";

interface PaymentSummary {
  total_collected: string;
  cash: string;
  upi: string;
  refunds: string;
  deposits: string;
  paid_bookings: number;
  partial_bookings: number;
  unpaid_bookings: number;
  /** ₹ collected on fully-paid bookings. */
  paid_amount: string;
  /** ₹ remaining due on partially-paid bookings. */
  partial_amount: string;
  /** ₹ due on unpaid bookings. */
  pending_amount: string;
}

type QuickRange = "all" | "today" | "last5" | "month" | "year";
// "card" stays as a FILTER option so legacy records remain findable.
type PaymentMode =
  | ""
  | "cash"
  | "upi"
  | "card"
  | "credit_card"
  | "debit_card"
  | "bank_transfer"
  | "other";

/** Billing History page size (figma shows a compact paginated table). */
const BILLING_PAGE_SIZE = 10;

/** Format a Date as local YYYY-MM-DD (avoids UTC off-by-one, same as localToday). */
function toLocalIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Compute from/to dates for a quick-filter chip. */
function rangeFor(range: QuickRange): { from: string; to: string } {
  const now = new Date();
  const today = localToday();
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

function PaymentsContent() {
  const t = useTranslations("money");
  const tb = useTranslations("bookings");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();
  const [bookingId, setBookingId] = useState("");
  const [correctTarget, setCorrectTarget] = useState<PaymentOut | null>(null);
  const [refundTarget, setRefundTarget] = useState<PaymentOut | null>(null);

  // Draft filters (edited in the filter bar) vs applied filters (drive the
  // queries). "Apply" commits the draft; "Clear" resets both.
  const [quickRange, setQuickRange] = useState<QuickRange>("all");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [draftMode, setDraftMode] = useState<PaymentMode>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [mode, setMode] = useState<PaymentMode>("");
  const [billingPage, setBillingPage] = useState(0);

  const applyFilters = () => {
    setFromDate(draftFrom);
    setToDate(draftTo);
    setMode(draftMode);
  };
  const clearFilters = () => {
    setQuickRange("all");
    setDraftFrom("");
    setDraftTo("");
    setDraftMode("");
    setFromDate("");
    setToDate("");
    setMode("");
  };

  // Reset Billing History pagination when applied filters change.
  useEffect(() => {
    setBillingPage(0);
  }, [fromDate, toDate, mode]);

  const rangeQs = `${fromDate ? `&from_date=${fromDate}` : ""}${toDate ? `&to_date=${toDate}` : ""}`;

  const bookings = useQuery({
    queryKey: ["bookings", activeHotelId],
    queryFn: () => api<ListOut<BookingOut>>("/api/v1/bookings?limit=50"),
    enabled: !!activeHotelId,
  });

  const summary = useQuery({
    queryKey: ["payment-summary", activeHotelId, rangeQs],
    queryFn: () =>
      api<PaymentSummary>(`/api/v1/payments/summary?${rangeQs.replace(/^&/, "")}`),
    enabled: !!activeHotelId,
  });

  const billingQs = rangeQs + (mode ? `&payment_mode=${mode}` : "");
  const billing = useQuery({
    queryKey: ["billing-history", activeHotelId, billingQs, billingPage],
    queryFn: () =>
      api<BillingHistoryOut>(
        `/api/v1/payments/billing-history?limit=${BILLING_PAGE_SIZE}&offset=${billingPage * BILLING_PAGE_SIZE}${billingQs}`,
      ),
    enabled: !!activeHotelId,
  });

  const payments = useQuery({
    queryKey: ["payments", activeHotelId, bookingId],
    queryFn: () =>
      api<ListOut<PaymentOut>>(
        `/api/v1/payments?limit=50${bookingId ? `&booking_id=${bookingId}` : ""}`,
      ),
    enabled: !!activeHotelId,
  });

  const charges = useQuery({
    queryKey: ["charges", activeHotelId, bookingId],
    queryFn: () => api<ListOut<ChargeOut>>(`/api/v1/charges?booking_id=${bookingId}`),
    enabled: !!activeHotelId && !!bookingId,
  });

  const ledger = useQuery({
    queryKey: ["ledger", activeHotelId, bookingId],
    queryFn: () => api<LedgerOut>(`/api/v1/payments/ledger/${bookingId}`),
    enabled: !!activeHotelId && !!bookingId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payments", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["payment-summary", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["billing-history", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["charges", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["ledger", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
  };

  const showActions = can(PERMISSIONS.paymentsCorrect) || can(PERMISSIONS.paymentsRefund);

  return (
    <>
      <PartnerHeader title={t("paymentsTitle")} subtitle={tn("money")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* ── Filter bar: quick chips + dates + payment mode + apply/clear ── */}
        <div className="mb-4 rounded-lg border bg-card p-4">
          {/* Platform segmented chip pattern (client 09/2026) */}
          <div className="mb-3">
            <SegmentedChips
              options={[
                { value: "all", label: tb("allTime") },
                { value: "today", label: tb("today") },
                { value: "last5", label: tb("last5Days") },
                { value: "month", label: tb("thisMonth") },
                { value: "year", label: tb("thisYear") },
              ]}
              value={quickRange}
              onChange={(v: QuickRange) => {
                setQuickRange(v);
                const { from, to } = rangeFor(v);
                setDraftFrom(from);
                setDraftTo(to);
              }}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>{t("fromDate")}</Label>
              <DatePicker
                className="mt-1 w-40"
                value={draftFrom}
                onChange={(v) => {
                  setQuickRange("all");
                  setDraftFrom(v);
                }}
              />
            </div>
            <div>
              <Label>{t("toDate")}</Label>
              <DatePicker
                className="mt-1 w-40"
                value={draftTo}
                onChange={(v) => {
                  setQuickRange("all");
                  setDraftTo(v);
                }}
              />
            </div>
            <div>
              <Label>{t("paymentModeFilter")}</Label>
              <select
                className="mt-1 h-8 w-40 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={draftMode}
                onChange={(e) => setDraftMode(e.target.value as PaymentMode)}
              >
                <option value="">{t("allModes")}</option>
                <option value="cash">{t("cash")}</option>
                <option value="upi">{t("upi")}</option>
                <option value="credit_card">{t("creditCard")}</option>
                <option value="debit_card">{t("debitCard")}</option>
                <option value="bank_transfer">{t("bankTransfer")}</option>
                <option value="other">{t("otherMethod")}</option>
              </select>
            </div>
            <Button onClick={applyFilters}>{t("applyFilters")}</Button>
            <Button variant="outline" onClick={clearFilters}>
              {t("clearFilters")}
            </Button>
          </div>
        </div>

        {/* Summary cards — all six show ₹ amounts (client Figma). */}
        <StatCardGrid cols={6} className="mb-6">
          <StatCard label={t("totalCollected")} value={fmtINR(summary.data?.total_collected ?? 0)} tone="navy"    isLoading={summary.isLoading} />
          <StatCard label={t("paidCard")}        value={fmtINR(summary.data?.paid_amount    ?? 0)} tone="success" isLoading={summary.isLoading} />
          <StatCard label={t("cash")}            value={fmtINR(summary.data?.cash           ?? 0)} tone="gold"    isLoading={summary.isLoading} />
          <StatCard label={t("upi")}             value={fmtINR(summary.data?.upi            ?? 0)} tone="info"    isLoading={summary.isLoading} />
          <StatCard label={t("partialCard")}     value={fmtINR(summary.data?.partial_amount ?? 0)} tone="amber"   isLoading={summary.isLoading} />
          <StatCard label={t("pendingCard")}     value={fmtINR(summary.data?.pending_amount ?? 0)} tone="danger"  isLoading={summary.isLoading} />
        </StatCardGrid>

        {/* ── Billing History: one row per booking (figma redesign) ── */}
        <section className="rounded-lg border bg-card">
          <h2 className="px-4 pt-4 text-sm font-semibold">{t("billingHistory")}</h2>
          {billing.isLoading && <Skeleton className="m-4 h-48" />}
          {billing.isError && (
            <p className="p-4 text-sm text-danger">
              {tc("error")}{" "}
              <button className="underline" onClick={() => billing.refetch()}>
                {tc("retry")}
              </button>
            </p>
          )}
          {billing.data && billing.data.items.length === 0 && (
            <EmptyState icon={Receipt} title={t("noBillingRows")} subtitle="Completed bookings with payments will appear here." />
          )}
          {billing.data && billing.data.items.length > 0 && (
            <>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-navy-900 hover:bg-navy-900">
                      <TableHead className="text-white">{t("colBooking")}</TableHead>
                      <TableHead className="text-white">{t("colGuest")}</TableHead>
                      <TableHead className="text-white">{t("colRoomRent")}</TableHead>
                      <TableHead className="text-white">{t("colTax")}</TableHead>
                      <TableHead className="text-white">{t("colDiscount")}</TableHead>
                      <TableHead className="text-white">{t("colAdvance")}</TableHead>
                      <TableHead className="text-white">{t("colBalance")}</TableHead>
                      <TableHead className="text-white">{t("colMode")}</TableHead>
                      <TableHead className="text-white">{t("colStatus")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billing.data.items.map((row) => (
                      <TableRow key={row.booking_id}>
                        <TableCell className="font-medium">{row.booking_number}</TableCell>
                        <TableCell>{row.guest_name ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">{fmtINR(row.room_rent)}</TableCell>
                        <TableCell className="tabular-nums">{fmtINR(row.gst)}</TableCell>
                        <TableCell className="tabular-nums">{fmtINR(row.discount)}</TableCell>
                        <TableCell className="tabular-nums">{fmtINR(row.advance)}</TableCell>
                        <TableCell
                          className={cn(
                            "tabular-nums font-semibold",
                            Number(row.balance) > 0 ? "text-danger" : "text-success",
                          )}
                        >
                          {fmtINR(row.balance)}
                        </TableCell>
                        <TableCell>
                          {row.mode
                            ? t(
                                (
                                  {
                                    cash: "cash",
                                    upi: "upi",
                                    card: "card",
                                    credit_card: "creditCard",
                                    debit_card: "debitCard",
                                    bank_transfer: "bankTransfer",
                                    other: "otherMethod",
                                  } as Record<string, string>
                                )[row.mode] ?? "otherMethod",
                              )
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <PaymentStatusBadge status={row.payment_status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
                <span>
                  {t("showingEntries", {
                    from: billingPage * BILLING_PAGE_SIZE + 1,
                    to: Math.min(
                      (billingPage + 1) * BILLING_PAGE_SIZE,
                      billing.data.total,
                    ),
                    total: billing.data.total,
                  })}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={billingPage === 0}
                    onClick={() => setBillingPage((p) => p - 1)}
                  >
                    {t("previousPage")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(billingPage + 1) * BILLING_PAGE_SIZE >= billing.data.total}
                    onClick={() => setBillingPage((p) => p + 1)}
                  >
                    {t("nextPage")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ── Payment transactions: raw payments with Correct / Refund ── */}
        <details className="mt-6 rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            {t("paymentTransactions")}
          </summary>
          <div className="border-t p-4">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <Label>{t("selectBooking")}</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
            >
              <option value="">{t("selectBooking")}</option>
              {bookings.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.booking_number} · {b.primary_guest_name ?? "—"}
                </option>
              ))}
            </select>
          </div>
          {can(PERMISSIONS.paymentsCollect) && bookingId && (
            <>
              <CollectDialog bookingId={bookingId} onDone={invalidate} />
              <ChargeDialog bookingId={bookingId} onDone={invalidate} />
            </>
          )}
        </div>

        <section className="rounded-lg border bg-card">
          {payments.isLoading && <Skeleton className="h-48" />}
          {payments.isError && (
            <p className="p-4 text-sm text-danger">
              {tc("error")}{" "}
              <button className="underline" onClick={() => payments.refetch()}>
                {tc("retry")}
              </button>
            </p>
          )}
          {payments.data && payments.data.items.length === 0 && (
            <EmptyState icon={Wallet} title={t("noPayments")} subtitle="Individual payments collected from guests appear here." />
          )}
          {payments.data && payments.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("amount")}</TableHead>
                  <TableHead>{t("method")}</TableHead>
                  <TableHead>{t("purpose")}</TableHead>
                  <TableHead>{t("reference")}</TableHead>
                  <TableHead>Status</TableHead>
                  {showActions && <TableHead className="text-right">{tc("actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular-nums">{fmtINR(p.amount)}</TableCell>
                    <TableCell>{t(p.method)}</TableCell>
                    <TableCell>{t(`purpose_${p.purpose}`)}</TableCell>
                    <TableCell>{p.reference ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge tone={p.status === "completed" ? "success" : "warning"}>
                        {p.status}
                      </StatusBadge>
                    </TableCell>
                    {showActions && (
                      <TableCell className="space-x-1 text-right">
                        {can(PERMISSIONS.paymentsCorrect) && p.status === "completed" && (
                          <Button size="sm" variant="outline" onClick={() => setCorrectTarget(p)}>
                            {t("correct")}
                          </Button>
                        )}
                        {can(PERMISSIONS.paymentsRefund) && p.status === "completed" && (
                          <Button size="sm" variant="ghost" onClick={() => setRefundTarget(p)}>
                            {t("refundAction")}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        {bookingId && charges.data && charges.data.items.length > 0 && (
          <section className="mt-6 rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">{t("addCharge")}</h2>
            <ul className="space-y-1 text-sm">
              {charges.data.items.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span>
                    {c.description} × {c.quantity}
                    {c.voided_at ? " (void)" : ""}
                  </span>
                  <span className="tabular-nums">{fmtINR(c.total_amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {ledger.data && (
          <section className="mt-6 rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("ledger")}</h2>
              <p className="text-sm">
                {t("balance")}: <span className="tabular-nums font-semibold">{fmtINR(ledger.data.balance)}</span>
              </p>
            </div>
            <ul className="space-y-1 text-sm">
              {ledger.data.items.map((e) => (
                <li key={e.id} className="flex justify-between">
                  <span>
                    {e.entry_type === "debit" ? t("debit") : t("credit")} · {e.description}
                  </span>
                  <span className="tabular-nums">{fmtINR(e.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
          </div>
        </details>

        {correctTarget && (
          <CorrectPaymentDialog
            payment={correctTarget}
            onClose={() => setCorrectTarget(null)}
            onDone={invalidate}
          />
        )}
        {refundTarget && (
          <RefundDialog
            payment={refundTarget}
            onClose={() => setRefundTarget(null)}
            onDone={invalidate}
          />
        )}
      </main>
    </>
  );
}

function CorrectPaymentDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentOut;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("money");
  const tc = useTranslations("common");
  const api = useApi();
  const [amount, setAmount] = useState(payment.amount);
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api<PaymentOut>(`/api/v1/payments/${payment.id}/correct`, {
        method: "POST",
        body: { corrected_amount: amount, reason },
      }),
    onSuccess: () => {
      toast.success(t("correctionDone"));
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("correct")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{t("correctedAmount")}</Label>
            <Input
              className="mt-1"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("correctionReason")}</Label>
            <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!amount || reason.trim().length < 3 || mutation.isPending}
          >
            {mutation.isPending ? tc("saving") : t("correct")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentOut;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("money");
  const tc = useTranslations("common");
  const api = useApi();
  const [amount, setAmount] = useState(payment.amount);
  const [method, setMethod] = useState<string>(
    payment.method === "upi" ? "upi" : "cash",
  );
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api("/api/v1/payments/refunds", {
        method: "POST",
        body: {
          booking_id: payment.booking_id,
          amount,
          method,
          reason,
        },
      }),
    onSuccess: () => {
      toast.success(t("refundDone"));
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("refundAction")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{t("amount")}</Label>
            <Input
              className="mt-1"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("method")}</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border border-input px-2.5 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="cash">{t("cash")}</option>
              <option value="upi">{t("upi")}</option>
            </select>
          </div>
          <div>
            <Label>{t("refundReason")}</Label>
            <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!amount || reason.trim().length < 3 || mutation.isPending}
          >
            {mutation.isPending ? tc("saving") : t("refundAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CollectDialog({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const t = useTranslations("money");
  const tc = useTranslations("common");
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [purpose, setPurpose] = useState("stay");
  const [reference, setReference] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api<PaymentOut>("/api/v1/payments", {
        method: "POST",
        body: {
          booking_id: bookingId,
          amount,
          method,
          purpose,
          reference: reference || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("paymentCollected"));
      setOpen(false);
      setAmount("");
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground">
        {t("collectPayment")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("collectPayment")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{t("amount")}</Label>
            <Input className="mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>{t("method")}</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border border-input px-2.5 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="cash">{t("cash")}</option>
              <option value="upi">{t("upi")}</option>
              <option value="credit_card">{t("creditCard")}</option>
              <option value="debit_card">{t("debitCard")}</option>
              <option value="bank_transfer">{t("bankTransfer")}</option>
              <option value="other">{t("otherMethod")}</option>
            </select>
            {method !== "cash" && method !== "upi" && (
              <p className="mt-1 text-label text-info flex items-center gap-1">
                <span>ℹ</span>
                {method === "credit_card" || method === "debit_card"
                  ? "Collected via card machine — recorded for your accounts"
                  : method === "bank_transfer"
                  ? "Collected via net banking — recorded for your accounts"
                  : "Collected externally — recorded for your accounts"}
              </p>
            )}
          </div>
          <div>
            <Label>{t("purpose")}</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border border-input px-2.5 text-sm"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              {["advance", "stay", "deposit", "charge", "other"].map((p) => (
                <option key={p} value={p}>
                  {t(`purpose_${p}`)}
                </option>
              ))}
            </select>
          </div>
          {method === "upi" && (
            <div>
              <Label>{t("reference")}</Label>
              <Input className="mt-1" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button onClick={() => mutation.mutate()} disabled={!amount || mutation.isPending}>
            {mutation.isPending ? tc("saving") : t("collectPayment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChargeDialog({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const t = useTranslations("money");
  const tc = useTranslations("common");
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("food");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [rate, setRate] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api("/api/v1/charges", {
        method: "POST",
        body: { booking_id: bookingId, category, description, quantity: Number(quantity), rate },
      }),
    onSuccess: () => {
      toast.success(t("chargeAdded"));
      setOpen(false);
      setDescription("");
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
        {t("addCharge")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addCharge")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{t("chargeCategory")}</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border border-input px-2.5 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {/* Full backend charge-category set (was missing restaurant/damage) */}
              {["food", "restaurant", "laundry", "room_service", "extra_bed", "minibar", "transport", "damage", "other"].map(
                (c) => (
                  <option key={c} value={c}>
                    {t(`category_${c}`)}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <Label>{t("chargeDescription")}</Label>
            <Input className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("quantity")}</Label>
              <Input className="mt-1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <Label>{t("rate")}</Label>
              <Input className="mt-1" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button onClick={() => mutation.mutate()} disabled={!description || !rate || mutation.isPending}>
            {t("addCharge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.paymentsView}>
      <PaymentsContent />
    </RequirePermission>
  );
}
