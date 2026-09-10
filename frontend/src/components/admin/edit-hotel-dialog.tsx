"use client";

/**
 * Super Admin Edit Hotel (client 9-08 items 28/30).
 *
 * Trigger + dialog: loads GET /super-admin/hotels/{id} (profile + owner
 * contact), lets the admin correct name/city/state/contact details and
 * backfill the OWNER's phone so phone login starts working for accounts
 * created without one. Saves via PATCH — audited server-side.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, ApiError } from "@/lib/api/client";

interface AdminHotelDetail {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  status: string;
  gstin: string | null;
  is_gst_registered: boolean;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  subscription_plan_name: string | null;
  subscription_status: string | null;
  subscription_expiry: string | null;
}

export function EditHotelDialog({
  hotelId,
  hotelName,
}: {
  readonly hotelId: string;
  readonly hotelName: string;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["admin-hotel-detail", hotelId],
    queryFn: () => apiFetch<AdminHotelDetail>(`/api/v1/super-admin/hotels/${hotelId}`),
    enabled: open,
    staleTime: 0,
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch<AdminHotelDetail>(`/api/v1/super-admin/hotels/${hotelId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      toast.success(t("hotelUpdated"));
      setError(null);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotel-detail", hotelId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  const d = detail.data;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-input px-2.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
        title={t("editHotel")}
      >
        <Pencil className="size-3" aria-hidden />
        {tc("edit")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("editHotel")} — {hotelName}
            </DialogTitle>
          </DialogHeader>
          {detail.isLoading && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {detail.isError && (
            <p className="text-sm text-danger">
              {detail.error instanceof ApiError ? detail.error.message : tc("error")}{" "}
              <button type="button" className="underline" onClick={() => detail.refetch()}>
                {tc("retry")}
              </button>
            </p>
          )}
          {d && (
            <form
              key={d.id}
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const read = (k: string) => String(form.get(k) ?? "").trim();
                const body: Record<string, string> = {};
                const fields: Array<[string, string | null]> = [
                  ["name", d.name],
                  ["city", d.city],
                  ["state", d.state],
                  ["phone", d.phone],
                  ["email", d.email],
                  ["address_line1", d.address_line1],
                  ["gstin", d.gstin],
                  ["owner_phone", d.owner_phone],
                ];
                for (const [key, prev] of fields) {
                  const value = read(key);
                  if (value && value !== (prev ?? "")) body[key] = value;
                }
                if (Object.keys(body).length === 0) {
                  setOpen(false);
                  return;
                }
                mutation.mutate(body);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="eh-name">{t("hotelName")}</Label>
                <Input id="eh-name" name="name" defaultValue={d.name} required minLength={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="eh-city">{t("city")}</Label>
                  <Input id="eh-city" name="city" defaultValue={d.city ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eh-state">State</Label>
                  <Input id="eh-state" name="state" defaultValue={d.state ?? ""} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eh-address">Address</Label>
                <Input id="eh-address" name="address_line1" defaultValue={d.address_line1 ?? ""} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="eh-phone">{t("contactNumber")}</Label>
                  <Input id="eh-phone" name="phone" inputMode="tel" defaultValue={d.phone ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eh-email">Email</Label>
                  <Input id="eh-email" name="email" type="email" defaultValue={d.email ?? ""} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eh-gstin">GSTIN</Label>
                <Input
                  id="eh-gstin"
                  name="gstin"
                  defaultValue={d.gstin ?? ""}
                  placeholder="22AAAAA0000A1Z5"
                  className="font-mono uppercase"
                />
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("owner")}: {d.owner_name ?? "—"}{" "}
                  {d.owner_email ? `· ${d.owner_email}` : ""}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="eh-owner-phone">{t("ownerPhoneLabel")}</Label>
                  <Input
                    id="eh-owner-phone"
                    name="owner_phone"
                    inputMode="tel"
                    defaultValue={d.owner_phone ?? ""}
                    placeholder="10-digit mobile"
                  />
                </div>
              </div>
              {/* Subscription summary — read-only, sync via /admin/plans */}
              {d.subscription_plan_name && (
                <div className="rounded-lg border bg-info-bg px-3 py-2 text-xs space-y-0.5">
                  <p className="font-semibold text-info">
                    Plan: {d.subscription_plan_name}
                    {d.subscription_status ? ` · ${d.subscription_status}` : ""}
                  </p>
                  {d.subscription_expiry && (
                    <p className="text-info">Expires: {d.subscription_expiry}</p>
                  )}
                </div>
              )}
              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}
              <DialogFooter>
                <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm hover:bg-muted">
                  {tc("cancel")}
                </DialogClose>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? tc("saving") : tc("save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
