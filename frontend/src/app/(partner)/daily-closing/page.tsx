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
import { StatusBadge } from "@/components/feedback/status-badge";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
import { fmtApiDate } from "@/lib/formatting";
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
  const reopenConfirm = useConfirmDialog();

  const today = useQuery({
    queryKey: ["closing-today", activeHotelId],
    queryFn: () => api<DailyClosingOut>("/api/v1/ops/daily-closing/today"),
    enabled: !!activeHotelId,
  });
  const history = useQuery({
    queryKey: ["closings", activeHotelId],
    queryFn: () => api<DailyClosingOut[]>("/api/v1/ops/daily-closing"),
    enabled: !!activeHotelId,
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
            {tc("error")}
          </p>
        )}
        {!today.isLoading && !today.isError && !row && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No closing record for today yet.
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
              <Stat label={t("cash")} value={`₹${row.cash_collected}`} />
              <Stat label={t("upi")} value={`₹${row.upi_collected}`} />
              <Stat label={t("revenue")} value={`₹${row.total_revenue}`} />
              <Stat label={t("expenses")} value={`₹${row.total_expenses}`} />
              <Stat label={t("refunds")} value={`₹${row.refunds_total}`} />
              <Stat label={t("dues")} value={`₹${row.dues_total}`} />
            </dl>
            {row.status === "open" && (
              <div className="mt-4 space-y-3">
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
          <ul className="mt-6 space-y-2 text-sm">
            {history.data.map((h) => (
              <li key={h.id} className="flex justify-between rounded-lg border bg-card px-4 py-2">
                <span>{fmtApiDate(h.business_date)}</span>
                <span>{h.status}</span>
              </li>
            ))}
          </ul>
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
