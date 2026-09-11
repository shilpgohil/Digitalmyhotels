"use client";

/** /staff — Staff List (client mockup "Staff List"). */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Download, MoreVertical, Plus, Users } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { SegmentedChips } from "@/components/ui/segmented-chips";
import { PaginationFooter, paginate } from "@/components/ui/pagination-footer";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { AttendanceStatusBadge } from "@/components/staff/attendance-status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { STAFF_DEPARTMENTS, type StaffListOut } from "@/types/staff";

const STATUS_TONE: Record<string, "success" | "info" | "neutral"> = {
  active: "success",
  on_leave: "info",
  inactive: "neutral",
};

function StaffListContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const router = useRouter();
  const { activeHotelId, can } = useAuth();

  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);

  const qs = [
    q && `q=${encodeURIComponent(q)}`,
    department && `department=${department}`,
    role && `role=${role}`,
    status !== "all" && `status=${status}`,
  ]
    .filter(Boolean)
    .join("&");

  const staff = useQuery({
    queryKey: ["staff", activeHotelId, qs],
    queryFn: () => api<StaffListOut>(`/api/v1/staff?limit=200${qs ? `&${qs}` : ""}`),
    enabled: !!activeHotelId,
  });

  /** Client-side CSV of the currently filtered directory (mockup Export). */
  const exportCsv = () => {
    const rows = staff.data?.items ?? [];
    const esc = (v: string | null | undefined) =>
      `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [
      ["Staff ID", "Name", "Role", "Department", "Mobile", "Status", "Joining Date"].join(","),
      ...rows.map((s) =>
        [
          esc(s.staff_code),
          esc(s.full_name),
          esc(s.role_code),
          esc(s.department),
          esc(s.phone),
          esc(s.status),
          esc(s.joining_date),
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "staff-list.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PartnerHeader title={t("staffListTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <FilterBar
            searchValue={q}
            onSearchChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            searchPlaceholder={t("searchStaffPlaceholder")}
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
            select2Value={role}
            onSelect2Change={(v) => {
              setRole(v);
              setPage(1);
            }}
            select2Options={[
              "manager",
              "admin",
              "receptionist",
              "general_staff",
              "housekeeping",
            ].map((r) => ({ value: r, label: t(`role_${r}`) }))}
            select2Placeholder={t("allRoles")}
            select2Label={t("roleCol")}
            hasActiveFilters={!!(q || department || role || status !== "all")}
            onClear={() => {
              setQ("");
              setDepartment("");
              setRole("");
              setStatus("all");
              setPage(1);
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-[42px] items-center gap-1.5 rounded-md border border-input bg-white px-3.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Download className="size-4" aria-hidden />
              {t("export")}
            </button>
            {can(PERMISSIONS.staffManage) && (
              <button
                type="button"
                onClick={() => router.push("/staff/new")}
                className="inline-flex h-[42px] items-center gap-1.5 rounded-md bg-gold-500 px-3.5 text-sm font-medium text-navy-900 hover:bg-gold-400"
              >
                <Plus className="size-4" aria-hidden />
                {t("addStaff")}
              </button>
            )}
          </div>
        </div>

        <div className="mb-4">
          <SegmentedChips
            options={[
              { value: "all", label: t("statusAll") },
              { value: "active", label: t("status_active") },
              { value: "on_leave", label: t("status_on_leave") },
              { value: "inactive", label: t("status_inactive") },
            ]}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
        </div>

        <DataTable
          darkHeader
          isLoading={staff.isLoading}
          isError={staff.isError}
          onRetry={() => staff.refetch()}
          isEmpty={staff.data?.items.length === 0}
          emptyTitle={t("noStaff")}
          emptySubtitle={t("noStaffSubtitle")}
          columns={[
            t("staffId"),
            t("staffName"),
            t("roleCol"),
            t("department"),
            t("mobile"),
            t("statusCol"),
            t("todaysAttendanceCol"),
            tc("actions"),
          ]}
        >
          {paginate(staff.data?.items ?? [], page, 10).map((s) => (
            <TableRow
              key={s.id}
              className="cursor-pointer"
              onClick={() => router.push(`/staff/${s.id}`)}
            >
              <TableCell className="font-medium tabular-nums">{s.staff_code}</TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-micro font-bold text-white">
                    {s.full_name
                      .split(" ")
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase())
                      .join("")}
                  </span>
                  <span className="font-medium">{s.full_name}</span>
                </span>
              </TableCell>
              <TableCell>{s.role_code ? t(`role_${s.role_code}`) : "—"}</TableCell>
              <TableCell>{t(`dept_${s.department}`)}</TableCell>
              <TableCell className="tabular-nums">{s.phone ?? "—"}</TableCell>
              <TableCell>
                <StatusBadge tone={STATUS_TONE[s.status] ?? "neutral"}>
                  {t(`status_${s.status}`)}
                </StatusBadge>
              </TableCell>
              <TableCell>
                {s.today_status ? <AttendanceStatusBadge status={s.today_status} /> : "—"}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted"
                    aria-label={tc("actions")}
                  >
                    <MoreVertical className="size-4" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48 whitespace-nowrap">
                    <DropdownMenuItem onClick={() => router.push(`/staff/${s.id}`)}>
                      <Users className="size-4" aria-hidden />
                      {t("viewProfile")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
        {(staff.data?.items.length ?? 0) > 0 && (
          <PaginationFooter
            page={page}
            total={staff.data?.items.length ?? 0}
            pageSize={10}
            onPageChange={setPage}
          />
        )}
      </main>
    </>
  );
}

export default function StaffListPage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffView}>
      <StaffListContent />
    </RequirePermission>
  );
}
