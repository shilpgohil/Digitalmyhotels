"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api/client";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestReset = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/auth/password-reset/request", {
        method: "POST",
        body: { email },
        skipAuthRetry: true,
      });
      setRequested(true);
      toast.success(t("resetRequested"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/auth/password-reset/confirm", {
        method: "POST",
        body: { token: token.trim(), new_password: newPassword },
        skipAuthRetry: true,
      });
      toast.success(t("resetDone"));
      router.replace("/login");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl text-foreground">{t("resetTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("resetSubtitle")}</p>

        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={requested || busy}
            />
          </div>
          {!requested && (
            <Button className="w-full" onClick={requestReset} disabled={!email || busy}>
              {t("sendResetToken")}
            </Button>
          )}
          {requested && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="token">{t("resetToken")}</Label>
                <Input
                  id="token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={busy}
                />
                <p className="text-xs text-muted-foreground">{t("resetTokenHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">{t("newPassword")}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
              <Button
                className="w-full"
                onClick={confirmReset}
                disabled={!token || newPassword.length < 8 || busy}
              >
                {t("resetPassword")}
              </Button>
            </>
          )}
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </div>
          )}
          <p className="text-center">
            <a href="/login" className="text-sm text-muted-foreground underline">
              {t("backToLogin")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
