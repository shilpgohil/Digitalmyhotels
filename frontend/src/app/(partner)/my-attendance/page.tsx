"use client";

/**
 * /my-attendance — staff self-service (mobile-first, per client mockup
 * "Staff Self-Service"). The ONLY page general_staff needs; also useful for
 * every other role.
 */

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckInCard } from "@/components/staff/check-in-card";
import { LeaveSection } from "@/components/staff/leave-section";
import { MonthCalendar } from "@/components/staff/month-calendar";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import type { CalendarOut, SelfTodayOut } from "@/types/staff";

function MyAttendanceContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const api = useApi();
  const { activeHotelId } = useAuth();

  const today = useQuery({
    queryKey: ["staff-self-today", activeHotelId],
    queryFn: () => api<SelfTodayOut>("/api/v1/staff/me/attendance/today"),
    enabled: !!activeHotelId,
  });

  const month = new Date().toISOString().slice(0, 7);
  const calendar = useQuery({
    queryKey: ["staff-self-calendar", activeHotelId, month],
    queryFn: () => api<CalendarOut>(`/api/v1/staff/me/attendance/calendar?month=${month}`),
    enabled: !!activeHotelId,
  });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t("goodMorning");
    if (h < 17) return t("goodAfternoon");
    return t("goodEvening");
  })();

  return (
    <>
      <PartnerHeader title={t("myAttendanceTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-md space-y-4">
          <div>
            <h2 className="text-xl font-semibold">
              {greeting}
              {today.data?.full_name ? `, ${today.data.full_name.split(" ")[0]}` : ""}
            </h2>
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>

          <CheckInCard big />

          {/* Leave requests (apply + status) */}
          <LeaveSection />

          {/* This-month mini calendar */}
          {calendar.isLoading && <Skeleton className="h-64" />}
          {calendar.data && (
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="mb-3 text-sm font-semibold">{t("thisMonth")}</p>
              <MonthCalendar data={calendar.data} />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default function MyAttendancePage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffAttendanceSelf}>
      <MyAttendanceContent />
    </RequirePermission>
  );
}
