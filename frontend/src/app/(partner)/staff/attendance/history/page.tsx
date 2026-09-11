"use client";

/** /staff/attendance/history — Attendance History (client mockup). */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataTable } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import { PaginationFooter, paginate } from "@/components/ui/pagination-footer";
import { AttendanceStatusBadge } from "@/components/staff/attendance-status-badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtApiDate, localToday, localYmd } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { STAFF_DEPARTMENTS, type HistoryOut } from "@/types/staff";

function fmtClock(iso: string | null): string {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function monthAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return localYmd(d);
}

function HistoryContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const api = useApi();
  const { activeHotelId } = useAuth();

  const [fromDate, setFromDate] = useState(monthAgo());
  const [toDate, setToDate] = useState(localToday());
  const [department, setDepartment] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const qs = [
    `from_date=${fromDate}`,
    `to_date=${toDate}`,
    department && `department=${department}`,
    q && `q=${encodeURIComponent(q)}`,
  ]
    .filter(Boolean)
    .join("&");

  const history = useQuery({
    queryKey: ["staff-attendance", activeHotelId, "history", qs],
    queryFn: () => api<HistoryOut>(`/api/v1/staff/attendance/history?limit=200&${qs}`),
    enabled: !!activeHotelId && !!fromDate && !!toDate,
  });

  const exportCsv = async () => {
    const token = getAccessToken();
    const res = await fetch(
      `${API_BASE}/api/v1/staff/attendance/history.csv?from_date=${fromDate}&to_date=${toDate}${department ? `&department=${department}` : ""}`,
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
    a.download = `attendance-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxMinutes = Math.max(
    ...(history.data?.items ?? []).map((i) => i.working_minutes ?? 0),
    480,
  );

  return (
    <>
      <PartnerHeader title={t("attendanceHistoryTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <FilterBar
            fromDate={fromDate}
            onFromDateChange={(v) => {
              setFromDate(v);
              setPage(1);
            }}
            fromLabel={t("fromDate")}
            toDate={toDate}
            onToDateChange={(v) => {
              setToDate(v);
              setPage(1);
            }}
            toLabel={t("toDate")}
            selectValue={department}
            onSelectChange={(v) => {
              setDepartment(v);
              setPage(1);
            }}
            selectOptions={STAFF_DEPARTMENTS.map((d) => ({
              value: d,
              label: t(`dept_${d}`),
            }))}
            selectPlaceholder={t("allDepartments")}
            selectLabel={t("department")}
            searchValue={q}
            onSearchChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            searchPlaceholder={t("searchStaffPlaceholder")}
            hasActiveFilters={!!(department || q)}
            onClear={() => {
              setDepartment("");
              setQ("");
              setFromDate(monthAgo());
              setToDate(localToday());
              setPage(1);
            }}
          />
          <Button variant="outline" className="h-[42px]" onClick={() => void exportCsv()}>
            <Download className="mr-2 size-4" aria-hidden />
            {t("export")}
          </Button>
        </div>

        <DataTable
          darkHeader
          isLoading={history.isLoading}
          isError={history.isError}
          onRetry={() => history.refetch()}
          isEmpty={history.data?.items.length === 0}
          emptyTitle={t("noAttendanceYet")}
          columns={[
            t("dateCol"),
            t("staffMember"),
            t("department"),
            t("checkInCol"),
            t("checkOutCol"),
            t("workingHours"),
            t("statusCol"),
          ]}
        >
          {paginate(history.data?.items ?? [], page, 15).map((row) => {
            const pct = Math.min(
              100,
              Math.round(((row.working_minutes ?? 0) / maxMinutes) * 100),
            );
            return (
              <TableRow key={`${row.staff_profile_id}-${row.work_date}`}>
                <TableCell>{fmtApiDate(row.work_date)}</TableCell>
                <TableCell>
                  <span className="font-medium">{row.full_name}</span>{" "}
                  <span className="text-label text-muted-foreground">{row.staff_code}</span>
                </TableCell>
                <TableCell>{t(`dept_${row.department}`)}</TableCell>
                <TableCell
                  className={cn("tabular-nums", row.late_minutes && "font-semibold text-warning")}
                >
                  {fmtClock(row.check_in_at)}
                </TableCell>
                <TableCell className="tabular-nums">{fmtClock(row.check_out_at)}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded bg-muted">
                      <span
                        className="block h-full rounded bg-navy-900"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="text-label tabular-nums text-muted-foreground">
                      {row.working_minutes != null
                        ? `${Math.floor(row.working_minutes / 60)}h ${row.working_minutes % 60}m`
                        : "0h 0m"}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <AttendanceStatusBadge status={row.status} />
                </TableCell>
              </TableRow>
            );
          })}
        </DataTable>
        {(history.data?.items.length ?? 0) > 0 && (
          <PaginationFooter
            page={page}
            total={history.data?.items.length ?? 0}
            pageSize={15}
            onPageChange={setPage}
          />
        )}
      </main>
    </>
  );
}

export default function AttendanceHistoryPage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffAttendanceView}>
      <HistoryContent />
    </RequirePermission>
  );
}
