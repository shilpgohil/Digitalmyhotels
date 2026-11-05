"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Download,
  Printer,
  CheckCircle2,
  AlertCircle,
  FileText,
  Hotel,
  Calendar,
  Phone,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  rate: string;
  taxable_amount: string;
  tax_amount: string;
  total_amount: string;
}

interface PublicInvoiceData {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  booking_number?: string | null;
  guest_name: string;
  guest_address?: string | null;
  guest_phone?: string | null;
  hotel_name: string;
  hotel_address?: string | null;
  hotel_phone?: string | null;
  hotel_gstin?: string | null;
  room_numbers?: string | null;
  check_in_date?: string | null;
  check_in_time?: string | null;
  check_out_date?: string | null;
  check_out_time?: string | null;
  nights?: number | null;
  subtotal: string;
  discount_amount: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_amount: string;
  paid_amount: string;
  due_amount: string;
  items: InvoiceItem[];
  pdf_url: string;
}

function fmtINR(val: string | number): string {
  const n = typeof val === "number" ? val : Number.parseFloat(val || "0");
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  try {
    const parts = d.split("T")[0].split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  } catch {
    // fallback
  }
  return d;
}

export default function PublicInvoicePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const autoDownload = searchParams.get("download") === "1";

  const [data, setData] = useState<PublicInvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchInvoice() {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/invoices/public/${id}`);
        if (!res.ok) {
          throw new Error("Invoice not found or expired");
        }
        const json = (await res.json()) as PublicInvoiceData;
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load invoice");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchInvoice();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleDownloadPdf = async () => {
    try {
      setDownloading(true);
      const res = await fetch(`/api/v1/invoices/public/${id}/pdf`);
      if (!res.ok) throw new Error("Failed to download PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanName = (data?.guest_name || "Guest")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      a.download = `Invoice_${data?.invoice_number || id}_${cleanName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      alert("Failed to download invoice PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (autoDownload && data && !loading && !error) {
      handleDownloadPdf();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDownload, data, loading, error]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border p-6 space-y-4 animate-pulse">
          <div className="h-6 bg-slate-200 rounded w-1/3" />
          <div className="h-4 bg-slate-100 rounded w-1/2" />
          <div className="h-40 bg-slate-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border p-8 space-y-4">
          <AlertCircle className="size-12 text-rose-500 mx-auto" />
          <h1 className="text-xl font-bold text-slate-800">Invoice Not Found</h1>
          <p className="text-sm text-slate-500">
            {error || "The invoice link may be invalid or no longer accessible."}
          </p>
        </div>
      </div>
    );
  }

  const isPaid = Number(data.due_amount || 0) <= 0;
  const gstTotal =
    Number(data.cgst_amount || 0) +
    Number(data.sgst_amount || 0) +
    Number(data.igst_amount || 0);

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-3 sm:py-10 sm:px-6 print:bg-white print:p-0">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Verification banner */}
        <div className="flex items-center justify-between gap-2 bg-navy-950 text-white rounded-xl px-4 py-2.5 text-xs shadow-sm print:hidden">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-gold-400 shrink-0" />
            <span>Official Verified GST Tax Invoice</span>
          </div>
          <span className="text-gold-400 font-medium">DigitalMyHotels</span>
        </div>

        {/* Main invoice card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden print:border-none print:shadow-none">
          {/* Header */}
          <div className="p-5 sm:p-7 border-b border-slate-100 bg-slate-50/50">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-navy-950">
                  <Hotel className="size-5 text-gold-500 shrink-0" />
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{data.hotel_name}</h1>
                </div>
                {data.hotel_address && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500 mt-1.5">
                    <MapPin className="size-3.5 shrink-0" />
                    <span>{data.hotel_address}</span>
                  </p>
                )}
                {data.hotel_phone && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                    <Phone className="size-3.5 shrink-0" />
                    <span>{data.hotel_phone}</span>
                  </p>
                )}
                {data.hotel_gstin && (
                  <p className="text-xs font-semibold text-slate-600 mt-1">
                    GSTIN: <span className="font-mono">{data.hotel_gstin}</span>
                  </p>
                )}
              </div>

              <div className="sm:text-right">
                <span className="inline-block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Tax Invoice
                </span>
                <p className="text-lg font-bold font-mono text-navy-950">{data.invoice_number}</p>
                <p className="text-xs text-slate-500 mt-0.5">Date: {fmtDate(data.invoice_date)}</p>
                <div className="mt-2">
                  {isPaid ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="size-3" />
                      Paid in Full
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      Balance Due: {fmtINR(data.due_amount)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Guest & Stay Details */}
          <div className="p-5 sm:p-7 border-b border-slate-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Stay & Guest Information
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Guest Name</p>
                <p className="font-semibold text-slate-800">{data.guest_name}</p>
              </div>
              {data.booking_number && (
                <div className="space-y-0.5">
                  <p className="text-xs text-slate-400">Booking ID</p>
                  <p className="font-semibold font-mono text-slate-800">{data.booking_number}</p>
                </div>
              )}
              {data.room_numbers && (
                <div className="space-y-0.5">
                  <p className="text-xs text-slate-400">Room(s)</p>
                  <p className="font-semibold text-slate-800">{data.room_numbers}</p>
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Dates</p>
                <p className="font-medium text-slate-800">
                  {fmtDate(data.check_in_date)} — {fmtDate(data.check_out_date)}
                  {data.nights ? ` (${data.nights}N)` : ""}
                </p>
              </div>
            </div>
          </div>

          {/* Charges Table */}
          <div className="p-5 sm:p-7 border-b border-slate-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Charges & Summary
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-400 text-left">
                    <th className="pb-2 font-medium">Description</th>
                    <th className="pb-2 font-medium text-right">Taxable</th>
                    <th className="pb-2 font-medium text-right">Tax</th>
                    <th className="pb-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2.5 font-medium text-slate-800">
                        {it.description}
                        {it.quantity > 1 && (
                          <span className="text-xs text-slate-400 ml-1">× {it.quantity}</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-600">
                        {fmtINR(it.taxable_amount)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-600">
                        {fmtINR(it.tax_amount)}
                      </td>
                      <td className="py-2.5 text-right font-mono font-medium text-slate-900">
                        {fmtINR(it.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total calculation */}
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col items-end space-y-1.5 text-sm">
              <div className="flex justify-between w-60 text-slate-600">
                <span>Subtotal:</span>
                <span className="font-mono">{fmtINR(data.subtotal)}</span>
              </div>
              {Number(data.discount_amount || 0) > 0 && (
                <div className="flex justify-between w-60 text-emerald-600">
                  <span>Discount:</span>
                  <span className="font-mono">- {fmtINR(data.discount_amount)}</span>
                </div>
              )}
              {gstTotal > 0 && (
                <div className="flex justify-between w-60 text-slate-600">
                  <span>GST / Taxes:</span>
                  <span className="font-mono">{fmtINR(gstTotal)}</span>
                </div>
              )}
              <div className="flex justify-between w-60 text-base font-bold text-navy-950 pt-2 border-t border-slate-200">
                <span>Total Amount:</span>
                <span className="font-mono">{fmtINR(data.total_amount)}</span>
              </div>
              <div className="flex justify-between w-60 text-slate-700">
                <span>Amount Paid:</span>
                <span className="font-mono font-semibold text-emerald-700">
                  {fmtINR(data.paid_amount)}
                </span>
              </div>
              <div className="flex justify-between w-60 font-bold text-slate-800">
                <span>Balance Due:</span>
                <span className={cn("font-mono", isPaid ? "text-emerald-700" : "text-amber-700")}>
                  {fmtINR(data.due_amount)}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-5 sm:p-7 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 print:hidden">
            <p className="text-xs text-slate-500">
              Need a physical copy? Download the official PDF or print directly.
            </p>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => window.print()}
                className="gap-2 flex-1 sm:flex-initial"
              >
                <Printer className="size-4" />
                Print
              </Button>
              <Button
                type="button"
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="gap-2 bg-navy-950 hover:bg-navy-900 text-white flex-1 sm:flex-initial"
              >
                <Download className="size-4 text-gold-400" />
                {downloading ? "Downloading..." : "Download Official PDF"}
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 print:hidden">
          Powered by DigitalMyHotels · Multi-tenant Operations SaaS for Indian Hotels
        </p>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
