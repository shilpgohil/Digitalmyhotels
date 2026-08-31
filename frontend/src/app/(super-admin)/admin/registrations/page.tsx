"use client";

import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api/client";
import { fmtDate } from "@/lib/formatting";
import type { HotelAdminListOut } from "@/types/money";

const PAGE_SIZE = 10;

function RegistrationsContent() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const hotels = useQuery({
    queryKey: ["admin-hotels-registrations", search, page],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search) params.set("q", search);
      return apiFetch<HotelAdminListOut>(`/api/v1/super-admin/hotels?${params}`);
    },
    staleTime: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/super-admin/hotels/${id}/status?status=active`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("approved"));
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const total = hotels.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <main className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("recentRegistrations")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b gap-4">
          <h2 className="font-semibold text-foreground shrink-0">Recent Hotels Registrations List</h2>
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

        {hotels.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                {[t("hotelName"), t("owner"), t("city"), t("registrationDate"), "Plan", "Status", tc("actions")].map((h) => (
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
                  <td className="px-4 py-3">
                    <p className="text-foreground">{h.owner_name ?? "—"}</p>
                    {h.owner_email && (
                      <p className="text-xs text-muted-foreground">{h.owner_email}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {fmtDate(h.created_at)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {h.subscription_plan_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                      New
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gold-600">{t("view")}</span>
                      {h.status !== "active" && (
                        <button
                          type="button"
                          onClick={() => approveMutation.mutate(h.id)}
                          disabled={approveMutation.isPending}
                          className="inline-flex h-6 items-center rounded border border-gold-500 px-2 text-xs font-medium text-gold-700 hover:bg-gold-50 transition-colors disabled:opacity-50"
                        >
                          {t("approve")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {(hotels.data?.items ?? []).length === 0 && !hotels.isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {t("noHotels")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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

export default function RegistrationsPage() {
  return (
    <Suspense>
      <RegistrationsContent />
    </Suspense>
  );
}
