"use client";

/** Month grid for attendance (mockup "Attendance Calendar"). */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { localYmd } from "@/lib/formatting";
import type { CalendarOut } from "@/types/staff";

const CELL_TONES: Record<string, string> = {
  present: "bg-success-bg text-success",
  working: "bg-info-bg text-info",
  late: "bg-warning-bg text-warning",
  checked_out: "bg-success-bg text-success",
  absent: "bg-danger-bg text-danger",
  leave: "bg-info-bg text-info",
  off: "bg-muted text-muted-foreground",
  holiday: "bg-muted text-muted-foreground",
};

export function MonthCalendar({ data }: { readonly data: CalendarOut }) {
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
          return (
            <div
              key={day.day}
              title={
                day.status
                  ? t(`att_${day.status}`)
                  : isFuture
                    ? t("scheduled")
                    : undefined
              }
              className={cn(
                "flex h-9 flex-col items-center justify-center rounded-md border text-caption",
                day.status
                  ? CELL_TONES[day.status] ?? "bg-muted"
                  : isFuture
                    ? "border-dashed bg-muted/30 text-muted-foreground"
                    : "bg-white",
                // Today gets the gold focus ring (theme accent).
                isToday && "ring-2 ring-gold-400 ring-offset-1",
              )}
            >
              <span className="font-medium tabular-nums">{n}</span>
            </div>
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
