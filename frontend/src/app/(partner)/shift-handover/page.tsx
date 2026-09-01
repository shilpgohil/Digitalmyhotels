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
import type { ShiftHandoverOut } from "@/types/money";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

function ShiftHandoverContent() {
  const t = useTranslations("ops");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("0");
  const [notes, setNotes] = useState("");

  const items = useQuery({
    queryKey: ["handovers", activeHotelId],
    queryFn: () => api<ShiftHandoverOut[]>("/api/v1/ops/shift-handover"),
    enabled: !!activeHotelId,
  });

  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/ops/shift-handover", {
        method: "POST",
        body: { opening_cash: opening, closing_cash: closing, notes: notes || null },
      }),
    onSuccess: () => {
      toast.success(t("handoverCreated"));
      queryClient.invalidateQueries({ queryKey: ["handovers", activeHotelId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });
  const confirm = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/ops/shift-handover/${id}/confirm`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("handoverConfirmed"));
      queryClient.invalidateQueries({ queryKey: ["handovers", activeHotelId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <>
      <PartnerHeader title={t("handoverTitle")} subtitle={tn("operations")} />
      <main className="flex-1 overflow-y-auto p-6">
        <section className="mb-6 max-w-md rounded-lg border bg-card p-5">
          <div className="grid gap-3">
            <div>
              <Label>{t("openingCash")}</Label>
              <Input className="mt-1" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </div>
            <div>
              <Label>{t("closingCash")}</Label>
              <Input className="mt-1" value={closing} onChange={(e) => setClosing(e.target.value)} />
            </div>
            <div>
              <Label>{t("notes")}</Label>
              <Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {t("createHandover")}
            </Button>
          </div>
        </section>
        {items.isLoading && <Skeleton className="h-32" />}
        {items.isError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {tc("error")}
          </p>
        )}
        {items.data && items.data.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No handovers yet.
          </p>
        )}
        <ul className="space-y-2">
          {items.data?.map((h) => (
            <li key={h.id} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
              <div className="text-sm">
                <p>
                  {t("openingCash")} ₹{h.opening_cash} → {t("closingCash")} ₹{h.closing_cash}
                </p>
                <StatusBadge tone={h.confirmed ? "success" : "warning"}>
                  {h.confirmed ? t("confirmed") : t("pending")}
                </StatusBadge>
              </div>
              {!h.confirmed && (
                <Button size="sm" onClick={() => confirm.mutate(h.id)}>
                  {t("confirmHandover")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}

export default function ShiftHandoverPage() {
  return (
    <RequirePermission permission={PERMISSIONS.shiftHandover}>
      <ShiftHandoverContent />
    </RequirePermission>
  );
}
