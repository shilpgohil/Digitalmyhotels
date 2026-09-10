"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";
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
  TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api/client";
import { fmtApiDate, fmtDateTime, fmtINR } from "@/lib/formatting";

interface PlatformTrendItem {
  month: string;
  hotels_added: number;
  revenue: string;
  checkins: number;
}
interface PlatformTrendOut { items: PlatformTrendItem[] }
import type {
  HotelAdminListOut,
  PlatformDashboardOut,
  RenewalRequestAdminListOut,
} from "@/types/money";
import { RenewDialog } from "@/components/admin/renew-dialog";

interface StatCard {
  key: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  format?: "currency";
  href?: string;
}

const STAT_CARDS: StatCard[] = [
  { key: "totalHotels",         icon: LayoutGrid,   iconBg: "bg-amber-50",   iconColor: "text-amber-500", href: "/admin/hotels?filter=all" },
  { key: "activeHotels",        icon: CheckCircle,  iconBg: "bg-green-50",   iconColor: "text-green-500", href: "/admin/hotels" },
  { key: "todayCheckins",       icon: Calendar,     iconBg: "bg-blue-50",    iconColor: "text-blue-500" },
  { key: "totalRevenue",        icon: IndianRupee,  iconBg: "bg-amber-50",   iconColor: "text-amber-600", format: "currency" },
  // recentlyExpiredCard = hotels expired in the LAST 30 DAYS → links to recently-expired page
  { key: "recentlyExpiredCard", icon: XCircle,      iconBg: "bg-red-50",     iconColor: "text-red-500",   href: "/admin/expired" },
  // expiredHotelsCard  = ALL-TIME total expired hotels → links to full expired list
  { key: "expiredHotelsCard",   icon: AlertTriangle, iconBg: "bg-orange-50", iconColor: "text-orange-500", href: "/admin/expired?filter=all" },
];

