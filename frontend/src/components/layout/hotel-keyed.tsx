"use client";

/**
 * HotelKeyed — remounts its subtree whenever the ACTIVE HOTEL changes.
 *
 * Why (plan §1.8, client 15/09/2026): switching hotels in the header does not
 * navigate, so page-level React state (a half-filled check-in form, selected
 * rooms, dialogs) survived the switch and could be SUBMITTED under the new
 * hotel's X-Hotel-Id — the same cross-tenant class as the draft leak.
 *
 * Keying on activeHotelId makes React discard and rebuild the whole page
 * subtree on switch: all form state resets, all queries mount fresh under the
 * new hotel. Switching hotels mid-form intentionally abandons the form (the
 * hotel-scoped draft feature is the supported way to keep unfinished work).
 *
 * display:contents keeps this wrapper out of the flex layout entirely.
 */

import { useAuth } from "@/lib/auth/auth-context";

export function HotelKeyed({ children }: { readonly children: React.ReactNode }) {
  const { activeHotelId } = useAuth();
  return (
    <div key={activeHotelId ?? "none"} className="contents">
      {children}
    </div>
  );
}
