"use client";

/**
 * Super Admin — Billing History / Total Revenue screen.
 *
 * Redesigned from the old per-hotel aggregate view into a full SaaS
 * subscription billing ledger matching the client reference image:
 *
 *   • 6 summary stat cards (Total Collected, This Month, Cash, UPI,
 *     Credit/Debit Card, Others) — always ALL-TIME regardless of filter.
 *   • Quick-period tabs (All Time | Today | Last 5 Days | This Month | This Year).
 *   • Date-range pickers (override period tabs).
 *   • Payment Mode dropdown filter.
 *   • Hotel name search.
 *   • Paginated table: Hotel Name | Owner | Contact | Payment Date |
 *     Plan Amount | Plan | Expiry Date | Mode | Actions.
 *   • Expiry date coloured: red (past) / amber (≤7 days) / default (future).
 *   • Actions: Eye → /admin/hotels/{id}/edit  (trash intentionally disabled —
 *     subscription records are financial history and must never be deleted).
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import {
  IndianRupee,
  CreditCard,
  Banknote,
  Plus,
  Smartphone,
  MoreHorizontal,
  Eye,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtINR, fmtApiDate, localYmd, localToday } from "@/lib/formatting";
import type { SuperAdminBillingHistoryList } from "@/types/money";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

type Period = "all" | "today" | "last5" | "this_month" | "this_year";

const PERIOD_KEYS: { value: Period; labelKey: string }[] = [
  { value: "all",        labelKey: "billingAllTime" },
  { value: "today",      labelKey: "billingToday" },
  { value: "last5",      labelKey: "billingLast5" },
  { value: "this_month", labelKey: "billingThisMonth" },
  { value: "this_year",  labelKey: "billingThisYear" },
];

const MODE_OPTIONS = [
  { value: "",             label: "billingAllModes" },
  { value: "cash",         label: "billingCash" },
  { value: "upi",          label: "billingUPI" },
  { value: "card",         label: "billingCardPayment" },
  { value: "other",        label: "billingOthers" },
] as const;

/** Label shown in Mode column */
function modeLabel(mode: string | null, t: (k: string) => string): string {
  if (!mode) return "—";
  const map: Record<string, string> = {
    cash:        t("billingCash"),
    upi:         t("billingUPI"),
    credit_card: t("billingCardPayment"),
    debit_card:  t("billingCardPayment"),
    card:        t("billingCardPayment"),
    other:       t("billingOthers"),
  };
  return map[mode] ?? mode;
}

