"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { fmtINR, localToday } from "@/lib/formatting";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface GstByBookingItem {
  booking_number: string;
  guest_name: string;
  invoice_number: string;
  invoice_date: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  status: string;
}

interface GstByBookingOut {
  from_date: string;
  to_date: string;
  items: GstByBookingItem[];
  total_taxable: string;
  total_gst: string;
  total_amount: string;
}

const ALL_TIME_FROM = "2020-01-01";

type QuickFilter = "allTime" | "today" | "last5Days" | "thisMonth" | "thisYear";

function quickFilterRange(filter: QuickFilter): { from: string; to: string } {
  const today = localToday();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (filter) {
    case "today":
      return { from: today, to: today };
    case "last5Days": {
      const d = new Date();
      d.setDate(d.getDate() - 4);
      return {
        from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        to: today,
      };
    }
    case "thisMonth":
      return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: today };
    case "thisYear":
      return { from: `${now.getFullYear()}-01-01`, to: today };
    case "allTime":
    default:
      return { from: ALL_TIME_FROM, to: today };
  }
}

const QUICK_FILTERS: QuickFilter[] = [
  "allTime",
  "today",
  "last5Days",
  "thisMonth",
  "thisYear",
];

function gstPayable(item: GstByBookingItem): number {
  return (
    (Number.parseFloat(item.cgst) || 0) +
    (Number.parseFloat(item.sgst) || 0) +
    (Number.parseFloat(item.igst) || 0)
  );
}

function gstRate(item: GstByBookingItem): string {
  const taxable = Number.parseFloat(item.taxable) || 0;
  if (taxable === 0) return "\u2014";
  return `${Math.round((gstPayable(item) / taxable) * 100)}%`;
}

function GstTaxContent() {
  const t = useTranslations("gstTax");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();

  const initial = useMemo(() => quickFilterRange("allTime"), []);
  const [activeChip, setActiveChip] = useState<QuickFilter | null>("allTime");
  const [draftFrom, setDraftFrom] = useState(initial.from);
  const [draftTo, setDraftTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);
  const [search, setSearch] = useState("");

  const selectChip = (filter: QuickFilter) => {
    const range = quickFilterRange(filter);
    setActiveChip(filter);
    setDraftFrom(range.from);
    setDraftTo(range.to);
    setApplied(range);
  };

  const applyDates = () => {
    setActiveChip(null);
    setApplied({ from: draftFrom, to: draftTo });
  };

  const clearDates = () => selectChip("allTime");

  const report = useQuery({
    queryKey: ["gst-by-booking", activeHotelId, applied.from, applied.to],
    queryFn: () =>
      api<GstByBookingOut>(
        `/api/v1/reports/gst/by-booking?from_date=${applied.from}&to_date=${applied.to}`,
      ),
    enabled: !!activeHotelId,
  });

  const filteredItems = useMemo(() => {
    if (!report.data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return report.data.items;
    return report.data.items.filter((item) =>
      item.booking_number.toLowerCase().includes(q),
    );
  }, [report.data, search]);

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("money")} />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Quick filter chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => selectChip(filter)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activeChip === filter
                  ? "border-navy-900 bg-navy-900 text-white"
                  : "bg-card hover:bg-muted",
              )}
            >
              {t(`chip_${filter}`)}
            </button>
          ))}
        </div>

        {/* Date range filters */}
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <Label>{t("fromDate")}</Label>
            <DatePicker className="mt-1" value={draftFrom} onChange={setDraftFrom} />
          </div>
          <div>
            <Label>{t("toDate")}</Label>
            <DatePicker className="mt-1" value={draftTo} onChange={setDraftTo} />
          </div>
          <Button onClick={applyDates} disabled={!draftFrom || !draftTo}>
            {t("apply")}
          </Button>
          <Button variant="outline" onClick={clearDates}>
            {t("clear")}
          </Button>
        </div>

        {/* Stat cards */}
        {report.isLoading && (
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        )}
        {report.data && (
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["totalAmount", report.data.total_amount, "bg-navy-900 text-white"],
                ["taxableValue", report.data.total_taxable, "bg-gold-500 text-navy-900"],
                ["gst", report.data.total_gst, "bg-muted text-foreground"],
              ] as const
            ).map(([key, value, className]) => (
              <div key={key} className={`rounded-lg p-4 ${className}`}>
                <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80">
                  {t(key)}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtINR(value)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="mb-4 max-w-sm">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-8"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <section className="rounded-lg border bg-card">
          {report.isLoading && <Skeleton className="h-48" />}
          {report.isError && (
            <p className="p-4 text-sm text-danger">
              {tc("error")}{" "}
              <button className="underline" onClick={() => report.refetch()}>
                {tc("retry")}
              </button>
            </p>
          )}
          {report.data && filteredItems.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">{t("noItems")}</p>
          )}
          {report.data && filteredItems.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-navy-900 hover:bg-navy-900">
                    <TableHead className="text-white">{t("colId")}</TableHead>
                    <TableHead className="text-white">{t("colGstRate")}</TableHead>
                    <TableHead className="text-white">{t("colTaxable")}</TableHead>
                    <TableHead className="text-white">{t("colCgst")}</TableHead>
                    <TableHead className="text-white">{t("colSgst")}</TableHead>
                    <TableHead className="text-white">{t("colGstPayable")}</TableHead>
                    <TableHead className="text-white">{t("colFinalPrice")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item, idx) => (
                    <TableRow key={`${item.booking_number}-${item.invoice_number}-${idx}`}>
                      <TableCell className="font-medium">{item.booking_number}</TableCell>
                      <TableCell className="tabular-nums">{gstRate(item)}</TableCell>
                      <TableCell className="tabular-nums">{fmtINR(item.taxable)}</TableCell>
                      <TableCell className="tabular-nums">{fmtINR(item.cgst)}</TableCell>
                      <TableCell className="tabular-nums">{fmtINR(item.sgst)}</TableCell>
                      <TableCell className="tabular-nums">
                        {fmtINR(gstPayable(item))}
                      </TableCell>
                      <TableCell className="tabular-nums font-semibold">
                        {fmtINR(item.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

export default function GstTaxPage() {
  return (
    <RequirePermission permission={PERMISSIONS.financialReports}>
      <GstTaxContent />
    </RequirePermission>
  );
}
