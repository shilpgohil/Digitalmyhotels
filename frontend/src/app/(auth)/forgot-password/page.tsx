"use client";

/**
 * Password recovery is HIERARCHICAL (confirmed product decision, client 9-08
 * item 34): staff ask their hotel administrator; the hotel owner/administrator
 * asks the platform Super Admin. Every reset issues a temporary password,
 * revokes sessions and forces a change at next login — all server-side.
 *
 * The old public email-token flow was removed; this page now explains who to
 * contact so nobody is stranded on a dead form.
 */

import { useTranslations } from "next-intl";
import { KeyRound, ShieldCheck, Users } from "lucide-react";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <h1 className="font-display text-2xl text-foreground">{t("resetTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("hierarchicalResetIntro")}</p>

        <div className="mt-6 space-y-3">
          <div className="flex gap-3 rounded-xl border bg-muted/30 p-4">
            <Users className="mt-0.5 size-5 shrink-0 text-gold-600" aria-hidden />
            <div>
              <p className="text-sm font-semibold">{t("staffResetTitle")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("staffResetBody")}</p>
            </div>
          </div>
          <div className="flex gap-3 rounded-xl border bg-muted/30 p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold-600" aria-hidden />
            <div>
              <p className="text-sm font-semibold">{t("ownerResetTitle")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("ownerResetBody")}</p>
            </div>
          </div>
          <div className="flex gap-3 rounded-xl border bg-muted/30 p-4">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-gold-600" aria-hidden />
            <div>
              <p className="text-sm font-semibold">{t("tempPasswordTitle")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("tempPasswordBody")}</p>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center">
          <a href="/login" className="text-sm text-muted-foreground underline">
            {t("backToLogin")}
          </a>
        </p>
      </div>
    </div>
  );
}
