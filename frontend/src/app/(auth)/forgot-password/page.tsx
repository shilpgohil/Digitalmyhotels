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

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, Send, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api/client";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/v1/auth/password-reset/request-admin", {
        method: "POST",
        body: { identifier: identifier.trim() },
        skipAuthRetry: true,
      });
      setSent(true);
    } catch (e) {
      // Show the server-provided message (e.g. "Email or Phone not found") as
      // an inline error rather than a toast so it's prominent (client #20).
      const msg = e instanceof ApiError ? e.message : t("requestFailed");
      setIdentifier(identifier); // keep the value so user can correct it
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 via-white to-amber-50/40 px-6">
      <div className="w-full max-w-md">
        <h1 className="font-display text-2xl text-foreground">{t("resetTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("hierarchicalResetIntro")}</p>

        {/* One-click request — notifies the right administrator (item 34). */}
        <div className="mt-6 rounded-xl border bg-white p-4 shadow-sm">
          {sent ? (
            <p className="text-sm font-medium text-success">{t("requestSent")}</p>
          ) : (
            <>
              <Label htmlFor="fp-identifier">{t("requestIdentifierLabel")}</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="fp-identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={t("requestIdentifierPlaceholder")}
                  disabled={busy}
                />
                {/* 42px to match the input height (client 09/2026) */}
                <Button
                  onClick={() => void submit()}
                  disabled={busy || identifier.trim().length < 3}
                  className="h-[42px] shrink-0 px-4"
                >
                  <Send className="mr-1.5 size-4" aria-hidden />
                  {t("requestReset")}
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t("requestIdentifierHint")}
              </p>
            </>
          )}
        </div>

        <div className="mt-4 space-y-3">
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
