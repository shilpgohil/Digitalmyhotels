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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { fmtDateTime, fmtINR } from "@/lib/formatting";
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
  const [toName, setToName] = useState("");
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
        body: {
          opening_cash: opening,
          closing_cash: closing,
          to_name: toName.trim() || null,
          notes: notes || null,
        },
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
        {/* Create form — single horizontal row (wraps on small screens). */}
        <section className="mb-6 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Label>{t("openingCash")}</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </div>
            <div className="w-36">
              <Label>{t("closingCash")}</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={closing}
                onChange={(e) => setClosing(e.target.value)}
              />
            </div>
            <div className="w-48 min-w-40 flex-1">
              <Label>{t("handoverTo")}</Label>
              <Input
                className="mt-1"
                maxLength={200}
                value={toName}
                onChange={(e) => setToName(e.target.value)}
              />
            </div>
            <div className="w-56 min-w-44 flex-1">
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
            {t("noHandovers")}
          </p>
        )}
        {items.data && items.data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">{t("dateTime")}</TableHead>
                  <TableHead className="text-white">{t("handoverName")}</TableHead>
                  <TableHead className="text-white">{t("openingCash")}</TableHead>
                  <TableHead className="text-white">{t("closingCash")}</TableHead>
                  <TableHead className="text-white">{t("notes")}</TableHead>
                  <TableHead className="text-white">{t("status")}</TableHead>
                  <TableHead className="text-right text-white">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.data.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmtDateTime(h.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{h.to_name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{fmtINR(h.opening_cash)}</TableCell>
                    <TableCell className="tabular-nums">{fmtINR(h.closing_cash)}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {h.notes ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={h.confirmed ? "success" : "warning"}>
                        {h.confirmed ? t("confirmed") : t("pending")}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!h.confirmed && (
                        <Button size="sm" onClick={() => confirm.mutate(h.id)}>
                          {t("confirmHandover")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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
