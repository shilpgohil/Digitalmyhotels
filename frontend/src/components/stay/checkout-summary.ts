/**
 * Shared checkout settlement calculations.
 *
 * Pure functions used by both the CheckoutDialog (compact modal flow) and the
 * full-page checkout experience at /checkout. Keep this file free of React —
 * everything here must stay unit-testable and side-effect free.
 */

import type { BookingOut } from "@/types/stay";
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

export interface SettlementSummary {
  /** Booking total + late fee. */
  finalTotal: number;
  /** Advance recorded on the booking. */
  advancePaid: number;
  /** Security deposit recorded on the booking. */
  secDeposit: number;
  /** advancePaid + secDeposit — what the guest has effectively paid. */
  effectivePaid: number;
  /** Amount still owed by the guest (≥ 0). */
  balance: number;
  /** Amount owed back to the guest (≥ 0). */
  refundAmt: number;
  /** Sum of all active extra charges. */
  extraChargesTotal: number;
  /** Room-night portion of the booking total (total − extras − late fee). */
  roomChargesTotal: number;
}

/**
 * Compute the full settlement picture for a checkout.
 *
 * @param booking  Fresh booking (server-side totals include posted charges).
 * @param charges  Active (non-voided) charges for the booking.
 * @param lateFee  Late-checkout fee entered by staff (not yet on the booking).
 */
export function computeSettlement(
  booking: BookingOut | null | undefined,
  charges: ChargeOut[],
  lateFee: number,
): SettlementSummary {
  const finalTotal = money(booking?.total_amount) + lateFee;
  const advancePaid = money(booking?.advance_amount);
  const secDeposit = money(booking?.security_deposit);
  const effectivePaid = advancePaid + secDeposit;
  const balance = Math.max(finalTotal - effectivePaid, 0);
  const refundAmt = Math.max(effectivePaid - finalTotal, 0);
  const extraChargesTotal = charges.reduce((s, c) => s + money(c.total_amount), 0);
  const roomChargesTotal = money(booking?.total_amount) - extraChargesTotal - lateFee;
  return {
    finalTotal,
    advancePaid,
    secDeposit,
    effectivePaid,
    balance,
    refundAmt,
    extraChargesTotal,
    roomChargesTotal,
  };
}
