"use client";

/**
 * ExtendDialog — custom short-period grant (client 09/2026).
 *
 * The super admin enters a number of days and the hotel's CURRENT plan is
 * extended by that many days (from today if the plan already lapsed, so a
 * "5-day grant" always gives 5 usable days). This is a courtesy extension,
 * not a paid renewal — use RenewDialog for real renewals.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api/client";
import { fmtApiDate } from "@/lib/formatting";
import type { HotelAdminOut } from "@/types/money";

export function ExtendDialog({ hotel }: { readonly hotel: HotelAdminOut }) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("");

  const daysNum = Number.parseInt(days, 10) || 0;

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ expiry_date: string }>(
        `/api/v1/super-admin/hotels/${hotel.id}/subscription/extend`,
        { method: "POST", body: { days: daysNum } },
      ),
    onSuccess: (sub) => {
      toast.success(
        t("extendSuccess", { days: daysNum, date: fmtApiDate(sub.expiry_date) }),
      );
      setOpen(false);
      setDays("");
      // Same invalidation set as RenewDialog — refresh every admin view.
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-expired"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotel-detail"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1 border-gold-500 text-gold-700 hover:bg-gold-50"
      >
        <CalendarPlus className="size-3.5" aria-hidden />
        {t("extend")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("extendFor")} {hotel.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`extend-days-${hotel.id}`}>{t("extendDaysLabel")}</Label>
            <Input
              id={`extend-days-${hotel.id}`}
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="5"
              className="max-w-[140px]"
            />
            <p className="text-label text-muted-foreground">{t("extendHint")}</p>
          </div>
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
              {tc("cancel")}
            </DialogClose>
            <Button
              disabled={daysNum < 1 || daysNum > 365 || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? tc("saving") : t("extend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
