"use client";

/** /staff/attendance/reports — Late & Early Attendance (client mockup). */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Clock, Hourglass, LogOut } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { SegmentedChips } from "@/components/ui/segmented-chips";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtApiDate, localToday } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { STAFF_DEPARTMENTS, type AnomaliesOut } from "@/types/staff";

function fmtClock(iso: string | null): string {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function weekAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

type AnomalyFilter = "all" | "late" | "early" | "missing";

function ReportsContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const api = useApi();
  const { activeHotelId } = useAuth();

  const [fromDate, setFromDate] = useState(weekAgo());
  const [toDate, setToDate] = useState(localToday());
  const [department, setDepartment] = useState("");
  const [filter, setFilter] = useState<AnomalyFilter>("all");

  const qs = [
    `from_date=${fromDate}`,
    `to_date=${toDate}`,
    department && `department=${department}`,
  ]
    .filter(Boolean)
    .join("&");

  const data = useQuery({
    queryKey: ["staff-attendance", activeHotelId, "anomalies", qs],
    queryFn: () => api<AnomaliesOut>(`/api/v1/staff/attendance/anomalies?${qs}`),
    enabled: !!activeHotelId && !!fromDate && !!toDate,
  });

  const items = (data.data?.items ?? []).filter((row) => {
    if (filter === "late") return !!row.late_minutes;
    if (filter === "early") return !!row.early_out_minutes;
    if (filter === "missing") return row.missing_out;
    return true;
  });

  return (
    <>
      <PartnerHeader title={t("lateEarlyTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <StatCardGrid className="mb-4" cols={4}>
          <StatCard
            label={t("lateArrivals")}
            value={String(data.data?.late_count ?? 0)}
            subtitle={t("inSelectedRange")}
            icon={AlarmClock}
            tone="warning"
            isLoading={data.isLoading}
          />
          <StatCard
            label={t("earlyCheckouts")}
            value={String(data.data?.early_count ?? 0)}
            subtitle={t("inSelectedRange")}
            icon={LogOut}
            tone="info"
            isLoading={data.isLoading}
          />
          <StatCard
            label={t("missingCheckouts")}
            value={String(data.data?.missing_count ?? 0)}
            subtitle={t("requiresReview")}
            icon={Hourglass}
            tone="danger"
            isLoading={data.isLoading}
          />
          <StatCard
            label={t("avgLateTime")}
            value={`${data.data?.avg_late_minutes ?? 0} min`}
            subtitle={t("acrossDepartments")}
            icon={Clock}
            tone="navy"
            isLoading={data.isLoading}
          />
        </StatCardGrid>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <FilterBar
            fromDate={fromDate}
            onFromDateChange={setFromDate}
            fromLabel={t("fromDate")}
            toDate={toDate}
            onToDateChange={setToDate}
            toLabel={t("toDate")}
            selectValue={department}
            onSelectChange={setDepartment}
            selectOptions={STAFF_DEPARTMENTS.map((d) => ({
              value: d,
              label: t(`dept_${d}`),
            }))}
            selectPlaceholder={t("allDepartments")}
            selectLabel={t("department")}
            hasActiveFilters={!!department}
            onClear={() => {
              setDepartment("");
              setFromDate(weekAgo());
              setToDate(localToday());
            }}
          />
          <SegmentedChips
            options={[
              { value: "all", label: t("statusAll") },
              { value: "late", label: t("lateOnly") },
              { value: "early", label: t("earlyOnly") },
              { value: "missing", label: t("missingOnly") },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>

        <DataTable
          darkHeader
          isLoading={data.isLoading}
          isError={data.isError}
          onRetry={() => data.refetch()}
          isEmpty={items.length === 0}
          emptyTitle={t("noAnomalies")}
          emptySubtitle={t("noAnomaliesSubtitle")}
          columns={[
            t("staffMember"),
            t("dateCol"),
            t("checkInCol"),
            t("expectedTime"),
            t("lateBy"),
            t("checkOutCol"),
            t("earlyBy"),
            t("statusCol"),
          ]}
        >
          {items.map((row) => (
            <TableRow key={`${row.staff_profile_id}-${row.work_date}`}>
              <TableCell>
                <span className="block font-medium">{row.full_name}</span>
                <span className="block text-label text-muted-foreground">
                  {t(`dept_${row.department}`)}
                </span>
              </TableCell>
              <TableCell>{fmtApiDate(row.work_date)}</TableCell>
              <TableCell
                className={cn("tabular-nums", row.late_minutes && "font-semibold text-warning")}
              >
                {fmtClock(row.check_in_at)}
              </TableCell>
              <TableCell className="tabular-nums">
                {row.expected_in ? row.expected_in.slice(0, 5) : "—"}
              </TableCell>
              <TableCell>
                {row.late_minutes ? (
                  <span className="font-semibold text-warning tabular-nums">
                    {row.late_minutes} min
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell
                className={cn(
                  "tabular-nums",
                  row.early_out_minutes && "font-semibold text-warning",
                )}
              >
                {fmtClock(row.check_out_at)}
              </TableCell>
              <TableCell>
                {row.early_out_minutes ? (
                  <span className="font-semibold text-warning tabular-nums">
                    {row.early_out_minutes} min
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="space-x-1">
                {row.late_minutes ? (
                  <StatusBadge tone="warning">{t("att_late")}</StatusBadge>
                ) : null}
                {row.early_out_minutes ? (
                  <StatusBadge tone="info">{t("earlyOut")}</StatusBadge>
                ) : null}
                {row.missing_out ? (
                  <StatusBadge tone="danger">{t("missingOut")}</StatusBadge>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </main>
    </>
  );
}

export default function LateEarlyReportsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffAttendanceView}>
      <ReportsContent />
    </RequirePermission>
  );
}
