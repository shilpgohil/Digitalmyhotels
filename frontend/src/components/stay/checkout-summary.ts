/**
 * Shared checkout settlement calculations.
 *
 * Pure functions used by both the CheckoutDialog (compact modal flow) and the
 * full-page checkout experience at /checkout. Keep this file free of React —
 * everything here must stay unit-testable and side-effect free.
 */

import type { ChargeOut, PaymentOut } from "@/types/money";

/** Parse a backend decimal string (or number) into a float, defaulting to 0. */
export function money(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) || 0 : v;
}

/** Format a number as whole-rupee Indian-locale currency, e.g. `₹1,235`.
 *  Matches backend ROUND_HALF_UP whole-rupee rounding (₹200.50 → ₹201). */
export function fmtMoney(v: number): string {
  if (!Number.isFinite(v)) return "₹0";
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

/** Human labels for extra-charge categories. */
export const CHARGE_LABELS: Record<string, string> = {
  food: "Food",
  laundry: "Laundry",
  room_service: "Room Service",
  extra_bed: "Extra Bed",
  minibar: "Minibar",
  transport: "Transport",
  restaurant: "Restaurant",
  damage: "Damage",
  other: "Other",
};

/** Charges that still count toward the bill (not voided). */
export function activeCharges(items: ChargeOut[] | undefined): ChargeOut[] {
  return (items ?? []).filter((c) => !c.voided_at);
}

/** Completed payments excluding security deposits (deposits are settled separately). */
export function nonDepositPayments(items: PaymentOut[] | undefined): PaymentOut[] {
  return (items ?? []).filter((p) => p.purpose !== "deposit" && p.status === "completed");
}

// NOTE: the old client-side `computeSettlement` bill engine was deliberately
// removed. Settlement is now priced exclusively by the server via
// POST /api/v1/checkouts/{booking_id}/quote — the screen must never do its
// own arithmetic (client audit 9-08, items 3/12/13/26/39).
