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
import { KeyRound, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { SectionPanel } from "@/components/ui/section-panel";

// Internal flag — NOT exported (page files in App Router must only export `default`
// and reserved Next.js names; named utility exports cause build errors).
const ALL_CUSTOMERS_FLAG = "admin.allCustomersEnabled";

function readAllCustomersFlag(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ALL_CUSTOMERS_FLAG) === "1";
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
        <SectionPanel title={t("profileSection")} icon={ShieldCheck}>
          <div className="grid gap-1 text-sm">
            <p><span className="text-muted-foreground">{t("profileName")}: </span><span className="font-medium">{user?.full_name ?? "—"}</span></p>
            <p><span className="text-muted-foreground">{t("profileEmail")}: </span><span className="font-medium">{user?.email ?? "—"}</span></p>
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
