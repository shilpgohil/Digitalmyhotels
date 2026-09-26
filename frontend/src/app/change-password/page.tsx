"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { apiFetch, ApiError } from "@/lib/api/client";
import { setCachedUser } from "@/lib/auth/session";

function ChangePasswordForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFirstTimeReset = !!user?.must_reset_password;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      toast.success(t("passwordChanged"));
      // Clear the stale cached user and refresh profile in memory.
      setCachedUser(null);
      const freshUser = await refreshUser();
      // Smooth router navigation without blank page reload.
      const target = freshUser?.is_super_admin ? "/admin" : "/dashboard";
      router.replace(target);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 via-white to-amber-50/40 px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl text-foreground">
          {isFirstTimeReset ? t("tempPasswordWelcome") : t("changePasswordTitle")}
        </h1>
        {isFirstTimeReset ? (
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            {t("tempPasswordSubtitle")}
          </p>
        ) : null}
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current">
              {isFirstTimeReset ? t("tempPasswordLabel") : t("currentPassword")}
            </Label>
            <PasswordInput
              id="current"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              disabled={busy}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next">
              {isFirstTimeReset ? t("permanentPasswordLabel") : t("newPassword")}
            </Label>
            <PasswordInput
              id="next"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              disabled={busy}
              autoComplete="new-password"
            />
          </div>
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </div>
          )}
          <Button
            className="h-[42px] w-full"
            onClick={submit}
            disabled={!current || next.length < 8 || busy}
          >
            {isFirstTimeReset ? t("setPasswordAndContinue") : t("changePassword")}
          </Button>
          {/* Go Back returns to Settings screen.
              Hidden during a FORCED reset so flow cannot be bypassed. */}
          {!isFirstTimeReset && (
            <Button
              variant="outline"
              className="h-[42px] w-full"
              disabled={busy}
              onClick={() =>
                router.push(user?.is_super_admin ? "/admin/settings" : "/settings")
              }
            >
              {t("goBack")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Minimal auth guard: just redirect to login if unauthenticated.
 *  Does NOT use RequireAuth because that would redirect super admins away
 *  from this page (partner-portal guard), breaking SA change-password. */
function ChangePasswordGuard({ children }: { readonly children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  if (status === "unauthenticated") {
    router.replace("/login");
    return null;
  }
  return <>{children}</>;
}

export default function ChangePasswordPage() {
  return (
    <ChangePasswordGuard>
      <ChangePasswordForm />
    </ChangePasswordGuard>
  );
}
