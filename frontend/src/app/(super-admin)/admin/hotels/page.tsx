"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { fmtApiDate } from "@/lib/formatting";
import type { HotelAdminListOut, HotelAdminOut } from "@/types/money";
import { RenewDialog } from "@/components/admin/renew-dialog";
import { HotelStatusBadge, hotelDisplayStatus } from "@/components/admin/admin-list-state";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 10;

function HotelsContent() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [page, setPage] = useState(0);
  const filter = searchParams.get("filter");
  const isTotal = filter === "all";

  const qParam = searchParams.get("q") ?? "";
  useEffect(() => {
    setSearch(qParam);
    setPage(0);
  }, [qParam]);

  const status = isTotal ? undefined : "active";

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
    retry: 1,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      apiFetch(`/api/v1/super-admin/hotels/${id}/status?status=${next}`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("statusUpdated"));
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-expired"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const total = hotels.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pageTitle = isTotal ? t("totalHotelsNav") : t("activeHotelsNav");
  const columns = isTotal
    ? [t("hotelName"), t("owner"), t("city"), t("contactNumber"), t("subscriptionPlan"), t("expiryDate"), "Status", tc("actions")]
    : [t("hotelName"), t("owner"), t("city"), t("contactNumber"), tc("actions")];

  return (
    <main className="p-4 space-y-6 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{pageTitle}</h1>
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
        emptyTitle={t("noHotels")}
        columns={columns}
      >
        {!hotels.isLoading && !hotels.isError && (hotels.data?.items ?? []).map((h) => (
          <HotelRow
            key={h.id}
            hotel={h}
            showMeta={isTotal}
            pending={statusMutation.isPending}
            onStatus={(next) => statusMutation.mutate({ id: h.id, next })}
            deactivateLabel={t("deactivate")}
            activateLabel={t("activate")}
          />
        ))}
      </DataTable>

      {total > PAGE_SIZE && (
        <AdminPager
          page={page}
          total={total}
          totalPages={totalPages}
          pageSize={PAGE_SIZE}
          onPage={setPage}
        />
      )}
    </main>
  );
}

function HotelRow({
  hotel,
  showMeta,
  pending,
  onStatus,
  deactivateLabel,
  activateLabel,
}: {
  readonly hotel: HotelAdminOut;
  readonly showMeta: boolean;
  readonly pending: boolean;
  readonly onStatus: (next: string) => void;
  readonly deactivateLabel: string;
  readonly activateLabel: string;
}) {
  const tc = useTranslations("common");
  const kind = hotelDisplayStatus(hotel);
  return (
    <tr className="border-t hover:bg-muted/20 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <span className="text-xs font-semibold">{hotel.name.slice(0, 1).toUpperCase()}</span>
          </div>
          <span className="font-medium">{hotel.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{hotel.owner_name ?? "—"}</td>
      <td className="px-4 py-3 text-muted-foreground">{hotel.city ?? "—"}</td>
      <td className="px-4 py-3 text-muted-foreground tabular-nums">{hotel.phone ?? "—"}</td>
      {showMeta && (
        <>
          <td className="px-4 py-3 text-muted-foreground">{hotel.subscription_plan_name ?? "—"}</td>
          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
            {hotel.expiry_date ? fmtApiDate(hotel.expiry_date) : "—"}
          </td>
          <td className="px-4 py-3">
            <HotelStatusBadge hotel={hotel} />
          </td>
        </>
      )}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {/* Full-page edit — navigates to /admin/hotels/[id]/edit */}
          <Link
            href={`/admin/hotels/${hotel.id}/edit`}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-input px-2.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="size-3" aria-hidden />
            {tc("edit")}
          </Link>
          {kind === "suspended" && (
            <>
              {!showMeta && <HotelStatusBadge hotel={hotel} />}
              <Button size="sm" onClick={() => onStatus("active")} disabled={pending}>
                {activateLabel}
              </Button>
            </>
          )}
          {kind === "expired" && (
            <>
              <RenewDialog hotel={hotel} />
              <Button size="sm" variant="outline" className="text-danger hover:text-danger" onClick={() => onStatus("suspended")} disabled={pending}>
                {deactivateLabel}
              </Button>
            </>
          )}
          {(kind === "active" || kind === "trial") && (
            <>
              {!showMeta && <HotelStatusBadge hotel={hotel} />}
              <Button size="sm" variant="outline" className="text-danger hover:text-danger" onClick={() => onStatus("suspended")} disabled={pending}>
                {deactivateLabel}
              </Button>
              <RenewDialog hotel={hotel} />
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function AdminPager({
  page,
  total,
  totalPages,
  pageSize,
  onPage,
}: {
  readonly page: number;
  readonly total: number;
  readonly totalPages: number;
  readonly pageSize: number;
  readonly onPage: (fn: (p: number) => number) => void;
}) {
  const tc = useTranslations("common");
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t">
      <span className="text-sm text-muted-foreground">
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} {tc("of")} {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          aria-label={tc("previous")}
        >
          <ChevronLeft className="size-4" />
        </button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPage(() => i)}
            className={`flex size-8 items-center justify-center rounded-lg text-sm border transition-colors ${
              page === i
                ? "bg-navy-900 text-white border-navy-900"
                : "border-border hover:bg-muted"
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
              onClick={() => onPage(() => totalPages - 1)}
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
          onClick={() => onPage((p) => Math.min(totalPages - 1, p + 1))}
          disabled={page >= totalPages - 1}
          className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          aria-label={tc("next")}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export default function AdminHotelsPage() {
  return (
    <Suspense>
      <HotelsContent />
    </Suspense>
  );
}



