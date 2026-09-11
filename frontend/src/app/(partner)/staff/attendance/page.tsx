"use client";

/** /staff/attendance — Today's Attendance (client mockups "Staff Dashboard"
 *  + "Today's Attendance"). */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  LogOut,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { SegmentedChips } from "@/components/ui/segmented-chips";
import { DataTable } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import { AttendanceStatusBadge } from "@/components/staff/attendance-status-badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtApiDate, localToday, localYmd } from "@/lib/formatting";
import { STAFF_DEPARTMENTS, type TodayAttendanceOut } from "@/types/staff";

function fmtClock(iso: string | null): string {
  if (!iso) return "--:--";
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

function shiftDate(iso: string, days: number): string {
  // Local-time arithmetic — toISOString() here shifted a day for IST users.
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localYmd(d);
}

function TodaysAttendanceContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const api = useApi();
  const router = useRouter();
  const { activeHotelId } = useAuth();

  const [onDate, setOnDate] = useState(localToday());
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("all");

  const qs = [
    `on_date=${onDate}`,
    department && `department=${department}`,
    status !== "all" && `status=${status}`,
  ]
    .filter(Boolean)
    .join("&");

  const data = useQuery({
    queryKey: ["staff-attendance", activeHotelId, qs],
    queryFn: () => api<TodayAttendanceOut>(`/api/v1/staff/attendance/today?${qs}`),
    enabled: !!activeHotelId,
    refetchInterval: 60_000,
  });

  const exportCsv = async () => {
    const token = getAccessToken();
    const res = await fetch(
      `${API_BASE}/api/v1/staff/attendance/history.csv?from_date=${onDate}&to_date=${onDate}`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "X-Hotel-Id": activeHotelId ?? "",
        },
        credentials: "include",
      },
    );
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${onDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = data.data?.stats;

  return (
    <>
      <PartnerHeader title={t("todaysAttendanceTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Day pager + export */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-[42px] px-3"
              onClick={() => setOnDate(shiftDate(onDate, -1))}
              aria-label={t("prevDay")}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <DatePicker value={onDate} onChange={setOnDate} className="w-44" />
            <Button
              variant="outline"
              className="h-[42px] px-3"
              onClick={() => setOnDate(shiftDate(onDate, 1))}
              aria-label={t("nextDay")}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              className="h-[42px]"
              onClick={() => setOnDate(localToday())}
            >
              {t("todayBtn")}
            </Button>
          </div>
          <Button variant="outline" className="h-[42px]" onClick={() => void exportCsv()}>
            <Download className="mr-2 size-4" aria-hidden />
            {t("export")}
          </Button>
        </div>

        {/* Stat cards — 6 per mockup */}
        <StatCardGrid className="mb-4" cols={6}>
          <StatCard label={t("statTotalStaff")} value={String(stats?.total ?? 0)} subtitle={t("scheduledToday")} icon={Users} tone="navy" isLoading={data.isLoading} />
          <StatCard label={t("statPresent")} value={String(stats?.present ?? 0)} subtitle={stats?.total ? `${Math.round(((stats.present ?? 0) / stats.total) * 100)}%` : undefined} icon={UserCheck} tone="success" isLoading={data.isLoading} />
          <StatCard label={t("statWorking")} value={String(stats?.working ?? 0)} subtitle={t("onPremises")} icon={Clock} tone="info" isLoading={data.isLoading} />
          <StatCard label={t("statCheckedOut")} value={String(stats?.checked_out ?? 0)} subtitle={t("shiftCompleted")} icon={LogOut} tone="navy2" isLoading={data.isLoading} />
          <StatCard label={t("statAbsent")} value={String(stats?.absent ?? 0)} subtitle={t("requiresAttention")} icon={UserX} tone="danger" isLoading={data.isLoading} />
          <StatCard label={t("statLate")} value={String(stats?.late ?? 0)} subtitle="> 10 min" icon={CalendarCheck} tone="warning" isLoading={data.isLoading} />
        </StatCardGrid>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SegmentedChips
            options={[
              { value: "all", label: t("statusAll") },
              { value: "present", label: t("att_present") },
              { value: "working", label: t("att_working") },
              { value: "checked_out", label: t("att_checked_out") },
              { value: "absent", label: t("att_absent") },
              { value: "late", label: t("att_late") },
            ]}
            value={status}
            onChange={setStatus}
          />
          <select
            className="h-[42px] rounded-md border border-input bg-white px-2.5 text-sm"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            aria-label={t("department")}
          >
            <option value="">{t("allDepartments")}</option>
            {STAFF_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {t(`dept_${d}`)}
              </option>
            ))}
          </select>
        </div>

        <DataTable
          darkHeader
          isLoading={data.isLoading}
          isError={data.isError}
          onRetry={() => data.refetch()}
          isEmpty={data.data?.items.length === 0}
          emptyTitle={t("noStaff")}
          columns={[
            t("staffMember"),
            t("department"),
            t("checkInCol"),
            t("checkOutCol"),
            t("workingHours"),
            t("lateBy"),
            t("statusCol"),
          ]}
        >
          {(data.data?.items ?? []).map((row) => (
            <TableRow
              key={row.staff_profile_id}
              className="cursor-pointer"
              onClick={() => router.push(`/staff/${row.staff_profile_id}`)}
            >
              <TableCell>
                <span className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-micro font-bold text-white">
                    {row.full_name
                      .split(" ")
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase())
                      .join("")}
                  </span>
                  <span>
                    <span className="block font-medium">{row.full_name}</span>
                    <span className="block text-label text-muted-foreground">
                      {row.staff_code}
                    </span>
                  </span>
                </span>
              </TableCell>
              <TableCell>{t(`dept_${row.department}`)}</TableCell>
              <TableCell className="tabular-nums">{fmtClock(row.check_in_at)}</TableCell>
              <TableCell className="tabular-nums">{fmtClock(row.check_out_at)}</TableCell>
              <TableCell className="tabular-nums">{fmtHrs(row.working_minutes)}</TableCell>
              <TableCell>
                {row.late_minutes ? (
                  <span className="font-semibold text-warning tabular-nums">
                    {row.late_minutes}m
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <AttendanceStatusBadge status={row.status} />
              </TableCell>
            </TableRow>
          ))}
        </DataTable>

        <p className="mt-2 text-label text-muted-foreground">
          {fmtApiDate(onDate)} · {data.data?.items.length ?? 0} / {stats?.total ?? 0}
        </p>
      </main>
    </>
  );
}

export default function TodaysAttendancePage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffAttendanceView}>
      <TodaysAttendanceContent />
    </RequirePermission>
  );
}
