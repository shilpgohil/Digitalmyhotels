"use client";

/**
 * /staff/[id] — Staff Profile (client mockup "Staff Profile").
 * When the profile belongs to the LOGGED-IN user, their self check-in card
 * renders on top (client 09/2026: managers/admins check in from their own
 * profile). `?edit=1` switches to the edit form.
 */

import { use, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, Pencil } from "lucide-react";
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
import { RequirePermission } from "@/components/auth/require-permission";
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

function StaffProfileContent({ staffId }: { readonly staffId: string }) {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeHotelId, can, user } = useAuth();
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");

  const staff = useQuery({
    queryKey: ["staff", activeHotelId, staffId],
    queryFn: () => api<StaffOut>(`/api/v1/staff/${staffId}`),
    enabled: !!activeHotelId,
  });

  const month = localToday().slice(0, 7);
  const calendar = useQuery({
    queryKey: ["staff-calendar", activeHotelId, staffId, month],
    queryFn: () =>
      api<CalendarOut>(`/api/v1/staff/attendance/calendar?staff_id=${staffId}&month=${month}`),
    enabled: !!activeHotelId && can(PERMISSIONS.staffAttendanceView),
  });

  const recent = useQuery({
    queryKey: ["staff-recent", activeHotelId, staffId],
    queryFn: () => api<HistoryOut>(`/api/v1/staff/attendance/${staffId}/recent?days=7`),
    enabled: !!activeHotelId && can(PERMISSIONS.staffAttendanceView),
  });

  const s = staff.data;
  const isOwnProfile = !!s && !!user && s.user_id === user.id;

  const workingDays = (() => {
    const c = calendar.data;
    if (!c || c.present_days === 0) return null;
    return c.present_days;
  })();

  return (
    <>
      <PartnerHeader title={t("staffProfileTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        <button
          type="button"
          onClick={() => router.push("/staff")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToStaffList")}
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
                <span className="flex size-14 items-center justify-center rounded-full bg-navy-900 text-lg font-bold text-white">
                  {s.full_name
                    .split(" ")
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase())
                    .join("")}
                </span>
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
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {/* Profile summary */}
              <SectionPanel title={t("profileSummary")} className="lg:col-span-2">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
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

              {/* This month */}
              <SectionPanel title={t("thisMonth")} icon={CalendarCheck}>
                <StatCardGrid cols={2}>
                  <StatCard
                    tone="white"
                    label={t("presentDays")}
                    value={String(calendar.data?.present_days ?? 0)}
                    isLoading={calendar.isLoading}
                  />
                  <StatCard
                    tone="white"
                    label={t("absentDays")}
                    value={String(calendar.data?.absent_days ?? 0)}
                    isLoading={calendar.isLoading}
                  />
                  <StatCard
                    tone="white"
                    label={t("lateDays")}
                    value={String(calendar.data?.late_days ?? 0)}
                    isLoading={calendar.isLoading}
                  />
                  <StatCard
                    tone="white"
                    label={t("leaveDays")}
                    value={String(calendar.data?.leave_days ?? 0)}
                    isLoading={calendar.isLoading}
                  />
                </StatCardGrid>
                {workingDays != null && (
                  <p className="mt-2 text-label text-muted-foreground">
                    {t("presentThisMonth", { days: workingDays })}
                  </p>
                )}
              </SectionPanel>
            </div>

            {/* Recent attendance */}
            {can(PERMISSIONS.staffAttendanceView) && (
              <SectionPanel
                title={t("recentAttendance")}
                action={
                  <button
                    type="button"
                    onClick={() => router.push("/staff/attendance/history")}
                    className="text-xs font-medium text-gold-600 hover:underline"
                  >
                    {t("viewFullHistory")} →
                  </button>
                }
                noPadding
              >
                <DataTable
                  isLoading={recent.isLoading}
                  isEmpty={recent.data?.items.length === 0}
                  emptyTitle={t("noAttendanceYet")}
                  columns={[
                    t("dateCol"),
                    t("checkInCol"),
                    t("checkOutCol"),
                    t("workingHours"),
                    t("statusCol"),
                  ]}
                >
                  {(recent.data?.items ?? []).map((row) => (
                    <TableRow key={`${row.staff_profile_id}-${row.work_date}`}>
                      <TableCell>{fmtApiDate(row.work_date)}</TableCell>
                      <TableCell className="tabular-nums">
                        {fmtClock(row.check_in_at)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {fmtClock(row.check_out_at)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {fmtHrs(row.working_minutes)}
                      </TableCell>
                      <TableCell>
                        <AttendanceStatusBadge status={row.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </DataTable>
              </SectionPanel>
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
    <RequirePermission permission={PERMISSIONS.staffView}>
      <StaffProfileContent staffId={id} />
    </RequirePermission>
  );
}
