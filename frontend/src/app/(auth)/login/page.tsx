"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Loader2, Lock, User } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { AUTH_RETURN_KEY } from "@/components/auth/require-auth";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { status, user, login } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Redirect if already authenticated.
  useEffect(() => {
    if (status === "authenticated") {
      const returnTo =
        typeof window !== "undefined"
          ? sessionStorage.getItem(AUTH_RETURN_KEY)
          : null;
      sessionStorage.removeItem(AUTH_RETURN_KEY);
      router.replace(returnTo ?? (user?.is_super_admin ? "/admin" : "/dashboard"));
    }
  }, [status, user, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const loggedIn = await login(values.email, values.password);
      if (loggedIn.must_reset_password) {
        router.replace("/change-password");
        return;
      }
      const returnTo = sessionStorage.getItem(AUTH_RETURN_KEY);
      sessionStorage.removeItem(AUTH_RETURN_KEY);
      // Role-based routing: super admins → /admin, everyone else → /dashboard
      router.replace(
        returnTo ?? (loggedIn.is_super_admin ? "/admin" : "/dashboard"),
      );
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "invalid_credentials") setServerError(t("invalidCredentials"));
        else if (error.code === "account_disabled") setServerError(t("accountDisabled"));
        else setServerError(error.message);
      } else {
        const detail = error instanceof Error ? error.message : tc("error");
        setServerError(detail || tc("error"));
      }
    }
  });

  const submitting = form.formState.isSubmitting;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#f0f2f5] px-4">
      {/* Locale switcher — top-right */}
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>

      {/* Login card */}
      <div className="w-full max-w-[400px] rounded-2xl bg-white px-8 py-10 shadow-md">
        {/* Heading */}
        <div className="mb-7 text-center">
          <h1 className="font-display text-3xl font-bold text-foreground">
            {t("loginTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("loginSubtitle")}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {/* Email / Username */}
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              {t("email")}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <User className="size-4" aria-hidden />
              </span>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={t("emailPlaceholder")}
                aria-invalid={!!form.formState.errors.email}
                disabled={submitting}
                {...form.register("email")}
                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-navy-900/30 disabled:opacity-60"
              />
            </div>
            {form.formState.errors.email && (
              <p className="text-xs text-danger" role="alert">
                {tc("requiredField")}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-foreground">
              {t("password")}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <Lock className="size-4" aria-hidden />
              </span>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder={t("passwordPlaceholder")}
                aria-invalid={!!form.formState.errors.password}
                disabled={submitting}
                {...form.register("password")}
                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-navy-900/30 disabled:opacity-60"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
            {form.formState.errors.password && (
              <p className="text-xs text-danger" role="alert">
                {tc("requiredField")}
              </p>
            )}
          </div>

          {/* Server error */}
          {serverError && (
            <div
              className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2.5 text-sm text-danger"
              role="alert"
            >
              {serverError}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-navy-900 text-sm font-semibold text-white transition-colors hover:bg-navy-900/90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {submitting ? t("signingIn") : t("loginBtn")}
          </button>

          {/* Forgot password */}
          <p className="text-center">
            <a
              href="/forgot-password"
              className="text-sm text-muted-foreground underline hover:text-foreground transition-colors"
            >
              {t("forgotPassword")}
            </a>
          </p>
        </form>
      </div>

      {/* Footer */}
      <p className="mt-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} DigitalMyHotel Portal. All Rights Reserved.
      </p>
    </div>
  );
}
