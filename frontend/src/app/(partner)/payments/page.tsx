"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
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
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { PERMISSIONS } from "@/lib/permissions";
import type { ListOut } from "@/types/hotel";
import type { BookingOut } from "@/types/stay";
import type { ChargeOut, LedgerOut, PaymentOut } from "@/types/money";

interface PaymentSummary {
  total_collected: string;
  cash: string;
  upi: string;
  refunds: string;
  deposits: string;
  paid_bookings: number;
  partial_bookings: number;
  unpaid_bookings: number;
}

function PaymentsContent() {
  const t = useTranslations("money");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();
  const [bookingId, setBookingId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

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
    queryClient.invalidateQueries({ queryKey: ["charges", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["ledger", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
  };

  return (
    <>
      <PartnerHeader title={t("paymentsTitle")} subtitle={tn("money")} />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Date filters */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <Label>{t("fromDate")}</Label>
            <DateInput
              className="mt-1"
              value={fromDate}
              onChange={setFromDate}
            />
          </div>
          <div>
            <Label>{t("toDate")}</Label>
            <DateInput
              className="mt-1"
              value={toDate}
              onChange={setToDate}
            />
          </div>
          {(fromDate || toDate) && (
            <Button
              variant="outline"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
            >
              {t("clearFilters")}
            </Button>
          )}
        </div>

        {/* Summary cards — paid/partial/pending are booking counts (the API
            exposes counts, not amounts, for those statuses). */}
        {summary.data && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {(
              [
                ["totalCollected", `₹${summary.data.total_collected}`, "bg-navy-900 text-white"],
                ["paidCard", String(summary.data.paid_bookings), "bg-green-800 text-white"],
                ["cash", `₹${summary.data.cash}`, "bg-gold-500 text-navy-900"],
                ["upi", `₹${summary.data.upi}`, "bg-success text-white"],
                ["partialCard", String(summary.data.partial_bookings), "bg-amber-700 text-white"],
                ["pendingCard", String(summary.data.unpaid_bookings), "bg-danger text-white"],
              ] as const
            ).map(([key, value, className]) => (
              <div key={key} className={`rounded-lg p-4 ${className}`}>
                <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80">
                  {t(key)}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        )}

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
            <p className="p-6 text-sm text-muted-foreground">{t("noPayments")}</p>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular-nums">₹{p.amount}</TableCell>
                    <TableCell>{t(p.method)}</TableCell>
                    <TableCell>{t(`purpose_${p.purpose}`)}</TableCell>
                    <TableCell>{p.reference ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge tone={p.status === "completed" ? "success" : "warning"}>
                        {p.status}
                      </StatusBadge>
                    </TableCell>
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
                  <span className="tabular-nums">₹{c.total_amount}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Billing history per booking */}
        {bookings.data && bookings.data.items.length > 0 && (
          <section className="mt-6 rounded-lg border bg-card">
            <h2 className="px-4 pt-4 text-sm font-semibold">{t("billingHistory")}</h2>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-navy-900 hover:bg-navy-900">
                    <TableHead className="text-white">{t("colBooking")}</TableHead>
                    <TableHead className="text-white">{t("colGuest")}</TableHead>
                    <TableHead className="text-white">{t("colTotal")}</TableHead>
                    <TableHead className="text-white">{t("colTax")}</TableHead>
                    <TableHead className="text-white">{t("colAdvance")}</TableHead>
                    <TableHead className="text-white">{t("colBalance")}</TableHead>
                    <TableHead className="text-white">{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.data.items.slice(0, 20).map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.booking_number}</TableCell>
                      <TableCell>{b.primary_guest_name ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">₹{b.total_amount}</TableCell>
                      <TableCell className="tabular-nums">₹{b.tax_amount}</TableCell>
                      <TableCell className="tabular-nums">₹{b.advance_amount}</TableCell>
                      <TableCell className="tabular-nums font-medium">₹{b.due_amount}</TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            b.payment_status === "paid"
                              ? "success"
                              : b.payment_status === "partial"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {b.payment_status}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        )}

        {ledger.data && (
          <section className="mt-6 rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("ledger")}</h2>
              <p className="text-sm">
                {t("balance")}: <span className="tabular-nums font-semibold">₹{ledger.data.balance}</span>
              </p>
            </div>
            <ul className="space-y-1 text-sm">
              {ledger.data.items.map((e) => (
                <li key={e.id} className="flex justify-between">
                  <span>
                    {e.entry_type === "debit" ? t("debit") : t("credit")} · {e.description}
                  </span>
                  <span className="tabular-nums">₹{e.amount}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
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
              <option value="card">{t("card")}</option>
              <option value="bank_transfer">{t("bankTransfer")}</option>
              <option value="other">{t("otherMethod")}</option>
            </select>
            {method !== "cash" && method !== "upi" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Manual record only — collected outside the app
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
              {["food", "laundry", "room_service", "extra_bed", "minibar", "transport", "other"].map(
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
