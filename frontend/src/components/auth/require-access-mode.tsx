"use client";

/**
 * RequireAccessMode — route-level feature gate for the three hotel tiers.
 *
 * Usage:
 *   export default function StaffPage() {
 *     return (
 *       <RequireAccessMode mode="full">
 *         <StaffContent />
 *       </RequireAccessMode>
 *     );
 *   }
 *
 * If the hotel's access_mode is not in `allowed` the component redirects to
 * /dashboard immediately (client-side) without rendering children, preventing
 * any flash of restricted content.
 *
 * For the backend equivalent see require_access_mode() in app/api/deps.py —
 * both guards must agree for complete protection.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";

type AccessMode = "checkin_only" | "checkin_expense" | "full";

interface RequireAccessModeProps {
  /**
   * The minimum access_mode required to render children.
   * - "full": only hotels with the full tier (includes staff/attendance)
   * - "checkin_expense": hotels with checkin_expense OR full
   * - "checkin_only": all hotels (rarely needed — most features exist here)
   */
  mode: AccessMode;
  children: React.ReactNode;
}

/** True when `current` satisfies the `required` minimum tier. */
function satisfies(current: AccessMode, required: AccessMode): boolean {
  const ORDER: Record<AccessMode, number> = {
    checkin_only: 1,
    checkin_expense: 2,
    full: 3,
  };
  return ORDER[current] >= ORDER[required];
}

export function RequireAccessMode({ mode, children }: RequireAccessModeProps) {
  const { accessMode, status } = useAuth();
  const router = useRouter();

  const allowed = status === "authenticated" ? satisfies(accessMode, mode) : true;

  useEffect(() => {
    // Wait for auth to resolve before deciding — prevents redirect flicker on
    // hard refresh (status briefly "loading" before the session is restored).
    if (status !== "authenticated") return;
    if (!satisfies(accessMode, mode)) {
      router.replace("/dashboard");
    }
  }, [accessMode, mode, status, router]);

  // While auth is loading, or access is allowed: render children.
  // While being redirected: render nothing to prevent flash of content.
  if (status === "authenticated" && !allowed) return null;
  return <>{children}</>;
}
