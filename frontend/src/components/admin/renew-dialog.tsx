"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api/client";
import { fmtINR } from "@/lib/formatting";
import type { HotelAdminOut, SubscriptionPlanOut } from "@/types/money";

export function RenewDialog({ hotel }: { readonly hotel: HotelAdminOut }) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");

  const plans = useQuery({
    queryKey: ["admin-plans"],
    queryFn: () => apiFetch<SubscriptionPlanOut[]>("/api/v1/super-admin/plans"),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/super-admin/hotels/${hotel.id}/subscription`, {
        method: "POST",
        body: { plan_id: planId },
      }),
    onSuccess: () => {
      toast.success(t("subscriptionAssigned"));
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center rounded-lg bg-[#7a6540] px-3 text-xs font-semibold text-white hover:bg-[#6a5535] transition-colors"
      >
        {t("renew")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("renewFor")} {hotel.name}
            </DialogTitle>
          </DialogHeader>
          <div>
            <Label>{t("plans")}</Label>
            <select
              className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              <option value="">—</option>
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {fmtINR(p.price)} / {p.duration_days}d
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
              {tc("cancel")}
            </DialogClose>
            <Button disabled={!planId || mutation.isPending} onClick={() => mutation.mutate()}>
              {t("renew")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
