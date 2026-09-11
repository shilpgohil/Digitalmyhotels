"use client";

/** /staff/attendance/calendar — per-staff month view (client mockup). */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionPanel } from "@/components/ui/section-panel";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { MonthCalendar } from "@/components/staff/month-calendar";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import type { CalendarOut, StaffListOut } from "@/types/staff";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function CalendarContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const api = useApi();
  const { activeHotelId } = useAuth();

  const [staffId, setStaffId] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const staff = useQuery({
    queryKey: ["staff", activeHotelId, "calendar-list"],
    queryFn: () => api<StaffListOut>("/api/v1/staff?limit=200"),
    enabled: !!activeHotelId,
  });

  // Auto-select the first staff member.
  const effectiveStaffId = staffId || staff.data?.items[0]?.id || "";

  const calendar = useQuery({
    queryKey: ["staff-calendar", activeHotelId, effectiveStaffId, month],
    queryFn: () =>
      api<CalendarOut>(
        `/api/v1/staff/attendance/calendar?staff_id=${effectiveStaffId}&month=${month}`,
      ),
    enabled: !!activeHotelId && !!effectiveStaffId,
  });

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <PartnerHeader title={t("attendanceCalendarTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-[42px] px-3"
                onClick={() => setMonth(shiftMonth(month, -1))}
                aria-label={t("prevMonth")}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <p className="min-w-40 text-center text-sm font-semibold">{monthLabel}</p>
              <Button
                variant="outline"
                className="h-[42px] px-3"
                onClick={() => setMonth(shiftMonth(month, 1))}
                aria-label={t("nextMonth")}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
            <select
              className="h-[42px] min-w-56 rounded-md border border-input bg-white px-2.5 text-sm"
              value={effectiveStaffId}
              onChange={(e) => setStaffId(e.target.value)}
              aria-label={t("staffMember")}
            >
              {(staff.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} — {s.staff_code}
                </option>
              ))}
            </select>
          </div>

          <SectionPanel title={monthLabel}>
            {calendar.isLoading && <Skeleton className="h-80" />}
            {calendar.data && <MonthCalendar data={calendar.data} />}
          </SectionPanel>

          <StatCardGrid cols={4}>
            <StatCard
              tone="white"
              label={t("totalPresent")}
              value={String(calendar.data?.present_days ?? 0)}
              isLoading={calendar.isLoading}
            />
            <StatCard
              tone="white"
              label={t("totalLate")}
              value={String(calendar.data?.late_days ?? 0)}
              isLoading={calendar.isLoading}
            />
            <StatCard
              tone="white"
              label={t("totalAbsent")}
              value={String(calendar.data?.absent_days ?? 0)}
              isLoading={calendar.isLoading}
            />
            <StatCard
              tone="white"
              label={t("leaveDays")}
              value={String(calendar.data?.leave_days ?? 0)}
              isLoading={calendar.isLoading}
            />
          </StatCardGrid>
        </div>
      </main>
    </>
  );
}

export default function AttendanceCalendarPage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffAttendanceView}>
      <CalendarContent />
    </RequirePermission>
  );
}
