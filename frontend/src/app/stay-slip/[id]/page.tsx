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
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface PublicStaySlipData {
  id: string;
  booking_number: string;
  guest_name: string;
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
  guest_count: number;
  due_amount: string;
  payment_status: string;
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

export default function PublicStaySlipPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const autoDownload = searchParams.get("download") === "1";

  const [data, setData] = useState<PublicStaySlipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchSlip() {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/bookings/public/${id}/registration`);
        if (!res.ok) {
          throw new Error("Stay slip not found or expired");
        }
        const json = (await res.json()) as PublicStaySlipData;
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stay slip");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchSlip();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleDownloadPdf = async () => {
    try {
      setDownloading(true);
      const res = await fetch(`/api/v1/bookings/public/${id}/registration/pdf`);
      if (!res.ok) throw new Error("Failed to download stay slip PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanName = (data?.guest_name || "Guest")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      a.download = `Stay_Slip_${data?.booking_number || id}_${cleanName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      alert("Failed to download stay slip PDF. Please try again.");
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
          <h1 className="text-xl font-bold text-slate-800">Stay Slip Not Found</h1>
          <p className="text-sm text-slate-500">
            {error || "The stay slip link may be invalid or no longer accessible."}
          </p>
        </div>
      </div>
    );
  }

  const hasDue = Number(data.due_amount || 0) > 0;

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-3 sm:py-10 sm:px-6 print:bg-white print:p-0">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Verification banner */}
        <div className="flex items-center justify-between gap-2 bg-navy-950 text-white rounded-xl px-4 py-2.5 text-xs shadow-sm print:hidden">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-gold-400 shrink-0" />
            <span>Official Guest Stay Slip & Registration</span>
          </div>
          <span className="text-gold-400 font-medium">DigitalMyHotels</span>
        </div>

        {/* Main stay slip card */}
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
                  Stay Slip
                </span>
                <p className="text-lg font-bold font-mono text-navy-950">{data.booking_number}</p>
                <div className="mt-2">
                  {!hasDue ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="size-3" />
                      Folio Clear
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      Current Due: {fmtINR(data.due_amount)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stay details */}
          <div className="p-5 sm:p-7 border-b border-slate-100">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              In-House Stay Details
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Primary Guest</p>
                <p className="font-semibold text-slate-800">{data.guest_name}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Assigned Room(s)</p>
                <p className="font-semibold text-slate-800 font-mono">{data.room_numbers || "—"}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Guest Count</p>
                <p className="font-medium text-slate-800">{data.guest_count} Person(s)</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-slate-400">Expected Check-out</p>
                <p className="font-medium text-slate-800">
                  {fmtDate(data.check_out_date)}
                  {data.check_out_time ? ` (${data.check_out_time})` : ""}
                </p>
              </div>
            </div>
          </div>

          {/* Folio balance */}
          <div className="p-5 sm:p-7 border-b border-slate-100 bg-slate-50/30">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Folio Summary
            </h2>
            <div className="flex justify-between items-center max-w-sm ml-auto text-sm">
              <span className="font-semibold text-slate-700">Outstanding Balance:</span>
              <span className={`font-mono text-base font-bold ${hasDue ? "text-amber-700" : "text-emerald-700"}`}>
                {fmtINR(data.due_amount)}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-5 sm:p-7 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 print:hidden">
            <p className="text-xs text-slate-500">
              Official guest registration slip issued by {data.hotel_name}.
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

