"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { fmtApiDate } from "@/lib/formatting";
import type { HotelAdminListOut } from "@/types/money";
import { RenewDialog } from "@/components/admin/renew-dialog";
import { ExtendDialog } from "@/components/admin/extend-dialog";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";

const PAGE_SIZE = 10;

function ExpiredContent() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filter = searchParams.get("filter");
  // "expiring" → About to Expire view (future expiry ≤ 7d)
  // default    → Expired Hotels view (lapsed + in-grace)
  // "all"      → All expired ever
  const isExpiring = filter === "expiring";
  const isAll = filter === "all";

  const hotels = useQuery({
    queryKey: ["admin-hotels-expired", search, page, filter],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search) params.set("q", search);
      if (isExpiring) {
        // "About to Expire": hotels whose plan lapses within 7 days
        params.set("status", "expiring_soon");
        params.set("expiring_within", "7");
      } else {
        // "Expired Hotels": truly expired (past grace) + in-grace hotels
        params.set("status", "expired");
        if (!isAll) {
          // Limit to last 30 days for the default view (show recent only)
          params.set("recent_days", "30");
        }
      }
      return apiFetch<HotelAdminListOut>(`/api/v1/super-admin/hotels?${params}`);
    },
    staleTime: 30_000,
    retry: 1,
  });

  /** Days from today until expiry — positive = still active, ≤0 = lapsed. */
  const daysUntilExpiry = (expiry: string | null): number | null => {
    if (!expiry) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expiry);
    exp.setHours(0, 0, 0, 0);
    return Math.round((exp.getTime() - today.getTime()) / 86_400_000);
  };

  const total = hotels.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // "About to Expire" shows the expiry date since that's the key info;
  // "Expired Hotels" omits it (the badge already signals expiry).
  const cols = [
    t("hotelName"), t("owner"), t("city"),
    ...(isExpiring ? [t("expiryDate")] : []),
    t("subscriptionPlan"), "Status", tc("actions"),
  ];

  const pageTitle = isExpiring
    ? t("aboutToExpireTitle")
    : isAll
      ? t("allExpiredTitle")
      : t("expiredHotelsNav");

  return (
    <main className="p-4 space-y-6 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{pageTitle}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isExpiring ? t("aboutToExpireSubtitle") : t("dashboardSubtitle")}
        </p>
      </div>

      <FilterBar
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        searchPlaceholder={t("searchHotel")}
      />

      <DataTable
        darkHeader
        isLoading={hotels.isLoading}
        isError={hotels.isError}
        onRetry={() => hotels.refetch()}
        isEmpty={!hotels.isLoading && !hotels.isError && (hotels.data?.items ?? []).length === 0}
        emptyTitle={isExpiring ? t("noneExpiring") : t("noneExpired")}
        columns={cols}
      >
        {!hotels.isLoading && !hotels.isError && (hotels.data?.items ?? []).map((h) => (
          <tr key={h.id} className="border-t hover:bg-muted/20 transition-colors">
            <td className="px-4 py-3 font-medium capitalize">{h.name}</td>
            <td className="px-4 py-3">
              <p className="text-foreground capitalize">{h.owner_name ?? "—"}</p>
              {h.owner_email && <p className="text-xs text-muted-foreground">{h.owner_email}</p>}
            </td>
            <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
            {/* Expiry date column — only in "About to Expire" mode */}
            {isExpiring && (
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                {h.expiry_date ? fmtApiDate(h.expiry_date) : "—"}
              </td>
            )}
            <td className="px-4 py-3 text-muted-foreground capitalize">{h.subscription_plan_name ?? "—"}</td>
            <td className="px-4 py-3">
              {(() => {
                const days = daysUntilExpiry(h.expiry_date);
                if (isExpiring) {
                  // "About to Expire" view — always future, show countdown
                  const d = days ?? 0;
                  return (
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      d === 0 ? "bg-danger-bg text-danger" : d <= 3 ? "bg-warning-bg text-warning" : "bg-amber-50 text-amber-700"
                    }`}>
                      {d === 0 ? "Expires Today" : `${d}d left`}
                    </span>
                  );
                }
                // "Expired Hotels" view — already lapsed (in grace or past grace)
                if (days !== null && days < 0 && h.expiry_date) {
                  // Check if in grace: expiry + grace_days >= today
                  // We don't have grace_days in the list payload, so infer from sub status
                  if (h.subscription_status === "expiring_soon") {
                    return (
                      <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        In Grace Period
                      </span>
                    );
                  }
                }
                return (
                  <span className="inline-flex rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-semibold text-danger">
                    Expired
                  </span>
                );
              })()}
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Link href={`/admin/hotels?filter=all&q=${encodeURIComponent(h.name)}`} className="text-xs font-medium text-gold-600 hover:underline">
                  {t("view")}
                </Link>
                <Link href={`/admin/hotels/${h.id}/edit`} className="inline-flex h-7 items-center gap-1 rounded-lg border border-input px-2.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors">
                  <Pencil className="size-3" aria-hidden />
                  {tc("edit")}
                </Link>
                <RenewDialog hotel={h} />
                {/* Custom grant — extend the current plan by N days
                    (client 09/2026) */}
                <ExtendDialog hotel={h} />
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-5 py-3">
          <span className="text-sm text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {tc("of")} {total}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40" aria-label={tc("previous")}>
              <ChevronLeft className="size-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => (
              <button key={i} type="button" onClick={() => setPage(i)}
                className={`flex size-8 items-center justify-center rounded-lg text-sm border transition-colors ${page === i ? "bg-navy-900 text-white border-navy-900" : "border-border hover:bg-muted"}`}>
                {i + 1}
              </button>
            ))}
            {totalPages > 5 && (
              <><span className="px-1 text-muted-foreground">…</span>
                <button type="button" onClick={() => setPage(totalPages - 1)}
                  className="flex size-8 items-center justify-center rounded-lg text-sm border border-border hover:bg-muted">{totalPages}</button>
              </>
            )}
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40" aria-label={tc("next")}>
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ExpiredHotelsPage() {
  return (
    <Suspense>
      <ExpiredContent />
    </Suspense>
  );
}



