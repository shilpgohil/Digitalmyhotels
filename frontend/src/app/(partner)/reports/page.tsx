"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  FileBarChart2,
  IndianRupee,
  Landmark,
  LayoutGrid,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { SectionPanel } from "@/components/ui/section-panel";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { PaginationFooter, paginate } from "@/components/ui/pagination-footer";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { fmtApiDate, fmtINR } from "@/lib/formatting";
import { PERMISSIONS } from "@/lib/permissions";
import { RequirePermission } from "@/components/auth/require-permission";
import type {
  ExpenseReportOut,
  GstReportOut,
  OccupancyReportOut,
  PaymentMethodReportOut,
  RevenueReportOut,
} from "@/types/money";

interface GstBookingRow {
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

interface GstByBooking {
  items: GstBookingRow[];
  total_taxable: string;
  total_gst: string;
  total_amount: string;
}

interface RoomUtilizationRow {
  room_number: string;
  room_type_name: string;
  floor: string | null;
  occupied_nights: number;
  available_nights: number;
  occupancy_percent: string;
  revenue: string;
}

interface RoomUtilizationOut {
  items: RoomUtilizationRow[];
  by_room_type: Record<string, string>;
  from_date: string;
  to_date: string;
}

function toLocalDate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 30);
  return { from: toLocalDate(from), to: toLocalDate(to) };
}

const TABLE_PAGE_SIZE = 10;

