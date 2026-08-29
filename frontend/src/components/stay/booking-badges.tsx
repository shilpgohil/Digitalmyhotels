"use client";

import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/feedback/status-badge";
import type { BookingStatus } from "@/types/stay";

const BOOKING_TONE: Record<BookingStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  pending: "warning",
  confirmed: "info",
  checked_in: "success",
  checked_out: "neutral",
  cancelled: "danger",
  no_show: "danger",
};

const PAYMENT_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  unpaid: "danger",
  partial: "warning",
  paid: "success",
  refunded: "info",
  cancelled: "neutral",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = useTranslations("bookings");
  return <StatusBadge tone={BOOKING_TONE[status]}>{t(`status_${status}`)}</StatusBadge>;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const t = useTranslations("bookings");
  return (
    <StatusBadge tone={PAYMENT_TONE[status] ?? "neutral"}>
      {t(`payment_${status}`)}
    </StatusBadge>
  );
}
