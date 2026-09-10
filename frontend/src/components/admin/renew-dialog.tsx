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
      // The admin screens use distinct query-key roots — invalidate them all
      // so renewing from any page refreshes the dashboard, hotels list and
      // the expired list together.
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-expired"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="bg-gold-600 text-white hover:bg-gold-700">
        {t("renew")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("renewFor")} {hotel.name}
            </DialogTitle>
          </DialogHeader>
          <div>
            <Label>{t("plans")}</Label>
            {/* Loading / error / empty states — the dialog previously showed a
                bare '—' select whatever happened (client 9-08 item 38). */}
            {plans.isLoading && (
              <p className="mt-1.5 text-sm text-muted-foreground">{tc("loading")}</p>
            )}
            {plans.isError && (
              <p className="mt-1.5 text-sm text-danger">
                {plans.error instanceof ApiError ? plans.error.message : tc("error")}{" "}
                <button type="button" className="underline" onClick={() => plans.refetch()}>
                  {tc("retry")}
                </button>
              </p>
            )}
            {plans.data && plans.data.filter((p) => p.is_active).length === 0 && (
              <p className="mt-1.5 text-sm text-muted-foreground">{t("noActivePlans")}</p>
            )}
            {plans.data && plans.data.filter((p) => p.is_active).length > 0 && (
              <select
                className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                {/* Explicit placeholder instead of a meaningless dash. */}
                <option value="">{t("choosePlan")}</option>
                {plans.data
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {fmtINR(p.price)} / {p.duration_days}d
                    </option>
                  ))}
              </select>
            )}
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
