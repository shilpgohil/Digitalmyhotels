"use client";

/**
 * CheckInCard — staff self check-in/out widget.
 *
 * Used on /my-attendance (mobile-first, `big` variant) AND on the user's own
 * Staff Profile (managers/admins check themselves in from their profile —
 * client 09/2026).
 *
 * Flow (Face Check-In):
 *   1. If the hotel geofence is enabled → get a high-accuracy GPS fix.
 *   2. Capture a selfie (evidence photo) via the shared camera component.
 *   3. Upload selfie → POST check-in {lat,lng,accuracy,selfie_key}.
 * The SERVER decides the geofence outcome; violations render a danger
 * callout with the computed distance.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogIn, LogOut, MapPinOff, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineSpinner } from "@/components/ui/inline-spinner";
import { InlineCameraCapture } from "@/components/checkin/inline-camera-capture";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { apiUpload, ApiError } from "@/lib/api/client";
import { GeoError, getPosition, type GeoPosition } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { AttendanceRecordOut, SelfTodayOut } from "@/types/staff";

function fmtClock(iso: string | null): string {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtHrs(minutes: number | null): string {
  if (minutes == null) return "0h 0m";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function CheckInCard({ big = false }: { readonly big?: boolean }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();

  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [pendingPos, setPendingPos] = useState<GeoPosition | null>(null);
  // Live clock (30s tick keeps the working duration fresh).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const today = useQuery({
    queryKey: ["staff-self-today", activeHotelId],
    queryFn: () => api<SelfTodayOut>("/api/v1/staff/me/attendance/today"),
    enabled: !!activeHotelId,
    refetchInterval: 60_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-self-today", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["staff-attendance", activeHotelId] });
  };

  const checkOutMutation = useMutation({
    mutationFn: (pos: GeoPosition | null) =>
      api<AttendanceRecordOut>("/api/v1/staff/attendance/check-out", {
        method: "POST",
        body: pos ? { ...pos } : {},
      }),
    onSuccess: () => {
      toast.success(t("checkedOutToast"));
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
    onSettled: () => setBusy(null),
  });

  /** Get a GPS fix when the fence is on; null (skip) when it's off. */
  const acquirePosition = async (): Promise<GeoPosition | null> => {
    if (!today.data?.geofence_enabled) return null;
    try {
      return await getPosition();
    } catch (e) {
      if (e instanceof GeoError && e.kind === "denied") {
        throw new Error(t("locationDenied"));
      }
      throw new Error(t("locationUnavailable"));
    }
  };

  const startCheckIn = async () => {
    setBusy("in");
    setError(null);
    try {
      const pos = await acquirePosition();
      setPendingPos(pos);
      // Face Check-In: selfie evidence is part of the flow (mockup).
      setShowCamera(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("error"));
      setBusy(null);
    }
  };

  const completeCheckIn = async (selfie: File | null) => {
    setShowCamera(false);
    try {
      let selfieKey: string | null = null;
      if (selfie) {
        const form = new FormData();
        form.append("file", selfie, selfie.name);
        const res = await apiUpload<{ selfie_key: string }>(
          "/api/v1/staff/attendance/selfie",
          form,
          { hotelId: activeHotelId ?? undefined },
        );
        selfieKey = res.selfie_key;
      }
      await api<AttendanceRecordOut>("/api/v1/staff/attendance/check-in", {
        method: "POST",
        body: {
          ...(pendingPos ?? {}),
          ...(selfieKey ? { selfie_key: selfieKey } : {}),
        },
      });
      toast.success(t("checkedInToast"));
      setError(null);
      invalidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(null);
      setPendingPos(null);
    }
  };

  const startCheckOut = async () => {
    setBusy("out");
    setError(null);
    try {
      const pos = await acquirePosition();
      checkOutMutation.mutate(pos);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("error"));
      setBusy(null);
    }
  };

  if (today.isLoading) return <Skeleton className={big ? "h-72" : "h-40"} />;
  const d = today.data;
  if (!d) return null;

  const statusPill = {
    not_checked_in: "bg-danger-bg text-danger",
    working: "bg-success-bg text-success",
    checked_out: "bg-muted text-muted-foreground",
  }[d.status];

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      {showCamera && (
        <InlineCameraCapture
          onCapture={(file) => void completeCheckIn(file)}
          onClose={() => {
            // Selfie skipped/unavailable — proceed without evidence photo.
            void completeCheckIn(null);
          }}
        />
      )}

      <div className={cn("flex flex-col items-center gap-3", big ? "py-4" : "py-1")}>
        {big && (
          <p className="text-4xl font-bold tabular-nums" suppressHydrationWarning>
            {new Date().toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })}
          </p>
        )}
        <span
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
            statusPill,
          )}
        >
          {t(`self_${d.status}`)}
        </span>

        {d.status === "not_checked_in" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void startCheckIn()}
            className={cn(
              "flex flex-col items-center justify-center rounded-full bg-navy-900 text-white",
              "transition-all hover:bg-navy-800 hover:ring-4 hover:ring-gold-400/40",
              "disabled:opacity-60",
              big ? "size-44" : "h-[42px] w-full max-w-xs flex-row gap-2 rounded-md",
            )}
          >
            {busy === "in" ? (
              <InlineSpinner size={big ? 28 : 16} />
            ) : (
              <ScanFace className={big ? "size-9" : "size-4"} aria-hidden />
            )}
            <span className={cn("font-semibold", big ? "mt-2 text-base" : "text-sm")}>
              {t("faceCheckIn")}
            </span>
          </button>
        )}

        {d.status === "working" && (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void startCheckOut()}
            className={cn("h-[42px]", big ? "w-full max-w-xs" : "w-full max-w-xs")}
          >
            {busy === "out" ? (
              <InlineSpinner size={16} className="mr-2" />
            ) : (
              <LogOut className="mr-2 size-4" aria-hidden />
            )}
            {t("checkOutAction")}
          </Button>
        )}

        {d.geofence_enabled && d.status === "not_checked_in" && (
          <p className="text-center text-label text-muted-foreground">
            {t("geofenceHint")}
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger"
          >
            <MapPinOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>

      {/* Today summary */}
      <div className="mt-4 grid grid-cols-3 divide-x rounded-lg border text-center text-sm">
        <div className="px-2 py-3">
          <p className="flex items-center justify-center gap-1 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
            <LogIn className="size-3" aria-hidden /> {t("checkInCol")}
          </p>
          <p className="mt-1 font-semibold tabular-nums">{fmtClock(d.check_in_at)}</p>
        </div>
        <div className="px-2 py-3">
          <p className="flex items-center justify-center gap-1 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
            <LogOut className="size-3" aria-hidden /> {t("checkOutCol")}
          </p>
          <p className="mt-1 font-semibold tabular-nums">{fmtClock(d.check_out_at)}</p>
        </div>
        <div className="px-2 py-3">
          <p className="text-micro font-semibold uppercase tracking-widest text-gold-700">
            {t("totalHrs")}
          </p>
          <p className="mt-1 font-semibold tabular-nums text-gold-700">
            {fmtHrs(d.working_minutes)}
          </p>
        </div>
      </div>
    </div>
  );
}
