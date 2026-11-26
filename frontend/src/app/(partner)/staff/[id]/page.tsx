"use client";

/**
 * /staff/[id] — Staff Profile & Attendance Auditing.
 * When accessed from Team page, back button returns to `/team`.
 * Showcases full staff profile + month-navigable calendar heatmap
 * + 30-day selfie retention/fingerprint auditing + monthly detailed logs.
 */

import { use, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lock,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionPanel } from "@/components/ui/section-panel";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { AttendanceStatusBadge } from "@/components/staff/attendance-status-badge";
import { CheckInCard } from "@/components/staff/check-in-card";
import { StaffForm } from "@/components/staff/staff-form";
import { MonthCalendar } from "@/components/staff/month-calendar";
import { StaffAvatar } from "@/components/staff/staff-avatar";
import { StaffIdProofCard } from "@/components/staff/staff-id-proof-card";
import { RecordDetailDialog } from "@/components/staff/record-detail-dialog";
import { RequirePermission } from "@/components/auth/require-permission";
import { RequireAccessMode } from "@/components/auth/require-access-mode";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtApiDate, fmtINR, localToday } from "@/lib/formatting";
import type { CalendarOut, HistoryOut, StaffOut } from "@/types/staff";

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

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function StaffProfileContent({ staffId }: { readonly staffId: string }) {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const fromTeam = searchParams.get("from") === "team";
  const { activeHotelId, can, user } = useAuth();
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [selectedMonth, setSelectedMonth] = useState(localToday().slice(0, 7));
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: ["staff", activeHotelId, staffId],
    queryFn: () => api<StaffOut>(`/api/v1/staff/${staffId}`),
    enabled: !!activeHotelId,
  });

  const calendar = useQuery({
    queryKey: ["staff-calendar", activeHotelId, staffId, selectedMonth],
    queryFn: () =>
      api<CalendarOut>(
        `/api/v1/staff/attendance/calendar?staff_id=${staffId}&month=${selectedMonth}`,
      ),
    enabled: !!activeHotelId && can(PERMISSIONS.staffAttendanceView),
  });

  const [yearNum, monthNum] = selectedMonth.split("-").map(Number);
  const lastDay = new Date(yearNum, monthNum, 0).getDate();
  const fromDate = `${selectedMonth}-01`;
  const toDate = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

  const monthHistory = useQuery({
    queryKey: ["staff-month-history", activeHotelId, staff.data?.staff_code, selectedMonth],
    queryFn: () =>
      api<HistoryOut>(
        `/api/v1/staff/attendance/history?q=${encodeURIComponent(staff.data?.staff_code ?? "")}&from_date=${fromDate}&to_date=${toDate}&limit=100`,
      ),
    enabled: !!activeHotelId && !!staff.data?.staff_code && can(PERMISSIONS.staffAttendanceView),
  });

  const s = staff.data;
  const isOwnProfile = !!s && !!user && s.user_id === user.id;

  const monthLabel = new Date(`${selectedMonth}-01T00:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <PartnerHeader title={t("staffProfileTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        <button
          type="button"
          onClick={() => router.push(fromTeam ? "/team" : "/staff")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {fromTeam ? t("backToTeam") : t("backToStaffList")}
        </button>

        {staff.isLoading && <Skeleton className="h-40" />}

        {staff.isError && (
          <p className="text-sm text-danger">
            {tc("error")}{" "}
            <button type="button" className="underline" onClick={() => staff.refetch()}>
              {tc("retry")}
            </button>
          </p>
        )}

        {s && editing && (
          <div className="mx-auto max-w-4xl">
            <StaffForm
              existing={s}
              onDone={() => {
                setEditing(false);
                staff.refetch();
              }}
            />
          </div>
        )}

        {s && !editing && (
          <>
            {/* Own profile → self check-in card on top (client requirement) */}
            {isOwnProfile && (
              <div className="mx-auto max-w-md">
                <CheckInCard />
              </div>
            )}

            {/* Hero */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-4">
                <StaffAvatar
                  staffId={s.id}
                  name={s.full_name}
                  hasPhoto={s.has_photo}
                  size="lg"
                />
                <div>
                  <p className="flex items-center gap-2 text-lg font-semibold">
                    {s.full_name}
                    <StatusBadge
                      tone={
                        s.status === "active"
                          ? "success"
                          : s.status === "on_leave"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {t(`status_${s.status}`)}
                    </StatusBadge>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {s.staff_code} · {s.designation ?? t(`dept_${s.department}`)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {can(PERMISSIONS.staffManage) && (
                  <Button
                    variant="outline"
                    className="h-[42px]"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="mr-2 size-4" aria-hidden />
                    {t("editStaff")}
                  </Button>
                )}
                {can(PERMISSIONS.staffAttendanceView) && (
                  <Button
                    className="h-[42px] bg-navy-900 text-white hover:bg-navy-800"
                    onClick={() =>
                      router.push(
                        `/staff/attendance/history?q=${encodeURIComponent(s.staff_code)}`,
                      )
                    }
                  >
                    <CalendarCheck className="mr-2 size-4" aria-hidden />
                    {t("attendanceBtn")}
                  </Button>
                )}
              </div>
            </div>

            {/* Profile summary */}
            <SectionPanel title={t("profileSummary")}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                {(
                  [
                    [t("joiningDate"), fmtApiDate(s.joining_date)],
                    [t("department"), t(`dept_${s.department}`)],
                    [t("designation"), s.designation ?? "—"],
                    [t("mobile"), s.phone ?? "—"],
                    [t("emailAddress"), s.email ?? "—"],
                    [
                      t("monthlySalary"),
                      can(PERMISSIONS.staffSalaryView) && s.base_salary
                        ? fmtINR(s.base_salary)
                        : t("confidential"),
                    ],
                    [
                      t("shift"),
                      s.shift_start
                        ? `${s.shift_start.slice(0, 5)} – ${s.shift_end?.slice(0, 5) ?? "…"}`
                        : "—",
                    ],
                    [t("employmentType"), t(`empType_${s.employment_type}`)],
                    [
                      t("weeklyOff"),
                      s.weekly_off != null ? t(`dow_${s.weekly_off}`) : "—",
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-0.5 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </SectionPanel>

            {/* ID Proof & Verification */}
            <StaffIdProofCard
              staff={s}
              onUpdated={() =>
                queryClient.invalidateQueries({ queryKey: ["staff", activeHotelId] })
              }
            />

            {/* Attendance Heatmap & Auditing Section */}
            {can(PERMISSIONS.staffAttendanceView) && (
              <div className="space-y-4">
                {/* Month Navigator + Stat Cards + Heatmap */}
                <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="size-5 text-gold-600" aria-hidden />
                      <div>
                        <h2 className="font-semibold text-base text-navy-950">
                          {t("attendanceAuditTitle")}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {t("attendanceHeatmap")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5"
                        onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
                        aria-label={t("prevMonth")}
                      >
                        <ChevronLeft className="size-4" aria-hidden />
                      </Button>
                      <span className="min-w-36 text-center text-sm font-semibold text-navy-900 tabular-nums">
                        {monthLabel}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5"
                        onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
                        aria-label={t("nextMonth")}
                      >
                        <ChevronRight className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  <StatCardGrid cols={4}>
                    <StatCard
                      tone="white"
                      barColor="bg-success"
                      className="border border-border/80 hover:border-success/50 transition-colors shadow-2xs hover:shadow-sm"
                      label={t("presentDays")}
                      value={String(calendar.data?.present_days ?? 0)}
                      isLoading={calendar.isLoading}
                    />
                    <StatCard
                      tone="white"
                      barColor="bg-warning"
                      className="border border-border/80 hover:border-warning/50 transition-colors shadow-2xs hover:shadow-sm"
                      label={t("lateDays")}
                      value={String(calendar.data?.late_days ?? 0)}
                      isLoading={calendar.isLoading}
                    />
                    <StatCard
                      tone="white"
                      barColor="bg-danger"
                      className="border border-border/80 hover:border-danger/50 transition-colors shadow-2xs hover:shadow-sm"
                      label={t("absentDays")}
                      value={String(calendar.data?.absent_days ?? 0)}
                      isLoading={calendar.isLoading}
                    />
                    <StatCard
                      tone="white"
                      barColor="bg-info"
                      className="border border-border/80 hover:border-info/50 transition-colors shadow-2xs hover:shadow-sm"
                      label={t("leaveDays")}
                      value={String(calendar.data?.leave_days ?? 0)}
                      isLoading={calendar.isLoading}
                    />
                  </StatCardGrid>

                  <div className="pt-2">
                    {calendar.isLoading && <Skeleton className="h-64" />}
                    {calendar.data && (
                      <MonthCalendar
                        data={calendar.data}
                        onSelectDay={(day) =>
                          day.record_id && setSelectedRecordId(day.record_id)
                        }
                      />
                    )}
                  </div>

                  {/* 30-Day Retention & Digital Fingerprint Notice */}
                  <div className="flex items-start gap-2.5 rounded-lg border border-amber-200/80 bg-amber-50/50 p-3 text-xs text-amber-900">
                    <ShieldCheck className="size-4 shrink-0 text-amber-700 mt-0.5" aria-hidden />
                    <p className="leading-relaxed">
                      {t("selfieRetentionNote")}
                    </p>
                  </div>
                </div>

                {/* Monthly Attendance Audit Table */}
                <SectionPanel
                  title={`${t("attendanceAuditTitle")} — ${monthLabel}`}
                  action={
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/staff/attendance/history?q=${encodeURIComponent(s.staff_code)}`,
                        )
                      }
                      className="text-xs font-medium text-gold-600 hover:underline"
                    >
                      {t("viewFullHistory")} →
                    </button>
                  }
                  noPadding
                >
                  <DataTable
                    isLoading={monthHistory.isLoading}
                    isEmpty={(monthHistory.data?.items ?? []).length === 0}
                    emptyTitle={t("noRecordsForMonth")}
                    columns={[
                      t("dateCol"),
                      t("statusCol"),
                      t("checkInCol"),
                      t("checkOutCol"),
                      t("workingHours"),
                      t("selfieAuditCol"),
                      tc("actions"),
                    ]}
                  >
                    {(monthHistory.data?.items ?? []).map((row) => (
                      <TableRow key={`${row.staff_profile_id}-${row.work_date}`}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {fmtApiDate(row.work_date)}
                        </TableCell>
                        <TableCell>
                          <AttendanceStatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="tabular-nums">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">
                              {fmtClock(row.first_check_in_at || row.check_in_at)}
                              {row.late_minutes ? (
                                <span className="ml-1 text-xs font-semibold text-warning">
                                  +{row.late_minutes}m
                                </span>
                              ) : null}
                            </span>
                            {row.method_in && (
                              <span className="text-[11px] text-muted-foreground uppercase">
                                {row.method_in === "self_geo"
                                  ? t("method_self_geo")
                                  : row.method_in === "front_desk"
                                    ? t("method_front_desk")
                                    : row.method_in === "auto"
                                      ? t("method_auto")
                                      : t("method_manual")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">
                              {fmtClock(row.check_out_at)}
                              {row.early_out_minutes ? (
                                <span className="ml-1 text-xs font-semibold text-warning">
                                  −{row.early_out_minutes}m
                                </span>
                              ) : null}
                            </span>
                            {row.method_out && (
                              <span className="text-[11px] text-muted-foreground uppercase">
                                {row.method_out === "self_geo"
                                  ? t("method_self_geo")
                                  : row.method_out === "front_desk"
                                    ? t("method_front_desk")
                                    : row.method_out === "auto"
                                      ? t("method_auto")
                                      : t("method_manual")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums font-medium">
                          {fmtHrs(row.working_minutes)}
                        </TableCell>
                        <TableCell>
                          {row.has_selfie && !row.selfie_flushed ? (
                            <button
                              type="button"
                              onClick={() =>
                                row.record_id && setSelectedRecordId(row.record_id)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                            >
                              <span className="size-1.5 rounded-full bg-emerald-600 animate-pulse" />
                              {t("selfieAvailable")}
                            </button>
                          ) : row.selfie_flushed ? (
                            <button
                              type="button"
                              onClick={() =>
                                row.record_id && setSelectedRecordId(row.record_id)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                              title={row.check_in_selfie_sha256 ?? undefined}
                            >
                              <Lock className="size-3 text-amber-600" aria-hidden />
                              {t("selfieArchived")}
                            </button>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.record_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2.5 text-xs text-navy-800 hover:text-navy-950 hover:bg-muted"
                              onClick={() => setSelectedRecordId(row.record_id)}
                            >
                              <Eye className="mr-1.5 size-3.5" aria-hidden />
                              {t("viewEvidence")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                </SectionPanel>

                {/* Audit Evidence Modal */}
                <RecordDetailDialog
                  recordId={selectedRecordId}
                  onClose={() => setSelectedRecordId(null)}
                />
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

export default function StaffProfilePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <RequireAccessMode mode="full">
      <RequirePermission permission={PERMISSIONS.staffView}>
        <StaffProfileContent staffId={id} />
      </RequirePermission>
    </RequireAccessMode>
  );
}
