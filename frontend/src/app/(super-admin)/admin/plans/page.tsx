"use client";

/**
 * Super Admin plan management (client 9-08 item 27).
 *
 * - Lists every plan with active/inactive state.
 * - Inline edit: name, price, duration, trial days.
 * - Activate / deactivate — a deactivated plan disappears from the renewal
 *   "Choose Plan" list but is never deleted (existing subscriptions keep it).
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Power } from "lucide-react";
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
import { fmtINR } from "@/lib/formatting";
import type { SubscriptionPlanOut } from "@/types/money";

export default function AdminPlansPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SubscriptionPlanOut | null>(null);

  const plans = useQuery({
    queryKey: ["admin-plans", "all"],
    queryFn: () =>
      apiFetch<SubscriptionPlanOut[]>("/api/v1/super-admin/plans?include_inactive=true"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-plans"] });

  const toggleMutation = useMutation({
    mutationFn: (plan: SubscriptionPlanOut) =>
      apiFetch<SubscriptionPlanOut>(`/api/v1/super-admin/plans/${plan.id}`, {
        method: "PATCH",
        body: { is_active: !plan.is_active },
      }),
    onSuccess: (updated) => {
      toast.success(updated.is_active ? t("planActivated") : t("planDeactivated"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <main className="p-6 space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gold-600">
          {t("portal")}
        </p>
        <h1 className="text-2xl font-bold text-foreground">{t("plans")}</h1>
      </div>
      <div>
        {plans.isLoading && (
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        )}
        {plans.isError && (
          <p className="p-8 text-center text-sm text-danger">
            {plans.error instanceof ApiError ? plans.error.message : tc("error")}{" "}
            <button type="button" className="underline" onClick={() => plans.refetch()}>
              {tc("retry")}
            </button>
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.data?.map((p) => (
            <div
              key={p.id}
              className={`rounded-lg border bg-card p-5 ${p.is_active ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display text-xl">{p.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{p.code}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    p.is_active
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {p.is_active ? t("planActive") : t("planInactive")}
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{fmtINR(p.price)}</p>
              <p className="text-sm text-muted-foreground">
                {p.duration_days} {t("days")} · {p.trial_days} {t("trialDays")}
              </p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                  <Pencil className="size-3.5" aria-hidden />
                  {tc("edit")}
                </Button>
                <Button
                  size="sm"
                  variant={p.is_active ? "outline" : "default"}
                  className={p.is_active ? "text-danger hover:text-danger" : ""}
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(p)}
                >
                  <Power className="size-3.5" aria-hidden />
                  {p.is_active ? t("deactivatePlan") : t("activatePlan")}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <EditPlanDialog
          plan={editing}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      </div>
    </main>
  );
}

function EditPlanDialog({
  plan,
  onClose,
  onDone,
}: {
  readonly plan: SubscriptionPlanOut | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string | number> }) =>
      apiFetch<SubscriptionPlanOut>(`/api/v1/super-admin/plans/${id}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      toast.success(t("planUpdated"));
      setError(null);
      onClose();
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={plan !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tc("edit")} — {plan?.name}
          </DialogTitle>
        </DialogHeader>
        <form
          key={plan?.id ?? "none"}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!plan) return;
            const form = new FormData(e.currentTarget);
            mutation.mutate({
              id: plan.id,
              body: {
                name: String(form.get("name") || plan.name),
                price: String(form.get("price") || plan.price),
                duration_days: Number(form.get("duration_days") || plan.duration_days),
                trial_days: Number(form.get("trial_days") ?? plan.trial_days),
                // Feature list, one per line — rendered verbatim on the
                // hotel's Choose Your Plan page.
                description: String(form.get("description") ?? ""),
              },
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="pl-name">{t("planName")}</Label>
            <Input id="pl-name" name="name" defaultValue={plan?.name ?? ""} required minLength={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pl-price">{t("planPrice")}</Label>
              <Input
                id="pl-price"
                name="price"
                type="number"
                min={0}
                step="0.01"
                defaultValue={plan ? String(Math.round(Number(plan.price))) : ""}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-days">{t("days")}</Label>
              <Input
                id="pl-days"
                name="duration_days"
                type="number"
                min={1}
                max={3650}
                defaultValue={plan?.duration_days ?? ""}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-trial">{t("trialDays")}</Label>
              <Input
                id="pl-trial"
                name="trial_days"
                type="number"
                min={0}
                max={365}
                defaultValue={plan?.trial_days ?? 0}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-features">{t("planFeatures")}</Label>
            <textarea
              id="pl-features"
              name="description"
              defaultValue={plan?.description ?? ""}
              rows={6}
              placeholder={t("planFeaturesPlaceholder")}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold-500/30"
            />
            <p className="text-xs text-muted-foreground">{t("planFeaturesHint")}</p>
          </div>
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
      </DialogContent>
    </Dialog>
  );
}
