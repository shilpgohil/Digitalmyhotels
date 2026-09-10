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
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";

const PAGE_SIZE = 10;

function ExpiredContent() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const isAll = searchParams.get("filter") === "all";

  const hotels = useQuery({
    queryKey: ["admin-hotels-expired", search, page, isAll],
    queryFn: () => {
      const params = new URLSearchParams({
        status: "expired",
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search) params.set("q", search);
      if (!isAll) params.set("recent_days", "30");
      return apiFetch<HotelAdminListOut>(`/api/v1/super-admin/hotels?${params}`);
    },
    staleTime: 30_000,
    retry: 1,
  });

  const total = hotels.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const cols = [t("hotelName"), t("owner"), t("city"), t("expiryDate"), t("subscriptionPlan"), "Status", tc("actions")];

  return (
    <main className="p-4 space-y-6 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          {isAll ? t("allExpiredTitle") : t("recentlyExpired")}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
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
        emptyTitle={t("noneExpired")}
        columns={cols}
      >
        {!hotels.isLoading && !hotels.isError && (hotels.data?.items ?? []).map((h) => (
          <tr key={h.id} className="border-t hover:bg-muted/20 transition-colors">
            <td className="px-4 py-3 font-medium">{h.name}</td>
            <td className="px-4 py-3">
              <p className="text-foreground">{h.owner_name ?? "—"}</p>
              {h.owner_email && <p className="text-xs text-muted-foreground">{h.owner_email}</p>}
            </td>
            <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
              {h.expiry_date ? fmtApiDate(h.expiry_date) : "—"}
            </td>
            <td className="px-4 py-3 text-muted-foreground">{h.subscription_plan_name ?? "—"}</td>
            <td className="px-4 py-3">
              <span className="inline-flex rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-medium text-danger">
                Expired
              </span>
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



