"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, MessageCircle, Printer } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationFooter, paginate } from "@/components/ui/pagination-footer";
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
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { fmtApiDate, fmtApiDateTime, fmtINR } from "@/lib/formatting";
import { API_BASE, ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import type { GstSettingsOut, HotelOut, ListOut } from "@/types/hotel";
import type { BookingOut } from "@/types/stay";
import type { InvoiceOut } from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

/** Build a wa.me phone: strip non-digits and ensure the 91 country prefix. */
function waPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function InvoicesContent() {
  const t = useTranslations("invoices");
  const tp = useTranslations("invoicePreview");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const cancelConfirm = useConfirmDialog();
  // Selected invoice for the styled preview card (single proper invoice —
  // client 09/2026: merged the old separate "Invoice Preview" page in here).
  const [selectedId, setSelectedId] = useState("");
  const [sharingPdf, setSharingPdf] = useState(false);

  const invoices = useQuery({
    queryKey: ["invoices", activeHotelId],
    queryFn: () => api<ListOut<InvoiceOut>>("/api/v1/invoices?limit=50"),
    enabled: !!activeHotelId,
  });

  const hotel = useQuery({
    queryKey: ["hotel", activeHotelId],
    queryFn: () => api<HotelOut>("/api/v1/hotels/me"),
    enabled: !!activeHotelId,
  });

  const gst = useQuery({
    queryKey: ["gst-settings", activeHotelId],
    queryFn: () => api<GstSettingsOut>("/api/v1/hotels/me/gst"),
    enabled: !!activeHotelId,
    retry: false,
  });

  // Auto-select the first invoice once the list loads.
  useEffect(() => {
    if (!selectedId && invoices.data && invoices.data.items.length > 0) {
      setSelectedId(invoices.data.items[0].id);
    }
  }, [invoices.data, selectedId]);

  const invoice = invoices.data?.items.find((inv) => inv.id === selectedId);

  const booking = useQuery({
    queryKey: ["booking", activeHotelId, invoice?.booking_id],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${invoice!.booking_id}`),
    enabled: !!activeHotelId && !!invoice,
  });

  const gstTotal = invoice
    ? Number(invoice.cgst_amount) +
      Number(invoice.sgst_amount) +
      Number(invoice.igst_amount)
    : 0;

  const hotelAddress = hotel.data
    ? [
        hotel.data.address_line1,
        hotel.data.address_line2,
        hotel.data.city,
        hotel.data.state,
        hotel.data.postal_code,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  const guestPhone = booking.data?.primary_guest_phone ?? null;

  const shareInvoiceWhatsApp = async () => {
    if (!invoice || !guestPhone) return;
    const hotelName = hotel.data?.name ?? "";
    const text = `${hotelName} — ${tp("waInvoice")} ${invoice.invoice_number} — ${tp("waTotalDue")} ${fmtINR(invoice.due_amount)}`;

    // Mobile: try Web Share API with the PDF file attached.
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        setSharingPdf(true);
        const token = getAccessToken();
        const res = await fetch(`${API_BASE}/api/v1/invoices/${invoice.id}/pdf`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
            "X-Hotel-Id": activeHotelId ?? "",
          },
          credentials: "include",
        });
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], `${invoice.invoice_number}.pdf`, {
            type: "application/pdf",
          });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: `${hotelName} Invoice`, text });
            return;
          }
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        // Fall through to URL on any error.
        toast.error(tp("shareFailed"));
      } finally {
        setSharingPdf(false);
      }
    }

    // Desktop fallback: text-only wa.me link.
    window.open(
      `https://wa.me/${waPhone(guestPhone)}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["invoices", activeHotelId] });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/v1/invoices/${id}/cancel`, { method: "POST", body: { reason } }),
    onSuccess: () => {
      toast.success(t("cancelled"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const downloadPdf = async (id: string) => {
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
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <>
      {/* Print stylesheet: isolate the invoice card when printing */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print-area, #invoice-print-area * { visibility: visible !important; }
          #invoice-print-area {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }
        }
      `}</style>
      <PartnerHeader title={t("title")} subtitle={tn("money")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex justify-end">
          <GenerateDialog onDone={invalidate} />
        </div>
        <div className="rounded-lg border bg-card">
          {invoices.isLoading && <Skeleton className="h-48" />}
          {invoices.isError && (
            <p className="rounded-lg border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
              {tc("error")}{" "}
              <button type="button" className="underline" onClick={() => invoices.refetch()}>
                {tc("retry")}
              </button>
            </p>
          )}
          {invoices.data?.items.length === 0 && (
            <EmptyState icon={FileText} title={t("noInvoices")} subtitle="Invoices are generated automatically at checkout." />
          )}
          {invoices.data && invoices.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoiceNumber")}</TableHead>
                  <TableHead>{t("guest")}</TableHead>
                  <TableHead>{t("total")}</TableHead>
                  <TableHead>{t("due")}</TableHead>
                  <TableHead>{t("statusCol")}</TableHead>
                  <TableHead>{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginate(invoices.data.items, page, 10).map((inv) => (
                  <TableRow
                    key={inv.id}
                    className={inv.id === selectedId ? "bg-muted/50" : undefined}
                  >
                    <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                    <TableCell>{inv.guest_name}</TableCell>
                    <TableCell className="tabular-nums">{fmtINR(inv.total_amount)}</TableCell>
                    <TableCell className="tabular-nums">{fmtINR(inv.due_amount)}</TableCell>
                    <TableCell>
                      <StatusBadge tone={inv.status === "cancelled" ? "danger" : "info"}>
                        {t(`status_${inv.status}`)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="space-x-2">
                      <Button variant="outline" size="sm" onClick={() => setSelectedId(inv.id)}>
                        {tc("view")}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => downloadPdf(inv.id)}>
                        {t("downloadPdf")}
                      </Button>
                      {inv.status !== "cancelled" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCancelTarget(inv.id);
                            cancelConfirm.show();
                          }}
                        >
                          {t("cancelInvoice")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {invoices.data && invoices.data.items.length > 0 && (
            <PaginationFooter
              page={page}
              total={invoices.data.items.length}
              pageSize={10}
              onPageChange={setPage}
            />
          )}
        </div>

        {/* ── Styled invoice preview (the ONE proper invoice design) ── */}
        {invoice && (
          <div className="mt-6">
            <div className="mx-auto mb-3 flex max-w-3xl items-center justify-end gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                {tp("print")}
              </Button>
              {guestPhone && (
                <Button
                  variant="default"
                  size="sm"
                  disabled={sharingPdf}
                  onClick={() => void shareInvoiceWhatsApp()}
                >
                  <MessageCircle className="size-4" aria-hidden />
                  {sharingPdf ? tp("preparingPdf") : tp("whatsapp")}
                </Button>
              )}
            </div>
            <div
              id="invoice-print-area"
              className="mx-auto max-w-3xl overflow-hidden rounded-lg border bg-card shadow-sm"
            >
              {/* Header */}
              <div className="bg-navy-900 p-6 text-white">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xl font-semibold">{hotel.data?.name ?? "—"}</p>
                    {hotelAddress && (
                      <p className="mt-1 max-w-sm text-xs opacity-80">{hotelAddress}</p>
                    )}
                    {gst.data?.gstin && (
                      <p className="mt-1 text-xs opacity-80">GSTIN: {gst.data.gstin}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-micro font-semibold uppercase tracking-widest opacity-70">
                      {t("invoiceNumber")}
                    </p>
                    <p className="text-sm font-semibold">{invoice.invoice_number}</p>
                    <p className="mt-1 text-xs opacity-80">
                      {fmtApiDate(invoice.invoice_date)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Billed to + stay details */}
              <div className="grid gap-6 p-6 sm:grid-cols-2">
                <div>
                  <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                    {tp("billedTo")}
                  </p>
                  <p className="mt-1.5 text-sm font-medium">{invoice.guest_name}</p>
                  {guestPhone && (
                    <p className="text-sm text-muted-foreground">{guestPhone}</p>
                  )}
                  {invoice.guest_address && (
                    <p className="text-sm text-muted-foreground">{invoice.guest_address}</p>
                  )}
                </div>
                <div>
                  <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                    {tp("stayDetails")}
                  </p>
                  {booking.isLoading && <Skeleton className="mt-1.5 h-10" />}
                  {booking.data && (
                    <>
                      <p className="mt-1.5 text-sm font-medium">
                        {booking.data.rooms
                          .map((r) => `${r.room_number} (${r.room_type_name})`)
                          .join(", ") || "—"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {fmtApiDateTime(booking.data.check_in_date, booking.data.check_in_time)} →{" "}
                        {fmtApiDateTime(booking.data.check_out_date, booking.data.check_out_time)}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Line items */}
              <div className="px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                        {tp("colDescription")}
                      </th>
                      <th className="py-2 text-right text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                        {tp("colAmount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item) => (
                      <tr key={item.id} className="border-b last:border-b-0">
                        <td className="py-2">
                          {item.description}
                          {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {fmtINR(item.total_amount)}
                        </td>
                      </tr>
                    ))}
                    {invoice.items.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-3 text-muted-foreground">
                          {tp("noLineItems")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end p-6">
                <div className="w-full max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{tp("subtotal")}</span>
                    <span className="tabular-nums">{fmtINR(invoice.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{tp("gst")}</span>
                    <span className="tabular-nums">{fmtINR(gstTotal)}</span>
                  </div>
                  {Number(invoice.discount_amount) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{tp("discount")}</span>
                      <span className="tabular-nums">−{fmtINR(invoice.discount_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium text-gold-600">
                    <span>{tp("advancePaid")}</span>
                    <span className="tabular-nums">−{fmtINR(invoice.paid_amount)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t pt-2">
                    <span className="text-xs font-semibold uppercase tracking-widest">
                      {tp("totalDue")}
                    </span>
                    <span className="text-xl font-semibold tabular-nums">
                      {fmtINR(invoice.due_amount)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <ConfirmDialog
          open={cancelConfirm.open}
          title={t("cancelInvoice")}
          requireText
          textLabel={t("cancelReason")}
          textPlaceholder={t("cancelReason")}
          confirmLabel={t("cancelInvoice")}
          confirmVariant="destructive"
          isPending={cancelMutation.isPending}
          onConfirm={(reason) => {
            if (cancelTarget) {
              cancelMutation.mutate({ id: cancelTarget, reason });
              cancelConfirm.hide();
              setCancelTarget(null);
            }
          }}
          onCancel={() => {
            cancelConfirm.hide();
            setCancelTarget(null);
          }}
        />
      </main>
    </>
  );
}

function GenerateDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [open, setOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [interstate, setInterstate] = useState(false);

  const bookings = useQuery({
    queryKey: ["bookings", activeHotelId],
    queryFn: () => api<ListOut<BookingOut>>("/api/v1/bookings?limit=50"),
    enabled: open && !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api("/api/v1/invoices", {
        method: "POST",
        body: { booking_id: bookingId, interstate },
      }),
    onSuccess: () => {
      toast.success(t("generated"));
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground">
        {t("generate")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("generate")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="inv-booking">Booking</Label>
            <select
              id="inv-booking"
              className="mt-1 h-8 w-full rounded-lg border px-2.5 text-sm"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
            >
              <option value="">—</option>
              {bookings.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.booking_number}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={interstate}
              onChange={(e) => setInterstate(e.target.checked)}
            />
            {t("interstate")}
          </label>
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button disabled={!bookingId || mutation.isPending} onClick={() => mutation.mutate()}>
            {t("generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InvoicesPage() {
  return (
    <RequirePermission permission={PERMISSIONS.invoicesManage}>
      <InvoicesContent />
    </RequirePermission>
  );
}
