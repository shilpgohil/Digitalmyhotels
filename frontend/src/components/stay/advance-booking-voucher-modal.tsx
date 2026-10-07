"use client";

/**
 * Advance Booking Confirmation & Receipt Voucher Modal.
 *
 * Provides a legally compliant hospitality payment proof for guests who
 * pay advance money during advance reservations.
 *
 * In accordance with Section 31(3)(d) of the Central Goods and Services
 * Tax (CGST) Act, 2017, a Receipt Voucher is the statutory document for
 * advance receipts prior to the supply of accommodation service. Final Tax
 * Invoices are generated at guest stay / check-out.
 */

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Printer,
  Share2,
  Copy,
  Check,
  CheckCircle2,
  Receipt,
  Calendar,
  User,
  Phone,
  BedDouble,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtApiDate, fmtINR } from "@/lib/formatting";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import type { BookingOut } from "@/types/stay";
import type { HotelOut } from "@/types/hotel";

interface AdvanceBookingVoucherModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly booking: BookingOut | null;
  /** Optional payment details if known at advance creation time */
  readonly paymentInfo?: {
    amount: string;
    method: string;
  } | null;
}

export function AdvanceBookingVoucherModal({
  open,
  onClose,
  booking,
  paymentInfo,
}: AdvanceBookingVoucherModalProps) {
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const hotelQuery = useQuery({
    queryKey: ["hotel-profile", activeHotelId],
    queryFn: () => api<HotelOut>("/api/v1/hotels/me"),
    enabled: !!activeHotelId && open,
    staleTime: 300_000,
  });

  const gstQuery = useQuery({
    queryKey: ["hotel-gst", activeHotelId],
    queryFn: () => api<{ gstin: string | null }>("/api/v1/hotels/me/gst"),
    enabled: !!activeHotelId && open,
    staleTime: 300_000,
  });

  if (!booking) return null;

  const hotel = hotelQuery.data;
  const gstin = gstQuery.data?.gstin;
  const advancePaid = paymentInfo?.amount ?? booking.advance_amount ?? "0";
  const payMethod = paymentInfo?.method ?? "Cash / UPI";

  // Prevent duplicate prefix when booking_number is already formatted like "BK-0052"
  const rawNum = booking.booking_number || "";
  const voucherRef = rawNum.startsWith("BK-") ? rawNum : `BK-${rawNum}`;

  const buildSummaryText = () => {
    const hotelName = hotel?.name || "Hotel Reservation";
    const guestName = booking.primary_guest_name || "Guest";
    const roomList =
      booking.rooms?.map((r) => r.room_number).join(", ") || "Assigned at check-in";
    const lines = [
      `*${hotelName} — Advance Booking Confirmation*`,
      `Dear ${guestName}, your room booking is confirmed!`,
      ``,
      `*Voucher Ref:* ${voucherRef}`,
      `*Check-in:* ${fmtApiDate(booking.check_in_date)}${booking.check_in_time ? ` (${booking.check_in_time})` : ""}`,
      `*Check-out:* ${fmtApiDate(booking.check_out_date)}${booking.check_out_time ? ` (${booking.check_out_time})` : ""}`,
      `*Room(s):* ${roomList}`,
      `*Guests:* ${booking.adults} Adults${booking.children ? `, ${booking.children} Children` : ""}`,
      ``,
      `*Financial Details:*`,
      `Estimated Tariff: ₹${booking.total_amount}`,
      `Advance Received: ₹${advancePaid} (${payMethod.toUpperCase()})`,
      `Balance at Check-in: ₹${booking.due_amount}`,
      ``,
      `*Notice:* This is an Advance Booking Confirmation & Receipt Voucher. The final Tax Invoice with GST breakdown will be issued at check-out.`,
      `We look forward to welcoming you!`,
      hotel?.phone ? `Contact: ${hotel.phone}` : "",
      hotel?.city ? `${hotel.city}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  };

  const handleCopy = () => {
    const text = buildSummaryText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Voucher details copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    const rawPhone = (booking.primary_guest_phone || "").replace(/\D/g, "");
    const targetPhone =
      rawPhone.startsWith("91") && rawPhone.length === 12
        ? rawPhone
        : rawPhone.length === 10
        ? `91${rawPhone}`
        : rawPhone;
    const text = buildSummaryText();
    const url = targetPhone
      ? `https://wa.me/${targetPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:max-w-[920px] max-h-[92vh] overflow-y-auto p-0 border border-slate-200 shadow-2xl">
        {/* Scoped print styles for crystal-clear A4 paper vouchers */}
        <style>{`
          @media print {
            @page {
              margin: 10mm;
              size: A4 portrait;
            }
            body * { visibility: hidden !important; }
            #advance-voucher-print-area, #advance-voucher-print-area * { visibility: visible !important; }
            #advance-voucher-print-area {
              position: absolute !important;
              inset: 0 auto auto 0 !important;
              width: 100% !important;
              margin: 0 !important;
              box-shadow: none !important;
              border: none !important;
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
          }
        `}</style>

        <DialogHeader className="p-4 pb-3 border-b bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-navy-900 text-white shadow-sm">
              <Receipt className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-navy-900">
                Advance Booking Confirmation & Receipt Voucher
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Statutory payment proof for advance room reservations under CGST Act Sec 31(3)(d)
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Printable Voucher Paper */}
        <div className="p-6 sm:p-8 space-y-6 bg-white" id="advance-voucher-print-area" ref={printRef}>
          {/* Header with Hotel Branding */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b pb-5">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight text-navy-900">
                {hotel?.name || "Hotel Reservation"}
              </h2>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {hotel?.address_line1 && <p>{hotel.address_line1}</p>}
                {(hotel?.city || hotel?.state) && (
                  <p>
                    {[hotel.city, hotel.state, hotel.postal_code]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                {hotel?.phone && (
                  <p className="flex items-center gap-1.5 pt-0.5">
                    <Phone className="size-3" /> {hotel.phone}
                  </p>
                )}
                {gstin && (
                  <p className="pt-1 font-semibold tracking-wide text-foreground">
                    GSTIN: <span className="text-navy-900">{gstin}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="text-left sm:text-right space-y-1.5 self-start sm:self-auto">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100/90 text-emerald-800 px-3.5 py-1 text-xs font-semibold">
                <CheckCircle2 className="size-3.5" />
                Confirmed Reservation
              </div>
              <p className="text-xs text-muted-foreground">
                Voucher Ref: <span className="font-semibold tracking-wide text-foreground">{voucherRef}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Date: <span className="font-medium text-foreground">{fmtApiDate(booking.created_at)}</span>
              </p>
            </div>
          </div>

          {/* Guest and Stay Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5 text-xs">
            <div className="space-y-2">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 text-micro">
                <User className="size-3.5 text-navy-800" /> Guest Information
              </span>
              <p className="font-bold text-sm text-navy-900">
                {booking.primary_guest_name || "—"}
              </p>
              <p className="text-muted-foreground">
                Mobile: <span className="font-medium text-foreground">{booking.primary_guest_phone || "—"}</span>
              </p>
              <p className="text-muted-foreground">
                Occupancy: <span className="font-medium text-foreground">{booking.adults} Adults{booking.children ? `, ${booking.children} Children` : ""}</span>
              </p>
            </div>

            <div className="space-y-2">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 text-micro">
                <Calendar className="size-3.5 text-navy-800" /> Stay Period & Rooms
              </span>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Check-in:</span>
                <span className="font-semibold text-foreground">
                  {fmtApiDate(booking.check_in_date)}
                  {booking.check_in_time ? ` @ ${booking.check_in_time}` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Check-out:</span>
                <span className="font-semibold text-foreground">
                  {fmtApiDate(booking.check_out_date)}
                  {booking.check_out_time ? ` @ ${booking.check_out_time}` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <BedDouble className="size-3 text-muted-foreground" /> Room(s):
                </span>
                <span className="font-semibold text-navy-900">
                  {booking.rooms?.map((r) => r.room_number).join(", ") || "Assigned on arrival"}
                </span>
              </div>
            </div>
          </div>

          {/* Financial Breakdown Table */}
          <div className="rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <table className="w-full text-xs">
              <thead className="bg-slate-100/70 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold text-muted-foreground">
                    Description
                  </th>
                  <th className="py-3 px-4 text-right font-semibold text-muted-foreground">
                    Amount (INR)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="py-3 px-4">
                    <p className="font-medium text-foreground">Estimated Accommodation Charges</p>
                    <p className="text-muted-foreground text-micro">
                      {booking.rooms?.length ?? 1} Room(s) • Final taxes calculated upon check-out
                    </p>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums text-foreground">
                    {fmtINR(booking.total_amount)}
                  </td>
                </tr>

                <tr className="bg-emerald-50/60">
                  <td className="py-3 px-4">
                    <p className="font-medium text-emerald-950">
                      Advance Payment Received
                    </p>
                    <p className="text-emerald-700 text-micro">
                      Mode: {payMethod.toUpperCase()} • Receipt Voucher under Sec 31(3)(d) CGST Act
                    </p>
                  </td>
                  <td className="py-3 px-4 text-right font-bold tabular-nums text-emerald-700">
                    −{fmtINR(advancePaid)}
                  </td>
                </tr>

                <tr className="bg-slate-100/70 font-semibold border-t border-slate-200">
                  <td className="py-3 px-4 text-navy-900 font-bold">
                    Balance Payable at Check-in
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-sm font-bold text-navy-900">
                    {fmtINR(booking.due_amount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Statutory Disclosure & Signature */}
          <div className="space-y-4 pt-1">
            <div className="rounded-lg border border-amber-300/80 bg-amber-50/50 p-3.5 text-micro text-amber-950 flex items-start gap-2.5">
              <ShieldCheck className="size-4 shrink-0 text-amber-700 mt-0.5" />
              <div>
                <p className="font-bold">GST Statutory Compliance Note:</p>
                <p className="mt-0.5 leading-relaxed text-amber-900/90">
                  In compliance with Section 31(3)(d) of the CGST Act, 2017, this document is a
                  Receipt Voucher acknowledging advance consideration. Final Tax Invoice with
                  detailed HSN/SAC and GST breakdown will be issued upon check-out when the
                  hospitality service is rendered.
                </p>
              </div>
            </div>

            <div className="flex justify-between items-end pt-5 border-t border-slate-200 text-micro text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">Generated by DigitalMyHotels Operations Desk</p>
                <p>{new Date().toLocaleString("en-IN")}</p>
              </div>
              <div className="text-center">
                <div className="h-8 border-b border-muted-foreground/30 w-40 mb-1.5" />
                <p className="font-medium text-foreground">Authorized Signatory</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-t bg-muted/20">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="gap-1.5"
            >
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy Details"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleWhatsApp}
              className="gap-1.5 text-emerald-700 hover:text-emerald-800"
            >
              <Share2 className="size-3.5" />
              WhatsApp Guest
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="gap-1.5"
            >
              <Printer className="size-3.5" />
              Print Voucher
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onClose}
              className="bg-navy-900 text-white hover:bg-navy-800"
            >
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
