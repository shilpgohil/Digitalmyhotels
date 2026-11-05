"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Download,
  Printer,
  CheckCircle2,
  AlertCircle,
  Hotel,
  Calendar,
  Phone,
  MapPin,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface PublicVoucherData {
  id: string;
  voucher_number: string;
  booking_number: string;
  status: string;
  guest_name: string;
  guest_phone?: string | null;
  hotel_name: string;
  hotel_address?: string | null;
  hotel_phone?: string | null;
  hotel_gstin?: string | null;
  room_numbers_or_type?: string | null;
  check_in_date?: string | null;
  check_in_time?: string | null;
  check_out_date?: string | null;
  check_out_time?: string | null;
  nights?: number | null;
  adults: number;
  children: number;
  total_estimated_tariff: string;
  advance_paid: string;
  balance_due: string;
  payment_method?: string | null;
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

export default function PublicVoucherPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const autoDownload = searchParams.get("download") === "1";

  const [data, setData] = useState<PublicVoucherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchVoucher() {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/bookings/public/${id}/voucher`);
        if (!res.ok) {
          throw new Error("Booking voucher not found or expired");
        }
        const json = (await res.json()) as PublicVoucherData;
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load booking voucher");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchVoucher();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleDownloadPdf = async () => {
    try {
      setDownloading(true);
      const res = await fetch(`/api/v1/bookings/public/${id}/voucher/pdf`);
      if (!res.ok) throw new Error("Failed to download voucher PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanName = (data?.guest_name || "Guest")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      a.download = `Voucher_${data?.booking_number || id}_${cleanName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      alert("Failed to download booking voucher PDF. Please try again.");
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
          <h1 className="text-xl font-bold text-slate-800">Voucher Not Found</h1>
          <p className="text-sm text-slate-500">
            {error || "The booking voucher link may be invalid or no longer accessible."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-3 sm:py-10 sm:px-6 print:bg-white print:p-0">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Verification banner */}
        <div className="flex items-center justify-between gap-2 bg-navy-950 text-white rounded-xl px-4 py-2.5 text-xs shadow-sm print:hidden">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-gold-400 shrink-0" />
            <span>Official Advance Booking Confirmation Voucher</span>
          </div>
          <span className="text-gold-400 font-medium">DigitalMyHotels</span>
        </div>

        {/* Main voucher card */}
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
              </div>

              <div className="sm:text-right">
                <span className="inline-block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Booking Voucher
                </span>
                <p className="text-lg font-bold font-mono text-navy-950">{data.voucher_number}</p>
                <p className="text-xs text-slate-500 mt-0.5">Ref: {data.booking_number}</p>
                <div className="mt-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="size-3" />
                    Reservation Confirmed
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Guest & Reservation details */}
          <div className="p-5 sm:p-7 border-b border-slate-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Reservation Summary
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Primary Guest</p>
                <p className="font-semibold text-slate-800">{data.guest_name}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Room(s) / Type</p>
                <p className="font-semibold text-slate-800">{data.room_numbers_or_type || "—"}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Guests</p>
                <p className="font-medium text-slate-800">
                  {data.adults} Adults{data.children > 0 ? `, ${data.children} Children` : ""}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Stay Duration</p>
                <p className="font-medium text-slate-800">
                  {fmtDate(data.check_in_date)} — {fmtDate(data.check_out_date)}
                  {data.nights ? ` (${data.nights}N)` : ""}
                </p>
              </div>
            </div>
          </div>

          {/* Financial summary */}
          <div className="p-5 sm:p-7 border-b border-slate-100 bg-slate-50/30">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Payment & Advance Receipt
            </h2>
            <div className="space-y-2 text-sm max-w-sm ml-auto">
              <div className="flex justify-between text-slate-600">
                <span>Total Estimated Tariff:</span>
                <span className="font-mono font-medium">{fmtINR(data.total_estimated_tariff)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Advance Paid & Received:</span>
                <span className="font-mono">{fmtINR(data.advance_paid)}</span>
              </div>
              <div className="flex justify-between text-navy-950 font-bold text-base pt-2 border-t border-slate-200">
                <span>Balance Due at Check-in:</span>
                <span className="font-mono text-amber-700">{fmtINR(data.balance_due)}</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-5 sm:p-7 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 print:hidden">
            <p className="text-xs text-slate-500">
              Present this voucher at the reception desk during check-in.
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

