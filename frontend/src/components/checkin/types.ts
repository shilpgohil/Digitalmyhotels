/**
 * Shared types for check-in components.
 * Extracted from checkin/page.tsx to allow component-level imports.
 */

/** Service item from the hotel's service menu. */
export interface ServiceItem {
  id: string;
  name: string;
  price: string;
  is_active: boolean;
}

/** Which face of an ID document (or selfie) a tile handles. */
export type DocSide = "front" | "back" | "selfie";
