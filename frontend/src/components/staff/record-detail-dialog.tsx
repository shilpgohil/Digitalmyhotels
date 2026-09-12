"use client";

/**
 * RecordDetailDialog — the evidence view behind every attendance row.
 *
 * Shows what the system captured but never surfaced before (client 09/2026
 * insight round): check-in/out methods, GPS distance from the property with
 * accuracy, late/early minutes, the Face Check-In selfie, who recorded a
 * front-desk/manual entry, and any notes (off-site checkout, auto-close…).
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { MapPin, ScanFace } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/feedback/status-badge";
import { AttendanceStatusBadge } from "@/components/staff/attendance-status-badge";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { fmtApiDate } from "@/lib/formatting";
import type { RecordDetailOut } from "@/types/staff";

function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtHrs(minutes: number | null): string {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Selfie image fetched with auth headers (object-URL lifecycle managed). */
function SelfieImage({ recordId }: { readonly recordId: string }) {
  const { activeHotelId } = useAuth();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      const token = getAccessToken();
      const res = await fetch(
        `${API_BASE}/api/v1/staff/attendance/records/${recordId}/selfie`,
        {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
            "X-Hotel-Id": activeHotelId ?? "",
          },
          credentials: "include",
        },
      );
      if (!res.ok || cancelled) return;
      objectUrl = URL.createObjectURL(await res.blob());
      if (!cancelled) setSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [recordId, activeHotelId]);

  if (!src) return <Skeleton className="h-40 w-32 rounded-lg" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-40 w-32 rounded-lg border object-cover shadow-sm"
    />
  );
}

const METHOD_KEYS: Record<string, string> = {
  self_geo: "method_self_geo",
  front_desk: "method_front_desk",
  manual: "method_manual",
  auto: "method_auto",
};

function MethodChip({ method }: { readonly method: string | null }) {
  const t = useTranslations("staff");
  if (!method) return <span className="text-muted-foreground">—</span>;
  const tone =
    method === "self_geo"
      ? "info"
      : method === "front_desk"
        ? "neutral"
        : method === "auto"
          ? "danger"
          : "warning";
  return <StatusBadge tone={tone}>{t(METHOD_KEYS[method] ?? method)}</StatusBadge>;
}

export function RecordDetailDialog({
  recordId,
  onClose,
}: {
  readonly recordId: string | null;
  readonly onClose: () => void;
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();

  const detail = useQuery({
    queryKey: ["staff-record-detail", activeHotelId, recordId],
    queryFn: () => api<RecordDetailOut>(`/api/v1/staff/attendance/records/${recordId}`),
    enabled: !!activeHotelId && !!recordId,
  });

  const d = detail.data;

  const fmtDistance = (
    dist: string | null | undefined,
    acc: string | null | undefined,
  ) => {
    if (dist == null) return t("noLocationRecorded");
    const base = `~${Math.round(Number(dist))} m`;
    return acc != null ? `${base} (±${Math.round(Number(acc))} m)` : base;
  };

  return (
    <Dialog open={recordId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanFace className="size-4 text-gold-600" aria-hidden />
            {t("recordDetailTitle")}
          </DialogTitle>
        </DialogHeader>

        {detail.isLoading && <Skeleton className="h-64" />}
        {detail.isError && (
          <p className="text-sm text-danger" role="alert">
            {tc("error")}
          </p>
        )}

        {d && (
          <div className="space-y-4">
            {/* Who + when + status */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{d.full_name}</p>
                <p className="text-label text-muted-foreground">
                  {d.staff_code} · {t(`dept_${d.department}`)} ·{" "}
                  {fmtApiDate(d.work_date)}
                </p>
              </div>
              <AttendanceStatusBadge status={d.status} />
            </div>

            <div className="flex gap-4">
              {/* Selfie evidence */}
              {d.has_selfie ? (
                <div className="shrink-0">
                  <p className="mb-1.5 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("selfieEvidence")}
                  </p>
                  <SelfieImage recordId={d.id} />
                </div>
              ) : null}

              {/* Times + methods */}
              <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-3 text-sm">
                <div>
                  <dt className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("checkInCol")}
                  </dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {fmtClock(d.check_in_at)}
                    {d.late_minutes ? (
                      <span className="ml-1.5 text-label font-semibold text-warning">
                        +{d.late_minutes}m
                      </span>
                    ) : null}
                  </dd>
                  <dd className="mt-1">
                    <MethodChip method={d.method_in} />
                  </dd>
                </div>
                <div>
                  <dt className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("checkOutCol")}
                  </dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {fmtClock(d.check_out_at)}
                    {d.early_out_minutes ? (
                      <span className="ml-1.5 text-label font-semibold text-warning">
                        −{d.early_out_minutes}m
                      </span>
                    ) : null}
                  </dd>
                  <dd className="mt-1">
                    <MethodChip method={d.method_out} />
                  </dd>
                </div>
                <div>
                  <dt className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("workingHours")}
                  </dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {fmtHrs(d.working_minutes)}
                  </dd>
                </div>
                {d.performed_by_name && (
                  <div>
                    <dt className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                      {t("recordedBy")}
                    </dt>
                    <dd className="mt-0.5 font-medium">{d.performed_by_name}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* GPS evidence */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <div>
                <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                  <MapPin className="size-3" aria-hidden />
                  {t("checkInDistance")}
                </p>
                <p className="mt-0.5 font-medium tabular-nums">
                  {fmtDistance(d.check_in_distance_m, d.check_in_accuracy_m)}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                  <MapPin className="size-3" aria-hidden />
                  {t("checkOutDistance")}
                </p>
                <p className="mt-0.5 font-medium tabular-nums">
                  {fmtDistance(d.check_out_distance_m, d.check_out_accuracy_m)}
                </p>
              </div>
            </div>

            {d.note && (
              <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
                {d.note}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
