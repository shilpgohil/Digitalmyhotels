"use client";

/**
 * Hotel Partner Smart Dashboard
 *
 * One API call → GET /api/v1/reports/smart-dashboard
 * Returns: KPIs, 30-day trend, guest mix, room-type revenue,
 *          week pattern, rule-generated insights.
 * Secondary calls (low priority): today's payments, arrivals, in-house.
 *
 * Sections
 * ─────────
 * 1. Smart Insights panel  — colour-coded AI-like statements
 * 2. Hero KPIs row         — RevPAR · ADR · ALOS · Occupancy · Revenue
 * 3. 30-day area trend     — revenue + occupancy overlay, interactive
 * 4. Mid row               — Room-status donut · Guest-mix donut · Week pattern bars
 * 5. Room-type revenue     — horizontal bar (ADR by room type)
 * 6. Bottom row            — Arrivals today · Cash/UPI split · In-house table
 * 7. Quick Actions
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
  Legend,
} from "recharts";
import {
  AlertTriangle,
  AlertOctagon,
  BedDouble,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  Eye,
  IndianRupee,
  LogIn,
  LogOut,
  MoreVertical,
  TrendingDown,
  TrendingUp,
  UserX,
  Wallet,
  Zap,
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
import type { CurrentGuestOut } from "@/types/stay";

// ── API types ─────────────────────────────────────────────────────────────────
interface SmartInsight {
  id: string;
  level: "alert" | "warning" | "success" | "info";
  icon: string;
  title: string;
  body: string;
  metric?: string | null;
  link?: string | null;
}
interface HotelKpis {
  revpar: string;
  adr: string;
  alos: string;
  lead_days: string;
  no_show_rate: string;
  revpar_wow: string;
  revenue_wow: string;
}
interface TrendPoint { date: string; revenue: string; checkins: number; checkouts: number; occupancy_pct: string; }
interface GuestMix  { guest_type: string; count: number; revenue: string; }
interface RoomTypeRev { room_type: string; revenue: string; room_nights: number; adr: string; }
interface WeekPat   { dow: string; avg_revenue: string; avg_checkins: string; }
interface SmartDashboard {
  insights: SmartInsight[];
  kpis: HotelKpis;
  trend_30d: TrendPoint[];
  guest_mix: GuestMix[];
  room_type_revenue: RoomTypeRev[];
  week_pattern: WeekPat[];
  today_occupancy_pct: string;
  total_rooms: number;
  available_rooms: number;
  in_house_count: number;
  arrivals_today: number;
  overdue_count: number;
}
interface PaymentSummary { total_collected: string; cash: string; upi: string; other: string; refunds: string; }

// ── Icon map for insights ─────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ElementType> = {
  TrendingUp, TrendingDown, AlertTriangle, AlertOctagon, BedDouble,
  Building2, CalendarCheck, CalendarDays, IndianRupee, UserX,
};

// ── Colour palettes ───────────────────────────────────────────────────────────
const ROOM_COLORS: Record<string, string> = {
  occupied: "#991b1b", available: "#166534", clean_ready: "#15803d",
  reserved: "#1e3a5f", cleaning_required: "#d97706", cleaning_in_progress: "#f59e0b",
  inspection_required: "#92400e", maintenance: "#334155", out_of_service: "#475569",
};
const GUEST_COLORS = ["#a08236", "#1e3a5f", "#166534", "#7c3aed", "#0e7490", "#9f1239"];
const LEVEL_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  alert:   { bg: "bg-red-50",    border: "border-red-300",    icon: "text-red-600" },
  warning: { bg: "bg-amber-50",  border: "border-amber-300",  icon: "text-amber-600" },
  success: { bg: "bg-green-50",  border: "border-green-300",  icon: "text-green-600" },
  info:    { bg: "bg-blue-50",   border: "border-blue-300",   icon: "text-blue-600" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const p = (v: string | number | undefined) => Number.parseFloat(String(v ?? "0"));
const fmtRev = (v: number) =>
  v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}K` : `₹${v}`;

function shortDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, action, children }: {
  title: string; icon: React.ElementType; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-gold-600" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function KpiChip({ label, value, sub, wow }: { label: string; value: string; sub?: string; wow?: number }) {
  const up = wow !== undefined && wow > 0;
  const down = wow !== undefined && wow < 0;
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      {wow !== undefined && wow !== 0 && (
        <p className={cn("mt-1 text-[11px] font-semibold flex items-center gap-0.5",
            up ? "text-green-600" : "text-red-600")}>
          {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          {up ? "+" : ""}{wow.toFixed(1)}% vs prior
        </p>
      )}
    </div>
  );
}

function PaymentBar({ label, amount, pct, color }: { label: string; amount: number; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">{fmtINR(amount)}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{pct}%</p>
    </div>
  );
}

// ── Custom tooltips ────────────────────────────────────────────────────────────
function RevTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number | undefined; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((entry) => {
        const v = entry.value ?? 0;
        const text =
          entry.name === "revenue"
            ? fmtINR(v)
            : entry.name === "occupancy_pct"
              ? `${v.toFixed(0)}% occupied`
              : `${v} check-ins`;
        return (
          <p key={entry.name} style={{ color: entry.color }}>
            {text}
          </p>
        );
      })}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const ts = useTranslations("stay");
  const router = useRouter();
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const today = localToday();

  // ── Queries ─────────────────────────────────────────────────────────────────
  const dash = useQuery({
    queryKey: ["smart-dashboard", activeHotelId],
    queryFn: () => api<SmartDashboard>("/api/v1/reports/smart-dashboard"),
    enabled: !!activeHotelId && can(PERMISSIONS.reportsView),
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
    queryFn: () => api<{ items: CurrentGuestOut[]; total: number }>("/api/v1/current-guests?limit=5"),
    enabled: !!activeHotelId && can(PERMISSIONS.guestsView),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ── Derived ──────────────────────────────────────────────────────────────────
  const d = dash.data;
  const kpis = d?.kpis;
  const today_rev = p(todayPayments.data?.total_collected);
  const todayCash  = p(todayPayments.data?.cash);
  const todayUpi   = p(todayPayments.data?.upi);
  const todayOther = p(todayPayments.data?.other);
  const todayRefunds = p(todayPayments.data?.refunds);
  const cashPct  = today_rev > 0 ? Math.round(todayCash / today_rev * 100) : 0;
  const upiPct   = today_rev > 0 ? Math.round(todayUpi  / today_rev * 100) : 0;
  const otherPct = Math.max(0, 100 - cashPct - upiPct);

  const trendData = useMemo(() =>
    (d?.trend_30d ?? []).map((pt) => ({
      label: shortDate(pt.date),
      revenue: Math.round(p(pt.revenue)),
      checkins: pt.checkins,
      occupancy_pct: Math.round(p(pt.occupancy_pct)),
    })),
    [d]
  );

  const weekData = useMemo(() =>
    (d?.week_pattern ?? []).map((w) => ({
      dow: w.dow,
      revenue: Math.round(p(w.avg_revenue)),
      checkins: Math.round(p(w.avg_checkins)),
    })),
    [d]
  );

  const roomRevData = useMemo(() =>
    (d?.room_type_revenue ?? []).map((r) => ({
      name: r.room_type,
      revenue: Math.round(p(r.revenue)),
      adr: Math.round(p(r.adr)),
    })),
    [d]
  );

  const donutData = useMemo(() => {
    if (!d?.guest_mix) return [];
    return d.guest_mix.filter((g) => g.count > 0);
  }, [d]);

  // When dashboard data isn't available (loading or no REPORTS_VIEW permission),
  // we still render the page — sections are individually guarded and show
  // skeletons while loading, or are hidden when permissions are absent.
  // Do NOT return early with an error message here.

  return (
    <>
      <PartnerHeader title={tn("dashboard")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">

        {/* ── 1. Smart Insights ──────────────────────────────────────────── */}
        {dash.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        )}
        {d?.insights && d.insights.length > 0 && (
          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("smartInsights")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.insights.map((ins) => {
                const style = LEVEL_STYLES[ins.level] ?? LEVEL_STYLES.info;
                const Icon = ICON_MAP[ins.icon] ?? TrendingUp;
                return (
                  <div
                    key={ins.id}
                    className={cn(
                      "rounded-xl border p-4 flex gap-3",
                      style.bg, style.border,
                      ins.link && "cursor-pointer hover:opacity-90 transition-opacity",
                    )}
                    onClick={() => ins.link && router.push(ins.link)}
                    role={ins.link ? "button" : undefined}
                  >
                    <Icon className={cn("size-5 shrink-0 mt-0.5", style.icon)} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground">{ins.title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-foreground/80">
                        {ins.body}
                      </p>
                      {ins.metric && (
                        <p className={cn("mt-1 text-xs font-bold", style.icon)}>{ins.metric}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 2. Hero KPI chips ────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {dash.isLoading ? (
            [0,1,2,3,4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : kpis ? (
            <>
              <KpiChip label={t("revpar")} value={fmtINR(p(kpis.revpar))} sub={t("per30days")} wow={p(kpis.revpar_wow)} />
              <KpiChip label={t("adr")} value={fmtINR(p(kpis.adr))} sub={t("perOccRoomNight")} />
              <KpiChip label={t("alos")} value={`${p(kpis.alos).toFixed(1)} ${t("nights")}`} sub={t("avgStay")} />
              <KpiChip label={t("leadDays")} value={`${p(kpis.lead_days).toFixed(0)} ${t("days")}`} sub={t("bookingLead")} />
              <KpiChip label={t("occupancyNow")} value={`${Math.round(p(d?.today_occupancy_pct))}%`} sub={`${d?.in_house_count ?? 0} in-house · ${d?.available_rooms ?? 0} free`} />
            </>
          ) : null}
        </section>

        {/* ── 3. 30-day trend (area + occupancy line, composed) ──────────── */}
        <SectionCard
          title={t("trend30d")}
          icon={TrendingUp}
          action={
            <span className="text-[11px] text-muted-foreground">
              {t("last30days")}
            </span>
          }
        >
          {dash.isLoading && <Skeleton className="h-56 w-full" />}
          {trendData.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a08236" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a08236" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={4} />
                <YAxis yAxisId="rev" tickFormatter={fmtRev} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={48} />
                <YAxis yAxisId="occ" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={36} />
                <Tooltip content={<RevTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Area yAxisId="rev" type="monotone" dataKey="revenue" name="revenue" fill="url(#revGrad)" stroke="#a08236" strokeWidth={2} dot={false} />
                <Line yAxisId="occ" type="monotone" dataKey="occupancy_pct" name="occupancy_pct" stroke="#1e3a5f" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* ── 4. Mid row: Guest mix · Week pattern ─────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Guest type mix donut */}
          <SectionCard title={t("guestMix")} icon={BookOpen}>
            {dash.isLoading && <Skeleton className="h-44 w-full" />}
            {donutData.length > 0 && (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={170} height={170}>
                  <PieChart>
                    <Pie data={donutData} dataKey="count" cx="50%" cy="50%" innerRadius={50} outerRadius={78} paddingAngle={2}>
                      {donutData.map((_, i) => (
                        <Cell key={i} fill={GUEST_COLORS[i % GUEST_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="flex-1 space-y-1.5 text-xs">
                  {donutData.map((item, i) => (
                    <li key={item.guest_type} className="flex items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: GUEST_COLORS[i % GUEST_COLORS.length] }} />
                      <span className="text-muted-foreground capitalize">{item.guest_type || "Unknown"}</span>
                      <span className="ml-auto font-semibold">{item.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!dash.isLoading && donutData.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noGuestData")}</p>
            )}
          </SectionCard>

          {/* Week pattern — which days are busiest */}
          <SectionCard title={t("weekPattern")} icon={CalendarDays}>
            {dash.isLoading && <Skeleton className="h-44 w-full" />}
            {weekData.length > 0 && (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={weekData} margin={{ top: 0, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="dow" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtRev} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="avg revenue" fill="#a08236" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="checkins" name="avg checkins" fill="#1e3a5f" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </section>

        {/* ── 5. Room-type revenue horizontal bar ───────────────────────────── */}
        {roomRevData.length > 0 && (
          <SectionCard title={t("roomTypeRevenue")} icon={BedDouble}>
            <div className="space-y-2.5">
              {(() => {
                const maxRev = Math.max(...roomRevData.map((r) => r.revenue), 1);
                return roomRevData.map((r) => (
                  <div key={r.name} className="flex items-center gap-3">
                    <p className="w-28 shrink-0 text-xs font-medium truncate">{r.name}</p>
                    <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
                      <div
                        className="h-full rounded bg-gold-500 flex items-center justify-end pr-1.5"
                        style={{ width: `${Math.round(r.revenue / maxRev * 100)}%` }}
                      >
                        {r.revenue / maxRev > 0.3 && (
                          <span className="text-[10px] font-bold text-navy-900">{fmtRev(r.revenue)}</span>
                        )}
                      </div>
                    </div>
                    {r.revenue / maxRev <= 0.3 && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">{fmtRev(r.revenue)}</span>
                    )}
                    <p className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
                      ADR {fmtRev(r.adr)}
                    </p>
                  </div>
                ));
              })()}
            </div>
          </SectionCard>
        )}

        {/* ── 6. Arrivals · Payment split · In-house ─────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/* Arrivals Today */}
          {can(PERMISSIONS.bookingsView) && (
            <SectionCard
              title={t("arrivingTodayTitle")}
              icon={BookOpen}
              action={d?.arrivals_today ? (
                <span className="text-xs font-bold text-gold-700">{d.arrivals_today} total</span>
              ) : undefined}
            >
              {dash.isLoading && <Skeleton className="h-24" />}
              {!dash.isLoading && (d?.arrivals_today ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground py-3">{t("noArrivalsToday")}</p>
              )}
              {!dash.isLoading && (d?.arrivals_today ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {d!.arrivals_today} confirmed guest{d!.arrivals_today > 1 ? "s" : ""} expected today.
                  </p>
                  <Link
                    href="/checkin"
                    className={cn(buttonVariants(), "w-full gap-2 bg-gold-500 text-navy-900 hover:bg-gold-400")}
                  >
                    <CheckSquare className="size-4" />
                    {t("checkInBtn")}
                  </Link>
                </div>
              )}
            </SectionCard>
          )}

          {/* Cash / UPI split */}
          {can(PERMISSIONS.paymentsView) && (
            <SectionCard title={t("paymentSplitToday")} icon={Wallet}>
              {todayPayments.isLoading && <Skeleton className="h-28" />}
              {todayPayments.data && (
                <div className="space-y-3">
                  <PaymentBar label={t("cash")} amount={todayCash} pct={cashPct} color="bg-gold-500" />
                  <PaymentBar label={t("upi")} amount={todayUpi} pct={upiPct} color="bg-navy-700" />
                  {todayOther > 0 && (
                    <PaymentBar label={t("otherMethods")} amount={todayOther} pct={otherPct} color="bg-slate-400" />
                  )}
                  {todayRefunds > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("refundsDeducted", { amount: fmtINR(todayRefunds) })}
                    </p>
                  )}
                  <div className="border-t pt-2 flex items-center justify-between text-xs font-semibold">
                    <span>{t("todayTotal")}</span>
                    <span className="tabular-nums text-gold-700">{fmtINR(today_rev)}</span>
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          {/* Quick Actions */}
          <div className="rounded-xl border bg-white p-5 shadow-sm" data-tour="quick-actions">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Zap className="size-4 text-gold-600" />
              {t("quickActions")}
            </h2>
            <div className="space-y-2.5">
              {can(PERMISSIONS.checkin) && (
                <Link href="/checkin" className={cn(buttonVariants(), "w-full justify-start gap-2 bg-gold-500 text-navy-900 hover:bg-gold-400")}>
                  <LogIn className="size-4" />{t("newCheckin")}
                </Link>
              )}
              {can(PERMISSIONS.checkout) && (
                <Link href="/checkout" className={cn(buttonVariants(), "w-full justify-start gap-2 bg-navy-900 text-white hover:bg-navy-800")}>
                  <LogOut className="size-4" />{t("processCheckout")}
                </Link>
              )}
              <Link href="/rooms" className={cn(buttonVariants({ variant: "outline" }), "w-full justify-start gap-2")}>
                <BedDouble className="size-4" />{t("viewRoomStatus")}
              </Link>
              {can(PERMISSIONS.paymentsView) && (
                <Link href="/payments" className={cn(buttonVariants({ variant: "outline" }), "w-full justify-start gap-2")}>
                  <Wallet className="size-4" />{t("billingHistory")}
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* ── 7. In-House guests table ─────────────────────────────────────── */}
        {can(PERMISSIONS.guestsView) && (
          <SectionCard
            title={t("inHouseGuests")}
            icon={Building2}
            action={
              <div className="flex items-center gap-3">
                {inHouse.data?.total ? (
                  <span className="rounded-full bg-navy-900 px-2 py-0.5 text-[10px] font-bold text-white">
                    {inHouse.data.total}
                  </span>
                ) : null}
                <Link href="/current-guests" className="text-xs text-gold-600 font-medium hover:underline">
                  {t("viewAll")}
                </Link>
              </div>
            }
          >
            {inHouse.isLoading && <Skeleton className="h-40" />}
            {inHouse.data && inHouse.data.items.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">{t("noInHouseGuests")}</p>
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
                      <TableCell className="font-medium text-sm">{guest.primary_guest_name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{guest.rooms.join(", ")}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtApiDate(guest.check_out_date)}{guest.check_out_time ? `, ${guest.check_out_time}` : ""}
                      </TableCell>
                      <TableCell><PaymentStatusBadge status={guest.payment_status} /></TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger className="flex size-7 items-center justify-center rounded-md hover:bg-muted" aria-label={tc("actions")}>
                            <MoreVertical className="size-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push("/current-guests")}>
                              <Eye className="size-4" />{tc("view")}
                            </DropdownMenuItem>
                            {can(PERMISSIONS.checkout) && (
                              <DropdownMenuItem variant="destructive" onClick={() => router.push(`/checkout?booking=${guest.booking_id}`)}>
                                <LogOut className="size-4" />{ts("checkOutAction")}
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
          </SectionCard>
        )}

      </main>
    </>
  );
}
