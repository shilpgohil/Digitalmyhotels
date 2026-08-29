"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { HotelAdminListOut } from "@/types/money";
import { RenewDialog } from "@/components/admin/renew-dialog";

const PAGE_SIZE = 10;

function HotelsContent() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [page, setPage] = useState(0);
  const filter = searchParams.get("filter");

  const status = filter === "all" ? undefined : "active";

  const hotels = useQuery({
    queryKey: ["admin-hotels-list", search, page, status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (search) params.set("q", search);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      return apiFetch<HotelAdminListOut>(`/api/v1/super-admin/hotels?${params}`);
    },
    staleTime: 30_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      apiFetch(`/api/v1/super-admin/hotels/${id}/status?status=${next}`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("statusUpdated"));
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const total = hotels.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pageTitle = filter === "all" ? t("totalHotelsNav") : t("activeHotelsNav");

  return (
    <main className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{pageTitle}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {/* Table header with search */}
        <div className="flex items-center justify-between px-5 py-4 border-b gap-4">
          <h2 className="font-semibold text-foreground shrink-0">
            {filter === "all" ? t("totalHotelsNav") : t("activeHotelsNav")} List
          </h2>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              placeholder={t("searchHotel")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="h-9 w-full rounded-lg border border-input pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
          </div>
        </div>

        {/* Table */}
        {hotels.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                {[t("hotelName"), t("owner"), t("city"), t("contactNumber"), tc("actions")].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(hotels.data?.items ?? []).map((h) => (
                <tr key={h.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <span className="text-xs font-semibold">{h.name.slice(0, 1).toUpperCase()}</span>
                      </div>
                      <span className="font-medium">{h.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{h.owner_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">{h.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {h.status !== "suspended" ? (
                        <>
                          <span className="inline-flex h-7 items-center rounded-lg bg-green-600 px-3 text-xs font-semibold text-white">
                            Active
                          </span>
                          <button
                            type="button"
                            onClick={() => statusMutation.mutate({ id: h.id, next: "suspended" })}
                            disabled={statusMutation.isPending}
                            className="inline-flex h-7 items-center rounded-lg bg-red-500 px-3 text-xs font-semibold text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                          >
                            {t("deactivate")}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="inline-flex h-7 items-center rounded-lg bg-muted px-3 text-xs font-semibold text-muted-foreground">
                            Inactive
                          </span>
                          <button
                            type="button"
                            onClick={() => statusMutation.mutate({ id: h.id, next: "active" })}
                            disabled={statusMutation.isPending}
                            className="inline-flex h-7 items-center rounded-lg bg-green-600 px-3 text-xs font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            {t("activate")}
                          </button>
                        </>
                      )}
                      <RenewDialog hotel={h} />
                    </div>
                  </td>
                </tr>
              ))}
              {(hotels.data?.items ?? []).length === 0 && !hotels.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {t("noHotels")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* Pagination */}
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
                className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition-colors"
                aria-label={tc("previous")}
              >
                <ChevronLeft className="size-4" />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pageNum = i;
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setPage(pageNum)}
                    className={`flex size-8 items-center justify-center rounded-lg text-sm border transition-colors ${
                      page === pageNum
                        ? "bg-navy-900 text-white border-navy-900"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                );
              })}
              {totalPages > 5 && (
                <>
                  <span className="px-1 text-muted-foreground">…</span>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages - 1)}
                    className={`flex size-8 items-center justify-center rounded-lg text-sm border transition-colors ${
                      page === totalPages - 1
                        ? "bg-navy-900 text-white border-navy-900"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {totalPages}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition-colors"
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

export default function AdminHotelsPage() {
  return (
    <Suspense>
      <HotelsContent />
    </Suspense>
  );
}
