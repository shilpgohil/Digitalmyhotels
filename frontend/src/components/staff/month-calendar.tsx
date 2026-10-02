"use client";

/** Month grid for attendance (mockup "Attendance Calendar"). */

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { localYmd } from "@/lib/formatting";
import type { CalendarDayOut, CalendarOut } from "@/types/staff";

const CELL_TONES: Record<string, string> = {
  present: "bg-success-bg text-success border-success/30",
  working: "bg-info-bg text-info border-info/30",
  late: "bg-warning-bg text-warning border-warning/30",
  checked_out: "bg-success-bg text-success border-success/30",
  absent: "bg-danger-bg text-danger border-danger/30",
  leave: "bg-info-bg text-info border-info/30",
  off: "bg-muted text-muted-foreground",
  holiday: "bg-muted text-muted-foreground",
};

export function MonthCalendar({
  data,
  onSelectDay,
}: {
  readonly data: CalendarOut;
  readonly onSelectDay?: (day: CalendarDayOut) => void;
}) {
  const t = useTranslations("staff");
  const dows = ["S", "M", "T", "W", "T", "F", "S"];
  const firstDay = new Date(`${data.month}-01T00:00:00`);
  const leadingBlanks = firstDay.getDay();

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {dows.map((d, i) => (
          <p
            key={`${d}-${i}`}
            className="text-micro font-semibold uppercase text-muted-foreground"
          >
            {d}
          </p>
        ))}
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {data.days.map((day) => {
          const n = Number(day.day.slice(-2));
          const today = localYmd(new Date());
          const isToday = day.day === today;
          const isFuture = day.day > today;
          const hasRecord = !!day.record_id;
          const isClickable = hasRecord && !!onSelectDay;

          return (
            <button
              type="button"
              key={day.day}
              disabled={!isClickable}
              onClick={() => isClickable && onSelectDay(day)}
              title={
                day.status
                  ? `${t(`att_${day.status}`)}${day.selfie_flushed ? ` (${t("selfieArchived")})` : ""}${hasRecord ? ` - ${t("viewAuditEvidence")}` : ""}`
                  : isFuture
                    ? t("scheduled")
                    : undefined
              }
              className={cn(
                "relative flex h-10 flex-col items-center justify-center rounded-md border text-caption transition-all",
                day.status
                  ? CELL_TONES[day.status] ?? "bg-muted"
                  : isFuture
                    ? "border-dashed bg-muted/30 text-muted-foreground"
                    : "bg-white",
                isToday && "ring-2 ring-gold-400 ring-offset-1 font-bold",
                isClickable && "cursor-pointer hover:border-gold-500 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-400",
                !isClickable && "cursor-default",
              )}
            >
              <span className="font-medium tabular-nums flex items-center justify-center gap-0.5">
                {n}
                {day.selfie_flushed && (
                  <Lock className="size-2.5 text-amber-600 inline" aria-hidden />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend + totals */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-label text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-success" /> {t("att_present")}{" "}
          <b className="text-foreground">{data.present_days}</b>
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-warning" /> {t("att_late")}{" "}
          <b className="text-foreground">{data.late_days}</b>
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-danger" /> {t("att_absent")}{" "}
          <b className="text-foreground">{data.absent_days}</b>
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-info" /> {t("att_leave")}{" "}
          <b className="text-foreground">{data.leave_days}</b>
        </span>
      </div>
    </div>
  );
}
