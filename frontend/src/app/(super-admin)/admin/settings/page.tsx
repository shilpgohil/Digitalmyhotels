"use client";

/**
 * Super Admin Settings (client 9-08 item 36):
 *  - Profile summary (name / email of the signed-in super admin)
 *  - Change Password (reuses the standard change-password flow)
 *  - "All Customers" feature toggle — shows/hides the cross-hotel customer
 *    directory in the sidebar. Per-admin UI preference (localStorage);
 *    the API itself stays super-admin-only and audited regardless.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, Pencil, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { SectionPanel } from "@/components/ui/section-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api/client";
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
      // The auth context caches the user — reload picks up the new name.
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
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ep-phone">{t("profilePhone")}</Label>
            <Input
              id="ep-phone"
              type="tel"
              maxLength={20}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <p className="text-label text-muted-foreground">{t("emailNotEditable")}</p>
          {error && (
            <p className="text-sm text-danger" role="alert">{error}</p>
          )}
        </div>
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm transition-colors hover:bg-muted">
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
    </main>
  );
}
