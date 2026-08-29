"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApi } from "@/lib/api/use-api";
import { ApiError } from "@/lib/api/client";
import type { CheckOutOut, CurrentGuestOut } from "@/types/stay";

export function CheckoutDialog({
  entry,
  onClose,
  onDone,
}: {
  readonly entry: CurrentGuestOut | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const t = useTranslations("stay");
  const tc = useTranslations("common");
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [allowDue, setAllowDue] = useState(false);

  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const fs = (k: string, fb = "") => (form.get(k) as string | null) ?? fb;
      return api<CheckOutOut>("/api/v1/checkouts", {
        method: "POST",
        body: {
          booking_id: entry?.booking_id,
          is_late: form.get("is_late") === "on",
          late_fee: fs("late_fee", "0"),
          allow_due: form.get("allow_due") === "on",
          due_reason: fs("due_reason").trim() || null,
        },
      });
    },
    onSuccess: (out) => {
      toast.success(
        `${t("checkedOutToast")} — ${t("finalTotal")}: ₹${out.final_total}` +
          (out.refund_amount !== "0.00" ? ` · ${t("refund")}: ₹${out.refund_amount}` : ""),
      );
      setError(null);
      setAllowDue(false);
      onClose();
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setAllowDue(false);
          setError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("checkOutAction")} — {entry?.booking_number}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <p className="text-sm text-muted-foreground">
            {entry?.primary_guest_name} · ₹{entry?.due_amount}
          </p>
          <div className="flex items-center gap-2">
            <input
              id="co-late"
              name="is_late"
              type="checkbox"
              className="size-4 rounded border-input"
            />
            <Label htmlFor="co-late">{t("lateCheckout")}</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-latefee">{t("lateFee")}</Label>
            <Input
              id="co-latefee"
              name="late_fee"
              type="number"
              min={0}
              step="0.01"
              defaultValue={0}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="co-allowdue"
              name="allow_due"
              type="checkbox"
              className="size-4 rounded border-input"
              checked={allowDue}
              onChange={(e) => setAllowDue(e.target.checked)}
            />
            <Label htmlFor="co-allowdue">{t("allowDue")}</Label>
          </div>
          {allowDue && (
            <div className="space-y-1.5">
              <Label htmlFor="co-duereason">{t("dueReason")}</Label>
              <Input id="co-duereason" name="due_reason" required />
            </div>
          )}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              {tc("cancel")}
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? tc("saving") : t("checkOutAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
