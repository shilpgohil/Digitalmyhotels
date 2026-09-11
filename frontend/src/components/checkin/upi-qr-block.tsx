"use client";
/**
 * UpiQrBlock — renders the hotel's UPI payment QR code, optionally with
 * the raw UPI ID (restricted to owner/admin with HOTEL_VIEW_UPI_ID permission).
 * Shared by the check-in and checkout payment sections.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";

interface UpiQrBlockProps {
  /** Blob URL of the hotel QR PNG (null/undefined when not configured). */
  qrUrl: string | null | undefined;
  loading: boolean;
}

export function UpiQrBlock({ qrUrl, loading }: UpiQrBlockProps) {
  const t = useTranslations("checkin");
  const tp = useTranslations("checkoutPage");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  // Raw UPI ID is restricted — workers may see the QR but never the raw ID.
  const canViewUpiId = can(PERMISSIONS.hotelViewUpiId);

  const qrInfoQuery = useQuery({
    queryKey: ["hotel-qr-info", activeHotelId],
    queryFn: () =>
      api<{ payment_label?: string | null }>("/api/v1/hotels/me/payment-qr"),
    enabled: !!activeHotelId && !!qrUrl,
    staleTime: 60_000,
  });

  const upiConfigQuery = useQuery({
    queryKey: ["hotel-payment-config", activeHotelId],
    queryFn: () =>
      api<{ upi_id: string | null; config_version: number; has_logo: boolean; qr_version: number }>(
        "/api/v1/hotels/me/payment-config",
      ),
    enabled: !!activeHotelId && canViewUpiId && !!qrUrl,
    staleTime: 300_000,
  });

  const copyUpiId = async () => {
    const upi = upiConfigQuery.data?.upi_id;
    if (!upi) return;
    try {
      await navigator.clipboard.writeText(upi);
      toast.success(tp("upiIdCopied"));
    } catch {
      toast.error(tc("error"));
    }
  };

  if (loading) return <Skeleton className="h-72 w-72 rounded-lg" />;
  if (!qrUrl) {
    return (
      <div className="rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-xs text-info">
        {t("qrNotConfiguredInfo")}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrUrl}
        alt={tp("upiQrAlt")}
        className="h-72 w-72 rounded-lg border object-contain"
      />
      <p className="text-sm font-semibold text-navy-900">
        {qrInfoQuery.data?.payment_label ?? tp("scanToPay")}
      </p>
      {/* UPI ID — restricted to owner/admin (canViewUpiId) */}
      {canViewUpiId && upiConfigQuery.data?.upi_id && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-gold-400 bg-gold-50 px-3 py-2">
          <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-gold-700">
            {tp("upiId")}
          </span>
          <span className="select-all font-mono text-sm font-semibold text-navy-900">
            {upiConfigQuery.data.upi_id}
          </span>
          <button
            type="button"
            onClick={() => void copyUpiId()}
            aria-label={tp("copyUpiId")}
            title={tp("copyUpiId")}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-gold-700 transition-colors hover:bg-gold-100"
          >
            <Copy className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