/** Expiry date colouring: red past, amber ≤7 days, default otherwise */
function expiryClass(expiryDate: string): string {
  const today = localToday();
  if (expiryDate < today) return "text-danger font-medium";
  const days7Later = new Date();
  days7Later.setDate(days7Later.getDate() + 7);
  const cutoff = localYmd(days7Later);
  if (expiryDate <= cutoff) return "text-warning font-medium";
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Payment dialog (SA manually records cash/offline payment for a hotel)
// ─────────────────────────────────────────────────────────────────────────────

function RecordPaymentButton({ onSuccess }: { readonly onSuccess: () => void }) {
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [hotelId, setHotelId] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [paymentMode, setPaymentMode] = useState("upi");
  const [txnRef, setTxnRef] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load hotels for the dropdown
  const hotels = useQuery({
    queryKey: ["admin-hotels-simple"],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string }> }>(
      "/api/v1/super-admin/hotels?status=active&limit=100"
    ),
    enabled: open,
    staleTime: 60_000,
  });

  // Load plans for the dropdown
  const plans = useQuery({
    queryKey: ["subscription-plans"],
    queryFn: () => apiFetch<Array<{ code: string; name: string; price: string; duration_days: number }>>(
      "/api/v1/subscriptions/plans"
    ),
    enabled: open,
    staleTime: 300_000,
  });

  const submit = useMutation({
    mutationFn: () => apiFetch("/api/v1/super-admin/record-payment", {
      method: "POST",
      body: {
        hotel_id: hotelId,
        plan_code: planCode,
        payment_mode: paymentMode,
        txn_ref: txnRef.trim() || null,
        note: note.trim() || null,
      },
    }),
    onSuccess: () => {
      toast.success("Payment recorded — hotel subscription renewed.");
      setOpen(false);
      setHotelId(""); setPlanCode(""); setPaymentMode("upi"); setTxnRef(""); setNote("");
      setError(null);
      onSuccess();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  const canSubmit = !!hotelId && !!planCode;

  return (
    <>
      <Button
        type="button"
        className="h-[42px] gap-1.5 bg-navy-900 text-white hover:bg-navy-800"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" aria-hidden />
        Record Payment
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Manual Payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rp-hotel">Hotel *</Label>
              <select
                id="rp-hotel"
                value={hotelId}
                onChange={(e) => setHotelId(e.target.value)}
                className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">— Select Hotel —</option>
                {(hotels.data?.items ?? []).map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-plan">Plan *</Label>
              <select
                id="rp-plan"
                value={planCode}
                onChange={(e) => setPlanCode(e.target.value)}
                className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">— Select Plan —</option>
                {(plans.data ?? []).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — ₹{p.price} / {p.duration_days} days
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-mode">Payment Mode</Label>
              <select
                id="rp-mode"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="manual">Manual / Other</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-txn">Transaction / Reference ID</Label>
              <Input
                id="rp-txn"
                value={txnRef}
                onChange={(e) => setTxnRef(e.target.value.toUpperCase())}
                placeholder="e.g. T2609201234567890"
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-note">Note (optional)</Label>
              <Input
                id="rp-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Cash collected at office"
                maxLength={500}
              />
            </div>

            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          </div>

          <DialogFooter>
            <DialogClose className="inline-flex h-[42px] items-center rounded-lg bg-[#d1d1d1] px-5 text-sm font-medium text-foreground hover:bg-[#bebebe] transition-colors">
              {tc("cancel")}
            </DialogClose>
            <Button
              type="button"
              disabled={!canSubmit || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? tc("saving") : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page component
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminBillingHistoryPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  // ── Filter state ────────────────────────────────────────────────────────
  const [period, setPeriod]         = useState<Period>("all");
  // Draft date state — only committed to the query on Apply/Clear
  const [draftFrom, setDraftFrom]   = useState("");
  const [draftTo, setDraftTo]       = useState("");
  // Committed date state — drives the actual API call
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");
  const [mode, setMode]             = useState("");
  const [search, setSearch]         = useState("");
  const [page, setPage]             = useState(0);

  // Selecting a period tab clears any custom date draft and committed dates.
  const handlePeriodChange = useCallback((p: Period) => {
    setPeriod(p);
    setDraftFrom("");
    setDraftTo("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  }, []);

  // Apply commits the draft dates into the query state.
  const handleApply = useCallback(() => {
    // Custom dates override period tabs
    if (draftFrom || draftTo) setPeriod("all");
    setDateFrom(draftFrom);
    setDateTo(draftTo);
    setPage(0);
  }, [draftFrom, draftTo]);

  const handleClear = useCallback(() => {
    setPeriod("all");
    setDraftFrom("");
    setDraftTo("");
    setDateFrom("");
    setDateTo("");
    setMode("");
    setSearch("");
    setPage(0);
  }, []);

  // ── Query — only depends on committed state ──────────────────────────────
  const query = useQuery({
    queryKey: ["admin-billing-history", period, dateFrom, dateTo, mode, search, page],
    queryFn: () => {
      const params = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      // Period only sent when no custom committed dates
      if (!dateFrom && !dateTo && period !== "all") params.set("period", period);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo)   params.set("date_to",   dateTo);
      if (mode)     params.set("mode",       mode);
      if (search)   params.set("q",          search);
      return apiFetch<SuperAdminBillingHistoryList>(
        `/api/v1/super-admin/billing-history?${params}`
      );
    },
    staleTime: 30_000,
    retry: 1,
  });

  const data       = query.data;
  const summary    = data?.summary;
  const items      = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Stat card definitions ────────────────────────────────────────────────
  type StatDef = { labelKey: string; icon: LucideIcon; tone: string; value: string | undefined };
  const STAT_CARDS: StatDef[] = [
    { labelKey: "billingTotalCollected", icon: IndianRupee,  tone: "navy",    value: summary?.total_collected },
    { labelKey: "billingThisMonthCard",  icon: IndianRupee,  tone: "success", value: summary?.this_month },
    { labelKey: "billingCash",           icon: Banknote,     tone: "gold",    value: summary?.cash },
    { labelKey: "billingUPI",            icon: Smartphone,   tone: "info",    value: summary?.upi },
    { labelKey: "billingCardPayment",    icon: CreditCard,   tone: "navy2",   value: summary?.card },
    { labelKey: "billingOthers",         icon: MoreHorizontal, tone: "muted", value: summary?.other },
  ];

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns = [
    t("hotelName"),
    t("billingOwner"),
    t("billingContactNumber"),
    t("billingPaymentDate"),
    t("billingPlanAmount"),
    t("billingChoosePlan"),
    t("billingExpiryDate"),
    t("billingMode"),
    t("billingActions"),
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="overflow-y-auto p-4 space-y-6 sm:p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            {t("billingHistoryTitle")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("billingHistorySubtitle")}
          </p>
        </div>
        {/* SA can manually record a payment (offline cash / bank transfer) */}
        <RecordPaymentButton onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-billing-history"] })} />
      </div>

      {/* ── 6 Summary stat cards (always ALL-TIME) ─────────────────────── */}
      {/* cols=6: 2 cols mobile → 3 cols sm → 6 cols xl */}
      <StatCardGrid cols={6}>
        {STAT_CARDS.map(({ labelKey, icon: Icon, tone, value }) =>
          query.isLoading ? (
            <Skeleton key={labelKey} className="h-24 rounded-xl" />
          ) : (
            <StatCard
              key={labelKey}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tone={tone as any}
              icon={Icon}
              label={t(labelKey)}
              value={fmtINR(value ?? "0")}
            />
          )
        )}
      </StatCardGrid>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
        {/* Period quick-tabs */}
        <div className="flex flex-wrap gap-2">
          {PERIOD_KEYS.map(({ value: pv, labelKey }) => (
            <button
              key={pv}
              type="button"
              onClick={() => handlePeriodChange(pv)}
              className={[
                "rounded-full px-4 py-1.5 text-sm font-medium border transition-colors",
                period === pv && !dateFrom && !dateTo
                  ? "bg-navy-900 text-white border-navy-900"
                  : "bg-muted/30 text-foreground border-border hover:bg-muted",
              ].join(" ")}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Custom date range + Mode + Search */}
        <div className="flex flex-wrap items-end gap-3">
          {/* From — writes to draftFrom (committed on Apply) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t("billingFrom")}</label>
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="h-[42px] rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
            />
          </div>
          {/* To — writes to draftTo (committed on Apply) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t("billingTo")}</label>
            <input
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
              className="h-[42px] rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
            />
          </div>
          {/* Mode */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t("billingPaymentMode")}</label>
            <select
              value={mode}
              onChange={(e) => { setMode(e.target.value); setPage(0); }}
              className="h-[42px] rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500 min-w-[160px]"
            >
              {MODE_OPTIONS.map(({ value: mv, label }) => (
                <option key={mv} value={mv}>{t(label)}</option>
              ))}
            </select>
          </div>
          {/* Apply + Clear */}
          <Button
            type="button"
            variant="default"
            className="h-[42px] mt-auto"
            onClick={handleApply}
          >
            {t("billingApply")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-[42px] mt-auto"
            onClick={handleClear}
          >
            {t("billingClear")}
          </Button>
          {/* Hotel search — pushed right on wide screens */}
          <div className="relative ml-auto mt-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder={t("searchHotel")}
              className="h-[42px] w-52 rounded-md border border-border bg-background pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); setPage(0); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Billing History table ─────────────────────────────────────── */}
      <DataTable
        darkHeader
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        isEmpty={!query.isLoading && !query.isError && items.length === 0}
        emptyTitle={t("billingNoRecords")}
        columns={columns}
      >
        {!query.isLoading && !query.isError && items.map((row) => (
          <tr key={row.subscription_id} className="border-t hover:bg-muted/20 transition-colors">
            {/* Hotel Name */}
            <td className="px-4 py-3 font-medium whitespace-nowrap">
              {row.hotel_name}
            </td>
            {/* Owner */}
            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
              {row.owner_name ?? "—"}
            </td>
            {/* Contact */}
            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
              {row.owner_phone ? (
                <a href={`tel:${row.owner_phone}`} className="hover:text-foreground hover:underline">
                  {row.owner_phone}
                </a>
              ) : "—"}
            </td>
            {/* Payment Date */}
            <td className="px-4 py-3 tabular-nums whitespace-nowrap">
              {fmtApiDate(row.payment_date)}
            </td>
            {/* Plan Amount */}
            <td className="px-4 py-3 font-semibold tabular-nums whitespace-nowrap">
              {fmtINR(row.plan_amount)}
            </td>
            {/* Plan */}
            <td className="px-4 py-3 whitespace-nowrap">
              <span className="inline-flex items-center rounded-full bg-info/10 text-info px-2.5 py-0.5 text-xs font-medium capitalize">
                {row.plan_name}
              </span>
            </td>
            {/* Expiry Date */}
            <td className={`px-4 py-3 tabular-nums whitespace-nowrap ${expiryClass(row.expiry_date)}`}>
              {fmtApiDate(row.expiry_date)}
            </td>
            {/* Mode */}
            <td className="px-4 py-3 whitespace-nowrap">
              {row.payment_mode ? (
                <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize">
                  {modeLabel(row.payment_mode, t)}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            {/* Actions */}
            <td className="px-4 py-3 whitespace-nowrap">
              <div className="flex items-center gap-1">
                <Link
                  href={`/admin/hotels/${row.hotel_id}/edit`}
                  className="flex size-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
                  aria-label={tc("view")}
                >
                  <Eye className="size-4 text-muted-foreground" />
                </Link>
                {/* Trash disabled — subscription records are financial history */}
                <button
                  type="button"
                  disabled
                  className="flex size-8 items-center justify-center rounded-md opacity-30 cursor-not-allowed"
                  aria-label="Delete (disabled)"
                  title="Subscription records cannot be deleted"
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      {/* ── Pagination ─────────────────────────────────────────────────── */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-5 py-3">
          <span className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {tc("of")} {total}
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
            <span className="px-3 text-sm tabular-nums">
              {page + 1} / {totalPages}
            </span>
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
    </main>
  );
}
