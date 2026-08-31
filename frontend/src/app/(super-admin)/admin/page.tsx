"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LayoutGrid,
  CheckCircle,
  Calendar,
  IndianRupee,
  AlertTriangle,
  XCircle,
  Plus,
  Eye,
  RefreshCw,
  FileBarChart2,
  Settings,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api/client";
import { fmtDate } from "@/lib/formatting";
import type { HotelAdminOut, PlatformDashboardOut } from "@/types/money";
import { RenewDialog } from "@/components/admin/renew-dialog";

interface HotelList {
  items: HotelAdminOut[];
  total: int;
}

// Explicitly inline the needed type
type int = number;

interface StatCard {
  key: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  format?: "currency";
}

const STAT_CARDS: StatCard[] = [
  { key: "totalHotels",      icon: LayoutGrid,   iconBg: "bg-amber-50",   iconColor: "text-amber-500" },
  { key: "activeHotels",     icon: CheckCircle,  iconBg: "bg-green-50",   iconColor: "text-green-500" },
  { key: "todayCheckins",    icon: Calendar,     iconBg: "bg-blue-50",    iconColor: "text-blue-500" },
  { key: "totalRevenue",     icon: IndianRupee,  iconBg: "bg-amber-50",   iconColor: "text-amber-600", format: "currency" },
  { key: "recentlyExpiredCard", icon: AlertTriangle, iconBg: "bg-orange-50", iconColor: "text-orange-500" },
  { key: "expiredHotels",    icon: XCircle,      iconBg: "bg-red-50",     iconColor: "text-red-500" },
];

function fmtRevenue(v: number | string): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2).replace(/\.?0+$/, "")}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1).replace(/\.?0+$/, "")}K`;
  return `₹${n.toFixed(0)}`;
}

export default function AdminDashboardPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const dash = useQuery({
    queryKey: ["platform-dashboard"],
    queryFn: () => apiFetch<PlatformDashboardOut>("/api/v1/super-admin/dashboard"),
  });
  const expired = useQuery({
    queryKey: ["admin-hotels", "expired"],
    queryFn: () =>
      apiFetch<HotelList>("/api/v1/super-admin/hotels?status=expired&limit=5"),
  });
  const recent = useQuery({
    queryKey: ["admin-hotels", "recent"],
    queryFn: () => apiFetch<HotelList>("/api/v1/super-admin/hotels?limit=5"),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/super-admin/hotels/${id}/status?status=active`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("approved"));
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const statValues: Record<string, number | string> = dash.data
    ? {
        totalHotels: dash.data.total_hotels,
        activeHotels: dash.data.active_hotels,
        todayCheckins: dash.data.today_checkins,
        totalRevenue: dash.data.total_revenue,
        recentlyExpiredCard: (dash.data as PlatformDashboardOut & { expiring_soon: number }).expiring_soon,
        expiredHotels: dash.data.expired_hotels,
      }
    : {};

  return (
    <main className="p-6 space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("dashboardTitle")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
      </div>

      {/* Stat cards */}
      {dash.isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {STAT_CARDS.map((card) => {
            const Icon = card.icon;
            const raw = statValues[card.key] ?? 0;
            const display =
              card.format === "currency" ? fmtRevenue(raw) : String(raw);
            return (
              <div key={card.key} className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(card.key as Parameters<typeof t>[0])}
                    </p>
                    <p className="mt-1.5 text-2xl font-bold text-foreground tabular-nums">
                      {display}
                    </p>
                  </div>
                  <div className={`flex size-10 items-center justify-center rounded-full ${card.iconBg}`}>
                    <Icon className={`size-5 ${card.iconColor}`} aria-hidden />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recently Expired Hotels table */}
      <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-foreground">{t("recentlyExpired")}</h2>
          <Link href="/admin/expired" className="text-sm text-gold-600 font-medium hover:underline">
            {t("viewAll")}
          </Link>
        </div>
        {expired.isLoading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        )}
        {!expired.isLoading && (
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                {[t("hotelName"), t("owner"), t("city"), t("expiryDate"), t("subscriptionPlan"), "Status", tc("actions")].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(expired.data?.items ?? []).slice(0, 5).map((h) => (
                <tr key={h.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{h.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{h.owner_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {h.expiry_date ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{h.subscription_plan_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
                      Expired
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/hotels`}
                        className="text-xs font-medium text-gold-600 hover:underline"
                      >
                        {t("view")}
                      </Link>
                      <RenewDialog hotel={h} />
                    </div>
                  </td>
                </tr>
              ))}
              {(expired.data?.items ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("noneExpired")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* Recent Hotel Registrations table */}
      <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-foreground">{t("recentRegistrations")}</h2>
          <Link href="/admin/registrations" className="text-sm text-gold-600 font-medium hover:underline">
            {t("viewAll")}
          </Link>
        </div>
        {recent.isLoading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        )}
        {!recent.isLoading && (
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
              {(recent.data?.items ?? []).slice(0, 5).map((h) => (
                <tr key={h.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                        <span className="text-[10px] font-bold text-muted-foreground">
                          {h.name.slice(0, 1).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium">{h.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{h.owner_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {fmtDate(h.created_at)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{h.subscription_plan_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                      New
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/hotels`}
                        className="text-xs font-medium text-gold-600 hover:underline"
                      >
                        {t("view")}
                      </Link>
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
              {(recent.data?.items ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("noHotels")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* Quick Actions */}
      <section>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("quickActions")}
        </p>
        <div className="flex flex-wrap gap-3">
          {[
            { label: t("addHotel"), icon: Plus, href: "/admin/add-hotel" },
            { label: t("viewHotels"), icon: Eye, href: "/admin/hotels" },
            { label: t("renewSubscriptions"), icon: RefreshCw, href: "/admin/expired" },
            { label: t("generateReport"), icon: FileBarChart2, href: "/admin/plans" },
            { label: t("settings"), icon: Settings, href: "/admin/plans" },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.label}
                href={action.href}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {action.label}
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
