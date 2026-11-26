"use client";

/**
 * /staff/checkin — Front-desk Staff Check-in / Check-out console.
 *
 * Restricted to Owner / Manager / Receptionist / Admin (`staff.attendance_record`).
 * Loads all active staff profiles immediately so operators can pick any team
 * member (e.g. workers without a phone) and record their Check-In, Check-Out,
 * or same-day Re-Check-In using the same property GPS geofence verification as
 * `/my-attendance`, without requiring a live selfie photo.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  LogIn,
  LogOut,
  MapPinOff,
  Navigation,
  Search,
  Users,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineSpinner } from "@/components/ui/inline-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/components/auth/require-permission";
import { RequireAccessMode } from "@/components/auth/require-access-mode";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { verifyHotelGeofencePosition, type GeoPosition } from "@/lib/geo";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type {
  AttendanceRecordOut,
  AttendanceRowOut,
  StaffListOut,
  StaffOut,
  TodayAttendanceOut,
} from "@/types/staff";

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

type StatusFilter = "all" | "not_checked_in" | "working" | "checked_out";

function resolveStatusKey(
  staff: StaffOut,
  row: AttendanceRowOut | undefined,
): {
  kind: "not_checked_in" | "working" | "late" | "checked_out" | "on_leave";
  badgeLabelKey:
    | "self_not_checked_in"
    | "self_working"
    | "self_late"
    | "self_checked_out"
    | "att_on_leave";
  pillClass: string;
} {
  if (row?.check_in_at && !row.check_out_at) {
    if (row.status === "late") {
      return {
        kind: "late",
        badgeLabelKey: "self_late",
        pillClass: "bg-warning-bg text-warning",
      };
    }
    return {
      kind: "working",
      badgeLabelKey: "self_working",
      pillClass: "bg-success-bg text-success",
    };
  }
  if (row?.check_out_at) {
    return {
      kind: "checked_out",
      badgeLabelKey: "self_checked_out",
      pillClass: "bg-muted text-muted-foreground",
    };
  }
  if (row?.status === "on_leave" || staff.status === "on_leave") {
    return {
      kind: "on_leave",
      badgeLabelKey: "att_on_leave",
      pillClass: "bg-muted text-muted-foreground",
    };
  }
  return {
    kind: "not_checked_in",
    badgeLabelKey: "self_not_checked_in",
    pillClass: "bg-danger-bg text-danger",
  };
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function StaffCheckinContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifiedDist, setVerifiedDist] = useState<{
    distance: number;
    accuracy: number;
  } | null>(null);
  const actionPanelRef = useRef<HTMLDivElement | null>(null);

  // Live clock & active shift duration ticker (every 30s).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const staffQuery = useQuery({
    queryKey: ["staff", activeHotelId, "active-roster"],
    queryFn: () => api<StaffListOut>("/api/v1/staff?status=active&limit=200"),
    enabled: !!activeHotelId,
  });

  const todayQuery = useQuery({
    queryKey: ["staff-attendance", activeHotelId, "front-desk"],
    queryFn: () => api<TodayAttendanceOut>("/api/v1/staff/attendance/today"),
    enabled: !!activeHotelId,
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const rowByStaffId = useMemo(() => {
    const map = new Map<string, AttendanceRowOut>();
    for (const item of todayQuery.data?.items ?? []) {
      map.set(item.staff_profile_id, item);
    }
    return map;
  }, [todayQuery.data?.items]);

  const filteredStaff = useMemo(() => {
    const all = staffQuery.data?.items ?? [];
    const term = q.trim().toLowerCase();
    return all.filter((s) => {
      const row = rowByStaffId.get(s.id);
      const st = resolveStatusKey(s, row);
      if (statusFilter === "not_checked_in" && st.kind !== "not_checked_in") {
        return false;
      }
      if (
        statusFilter === "working" &&
        st.kind !== "working" &&
        st.kind !== "late"
      ) {
        return false;
      }
      if (statusFilter === "checked_out" && st.kind !== "checked_out") {
        return false;
      }
      if (!term) return true;
      return (
        s.full_name.toLowerCase().includes(term) ||
        s.staff_code.toLowerCase().includes(term) ||
        (s.phone ?? "").toLowerCase().includes(term) ||
        s.department.toLowerCase().includes(term)
      );
    });
  }, [staffQuery.data?.items, rowByStaffId, q, statusFilter]);

  // Keep a valid default selection as soon as staff roster loads or filters change.
  useEffect(() => {
    if (!filteredStaff.length) return;
    if (!selectedId || !filteredStaff.some((s) => s.id === selectedId)) {
      setSelectedId(filteredStaff[0].id);
    }
  }, [filteredStaff, selectedId]);

  // Reset transient GPS error/badge when switching between workers.
  useEffect(() => {
    setError(null);
    setVerifiedDist(null);
  }, [selectedId]);

  const selectedStaff = useMemo(
    () =>
      (staffQuery.data?.items ?? []).find((s) => s.id === selectedId) ??
      filteredStaff[0] ??
      null,
    [staffQuery.data?.items, filteredStaff, selectedId],
  );
  const selectedRow = selectedStaff
    ? rowByStaffId.get(selectedStaff.id)
    : undefined;
  const selectedStatus = selectedStaff
    ? resolveStatusKey(selectedStaff, selectedRow)
    : null;

  const recordMutation = useMutation({
    mutationFn: ({
      staffId,
      action,
      pos,
    }: {
      staffId: string;
      action: "in" | "out";
      pos: GeoPosition | null;
    }) =>
      api<AttendanceRecordOut>(`/api/v1/staff/attendance/${staffId}/record`, {
        method: "POST",
        body: {
          action,
          ...(pos ?? {}),
        },
      }),
    onSuccess: (_, vars) => {
      toast.success(
        vars.action === "in" ? t("checkedInToast") : t("checkedOutToast"),
      );
      setError(null);
      queryClient.invalidateQueries({
        queryKey: ["staff-attendance", activeHotelId],
      });
      queryClient.invalidateQueries({ queryKey: ["staff", activeHotelId] });
      queryClient.invalidateQueries({
        queryKey: ["staff-self-today", activeHotelId],
      });
    },
  });

  const handleAction = async (staff: StaffOut, action: "in" | "out") => {
    setBusy(action);
    setError(null);
    setVerifiedDist(null);
    try {
      const geo = await verifyHotelGeofencePosition(todayQuery.data, {
        denied: t("locationDenied"),
        unavailable: t("locationUnavailable"),
        distanceViolation: (params) => t("geofenceDistanceViolation", params),
      });
      if (geo.verifiedDist) {
        setVerifiedDist(geo.verifiedDist);
      }
      await recordMutation.mutateAsync({
        staffId: staff.id,
        action,
        pos: geo.pos,
      });
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error ? e.message : tc("error"),
      );
    } finally {
      setBusy(null);
    }
  };

  const isWorking =
    selectedStatus?.kind === "working" || selectedStatus?.kind === "late";
  const isCheckedOut = selectedStatus?.kind === "checked_out";
  const liveWorkingMinutes = useMemo(() => {
    if (!selectedRow || selectedRow.working_minutes == null) return null;
    if (!isWorking) return selectedRow.working_minutes;
    const elapsedSinceFetch = todayQuery.dataUpdatedAt
      ? Math.max(0, Math.floor((now - todayQuery.dataUpdatedAt) / 60_000))
      : 0;
    return selectedRow.working_minutes + elapsedSinceFetch;
  }, [selectedRow, isWorking, todayQuery.dataUpdatedAt, now]);

  const filterOptions: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("statusAll") },
    { key: "not_checked_in", label: t("self_not_checked_in") },
    { key: "working", label: t("self_working") },
    { key: "checked_out", label: t("self_checked_out") },
  ];

  return (
    <>
      <PartnerHeader
        title={t("staffCheckinTitle")}
        subtitle={tn("staffGroup")}
      />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {staffQuery.isLoading ? (
            <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
              <Skeleton className="h-96 rounded-xl" />
              <Skeleton className="h-96 rounded-xl" />
            </div>
          ) : staffQuery.isError ? (
            <div className="rounded-xl border bg-card p-8 text-center text-sm text-danger">
              {tc("error")}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => staffQuery.refetch()}
              >
                {tc("retry")}
              </button>
            </div>
          ) : (staffQuery.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={Users}
              title={t("noStaff")}
              subtitle={t("noStaffSubtitle")}
            />
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
              {/* Left / Top pane: Active Staff Roster */}
              <section className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="space-y-3 border-b bg-muted/30 p-3.5">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      className="pl-9 bg-background"
                      placeholder={t("searchStaffCheckinPlaceholder")}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {filterOptions.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setStatusFilter(opt.key)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                          statusFilter === opt.key
                            ? "border-navy-900 bg-navy-900 text-white"
                            : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("staffRosterCount", { count: filteredStaff.length })}
                  </p>
                </div>

                {filteredStaff.length === 0 ? (
                  <div className="p-6">
                    <EmptyState icon={Search} title={t("noStaffMatch")} />
                  </div>
                ) : (
                  <div className="max-h-[340px] lg:max-h-[calc(100vh-290px)] overflow-y-auto divide-y">
                    {filteredStaff.map((s) => {
                      const row = rowByStaffId.get(s.id);
                      const st = resolveStatusKey(s, row);
                      const isSelected = selectedStaff?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(s.id);
                            if (
                              typeof window !== "undefined" &&
                              window.innerWidth < 1024
                            ) {
                              setTimeout(() => {
                                actionPanelRef.current?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "nearest",
                                });
                              }, 40);
                            }
                          }}
                          className={cn(
                            "flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                            isSelected
                              ? "border-l-4 border-l-gold-500 bg-gold-50/60"
                              : "hover:bg-muted/40",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                              isSelected
                                ? "bg-navy-900 text-white"
                                : "bg-muted text-navy-900",
                            )}
                          >
                            {initialsOf(s.full_name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {s.full_name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {t(`dept_${s.department}`)} · {s.staff_code}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                              st.pillClass,
                            )}
                          >
                            {t(st.badgeLabelKey)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Right / Bottom pane: My-Attendance-style Check-in Card (GPS, NO selfie) */}
              <section ref={actionPanelRef}>
                {selectedStaff && selectedStatus ? (
                  <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-12 items-center justify-center rounded-full bg-navy-900 text-base font-bold text-white">
                          {initialsOf(selectedStaff.full_name)}
                        </span>
                        <div>
                          <p className="text-lg font-semibold leading-tight">
                            {selectedStaff.full_name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {t(`dept_${selectedStaff.department}`)} ·{" "}
                            {selectedStaff.staff_code}
                            {selectedStaff.phone ? ` · ${selectedStaff.phone}` : ""}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
                          selectedStatus.pillClass,
                        )}
                      >
                        {t(selectedStatus.badgeLabelKey)}
                      </span>
                    </div>

                    <div className="flex flex-col items-center gap-3.5 py-6">
                      <p
                        className="text-3xl sm:text-4xl font-bold tabular-nums tracking-tight"
                        suppressHydrationWarning
                      >
                        {new Date(now).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </p>

                      {!isWorking ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void handleAction(selectedStaff, "in")}
                          className={cn(
                            "flex size-40 sm:size-44 flex-col items-center justify-center rounded-full bg-navy-900 text-white",
                            "transition-all hover:bg-navy-800 hover:ring-4 hover:ring-gold-400/40",
                            "disabled:opacity-60",
                          )}
                        >
                          {busy === "in" ? (
                            <InlineSpinner size={28} />
                          ) : (
                            <LogIn className="size-8" aria-hidden />
                          )}
                          <span className="mt-2 text-base font-semibold">
                            {isCheckedOut
                              ? t("checkInAgain")
                              : t("checkInAction")}
                          </span>
                        </button>
                      ) : (
                        <Button
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() =>
                            void handleAction(selectedStaff, "out")
                          }
                          className="h-[44px] w-full max-w-xs border-navy-900 text-navy-900 hover:bg-muted"
                        >
                          {busy === "out" ? (
                            <InlineSpinner size={16} className="mr-2" />
                          ) : (
                            <LogOut className="mr-2 size-4" aria-hidden />
                          )}
                          {t("checkOutAction")}
                        </Button>
                      )}

                      {busy !== null && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
                          <InlineSpinner size={14} />
                          {t("acquiringLocation")}
                        </p>
                      )}

                      {verifiedDist && (
                        <p className="flex items-center gap-1 text-xs font-medium text-success">
                          <CheckCircle2
                            className="size-3.5 shrink-0"
                            aria-hidden
                          />
                          {t("withinPropertyRange", {
                            distance: verifiedDist.distance,
                            accuracy: verifiedDist.accuracy,
                          })}
                        </p>
                      )}

                      <p className="text-center text-label text-muted-foreground">
                        {todayQuery.data?.geofence_enabled
                          ? `${t("geofenceHint")} · ${t("frontDeskNoSelfieHint")}`
                          : t("frontDeskNoSelfieHint")}
                      </p>

                      {error && (
                        <div
                          role="alert"
                          className="flex w-full max-w-sm flex-col items-start gap-2 rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger"
                        >
                          <div className="flex items-start gap-2">
                            <MapPinOff
                              className="mt-0.5 size-4 shrink-0"
                              aria-hidden
                            />
                            <span className="leading-snug">{error}</span>
                          </div>
                          {todayQuery.data?.geofence_enabled && (
                            <button
                              type="button"
                              onClick={() => {
                                setError(null);
                                void handleAction(
                                  selectedStaff,
                                  isWorking ? "out" : "in",
                                );
                              }}
                              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-white/80 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-white"
                            >
                              <Navigation className="size-3" aria-hidden />
                              {t("retryGpsLocation")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Today 3-column summary (Check-in / Check-out / Total Hrs) */}
                    <div className="mt-2 grid grid-cols-3 divide-x rounded-lg border text-center text-sm">
                      <div className="px-2 py-3">
                        <p className="flex items-center justify-center gap-1 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                          <LogIn className="size-3" aria-hidden />{" "}
                          {t("checkInCol")}
                        </p>
                        <p className="mt-1 font-semibold tabular-nums">
                          {fmtClock(
                            selectedRow?.first_check_in_at ||
                              selectedRow?.check_in_at ||
                              null,
                          )}
                        </p>
                      </div>
                      <div className="px-2 py-3">
                        <p className="flex items-center justify-center gap-1 text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                          <LogOut className="size-3" aria-hidden />{" "}
                          {t("checkOutCol")}
                        </p>
                        <p className="mt-1 font-semibold tabular-nums">
                          {fmtClock(selectedRow?.check_out_at || null)}
                        </p>
                      </div>
                      <div className="px-2 py-3">
                        <p className="text-micro font-semibold uppercase tracking-widest text-gold-700">
                          {t("totalHrs")}
                        </p>
                        <p className="mt-1 font-semibold tabular-nums text-gold-700">
                          {fmtHrs(liveWorkingMinutes)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border bg-card p-8 shadow-sm">
                    <EmptyState
                      icon={Users}
                      title={t("selectStaffMember")}
                      subtitle={t("selectStaffSubtitle")}
                    />
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default function StaffCheckinPage() {
  return (
    <RequireAccessMode mode="full">
      <RequirePermission permission={PERMISSIONS.staffAttendanceRecord}>
        <StaffCheckinContent />
      </RequirePermission>
    </RequireAccessMode>
  );
}
