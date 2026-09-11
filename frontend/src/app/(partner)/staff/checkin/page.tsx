"use client";

/**
 * /staff/checkin — Front-desk Staff Check-in/Check-out utility (client
 * mockup "Check-out Utility"). The operator (manager/receptionist) records
 * attendance for staff at the desk — no geofence here; the operator's
 * identity + audit trail is the control.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, Search } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineSpinner } from "@/components/ui/inline-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type {
  AttendanceRecordOut,
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

function StaffCheckinContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  // Live-tick working durations.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const staff = useQuery({
    queryKey: ["staff", activeHotelId, "checkin-search", q],
    queryFn: () =>
      api<StaffListOut>(
        `/api/v1/staff?status=active&limit=12${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      ),
    enabled: !!activeHotelId && q.trim().length >= 2,
  });

  const today = useQuery({
    queryKey: ["staff-attendance", activeHotelId, "front-desk"],
    queryFn: () => api<TodayAttendanceOut>("/api/v1/staff/attendance/today"),
    enabled: !!activeHotelId,
  });

  const recordMutation = useMutation({
    mutationFn: ({ staffId, action }: { staffId: string; action: "in" | "out" }) =>
      api<AttendanceRecordOut>(`/api/v1/staff/attendance/${staffId}/record`, {
        method: "POST",
        body: { action },
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.action === "in" ? t("checkedInToast") : t("checkedOutToast"));
      queryClient.invalidateQueries({ queryKey: ["staff-attendance", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["staff", activeHotelId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const rowFor = (s: StaffOut) =>
    today.data?.items.find((i) => i.staff_profile_id === s.id);

  const now = Date.now();

  return (
    <>
      <PartnerHeader title={t("staffCheckinTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              className="pl-9"
              placeholder={t("searchStaffCheckinPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {q.trim().length < 2 && (
            <EmptyState
              icon={Search}
              title={t("searchToBegin")}
              subtitle={t("searchToBeginSubtitle")}
            />
          )}

          {staff.isLoading && q.trim().length >= 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          )}

          {staff.data && staff.data.items.length === 0 && (
            <EmptyState icon={Search} title={t("noStaffMatch")} />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {(staff.data?.items ?? []).map((s) => {
              const row = rowFor(s);
              const working =
                !!row?.check_in_at && !row.check_out_at;
              const done = !!row?.check_out_at;
              const durationMin = row?.check_in_at
                ? Math.max(
                    0,
                    Math.floor(
                      ((row.check_out_at ? new Date(row.check_out_at).getTime() : now) -
                        new Date(row.check_in_at).getTime()) /
                        60000,
                    ),
                  )
                : 0;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "overflow-hidden rounded-lg border bg-card shadow-sm",
                    working && "border-t-2 border-t-navy-900",
                  )}
                >
                  <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                    <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                      {t("statusCol")}
                    </p>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-label font-medium",
                        working
                          ? "border-success/30 bg-success-bg text-success"
                          : done
                            ? "border-border bg-muted text-muted-foreground"
                            : "border-border bg-white text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          working ? "bg-success" : done ? "bg-muted-foreground" : "bg-danger",
                        )}
                      />
                      {working
                        ? t("currentlyWorking")
                        : done
                          ? t("att_checked_out")
                          : t("notCheckedIn")}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-3 p-5">
                    <span className="flex size-16 items-center justify-center rounded-full bg-navy-900 text-xl font-bold text-white">
                      {s.full_name
                        .split(" ")
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join("")}
                    </span>
                    <div className="text-center">
                      <p className="text-lg font-semibold">{s.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {t(`dept_${s.department}`)} · {s.staff_code}
                      </p>
                    </div>

                    <div className="grid w-full grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-center text-sm">
                      {working || done ? (
                        <>
                          <div>
                            <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                              {t("checkInCol")}
                            </p>
                            <p className="mt-0.5 font-semibold tabular-nums">
                              {fmtClock(row?.check_in_at ?? null)}
                            </p>
                          </div>
                          <div>
                            <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                              {t("duration")}
                            </p>
                            <p className="mt-0.5 flex items-center justify-center gap-1 font-semibold tabular-nums">
                              <Clock className="size-3.5" aria-hidden />
                              {`${String(Math.floor(durationMin / 60)).padStart(2, "0")}h ${String(durationMin % 60).padStart(2, "0")}m`}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                              {t("currentDate")}
                            </p>
                            <p className="mt-0.5 font-semibold">
                              {new Date().toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                              })}
                            </p>
                          </div>
                          <div>
                            <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                              {t("currentTime")}
                            </p>
                            <p className="mt-0.5 font-semibold tabular-nums">
                              {new Date().toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              })}
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    {!done && (
                      <Button
                        className={cn(
                          "h-[42px] w-full",
                          working
                            ? "border border-navy-900 bg-white text-navy-900 hover:bg-muted"
                            : "bg-navy-900 text-white hover:bg-navy-800",
                        )}
                        disabled={recordMutation.isPending}
                        onClick={() =>
                          recordMutation.mutate({
                            staffId: s.id,
                            action: working ? "out" : "in",
                          })
                        }
                      >
                        {recordMutation.isPending ? (
                          <InlineSpinner size={16} className="mr-2" />
                        ) : working ? (
                          <LogOut className="mr-2 size-4" aria-hidden />
                        ) : (
                          <LogIn className="mr-2 size-4" aria-hidden />
                        )}
                        {working ? t("checkOutAction") : t("checkInAction")}
                      </Button>
                    )}
                    {done && (
                      <p className="text-sm text-muted-foreground">
                        {t("shiftCompleted")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </>
  );
}

export default function StaffCheckinPage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffAttendanceRecord}>
      <StaffCheckinContent />
    </RequirePermission>
  );
}
