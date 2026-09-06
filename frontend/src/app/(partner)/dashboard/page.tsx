"use client";

/**
 * Hotel Partner Dashboard — Insightful, real-time, chart-driven.
 *
 * Sections:
 *  1. Hero KPIs     — today's revenue, occupancy %, arrivals/departures
 *  2. Charts row    — room-status donut + 14-day revenue bar
 *  3. Arrivals      — confirmed bookings arriving today
 *  4. Payment split — Cash vs UPI with mini progress bars
 *  5. In-House      — compact table (top 5) + Quick Actions
 *
 * All data comes from existing APIs + two new trend endpoints.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "recharts";
import {
  ArrowUpRight,
  BedDouble,
  BookOpen,
  LogIn,
  LogOut,
  TrendingUp,
  Users,
  Wallet,
  Zap,
  MoreVertical,
  Eye,
  Building2,
  CheckSquare,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentStatusBadge } from "@/components/stay/booking-badges";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { fmtApiDate, fmtINR, localToday } from "@/lib/formatting";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { RoomStatusSummaryOut } from "@/types/hotel";
import type { CurrentGuestOut } from "@/types/stay";

// ── API types ────────────────────────────────────────────────────────────────
interface DailyTrendItem {
  date: string;
  revenue: string;
  checkins: number;
  checkouts: number;
}
interface DailyTrendOut {
  items: DailyTrendItem[];
  total_revenue: string;
  total_checkins: number;
  total_checkouts: number;
}
interface ArrivalsItem {
  booking_id: string;
  booking_number: string;
  guest_name: string;
  rooms: string[];
  check_in_time: string | null;
  advance_paid: string;
  due_amount: string;
}
interface ArrivalsOut {
  items: ArrivalsItem[];
  total: number;
}
interface PaymentSummary {
  total_collected: string;
  cash: string;
  upi: string;
}

// ── Donut chart colours ──────────────────────────────────────────────────────
const ROOM_COLORS: Record<string, string> = {
  occupied: "#991b1b",
  available: "#166534",
  clean_ready: "#15803d",
  reserved: "#1e3a5f",
  cleaning_required: "#d97706",
  cleaning_in_progress: "#f59e0b",
  inspection_required: "#92400e",
  maintenance: "#334155",
  out_of_service: "#475569",
};

// Format short date labels for the bar chart (e.g. "Sep 3")
function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function fmtRev(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

// ── Custom tooltip for bar chart ─────────────────────────────────────────────
function RevenueTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-gold-700">{fmtINR(payload[0].value)}</p>
    </div>
  );
}

// ── Hero KPI card ────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accentClass,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accentClass: string;
  href?: string;
}) {
  const card = (
    <div className="flex items-center gap-4 rounded-xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl", accentClass)}>
        <Icon className="size-6" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {href && <ArrowUpRight className="size-4 shrink-0 text-muted-foreground ml-auto" />}
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

// ── Main component ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const ts = useTranslations("stay");
  const router = useRouter();
  const api = useApi();
  const { activeHotelId, can } = useAuth();

  const today = localToday();

  // ── Queries ────────────────────────────────────────────────────────────────
  const summary = useQuery({
    queryKey: ["room-status-summary", activeHotelId],
    queryFn: () => api<RoomStatusSummaryOut>("/api/v1/rooms/status-summary"),
    enabled: !!activeHotelId && can(PERMISSIONS.roomsView),
    staleTime: 30_000,
    refetchInterval: 60_000, // live
  });

  const trend = useQuery({
    queryKey: ["revenue-trend", activeHotelId],
    queryFn: () => api<DailyTrendOut>("/api/v1/reports/revenue/trend?days=14"),
    enabled: !!activeHotelId && can(PERMISSIONS.reportsView),
    staleTime: 5 * 60_000,
  });

  const arrivals = useQuery({
    queryKey: ["arrivals-today", activeHotelId],
    queryFn: () => api<ArrivalsOut>("/api/v1/reports/arrivals-today"),
    enabled: !!activeHotelId && can(PERMISSIONS.bookingsView),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const todayPayments = useQuery({
    queryKey: ["payment-summary-today", activeHotelId],
    queryFn: () => api<PaymentSummary>(`/api/v1/payments/summary?from_date=${today}&to_date=${today}`),
    enabled: !!activeHotelId && can(PERMISSIONS.paymentsView),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const inHouse = useQuery({
    queryKey: ["current-guests", activeHotelId, "dashboard"],
    queryFn: () =>
      api<{ items: CurrentGuestOut[]; total: number }>("/api/v1/current-guests?limit=5"),
    enabled: !!activeHotelId && can(PERMISSIONS.guestsView),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalRooms = summary.data?.total ?? 0;
  const occupiedCount = (summary.data?.counts?.occupied ?? 0);
  const occupancy = totalRooms > 0 ? Math.round((occupiedCount / totalRooms) * 100) : 0;
  const todayRevenue = Number.parseFloat(todayPayments.data?.total_collected ?? "0");
  const todayCash = Number.parseFloat(todayPayments.data?.cash ?? "0");
  const todayUpi = Number.parseFloat(todayPayments.data?.upi ?? "0");
  const todayTotal = todayCash + todayUpi;
  const cashPct = todayTotal > 0 ? Math.round((todayCash / todayTotal) * 100) : 0;
  const upiPct = 100 - cashPct;

  // Donut data
  const donutData = useMemo(() => {
    if (!summary.data?.counts) return [];
    return Object.entries(summary.data.counts)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([k, v]) => ({ name: k.replace(/_/g, " "), value: v ?? 0, key: k }));
  }, [summary.data]);

  // Bar chart data (last 14 days)
  const barData = useMemo(
    () =>
      (trend.data?.items ?? []).map((d) => ({
        label: shortDate(d.date),
        revenue: Math.round(Number.parseFloat(d.revenue)),
      })),
    [trend.data],
  );

  const todayArrivals = arrivals.data?.items ?? [];
  const todayCheckins = trend.data?.items.at(-1)?.checkins ?? 0;
  const todayCheckouts = trend.data?.items.at(-1)?.checkouts ?? 0;

  return (
    <>
      <PartnerHeader title={tn("dashboard")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {/* ── Hero KPIs ─────────────────────────────────────────────────── */}
        <section className="grid gap-3 sm:grid-cols-3">
          {todayPayments.isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (
            <KpiCard
              label={t("todayRevenue")}
              value={fmtINR(todayRevenue)}
              sub={t("todayRevenueHint")}
              icon={Wallet}
              accentClass="bg-gold-100 text-gold-700"
              href="/payments"
            />
          )}
          {summary.isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (
            <KpiCard
              label={t("occupancyRate")}
              value={`${occupancy}%`}
              sub={`${occupiedCount} / ${totalRooms} ${t("rooms")}`}
              icon={Building2}
              accentClass="bg-navy-50 text-navy-700"
              href="/rooms"
            />
          )}
          {trend.isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (
            <KpiCard
              label={t("todayMovement")}
              value={`${todayCheckins} in · ${todayCheckouts} out`}
              sub={arrivals.data ? `${todayArrivals.length} ${t("arrivingToday")}` : ""}
              icon={TrendingUp}
              accentClass="bg-green-50 text-green-700"
              href="/checkin"
            />
          )}
        </section>

        {/* ── Charts row ────────────────────────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Room Status Donut */}
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <BedDouble className="size-4 text-gold-600" aria-hidden />
              {t("roomStatusBreakdown")}
            </h2>
            {summary.isLoading && <Skeleton className="mx-auto h-48 w-48 rounded-full" />}
            {summary.data && (
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {donutData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={ROOM_COLORS[entry.key] ?? "#94a3b8"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend */}
                <ul className="flex-1 space-y-1.5 text-xs">
                  {donutData.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: ROOM_COLORS[entry.key] ?? "#94a3b8" }}
                      />
                      <span className="capitalize text-muted-foreground">{entry.name}</span>
                      <span className="ml-auto font-semibold text-foreground tabular-nums">
                        {entry.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 14-Day Revenue Bar Chart */}
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="size-4 text-gold-600" aria-hidden />
                {t("revenueTrend")}
              </h2>
              {trend.data && (
                <span className="text-xs text-muted-foreground">
                  {t("totalN")} {fmtINR(Number.parseFloat(trend.data.total_revenue))}
                </span>
              )}
            </div>
            {trend.isLoading && <Skeleton className="h-48 w-full" />}
            {trend.data && (
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={barData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={fmtRev}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip content={<RevenueTooltip />} cursor={{ fill: "#f1f5f9" }} />
                  <Bar dataKey="revenue" fill="#a08236" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Arrivals + Payment split row ──────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/* Arrivals Today */}
          {can(PERMISSIONS.bookingsView) && (
            <div className="rounded-xl border bg-white p-5 shadow-sm lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen className="size-4 text-gold-600" aria-hidden />
                  {t("arrivingTodayTitle")}
                </h2>
                {arrivals.data && arrivals.data.total > 0 && (
                  <span className="text-xs font-semibold text-gold-700">
                    {arrivals.data.total} {tc("total")}
                  </span>
                )}
              </div>
              {arrivals.isLoading && <Skeleton className="h-24 w-full" />}
              {!arrivals.isLoading && todayArrivals.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">{t("noArrivalsToday")}</p>
              )}
              {todayArrivals.length > 0 && (
                <div className="space-y-2">
                  {todayArrivals.map((a) => (
                    <div
                      key={a.booking_id}
                      className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5"
                    >
                      <div>
                        <p className="text-sm font-semibold">{a.guest_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.booking_number} · Room {a.rooms.join(", ")}
                          {a.check_in_time ? ` · ${a.check_in_time}` : ""}
                        </p>
                      </div>
                      <Link
                        href={`/checkin?booking=${a.booking_id}`}
                        className="inline-flex h-8 items-center rounded-lg bg-gold-500 px-3 text-xs font-semibold text-navy-900 hover:bg-gold-400 transition-colors"
                      >
                        <CheckSquare className="size-3.5 mr-1" />
                        {t("checkInBtn")}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cash vs UPI split */}
          {can(PERMISSIONS.paymentsView) && (
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <Wallet className="size-4 text-gold-600" aria-hidden />
                {t("paymentSplitToday")}
              </h2>
              {todayPayments.isLoading && <Skeleton className="h-24 w-full" />}
              {todayPayments.data && (
                <div className="space-y-4">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium">{t("cash")}</span>
                      <span className="tabular-nums">{fmtINR(todayCash)}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gold-500 transition-all"
                        style={{ width: `${cashPct}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{cashPct}%</p>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium">{t("upi")}</span>
                      <span className="tabular-nums">{fmtINR(todayUpi)}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-navy-700 transition-all"
                        style={{ width: `${upiPct}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{upiPct}%</p>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{t("todayTotal")}</span>
                      <span className="tabular-nums text-gold-700">{fmtINR(todayTotal)}</span>
                    </div>
                  </div>
                </div>
              )}
              {!todayPayments.isLoading && !todayPayments.data && (
                <p className="text-sm text-muted-foreground">{t("noPaymentsToday")}</p>
              )}
            </div>
          )}
        </section>

        {/* ── In-House + Quick Actions ───────────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-3">
          {can(PERMISSIONS.guestsView) && (
            <div className="rounded-xl border bg-white lg:col-span-2" data-tour="inhouse">
              <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-gold-600" aria-hidden />
                  {t("inHouseGuests")}
                  {inHouse.data && inHouse.data.total > 0 && (
                    <span className="rounded-full bg-navy-900 px-2 py-0.5 text-[10px] font-bold text-white">
                      {inHouse.data.total}
                    </span>
                  )}
                </h2>
                <Link href="/current-guests" className="text-xs text-gold-600 font-medium hover:underline">
                  {t("viewAll")}
                </Link>
              </div>
              {inHouse.isLoading && <Skeleton className="mx-5 mb-5 h-40" />}
              {inHouse.data && inHouse.data.items.length === 0 && (
                <p className="px-5 pb-6 text-sm text-muted-foreground">{t("noInHouseGuests")}</p>
              )}
              {inHouse.data && inHouse.data.items.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-navy-900 hover:bg-navy-900">
                      <TableHead className="text-white text-xs">{t("colGuest")}</TableHead>
                      <TableHead className="text-white text-xs">{t("colRoom")}</TableHead>
                      <TableHead className="text-white text-xs">{t("colCheckout")}</TableHead>
                      <TableHead className="text-white text-xs">{t("colPayment")}</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inHouse.data.items.map((guest) => (
                      <TableRow key={guest.booking_id}>
                        <TableCell className="font-medium text-sm">
                          {guest.primary_guest_name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {guest.rooms.join(", ")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                          {fmtApiDate(guest.check_out_date)}
                          {guest.check_out_time ? `, ${guest.check_out_time}` : ""}
                        </TableCell>
                        <TableCell>
                          <PaymentStatusBadge status={guest.payment_status} />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="flex size-7 items-center justify-center rounded-md hover:bg-muted"
                              aria-label={tc("actions")}
                            >
                              <MoreVertical className="size-3.5" aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push("/current-guests")}>
                                <Eye className="size-4" />
                                {tc("view")}
                              </DropdownMenuItem>
                              {can(PERMISSIONS.checkout) && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    router.push(`/checkout?booking=${guest.booking_id}`)
                                  }
                                >
                                  <LogOut className="size-4" />
                                  {ts("checkOutAction")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}

          {/* Quick Actions */}
          <div className="rounded-xl border bg-white p-5 shadow-sm" data-tour="quick-actions">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Zap className="size-4 text-gold-600" aria-hidden />
              {t("quickActions")}
            </h2>
            <div className="space-y-2.5">
              {can(PERMISSIONS.checkin) && (
                <Link
                  href="/checkin"
                  className={cn(
                    buttonVariants(),
                    "w-full justify-start gap-2 bg-gold-500 text-navy-900 hover:bg-gold-400",
                  )}
                >
                  <LogIn className="size-4" />
                  {t("newCheckin")}
                </Link>
              )}
              {can(PERMISSIONS.checkout) && (
                <Link
                  href="/checkout"
                  className={cn(
                    buttonVariants(),
                    "w-full justify-start gap-2 bg-navy-900 text-white hover:bg-navy-800",
                  )}
                >
                  <LogOut className="size-4" />
                  {t("processCheckout")}
                </Link>
              )}
              <Link
                href="/rooms"
                className={cn(buttonVariants({ variant: "outline" }), "w-full justify-start gap-2")}
              >
                <BedDouble className="size-4" />
                {t("viewRoomStatus")}
              </Link>
              {can(PERMISSIONS.paymentsView) && (
                <Link
                  href="/payments"
                  className={cn(buttonVariants({ variant: "outline" }), "w-full justify-start gap-2")}
                >
                  <Wallet className="size-4" />
                  {t("billingHistory")}
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
