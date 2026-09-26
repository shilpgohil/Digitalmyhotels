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

  const buildSummaryText = () => {
    const hotelName = hotel?.name || "Hotel Reservation";
    const guestName = booking.primary_guest_name || "Guest";
    const roomList =
      booking.rooms?.map((r) => r.room_number).join(", ") || "Assigned at check-in";
    const lines = [
      `*${hotelName} — Advance Booking Confirmation*`,
      `Dear ${guestName}, your room booking is confirmed!`,
      ``,
      `*Booking Ref:* ${booking.booking_number}`,
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-4 pb-2 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-navy-900 text-white">
              <Receipt className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Advance Booking Confirmation & Receipt Voucher
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Statutory payment proof for advance room reservations
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Printable Voucher Paper */}
        <div className="p-6 space-y-6" id="advance-voucher-print-area" ref={printRef}>
          {/* Header with Hotel Branding */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b pb-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-navy-900">
                {hotel?.name || "Hotel Reservation"}
              </h2>
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                {hotel?.address_line1 && <p>{hotel.address_line1}</p>}
                {(hotel?.city || hotel?.state) && (
                  <p>
                    {[hotel.city, hotel.state, hotel.postal_code]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                {hotel?.phone && <p>Phone: {hotel.phone}</p>}
                {gstin && <p className="font-mono font-medium text-foreground">GSTIN: {gstin}</p>}
              </div>
            </div>

            <div className="text-left sm:text-right space-y-1">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-xs font-semibold">
                <CheckCircle2 className="size-3.5" />
                Confirmed Reservation
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Voucher Ref: <span className="font-mono font-semibold text-foreground">BK-{booking.booking_number}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Date: {fmtApiDate(booking.created_at)}
              </p>
            </div>
          </div>

          {/* Guest and Stay Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border bg-muted/10 p-4 text-xs">
            <div className="space-y-1.5">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 text-micro">
                <User className="size-3.5" /> Guest Information
              </span>
              <p className="font-bold text-sm text-foreground">
                {booking.primary_guest_name || "—"}
              </p>
              <p className="text-muted-foreground">
                Mobile: {booking.primary_guest_phone || "—"}
              </p>
              <p className="text-muted-foreground">
                Occupancy: {booking.adults} Adults
                {booking.children ? `, ${booking.children} Children` : ""}
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 text-micro">
                <Calendar className="size-3.5" /> Stay Period
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
                <span className="text-muted-foreground">Room(s):</span>
                <span className="font-semibold text-foreground">
                  {booking.rooms?.map((r) => r.room_number).join(", ") || "Assigned on arrival"}
                </span>
              </div>
            </div>
          </div>

          {/* Financial Breakdown Table */}
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="py-2.5 px-4 text-left font-semibold text-muted-foreground">
                    Description
                  </th>
                  <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-foreground">Estimated Accommodation Charges</p>
                    <p className="text-muted-foreground text-micro">
                      {booking.rooms?.length ?? 1} Room(s)
                    </p>
                  </td>
                  <td className="py-2.5 px-4 text-right font-semibold tabular-nums text-foreground">
                    {fmtINR(booking.total_amount)}
                  </td>
                </tr>

                <tr className="bg-emerald-50/50">
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-emerald-900">
                      Advance Payment Received
                    </p>
                    <p className="text-emerald-700 text-micro">
                      Mode: {payMethod.toUpperCase()} • Receipt Voucher under Sec 31(3)(d) CGST Act
                    </p>
                  </td>
                  <td className="py-2.5 px-4 text-right font-bold tabular-nums text-emerald-700">
                    −{fmtINR(advancePaid)}
                  </td>
                </tr>

                <tr className="bg-muted/20 font-semibold">
                  <td className="py-2.5 px-4 text-foreground">
                    Balance Payable at Check-in
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums text-base text-navy-900">
                    {fmtINR(booking.due_amount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Statutory Disclosure & Signature */}
          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-gold-300 bg-gold-50/40 p-3 text-micro text-gold-900">
              <p className="font-bold">GST Statutory Compliance Note:</p>
              <p className="mt-0.5">
                In compliance with Section 31(3)(d) of the CGST Act, 2017, this document is a
                Receipt Voucher acknowledging advance consideration. Final Tax Invoice with
                detailed HSN/SAC and GST breakdown will be issued upon check-out when the
                hospitality service is rendered.
              </p>
            </div>

            <div className="flex justify-between items-end pt-4 border-t text-micro text-muted-foreground">
              <div>
                <p>Generated by DigitalMyHotels Operations Desk</p>
                <p>{new Date().toLocaleString("en-IN")}</p>
              </div>
              <div className="text-center">
                <div className="h-8 border-b border-muted-foreground/30 w-36 mb-1" />
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
