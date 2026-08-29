"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function ReportsContent() {
  const t = useTranslations("reports");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const initial = useMemo(defaultRange, []);
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const qs = `from_date=${fromDate}&to_date=${toDate}`;

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

  const exportGstCsv = () => {
    if (!gstRows.data) return;
    const header = ["Booking No","Guest","Invoice No","Date","Taxable","CGST","SGST","IGST","Total","Status"];
    const rowData = gstRows.data.items.map((r) => [
      r.booking_number, r.guest_name, r.invoice_number, r.invoice_date,
      r.taxable, r.cgst, r.sgst, r.igst, r.total, r.status,
    ]);
    const totals = ["TOTAL","","","",
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

  const exportCsv = () => {
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
  };

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("operations")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <Label>{t("from")}</Label>
            <Input className="mt-1" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label>{t("to")}</Label>
            <Input className="mt-1" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <button className="h-8 rounded-lg border px-3 text-sm" onClick={exportCsv}>
            {t("exportCsv")}
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ReportCard title={t("occupancy")} loading={occupancy.isLoading} error={occupancy.isError}>
            {occupancy.data && (
              <p className="text-3xl font-semibold tabular-nums">{occupancy.data.occupancy_percent}%</p>
            )}
          </ReportCard>
          {financial && (
            <>
              <ReportCard title={t("revenue")} loading={revenue.isLoading} error={revenue.isError}>
                {revenue.data && (
                  <p className="text-3xl font-semibold tabular-nums">₹{revenue.data.net_revenue}</p>
                )}
              </ReportCard>
              <ReportCard title={t("payments")} loading={payments.isLoading} error={payments.isError}>
                {payments.data && (
                  <p className="text-sm">
                    {t("cash")}: ₹{payments.data.cash} · {t("upi")}: ₹{payments.data.upi}
                  </p>
                )}
              </ReportCard>
              <ReportCard title={t("gst")} loading={gst.isLoading} error={gst.isError}>
                {gst.data && (
                  <p className="text-sm">
                    CGST ₹{gst.data.cgst} · SGST ₹{gst.data.sgst} · IGST ₹{gst.data.igst}
                  </p>
                )}
              </ReportCard>
              <ReportCard title={t("expenses")} loading={expenses.isLoading} error={expenses.isError}>
                {expenses.data && (
                  <p className="text-3xl font-semibold tabular-nums">₹{expenses.data.total}</p>
                )}
              </ReportCard>
            </>
          )}
          {!financial && <p className="text-sm text-muted-foreground">{tc("unauthorized")}</p>}
        </div>

        {/* Room utilization table */}
        {roomUtil.data && roomUtil.data.items.length > 0 && (
          <section className="mt-6 rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <h2 className="text-sm font-semibold">{t("roomUtilizationTitle")}</h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(roomUtil.data.by_room_type).map(([typeName, pct]) => (
                  <span key={typeName} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                    {typeName}: {pct}%
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-navy-900 hover:bg-navy-900">
                    <TableHead className="text-white">{t("colRoomNo")}</TableHead>
                    <TableHead className="text-white">{t("colRoomType")}</TableHead>
                    <TableHead className="text-white">{t("colFloor")}</TableHead>
                    <TableHead className="text-white">{t("colOccupiedNights")}</TableHead>
                    <TableHead className="text-white">{t("colOccupancyPct")}</TableHead>
                    <TableHead className="text-white">{t("colRevenue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roomUtil.data.items.map((row) => (
                    <TableRow key={row.room_number}>
                      <TableCell className="font-medium">{row.room_number}</TableCell>
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
                          <span className="tabular-nums text-sm">{row.occupancy_percent}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">₹{row.revenue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        )}

        {/* GST per-booking table */}
        {financial && gstRows.data && gstRows.data.items.length > 0 && (
          <section className="mt-6 rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <h2 className="text-sm font-semibold">{t("gstByBooking")}</h2>
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  {t("gstTotals", {
                    taxable: gstRows.data.total_taxable,
                    gst: gstRows.data.total_gst,
                    total: gstRows.data.total_amount,
                  })}
                </p>
                <button
                  className="inline-flex h-7 items-center rounded-md border px-2.5 text-xs hover:bg-muted"
                  onClick={exportGstCsv}
                  type="button"
                >
                  {t("exportCsvGst")}
                </button>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-navy-900 hover:bg-navy-900">
                    <TableHead className="text-white">{t("colBooking")}</TableHead>
                    <TableHead className="text-white">{t("colGuest")}</TableHead>
                    <TableHead className="text-white">{t("colInvoice")}</TableHead>
                    <TableHead className="text-white">{t("colTaxable")}</TableHead>
                    <TableHead className="text-white">CGST</TableHead>
                    <TableHead className="text-white">SGST</TableHead>
                    <TableHead className="text-white">IGST</TableHead>
                    <TableHead className="text-white">{t("colFinal")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gstRows.data.items.map((row) => (
                    <TableRow key={row.invoice_number}>
                      <TableCell className="font-medium">{row.booking_number}</TableCell>
                      <TableCell>{row.guest_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.invoice_number} · {row.invoice_date}
                      </TableCell>
                      <TableCell className="tabular-nums">₹{row.taxable}</TableCell>
                      <TableCell className="tabular-nums">₹{row.cgst}</TableCell>
                      <TableCell className="tabular-nums">₹{row.sgst}</TableCell>
                      <TableCell className="tabular-nums">₹{row.igst}</TableCell>
                      <TableCell className="tabular-nums font-semibold">₹{row.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function ReportCard({
  title,
  loading,
  error,
  children,
}: {
  title: string;
  loading: boolean;
  error: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">{title}</h2>
      <div className="mt-3">
        {loading && <Skeleton className="h-10" />}
        {error && <p className="text-sm text-danger">Error</p>}
        {children}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.reportsView}>
      <ReportsContent />
    </RequirePermission>
  );
}
