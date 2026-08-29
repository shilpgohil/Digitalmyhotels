"use client";

/**
 * RequirePermission — page-level permission guard.
 *
 * Wraps a page that requires the authenticated user to hold a specific
 * permission. If the user lacks it, they are redirected to their home page
 * instead of seeing a broken/403 UI.
 *
 * Usage:
 *   export default function ExpensesPage() {
 *     return (
 *       <RequirePermission permission={PERMISSIONS.expensesView}>
 *         ...
 *       </RequirePermission>
 *     );
 *   }
 *
 * This is a *supplementary* guard on top of RequireAuth (which is applied at
 * the layout level). It handles the case where a user directly navigates to a
 * URL that their role cannot access — the API enforces the real security, but
 * this gives a clean redirect rather than a broken page.
 */

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { FullPageSpinner } from "@/components/feedback/full-page-spinner";

interface RequirePermissionProps {
  children: ReactNode;
  /**
   * Permission code from PERMISSIONS map.
   * The user must hold this permission for their current hotel role.
   */
  permission: string;
  /**
   * Where to redirect when permission is denied.
   * Defaults to /dashboard (or /admin for super admins without hotel context).
   */
  redirectTo?: string;
}

export function RequirePermission({
  children,
  permission,
  redirectTo,
}: RequirePermissionProps) {
  const { status, user, can } = useAuth();
  const router = useRouter();

  const isLoading = status === "loading";
  const permitted = status === "authenticated" && can(permission);
  const denied = status === "authenticated" && !can(permission);

  useEffect(() => {
    if (denied) {
      // Redirect super admins who strayed into partner pages to their portal.
      const home = redirectTo ?? (user?.is_super_admin ? "/admin" : "/dashboard");
      router.replace(home);
    }
  }, [denied, redirectTo, user, router]);

  if (isLoading || denied) return <FullPageSpinner />;
  if (!permitted) return null;
  return <>{children}</>;
}
