"use client";

/**
 * Super Admin Settings (client 9-08 item 36):
 *  - Profile summary (name / email of the signed-in super admin)
 *  - Change Password (reuses the standard change-password flow)
 *  - "All Customers" feature toggle — shows/hides the cross-hotel customer
 *    directory in the sidebar. Per-admin UI preference (localStorage);
 *    the API itself stays super-admin-only and audited regardless.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle, CreditCard, KeyRound, Pencil, QrCode, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { SectionPanel } from "@/components/ui/section-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { liveNameCase, sanitizePhone } from "@/lib/input-discipline";
import { apiFetch, ApiError, API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { setCachedUser } from "@/lib/auth/session";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Internal flag — NOT exported (page files in App Router must only export `default`
// and reserved Next.js names; named utility exports cause build errors).
const ALL_CUSTOMERS_FLAG = "admin.allCustomersEnabled";

function readAllCustomersFlag(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ALL_CUSTOMERS_FLAG) === "1";
}

/** Edit own profile (name + phone) — client 09/2026 Settings Edit option. */
function EditProfileDialog() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form each time the dialog opens.
  useEffect(() => {
    if (open && user) {
      setFullName(user.full_name);
      setPhone(user.phone ?? "");
      setError(null);
    }
  }, [open, user]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/auth/me", {
        method: "PATCH",
        body: {
          full_name: fullName.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
      });
      toast.success(t("profileUpdated"));
      setOpen(false);
      // Bust the sessionStorage user cache so reload fetches fresh data,
      // not stale cached name. (Without this, the reload would re-apply
      // the old name from the cache — #11 profile edit missing invalidation.)
      setCachedUser(null);
      window.location.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-white px-2.5 text-sm font-medium transition-colors hover:bg-muted">
        <Pencil className="size-3.5" aria-hidden />
        {tc("edit")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editProfileTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ep-name">{t("profileName")}</Label>
            <Input
              id="ep-name"
              value={fullName}
              minLength={2}
              maxLength={200}
              onChange={(e) => setFullName(liveNameCase(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ep-phone">{t("profilePhone")}</Label>
            <Input
              id="ep-phone"
              type="tel"
              maxLength={10}
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(sanitizePhone(e.target.value))}
            />
          </div>
          <p className="text-label text-muted-foreground">{t("emailNotEditable")}</p>
          {error && (
            <p className="text-sm text-danger" role="alert">{error}</p>
          )}
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-[42px] items-center rounded-lg bg-[#d1d1d1] px-5 text-sm font-medium text-foreground hover:bg-[#bebebe] transition-colors">
            {tc("cancel")}
          </DialogClose>
          <Button disabled={fullName.trim().length < 2 || busy} onClick={() => void save()}>
            {busy ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * SA Platform Payment section — lets the Super Admin configure the platform
 * collection UPI ID so hotel owners can scan a QR and pay for their plans.
 * Same pattern as hotel Settings > Payments (UPI) tab.
 */
function PlatformPaymentSection() {
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const config = useQuery({
    queryKey: ["sa-platform-config"],
    queryFn: () => apiFetch<{ platform_upi_id: string | null; platform_upi_payee_name: string | null; configured: boolean }>(
      "/api/v1/super-admin/platform-config"
    ),
    staleTime: 60_000,
  });

  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [qrBlobUrl, setQrBlobUrl] = useState<string | null>(null);
  const [qrPolling, setQrPolling] = useState(false);
  const qrBlobRef = useRef<string | null>(null);

  // Seed from DB when loaded
  useEffect(() => {
    if (config.data) {
      setUpiId(config.data.platform_upi_id ?? "");
      setPayeeName(config.data.platform_upi_payee_name ?? "");
    }
  }, [config.data]);

  // Cleanup blob URL on unmount
  useEffect(() => () => { if (qrBlobRef.current) URL.revokeObjectURL(qrBlobRef.current); }, []);

  const fetchQrPreview = async () => {
    if (!upiId.trim()) return;
    setQrPolling(true);
    try {
      // Generate a preview QR from the first active plan (just for visual confirmation).
      // /subscriptions/plans returns a plain array (not { items: [...] }).
      const token = getAccessToken();
      const plansArr = await apiFetch<Array<{ id: string; price: string }>>("/api/v1/subscriptions/plans");
      const firstPlan = plansArr?.[0];
      if (!firstPlan) { setQrPolling(false); return; }
      const resp = await fetch(
        `${API_BASE}/api/v1/subscriptions/payment-qr?plan_id=${firstPlan.id}`,
        { headers: { Authorization: `Bearer ${token ?? ""}` }, credentials: "include" }
      );
      if (!resp.ok) { setQrPolling(false); return; }
      if (qrBlobRef.current) URL.revokeObjectURL(qrBlobRef.current);
      const url = URL.createObjectURL(await resp.blob());
      qrBlobRef.current = url;
      setQrBlobUrl(url);
    } finally {
      setQrPolling(false);
    }
  };

  const save = useMutation({
    mutationFn: () => apiFetch("/api/v1/super-admin/platform-config", {
      method: "PUT",
      body: {
        platform_upi_id: upiId.trim() || null,
        platform_upi_payee_name: payeeName.trim() || null,
      },
    }),
    onSuccess: () => {
      toast.success("Platform UPI saved — hotel owners can now scan to pay.");
      queryClient.invalidateQueries({ queryKey: ["sa-platform-config"] });
      void fetchQrPreview();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <SectionPanel
      title="Platform Payment (UPI)"
      icon={CreditCard}
      subtitle="Hotel owners scan this QR to pay for plan renewals. Enter your platform UPI ID here."
    >
      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="sa-payee">Payee Name (shown on guest&apos;s UPI app)</Label>
              <Input
                id="sa-payee"
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                placeholder="DigitalMyHotels"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sa-upi">Platform UPI ID / VPA *</Label>
              <Input
                id="sa-upi"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="business@okhdfc"
                required
              />
              <p className="text-label text-muted-foreground">
                Hotel owners pay this VPA when upgrading or renewing their plans.
              </p>
            </div>
            <Button type="submit" disabled={save.isPending || !upiId.trim()}>
              {save.isPending ? "Saving…" : "Save & Generate QR"}
            </Button>
          </form>
        </div>

        {/* QR preview */}
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-muted/20 p-4 text-center min-w-[160px]">
          {config.isLoading ? (
            <Skeleton className="size-36 rounded-md" />
          ) : qrBlobUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrBlobUrl} alt="Platform UPI QR" className="size-36 rounded-md border" />
              <p className="text-micro text-success font-semibold flex items-center gap-1">
                <CheckCircle className="size-3.5" aria-hidden /> QR Ready
              </p>
            </>
          ) : qrPolling ? (
            <>
              <Skeleton className="size-36 rounded-md" />
              <p className="text-micro text-muted-foreground animate-pulse">Generating…</p>
            </>
          ) : (
            <>
              <QrCode className="size-12 text-muted-foreground/40" aria-hidden />
              <p className="text-micro text-muted-foreground leading-tight max-w-[120px]">
                {config.data?.configured
                  ? "Click Save to regenerate QR"
                  : "Enter your UPI ID and save to generate QR"}
              </p>
            </>
          )}
        </div>
      </div>
    </SectionPanel>
  );
}

export default function AdminSettingsPage() {
  const t = useTranslations("admin");
  const { user } = useAuth();
  const [allCustomers, setAllCustomers] = useState(false);

  useEffect(() => {
    setAllCustomers(readAllCustomersFlag());
  }, []);

  const toggle = (next: boolean) => {
    setAllCustomers(next);
    window.localStorage.setItem(ALL_CUSTOMERS_FLAG, next ? "1" : "0");
    // Same-tab listeners (sidebar) don't get "storage" events — dispatch one.
    window.dispatchEvent(new StorageEvent("storage", { key: ALL_CUSTOMERS_FLAG }));
  };

  return (
    <main className="max-w-2xl space-y-4 p-6">
      <div>
        <p className="text-micro font-semibold uppercase tracking-widest text-gold-600">
          {t("portal")}
        </p>
        <h1 className="text-2xl font-bold text-foreground">{t("settings")}</h1>
      </div>
        <SectionPanel
          title={t("profileSection")}
          icon={ShieldCheck}
          action={<EditProfileDialog />}
        >
          <div className="grid gap-1 text-sm">
            <p><span className="text-muted-foreground">{t("profileName")}: </span><span className="font-medium">{user?.full_name ?? "—"}</span></p>
            <p><span className="text-muted-foreground">{t("profileEmail")}: </span><span className="font-medium">{user?.email ?? "—"}</span></p>
            {user?.phone && (
              <p><span className="text-muted-foreground">{t("profilePhone")}: </span><span className="font-medium">{user.phone}</span></p>
            )}
          </div>
        </SectionPanel>

        <SectionPanel title={t("changePasswordSection")} icon={KeyRound} subtitle={t("changePasswordHint")}>
    <Link href="/change-password" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80">
            {t("changePasswordAction")}
          </Link>
        </SectionPanel>

        <SectionPanel
          title={t("allCustomersSection")}
          icon={Users}
          subtitle={t("allCustomersHint")}
          action={
            <button
              type="button"
              role="switch"
              aria-checked={allCustomers}
              aria-label={t("allCustomersSection")}
              onClick={() => toggle(!allCustomers)}
              className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors ${allCustomers ? "border-gold-500 bg-gold-500" : "border-input bg-muted"}`}
            >
              <span className={`absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${allCustomers ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </button>
          }
        >
          {allCustomers && (
            <Link href="/admin/customers" className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
              {t("openAllCustomers")}
            </Link>
          )}
        </SectionPanel>

        {/* ── Platform UPI (subscription payment QR) ─────────────────── */}
        <PlatformPaymentSection />
    </main>
  );
}
