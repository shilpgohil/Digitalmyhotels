"use client";

/**
 * Super Admin — Total Revenue screen (client 09/2026:
 * "Missing Total Revenue screen in Super Admin flow").
 *
 * Grand total of all completed payments across the platform, plus a
 * per-hotel revenue breakdown sorted highest-first.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, IndianRupee } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";

interface RevenueRow {
  hotel_id: string;
  hotel_name: string;
  city: string | null;
  revenue: string;
  payments_count: number;
}

interface RevenueList {
  total_revenue: string;
  items: RevenueRow[];
  total: number;
}

const PAGE_SIZE = 20;

const fmtINR = (v: string | number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(v));

export default function AdminRevenuePage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const revenue = useQuery({
    queryKey: ["admin-revenue", search, page],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search) params.set("q", search);
      return apiFetch<RevenueList>(`/api/v1/super-admin/revenue?${params}`);
    },
    staleTime: 30_000,
    retry: 1,
  });

  const total = revenue.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const cols = [t("hotelName"), t("city"), t("paymentsCol"), t("revenueCol")];

  return (
    <main className="p-4 space-y-6 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t("totalRevenueTitle")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
      </div>

      {/* Grand total card */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-xl bg-gold-50">
            <IndianRupee className="size-6 text-gold-600" aria-hidden />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("totalRevenueSubtitle")}</p>
            {revenue.isLoading ? (
              <Skeleton className="mt-1 h-8 w-40" />
            ) : (
              <p className="font-display text-3xl font-bold text-foreground tabular-nums">
                {fmtINR(revenue.data?.total_revenue ?? 0)}
              </p>
            )}
          </div>
        </div>
      </div>

      <FilterBar
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(0); }}
        searchPlaceholder={t("searchHotel")}
      />

      <DataTable
        darkHeader
        isLoading={revenue.isLoading}
        isError={revenue.isError}
        onRetry={() => revenue.refetch()}
        isEmpty={!revenue.isLoading && !revenue.isError && (revenue.data?.items ?? []).length === 0}
        emptyTitle={t("noRevenueYet")}
        columns={cols}
      >
        {!revenue.isLoading && !revenue.isError && (revenue.data?.items ?? []).map((r) => (
          <tr key={r.hotel_id} className="border-t hover:bg-muted/20 transition-colors">
            <td className="px-4 py-3 font-medium">{r.hotel_name}</td>
            <td className="px-4 py-3 text-muted-foreground">{r.city ?? "—"}</td>
            <td className="px-4 py-3 text-muted-foreground tabular-nums">{r.payments_count}</td>
            <td className="px-4 py-3 font-semibold tabular-nums">{fmtINR(r.revenue)}</td>
          </tr>
        ))}
      </DataTable>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-5 py-3">
          <span className="text-sm text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {tc("of")} {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40"
              aria-label={tc("previous")}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40"
              aria-label={tc("next")}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
