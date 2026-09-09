"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationFooter, paginate } from "@/components/ui/pagination-footer";
import { StatusBadge } from "@/components/feedback/status-badge";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
import { AlertTriangle } from "lucide-react";
import { fmtApiDate, fmtINR } from "@/lib/formatting";
import type { DailyClosingOut } from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

function DailyClosingContent() {
  const t = useTranslations("ops");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const reopenConfirm = useConfirmDialog();

  const today = useQuery({
    queryKey: ["closing-today", activeHotelId],
    queryFn: () => api<DailyClosingOut>("/api/v1/ops/daily-closing/today"),
    enabled: !!activeHotelId,
    staleTime: 30_000,
  });
  const history = useQuery({
    queryKey: ["closings", activeHotelId],
    queryFn: () => api<DailyClosingOut[]>("/api/v1/ops/daily-closing"),
    enabled: !!activeHotelId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["closing-today", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["closings", activeHotelId] });
  };

  const closeDay = useMutation({
    mutationFn: () =>
      api("/api/v1/ops/daily-closing/close", { method: "POST", body: { notes: notes || null } }),
    onSuccess: () => {
      toast.success(t("dayClosed"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });
  const reopen = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/api/v1/ops/daily-closing/${id}/reopen`, { method: "POST", body: { reason } }),
    onSuccess: () => {
      toast.success(t("dayReopened"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const row = today.data;

  return (
    <>
      <PartnerHeader title={t("closingTitle")} subtitle={tn("operations")} />
      <main className="flex-1 overflow-y-auto p-6">
        {today.isLoading && <Skeleton className="h-48" />}
        {(today.isError || history.isError) && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {tc("error")}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                if (today.isError) today.refetch();
                if (history.isError) history.refetch();
              }}
            >
              {tc("retry")}
            </button>
          </p>
        )}
        {!today.isLoading && !today.isError && !row && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("noClosingToday")}
          </p>
        )}
        {row && (
          <section className="rounded-lg border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl">{fmtApiDate(row.business_date)}</h2>
              <StatusBadge tone={row.status === "closed" ? "success" : "warning"}>{row.status}</StatusBadge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Stat label={t("checkins")} value={String(row.checkins_count)} />
              <Stat label={t("checkouts")} value={String(row.checkouts_count)} />
              <Stat label={t("cash")} value={fmtINR(row.cash_collected)} />
              <Stat label={t("upi")} value={fmtINR(row.upi_collected)} />
              <Stat label={t("revenue")} value={fmtINR(row.total_revenue)} />
              <Stat label={t("expenses")} value={fmtINR(row.total_expenses)} />
              <Stat label={t("refunds")} value={fmtINR(row.refunds_total)} />
              <Stat label={t("dues")} value={fmtINR(row.dues_total)} />
            </dl>
            {row.status === "open" && (
              <div className="mt-4 space-y-3">
                {/* Backdated-payment warning — shown when today's payments
                    belong to bookings from prior days (e.g. dues at late
                    checkout). Legitimate but should be reviewed before close. */}
                {(row.backdated_payments_count ?? 0) > 0 && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                    <div className="text-sm">
                      <p className="font-semibold text-amber-800">
                        {t("backdatedPaymentsTitle", {
                          count: row.backdated_payments_count,
                        })}
                      </p>
                      <p className="text-amber-700">
                        {t("backdatedPaymentsHint", {
                          amount: fmtINR(row.backdated_payments_amount),
                        })}
                      </p>
                    </div>
                  </div>
                )}
                <div>
                  <Label>{t("notes")}</Label>
                  <Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <Button onClick={() => closeDay.mutate()} disabled={closeDay.isPending}>
                  {t("closeDay")}
                </Button>
              </div>
            )}
            {row.status === "closed" && (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  setReopenId(row.id);
                  reopenConfirm.show();
                }}
              >
                {t("reopenDay")}
              </Button>
            )}
          </section>
        )}
        {history.data && history.data.length > 1 && (
          <div className="mt-6">
            <ul className="space-y-2 text-sm">
              {paginate(history.data, historyPage, 10).map((h) => (
                <li key={h.id} className="flex justify-between rounded-lg border bg-card px-4 py-2">
                  <span>{fmtApiDate(h.business_date)}</span>
                  <span>{h.status}</span>
                </li>
              ))}
            </ul>
            <PaginationFooter
              page={historyPage}
              total={history.data.length}
              pageSize={10}
              onPageChange={setHistoryPage}
              className="border-t-0 px-0"
            />
          </div>
        )}
        <ConfirmDialog
          open={reopenConfirm.open}
          title={t("reopenDay")}
          requireText
          textLabel={t("reopenReason")}
          textPlaceholder={t("reopenReason")}
          confirmLabel={t("reopenDay")}
          isPending={reopen.isPending}
          onConfirm={(reason) => {
            if (reopenId) {
              reopen.mutate({ id: reopenId, reason });
              reopenConfirm.hide();
              setReopenId(null);
            }
          }}
          onCancel={() => {
            reopenConfirm.hide();
            setReopenId(null);
          }}
        />
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default function DailyClosingPage() {
  return (
    <RequirePermission permission={PERMISSIONS.dailyClosing}>
      <DailyClosingContent />
    </RequirePermission>
  );
}
