"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

export function AdminListLoading({ rows = 5 }: { readonly rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

export function AdminListError({
  onRetry,
}: {
  readonly onRetry: () => void;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center rounded-lg border border-border bg-white px-3 text-sm font-medium hover:bg-muted"
      >
        {tc("retry")}
      </button>
    </div>
  );
}

export function hotelDisplayStatus(hotel: {
  status: string;
  subscription_status: string | null;
  expiry_date?: string | null;
}): "active" | "expired" | "suspended" | "trial" {
  if (hotel.status === "suspended") return "suspended";
  // Expired: stored status, subscription_status, or expiry_date has passed.
  // The last check guards against background-job lag where subscription_status
  // wasn't updated but the date is clearly in the past (client item 16).
  const dateExpired =
    !!hotel.expiry_date && new Date(hotel.expiry_date) < new Date();
  if (
    hotel.status === "expired" ||
    hotel.subscription_status === "expired" ||
    dateExpired
  ) {
    return "expired";
  }
  if (hotel.status === "trial" || hotel.subscription_status === "trial") return "trial";
  return "active";
}

export function HotelStatusBadge({
  hotel,
}: {
  readonly hotel: {
    status: string;
    subscription_status: string | null;
    expiry_date?: string | null;
  };
}) {
  const kind = hotelDisplayStatus(hotel);
  const styles: Record<typeof kind, string> = {
    active:    "bg-success-bg text-success",
    expired:   "bg-danger-bg  text-danger",
    suspended: "bg-muted      text-muted-foreground",
    trial:     "bg-warning-bg text-warning",
  };
  const labels: Record<typeof kind, string> = {
    active: "Active", expired: "Expired", suspended: "Inactive", trial: "Trial",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[kind]}`}>
      {labels[kind]}
    </span>
  );
}