function ReportsContent() {
  const t = useTranslations("reports");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const initial = useMemo(defaultRange, []);
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [roomUtilPage, setRoomUtilPage] = useState(1);
  const [gstPage, setGstPage] = useState(1);
  const qs = `from_date=${fromDate}&to_date=${toDate}`;

  useEffect(() => {
    setRoomUtilPage(1);
    setGstPage(1);
  }, [qs]);

  const occupancy = useQuery({
    queryKey: ["report-occ", activeHotelId, qs],
    queryFn: () => api<OccupancyReportOut>(`/api/v1/reports/occupancy?${qs}`),
    enabled: !!activeHotelId,
  });
  const financial = can(PERMISSIONS.financialReports);
  const revenue = useQuery({
    queryKey: ["report-rev", activeHotelId, qs],
    queryFn: () => api<RevenueReportOut>(`/api/v1/reports/revenue?${qs}`),
    enabled: !!activeHotelId && financial,
  });
  const payments = useQuery({
    queryKey: ["report-pay", activeHotelId, qs],
    queryFn: () => api<PaymentMethodReportOut>(`/api/v1/reports/payments?${qs}`),
    enabled: !!activeHotelId && financial,
  });
  const gst = useQuery({
    queryKey: ["report-gst", activeHotelId, qs],
    queryFn: () => api<GstReportOut>(`/api/v1/reports/gst?${qs}`),
    enabled: !!activeHotelId && financial,
  });
  const expenses = useQuery({
    queryKey: ["report-exp", activeHotelId, qs],
    queryFn: () => api<ExpenseReportOut>(`/api/v1/reports/expenses?${qs}`),
    enabled: !!activeHotelId && financial,
  });
  const gstRows = useQuery({
    queryKey: ["report-gst-rows", activeHotelId, qs],
    queryFn: () => api<GstByBooking>(`/api/v1/reports/gst/by-booking?${qs}`),
    enabled: !!activeHotelId && financial,
  });
  const roomUtil = useQuery({
    queryKey: ["report-room-util", activeHotelId, qs],
    queryFn: () => api<RoomUtilizationOut>(`/api/v1/reports/room-utilization?${qs}`),
    enabled: !!activeHotelId,
  });

  // ── CSV exports ───────────────────────────────────────────────────────────

  const exportGstCsv = () => {
    if (!gstRows.data) return;
    const header = ["Booking No", "Guest", "Invoice No", "Date", "Taxable", "CGST", "SGST", "IGST", "Total", "Status"];
    const rowData = gstRows.data.items.map((r) => [
      r.booking_number, r.guest_name, r.invoice_number, r.invoice_date,
      r.taxable, r.cgst, r.sgst, r.igst, r.total, r.status,
    ]);
    const totals = ["TOTAL", "", "", "",
      gstRows.data.total_taxable, "", "", "",
      gstRows.data.total_amount, "",
    ];
    const csv = [header, ...rowData, totals]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gst-by-booking-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSummaryCsv = () => {
    const rows = [
      ["metric", "value"],
      ["occupancy_percent", occupancy.data?.occupancy_percent ?? ""],
      ["occupied_nights", String(occupancy.data?.occupied_nights ?? "")],
      ["net_revenue", revenue.data?.net_revenue ?? ""],
      ["cash", payments.data?.cash ?? ""],
      ["upi", payments.data?.upi ?? ""],
      ["gst_taxable", gst.data?.taxable ?? ""],
      ["expenses", expenses.data?.total ?? ""],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reports-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("operations")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

        {/* ── Date range filter + export ──────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <FilterBar
            fromDate={fromDate}
            onFromDateChange={setFromDate}
            fromLabel={t("from")}
            toDate={toDate}
            onToDateChange={setToDate}
            toLabel={t("to")}
          />
          <Button variant="outline" size="sm" onClick={exportSummaryCsv}>
            <Download className="size-3.5 mr-1.5" aria-hidden />
            {t("exportCsv")}
          </Button>
        </div>

        {/* ── Summary stat cards ──────────────────────────────────────── */}
        <StatCardGrid cols={financial ? 4 : 2}>
          <StatCard
            label={t("occupancy")}
            value={occupancy.data ? `${occupancy.data.occupancy_percent}%` : "—"}
            subtitle={occupancy.data ? `${occupancy.data.occupied_nights} nights occupied` : undefined}
            icon={LayoutGrid}
            tone="white"
            isLoading={occupancy.isLoading}
          />
          {financial && (
            <>
              <StatCard
                label={t("revenue")}
                value={revenue.data ? fmtINR(revenue.data.net_revenue) : "—"}
                subtitle="Net revenue after discounts"
                icon={TrendingUp}
                tone="white"
                isLoading={revenue.isLoading}
              />
              <StatCard
                label={t("expenses")}
                value={expenses.data ? fmtINR(expenses.data.total) : "—"}
                subtitle="Approved + paid only"
                icon={Receipt}
                tone="white"
                isLoading={expenses.isLoading}
              />
              <StatCard
                label={t("gst")}
                value={gst.data ? fmtINR(String(Number(gst.data.cgst) + Number(gst.data.sgst) + Number(gst.data.igst))) : "—"}
                subtitle={gst.data ? `Taxable: ${fmtINR(gst.data.taxable)}` : undefined}
                icon={Landmark}
                tone="white"
                isLoading={gst.isLoading}
              />
            </>
          )}
        </StatCardGrid>

        {/* ── Payment method breakdown ────────────────────────────────── */}
        {financial && (
          <SectionPanel title={t("payments")} icon={Wallet}>
            {payments.isLoading && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-6 rounded bg-muted animate-pulse" />
                ))}
              </div>
            )}
            {payments.data && (
              <div className="space-y-3">
                {[
                  { label: t("cash"), value: payments.data.cash, color: "bg-gold-500" },
                  { label: t("upi"), value: payments.data.upi, color: "bg-success" },
                ].map(({ label, value, color }) => {
                  const total = Number(payments.data.cash) + Number(payments.data.upi);
                  const pct = total > 0 ? Math.round((Number(value) / total) * 100) : 0;
                  return (
                    <div key={label}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="tabular-nums">{fmtINR(value)}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-0.5 text-label text-muted-foreground">{pct}%</p>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionPanel>
        )}

        {/* ── Room utilization table ──────────────────────────────────── */}
        <SectionPanel
          title={t("roomUtilizationTitle")}
          icon={IndianRupee}
          noPadding
          action={
            roomUtil.data && Object.keys(roomUtil.data.by_room_type).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(roomUtil.data.by_room_type).map(([typeName, pct]) => (
                  <span key={typeName} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                    {typeName}: {pct}%
                  </span>
                ))}
              </div>
            ) : undefined
          }
        >
          <DataTable
            darkHeader
            isLoading={roomUtil.isLoading}
            isError={roomUtil.isError}
            onRetry={() => roomUtil.refetch()}
            isEmpty={!roomUtil.isLoading && !roomUtil.isError && (roomUtil.data?.items.length ?? 0) === 0}
            emptyTitle={t("noRoomUtilization")}
            emptySubtitle="Data appears once bookings are made in the selected period."
            className="rounded-none border-0"
            columns={[
              t("colRoomNo"),
              t("colRoomType"),
              t("colFloor"),
              t("colOccupiedNights"),
              t("colOccupancyPct"),
              t("colRevenue"),
            ]}
          >
            {roomUtil.data && (
              <TableBody>
                {paginate(roomUtil.data.items, roomUtilPage, TABLE_PAGE_SIZE).map((row) => (
                  <TableRow key={row.room_number}>
                    <TableCell className="font-medium whitespace-nowrap">{row.room_number}</TableCell>
                    <TableCell>{row.room_type_name}</TableCell>
                    <TableCell>{row.floor ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.occupied_nights}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gold-500"
                            style={{ width: `${Math.min(Number(row.occupancy_percent), 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-sm whitespace-nowrap">{row.occupancy_percent}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">{fmtINR(row.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            )}
          </DataTable>
          {roomUtil.data && roomUtil.data.items.length > TABLE_PAGE_SIZE && (
            <div className="border-t px-4 py-2">
              <PaginationFooter
                page={roomUtilPage}
                total={roomUtil.data.items.length}
                pageSize={TABLE_PAGE_SIZE}
                onPageChange={setRoomUtilPage}
              />
            </div>
          )}
        </SectionPanel>

        {/* ── GST per-booking table ───────────────────────────────────── */}
        {financial && (
          <SectionPanel
            title={t("gstByBooking")}
            icon={FileBarChart2}
            noPadding
            action={
              gstRows.data ? (
                <div className="flex items-center gap-3">
                  <p className="hidden text-label text-muted-foreground sm:block">
                    {t("gstTotals", {
                      taxable: fmtINR(gstRows.data.total_taxable),
                      gst: fmtINR(gstRows.data.total_gst),
                      total: fmtINR(gstRows.data.total_amount),
                    })}
                  </p>
                  <Button variant="outline" size="sm" onClick={exportGstCsv}>
                    <Download className="size-3.5 mr-1" aria-hidden />
                    {t("exportCsvGst")}
                  </Button>
                </div>
              ) : undefined
            }
          >
            <DataTable
              darkHeader
              isLoading={gstRows.isLoading}
              isError={gstRows.isError}
              onRetry={() => gstRows.refetch()}
              isEmpty={!gstRows.isLoading && !gstRows.isError && (gstRows.data?.items.length ?? 0) === 0}
              emptyTitle={t("noGstRows")}
              emptySubtitle="GST appears once invoices are generated for this period."
              className="rounded-none border-0"
              columns={[
                t("colBooking"),
                t("colGuest"),
                t("colInvoice"),
                t("colTaxable"),
                "CGST",
                "SGST",
                "IGST",
                t("colFinal"),
              ]}
            >
              {gstRows.data && (
                <TableBody>
                  {paginate(gstRows.data.items, gstPage, TABLE_PAGE_SIZE).map((row) => (
                    <TableRow key={row.invoice_number}>
                      <TableCell className="font-medium whitespace-nowrap">{row.booking_number}</TableCell>
                      <TableCell>{row.guest_name}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {row.invoice_number} · {fmtApiDate(row.invoice_date)}
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtINR(row.taxable)}</TableCell>
                      <TableCell className="tabular-nums">{fmtINR(row.cgst)}</TableCell>
                      <TableCell className="tabular-nums">{fmtINR(row.sgst)}</TableCell>
                      <TableCell className="tabular-nums">{fmtINR(row.igst)}</TableCell>
                      <TableCell className="tabular-nums font-semibold">{fmtINR(row.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )}
            </DataTable>
            {gstRows.data && gstRows.data.items.length > TABLE_PAGE_SIZE && (
              <div className="border-t px-4 py-2">
                <PaginationFooter
                  page={gstPage}
                  total={gstRows.data.items.length}
                  pageSize={TABLE_PAGE_SIZE}
                  onPageChange={setGstPage}
                />
              </div>
            )}
          </SectionPanel>
        )}

        {!financial && (
          <EmptyState
            icon={FileBarChart2}
            title={tc("unauthorized")}
            subtitle="Financial reports are available to owners and managers only."
          />
        )}
      </main>
    </>
  );
}

export default function ReportsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.reportsView}>
      <ReportsContent />
    </RequirePermission>
  );
}
