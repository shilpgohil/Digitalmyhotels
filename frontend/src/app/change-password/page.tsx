"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";

function ChangePasswordForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      toast.success(t("passwordChanged"));
      router.replace(user?.is_super_admin ? "/admin" : "/dashboard");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl text-foreground">{t("changePasswordTitle")}</h1>
        {user?.must_reset_password && (
          <p className="mt-1 text-sm text-warning">{t("mustChangePassword")}</p>
        )}
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current">{t("currentPassword")}</Label>
            <Input
              id="current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next">{t("newPassword")}</Label>
            <Input
              id="next"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              disabled={busy}
            />
          </div>
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </div>
          )}
          <Button className="w-full" onClick={submit} disabled={!current || next.length < 8 || busy}>
            {t("changePassword")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <RequireAuth>
      <ChangePasswordForm />
    </RequireAuth>
  );
}
