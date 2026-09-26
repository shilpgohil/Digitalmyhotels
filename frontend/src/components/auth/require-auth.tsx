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
  const { status, user, memberships, activeHotelId } = useAuth();
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
    if (status !== "authenticated" || !user) return;

    // Temporary password check: must reset password before accessing any portal page
    if (user.must_reset_password) {
      router.replace("/change-password");
      return;
    }

    if (superAdminOnly && !user.is_super_admin) {
      // Non-super-admin tried to access an admin-only area.
      router.replace("/dashboard");
      return;
    }

    if (!superAdminOnly && user.is_super_admin) {
      // Super admin strayed into the partner portal — they have no hotel
      // membership so all partner API calls would fail with 403.
      router.replace("/admin");
      return;
    }

    // Hotel deactivated / suspended check: redirect to /suspended before children mount
    if (!superAdminOnly) {
      const activeMem =
        memberships.find((m) => m.hotel_id === activeHotelId) ?? memberships[0];
      if (activeMem?.hotel_status === "suspended") {
        router.replace("/suspended");
        return;
      }
    }
  }, [status, user, memberships, activeHotelId, superAdminOnly, router, pathname]);

  if (status !== "authenticated" || !user) return <FullPageSpinner />;
  if (user.must_reset_password) return <FullPageSpinner />;
  if (superAdminOnly && !user.is_super_admin) return <FullPageSpinner />;
  if (!superAdminOnly && user.is_super_admin) return <FullPageSpinner />;
  if (!superAdminOnly) {
    const activeMem =
      memberships.find((m) => m.hotel_id === activeHotelId) ?? memberships[0];
    if (activeMem?.hotel_status === "suspended") {
      return <FullPageSpinner />;
    }
  }
  return <>{children}</>;
}
