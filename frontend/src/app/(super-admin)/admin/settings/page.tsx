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

export const ALL_CUSTOMERS_FLAG = "admin.allCustomersEnabled";

export function readAllCustomersFlag(): boolean {
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
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gold-600">
          {t("portal")}
        </p>
        <h1 className="text-2xl font-bold text-foreground">{t("settings")}</h1>
      </div>
        {/* Profile */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-gold-600" aria-hidden />
            {t("profileSection")}
          </h2>
          <div className="mt-3 grid gap-1 text-sm">
            <p>
              <span className="text-muted-foreground">{t("profileName")}: </span>
              <span className="font-medium">{user?.full_name ?? "—"}</span>
            </p>
            <p>
              <span className="text-muted-foreground">{t("profileEmail")}: </span>
              <span className="font-medium">{user?.email ?? "—"}</span>
            </p>
          </div>
        </section>

        {/* Change password */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4 text-gold-600" aria-hidden />
            {t("changePasswordSection")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("changePasswordHint")}
          </p>
          <Link
            href="/change-password"
            className="mt-3 inline-flex h-9 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-900/90"
          >
            {t("changePasswordAction")}
          </Link>
        </section>

        {/* All Customers feature */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Users className="size-4 text-gold-600" aria-hidden />
                {t("allCustomersSection")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("allCustomersHint")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={allCustomers}
              onClick={() => toggle(!allCustomers)}
              className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors ${
                allCustomers
                  ? "border-gold-500 bg-gold-500"
                  : "border-input bg-muted"
              }`}
            >
              {/* left-0 anchor is required — without it the absolute knob has
                  no horizontal reference and renders misplaced. */}
              <span
                className={`absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                  allCustomers ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          {allCustomers && (
            <Link
              href="/admin/customers"
              className="mt-3 inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
            >
              {t("openAllCustomers")}
            </Link>
          )}
        </section>
    </main>
  );
}
