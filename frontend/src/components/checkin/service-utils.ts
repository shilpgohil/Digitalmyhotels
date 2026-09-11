/**
 * Pure utility functions for service/pricing calculations — shared between
 * checkin/page.tsx and the extracted ServiceChips / SelectedServicesList
 * components.
 */
import type { ServiceItem } from "@/components/checkin/types";

/**
 * Amount charged for a selected service chip — the staff-edited amount when
 * present and a valid non-negative number, else the service's fixed price.
 */
export function serviceChargeAmount(
  svc: ServiceItem,
  amounts: Record<string, string>,
): string {
  const edited = amounts[svc.id]?.trim();
  if (edited) {
    const parsed = Number.parseFloat(edited);
    if (Number.isFinite(parsed) && parsed >= 0) return edited;
  }
  return svc.price;
}

/** API decimal string ("150.00") → whole-rupee string ("150") for inputs. */
export function wholeRupees(price: string): string {
  return String(Math.round(Number(price) || 0));
}
