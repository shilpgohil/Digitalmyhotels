"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { fmtApiDate } from "@/lib/formatting";
import type { HotelAdminListOut } from "@/types/money";
import { RenewDialog } from "@/components/admin/renew-dialog";
import { AdminListError, AdminListLoading } from "@/components/admin/admin-list-state";

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

  return (
    <main className="p-4 space-y-6 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          {isAll ? t("allExpiredTitle") : t("recentlyExpired")}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b gap-4">
          <h2 className="font-semibold text-foreground shrink-0">{t("expiredListTitle")}</h2>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              placeholder={t("searchHotel")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="h-9 w-full rounded-lg border border-input pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
          </div>
        </div>

        {hotels.isLoading && <AdminListLoading />}
        {hotels.isError && !hotels.isLoading && (
          <AdminListError onRetry={() => hotels.refetch()} />
        )}
        {!hotels.isLoading && !hotels.isError && (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-muted/30">
              <tr>
                {[t("hotelName"), t("owner"), t("city"), t("expiryDate"), t("subscriptionPlan"), "Status", tc("actions")].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(hotels.data?.items ?? []).map((h) => (
                <tr key={h.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{h.name}</td>
                  <td className="px-4 py-3">
                    <p className="text-foreground">{h.owner_name ?? "—"}</p>
                    {h.owner_email && (
                      <p className="text-xs text-muted-foreground">{h.owner_email}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {h.expiry_date ? fmtApiDate(h.expiry_date) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {h.subscription_plan_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
                      Expired
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/hotels?filter=all&q=${encodeURIComponent(h.name)}`}
                        className="text-xs font-medium text-gold-600 hover:underline"
                      >
                        {t("view")}
                      </Link>
                      <Link
                        href={`/admin/hotels/${h.id}/edit`}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-input px-2.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                      >
                        <Pencil className="size-3" aria-hidden />
                        {tc("edit")}
                      </Link>
                      <RenewDialog hotel={h} />
                    </div>
                  </td>
                </tr>
              ))}
              {(hotels.data?.items ?? []).length === 0 && !hotels.isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {t("noneExpired")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-3 border-t">
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
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPage(i)}
                  className={`flex size-8 items-center justify-center rounded-lg text-sm border transition-colors ${
                    page === i ? "bg-navy-900 text-white border-navy-900" : "border-border hover:bg-muted"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              {totalPages > 5 && (
                <>
                  <span className="px-1 text-muted-foreground">…</span>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages - 1)}
                    className="flex size-8 items-center justify-center rounded-lg text-sm border border-border hover:bg-muted"
                  >
                    {totalPages}
                  </button>
                </>
              )}
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
      </div>
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



