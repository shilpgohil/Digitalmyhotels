"use client";

import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/feedback/status-badge";

/** Attendance status → badge tone (theme contract). */
const TONES: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  present: "success",
  working: "info",
  late: "warning",
  checked_out: "neutral",
  absent: "danger",
  not_checked_in: "danger",
  leave: "info",
  on_leave: "info",
  off: "neutral",
  holiday: "neutral",
};

export function AttendanceStatusBadge({ status }: { readonly status: string }) {
  const t = useTranslations("staff");
  const known = [
    "present",
    "working",
    "late",
    "checked_out",
    "absent",
    "not_checked_in",
    "leave",
    "on_leave",
    "off",
    "holiday",
  ];
  const label = known.includes(status) ? t(`att_${status}`) : status;
  return <StatusBadge tone={TONES[status] ?? "neutral"}>{label}</StatusBadge>;
}
