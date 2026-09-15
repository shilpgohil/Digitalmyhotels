/**
 * Cross-page cache invalidation (plan Part 6, client 15/09/2026).
 *
 * Root cause of "housekeeping marks Complete but check-in still shows
 * Cleaning Soon until refresh": every page invalidated only ITS OWN query
 * keys, so mutations never refreshed the other pages that display the same
 * room/money state. These helpers list every query-key FAMILY that mirrors
 * room state or money state anywhere in the partner app — call the matching
 * helper from any mutation that changes that state.
 *
 * Keys are invalidated by ROOT prefix (react-query prefix matching), which
 * is immune to per-key shape differences (with/without hotelId, filters…).
 * Safe cross-hotel: the cache is cleared on hotel switch (partner-header),
 * so only the active hotel's data is ever cached.
 */

import type { QueryClient } from "@tanstack/react-query";

/** Query families that render ROOM/OCCUPANCY state somewhere in the app. */
const ROOM_STATE_ROOTS = [
  "rooms",
  "room-status-summary",
  "room-availability",
  "hk-tasks",
  "maintenance",
  "smart-dashboard",
  "current-guests",
  "bookings",
] as const;

/** Query families that render MONEY state somewhere in the app. */
const MONEY_ROOTS = [
  "payments",
  "payment-summary",
  "payment-summary-today",
  "billing-history",
  "charges",
  "ledger",
  "invoices",
  "smart-dashboard",
  "current-guests",
  "bookings",
  "closing-today",
  "restaurant-billing",
] as const;

/** Call after any mutation that changes room status or occupancy
 *  (housekeeping, room status change, check-in/out, booking cancel/no-show,
 *  transfers, checkout reversal). */
export function invalidateRoomState(qc: QueryClient): void {
  for (const root of ROOM_STATE_ROOTS) {
    void qc.invalidateQueries({ queryKey: [root] });
  }
}

/** Call after any mutation that moves money (payments, refunds, corrections,
 *  charges, checkout, reversal, invoice generation/cancel). */
export function invalidateMoney(qc: QueryClient): void {
  for (const root of MONEY_ROOTS) {
    void qc.invalidateQueries({ queryKey: [root] });
  }
}
