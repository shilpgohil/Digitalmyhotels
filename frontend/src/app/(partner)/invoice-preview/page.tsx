"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Printer } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { fmtApiDate } from "@/lib/formatting";
import { PERMISSIONS } from "@/lib/permissions";
import type { GstSettingsOut, HotelOut, ListOut } from "@/types/hotel";
import type { InvoiceOut } from "@/types/money";
import type { BookingOut } from "@/types/stay";

/** Build a wa.me phone: strip non-digits and ensure the 91 country prefix. */
function waPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function InvoicePreviewContent() {
  const t = useTranslations("invoicePreview");
  const ti = useTranslations("invoices");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [selectedId, setSelectedId] = useState("");

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
    ? (
        Number(invoice.cgst_amount) +
        Number(invoice.sgst_amount) +
        Number(invoice.igst_amount)
      ).toFixed(2)
    : "0.00";

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

  const whatsappHref =
    invoice && guestPhone
      ? `https://wa.me/${waPhone(guestPhone)}?text=${encodeURIComponent(
          `${hotel.data?.name ?? ""} — ${t("waInvoice")} ${invoice.invoice_number} — ${t("waTotalDue")} ₹${invoice.due_amount}`,
        )}`
      : null;

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
      <main className="flex-1 overflow-y-auto p-6">
        {/* Selector + actions */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-72">
            <Label>{t("selectInvoice")}</Label>
            <select
              className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">{t("selectInvoice")}</option>
              {invoices.data?.items.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number} — {inv.guest_name}
                </option>
              ))}
            </select>
          </div>
          {invoice && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                {t("print")}
              </Button>
              {whatsappHref && (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  {t("whatsapp")}
                </a>
              )}
            </div>
          )}
        </div>

        {invoices.isLoading && <Skeleton className="mx-auto h-96 max-w-3xl" />}
        {invoices.isError && (
          <p className="text-sm text-danger">
            {tc("error")}{" "}
            <button className="underline" onClick={() => invoices.refetch()}>
              {tc("retry")}
            </button>
          </p>
        )}
        {invoices.data && invoices.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{ti("noInvoices")}</p>
        )}

        {/* Invoice card */}
        {invoice && (
          <div
            id="invoice-print-area"
            className="mx-auto max-w-3xl overflow-hidden rounded-lg border bg-card shadow-sm"
          >
            {/* Header */}
            <div className="bg-navy-900 p-6 text-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xl font-semibold">
                    {hotel.data?.name ?? "—"}
                  </p>
                  {hotelAddress && (
                    <p className="mt-1 max-w-sm text-xs opacity-80">{hotelAddress}</p>
                  )}
                  {gst.data?.gstin && (
                    <p className="mt-1 text-xs opacity-80">GSTIN: {gst.data.gstin}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-widest opacity-70">
                    {ti("invoiceNumber")}
                  </p>
                  <p className="text-lg font-semibold">{invoice.invoice_number}</p>
                  <p className="mt-1 text-xs opacity-80">
                    {fmtApiDate(invoice.invoice_date)}
                  </p>
                </div>
              </div>
            </div>

            {/* Billed to + stay details */}
            <div className="grid gap-6 p-6 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("billedTo")}
                </p>
                <p className="mt-1.5 text-sm font-medium">{invoice.guest_name}</p>
                {guestPhone && <p className="text-sm text-muted-foreground">{guestPhone}</p>}
                {invoice.guest_address && (
                  <p className="text-sm text-muted-foreground">{invoice.guest_address}</p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("stayDetails")}
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
                      {fmtApiDate(booking.data.check_in_date)} →{" "}
                      {fmtApiDate(booking.data.check_out_date)}
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
                    <th className="py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {t("colDescription")}
                    </th>
                    <th className="py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {t("colAmount")}
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
                      <td className="py-2 text-right tabular-nums">₹{item.total_amount}</td>
                    </tr>
                  ))}
                  {invoice.items.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-3 text-muted-foreground">
                        {t("noLineItems")}
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
                  <span className="text-muted-foreground">{t("subtotal")}</span>
                  <span className="tabular-nums">₹{invoice.subtotal}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("gst")}</span>
                  <span className="tabular-nums">₹{gstTotal}</span>
                </div>
                {Number(invoice.discount_amount) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("discount")}</span>
                    <span className="tabular-nums">−₹{invoice.discount_amount}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium text-gold-600">
                  <span>{t("advancePaid")}</span>
                  <span className="tabular-nums">−₹{invoice.paid_amount}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t pt-2">
                  <span className="text-xs font-semibold uppercase tracking-widest">
                    {t("totalDue")}
                  </span>
                  <span className="text-2xl font-semibold tabular-nums">
                    ₹{invoice.due_amount}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default function InvoicePreviewPage() {
  return (
    <RequirePermission permission={PERMISSIONS.invoicesManage}>
      <InvoicePreviewContent />
    </RequirePermission>
  );
}