function fmtRevenue(v: number | string): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2).replace(/\.?0+$/, "")}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1).replace(/\.?0+$/, "")}K`;
  return fmtINR(n);
}

export default function AdminDashboardPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const dash = useQuery({
    queryKey: ["platform-dashboard"],
    queryFn: () => apiFetch<PlatformDashboardOut>("/api/v1/super-admin/dashboard"),
    refetchInterval: 60_000,
  });

  const platformTrend = useQuery({
    queryKey: ["platform-trend"],
    queryFn: () => apiFetch<PlatformTrendOut>("/api/v1/super-admin/dashboard/trend?months=6"),
    staleTime: 5 * 60_000,
  });

  const expired = useQuery({
    queryKey: ["admin-hotels", "expired"],
    queryFn: () =>
      apiFetch<HotelAdminListOut>("/api/v1/super-admin/hotels?status=expired&recent_days=30&limit=5"),
  });
  const recent = useQuery({
    queryKey: ["admin-hotels", "recent"],
    queryFn: () => apiFetch<HotelAdminListOut>("/api/v1/super-admin/hotels?limit=5"),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/super-admin/hotels/${id}/status?status=active`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("approved"));
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const renewals = useQuery({
    queryKey: ["admin-renewal-requests"],
    queryFn: () =>
      apiFetch<RenewalRequestAdminListOut>(
        "/api/v1/super-admin/renewal-requests?status=pending",
      ),
  });

  const decideRenewal = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      apiFetch(`/api/v1/super-admin/renewal-requests/${id}/${action}`, { method: "POST" }),
    onSuccess: (_data, vars) => {
      toast.success(vars.action === "approve" ? t("renewalApproved") : t("renewalRejected"));
      queryClient.invalidateQueries({ queryKey: ["admin-renewal-requests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-expired"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const statValues: Record<string, number | string> = dash.data
    ? {
        totalHotels:         dash.data.total_hotels,
        activeHotels:        dash.data.active_hotels,
        todayCheckins:       dash.data.today_checkins,
        totalRevenue:        dash.data.total_revenue,
        // Recently Expired = hotels expired in the last 30 days (new field)
        recentlyExpiredCard: dash.data.recently_expired ?? 0,
        // Expired Hotels = all-time total expired (replaces "Expiring Soon")
        expiredHotelsCard:   dash.data.expired_hotels,
      }
    : {};

  return (
    <main className="p-4 space-y-6 sm:p-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t("dashboardTitle")}</h1>
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
            const inner = (
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
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
            );
            const cardClass = "rounded-xl border bg-white p-5 shadow-sm";
            return card.href ? (
              <Link key={card.key} href={card.href} className={`${cardClass} transition-colors hover:border-gold-400`}>
                {inner}
              </Link>
            ) : (
              <div key={card.key} className={cardClass}>
                {inner}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Platform Trend Charts ─────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Hotel Status Donut */}
        {dash.data && (
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <LayoutGrid className="size-4 text-amber-500" aria-hidden />
              {t("hotelStatusDistribution")}
            </h2>
            {/* Stacks on mobile (chart above legend), side-by-side on sm+ */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="mx-auto sm:mx-0 shrink-0" style={{ width: 160, height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: t("activeHotels"), value: dash.data.active_hotels, fill: "#166534" },
                        { name: t("trialHotels"), value: dash.data.trial_hotels, fill: "#a08236" },
                        { name: t("expiredHotels"), value: dash.data.expired_hotels, fill: "#991b1b" },
                        { name: t("suspendedHotels"), value: dash.data.inactive_hotels, fill: "#475569" },
                      ].filter((d) => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={72}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {[
                        { name: t("activeHotels"), value: dash.data.active_hotels, fill: "#166534" },
                        { name: t("trialHotels"), value: dash.data.trial_hotels, fill: "#a08236" },
                        { name: t("expiredHotels"), value: dash.data.expired_hotels, fill: "#991b1b" },
                        { name: t("suspendedHotels"), value: dash.data.inactive_hotels, fill: "#475569" },
                      ].filter((d) => d.value > 0).map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="flex-1 space-y-2 text-xs">
                {[
                  { label: t("activeHotels"), count: dash.data.active_hotels, color: "#166534" },
                  { label: t("trialHotels"), count: dash.data.trial_hotels, color: "#a08236" },
                  { label: t("expiredHotels"), count: dash.data.expired_hotels, color: "#991b1b" },
                  { label: t("suspendedHotels"), count: dash.data.inactive_hotels, color: "#475569" },
                ].map((row) => (
                  <li key={row.label} className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="ml-auto font-semibold tabular-nums">{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {dash.isLoading && <Skeleton className="h-48 rounded-xl" />}

        {/* Monthly Hotel Growth + Check-ins Line Chart */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="size-4 text-amber-500" aria-hidden />
            {t("monthlyGrowth")}
          </h2>
          {platformTrend.isLoading && <Skeleton className="h-40 w-full" />}
          {platformTrend.data && (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart
                data={platformTrend.data.items.map((d) => ({
                  month: d.month.slice(5),   // "MM"
                  hotels: d.hotels_added,
                  checkins: d.checkins,
                }))}
                margin={{ top: 0, right: 4, left: -8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="hotels" name={t("hotelsAdded")} fill="#a08236" radius={[3, 3, 0, 0]} maxBarSize={24} />
                <Bar dataKey="checkins" name={t("todayCheckins")} fill="#1e3a5f" radius={[3, 3, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Pending subscription renewal requests (partner paid → verify & approve) */}
      <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-foreground">{t("renewalRequests")}</h2>
          {(renewals.data?.total ?? 0) > 0 && (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
              {renewals.data?.total}
            </span>
          )}
        </div>
        {renewals.isLoading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        )}
        {!renewals.isLoading && (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="bg-muted/30">
              <tr>
                {[t("hotelName"), t("subscriptionPlan"), t("amount"), t("requestDate"), tc("actions")].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(renewals.data?.items ?? []).map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.hotel_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.plan_name} — {r.duration_days} {t("days")}
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">{fmtINR(r.amount)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {fmtDateTime(r.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => decideRenewal.mutate({ id: r.id, action: "approve" })}
                        disabled={decideRenewal.isPending}
                        className="inline-flex h-7 items-center rounded-lg bg-green-600 px-3 text-xs font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                      >
                        {t("approve")}
                      </button>
                      <button
                        type="button"
                        onClick={() => decideRenewal.mutate({ id: r.id, action: "reject" })}
                        disabled={decideRenewal.isPending}
                        className="inline-flex h-7 items-center rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {t("rejectRequest")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(renewals.data?.items ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("noRenewalRequests")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </section>

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
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[550px]">
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
              {(expired.data?.items ?? []).slice(0, 5).map((h) => (
                <tr key={h.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{h.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{h.owner_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {fmtApiDate(h.expiry_date)}
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
                        href={`/admin/hotels?filter=all&q=${encodeURIComponent(h.name)}`}
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
          </div>
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[550px]">
            <thead className="bg-muted/30">
              <tr>
                {[t("hotelName"), t("owner"), t("city"), t("registrationDate"), "Plan", "Status", tc("actions")].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
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
                        <span className="text-micro font-bold text-muted-foreground">
                          {h.name.slice(0, 1).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium">{h.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{h.owner_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{h.city ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {fmtDateTime(h.created_at)}
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
                        href={`/admin/hotels?filter=all&q=${encodeURIComponent(h.name)}`}
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
          </div>
        )}
      </section>

      {/* Quick Actions */}
      <section>
        <p className="mb-3 text-label font-semibold uppercase tracking-wide text-muted-foreground">
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
