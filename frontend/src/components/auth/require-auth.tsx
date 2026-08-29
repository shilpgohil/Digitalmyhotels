"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { FullPageSpinner } from "@/components/feedback/full-page-spinner";

export const AUTH_RETURN_KEY = "dmh.auth.returnTo";

interface RequireAuthProps {
  children: ReactNode;
  /** When true, only super admins may enter (e.g. /admin). */
  superAdminOnly?: boolean;
}

export function RequireAuth({ children, superAdminOnly = false }: RequireAuthProps) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      // Remember where the user was so we can return them after login.
      if (typeof window !== "undefined" && pathname && pathname !== "/login") {
        sessionStorage.setItem(
          AUTH_RETURN_KEY,
          pathname + window.location.hash,
        );
      }
      router.replace("/login");
      return;
    }
    if (status !== "authenticated") return;

    if (superAdminOnly && !user?.is_super_admin) {
      // Non-super-admin tried to access an admin-only area.
      router.replace("/dashboard");
      return;
    }

    if (!superAdminOnly && user?.is_super_admin) {
      // Super admin strayed into the partner portal — they have no hotel
      // membership so all partner API calls would fail with 403.
      router.replace("/admin");
    }
  }, [status, user, superAdminOnly, router, pathname]);

  if (status !== "authenticated") return <FullPageSpinner />;
  if (superAdminOnly && !user?.is_super_admin) return <FullPageSpinner />;
  if (!superAdminOnly && user?.is_super_admin) return <FullPageSpinner />;
  return <>{children}</>;
}
