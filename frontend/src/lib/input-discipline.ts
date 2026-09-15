/**
 * Input discipline (plan Phase 5, client 15/09/2026).
 *
 * One place for every field-format rule in the product — phone digit caps,
 * per-ID-type number rules (Aadhaar/PAN/Passport/DL/Voter), and live name
 * capitalization. Apply these helpers in onChange handlers so EVERY screen
 * enforces identical discipline instead of each form improvising.
 */

/** Indian mobile numbers: exactly 10 digits. Strips non-digits and a leading
 *  0 / 91 country prefix while typing, then caps at 10. */
export function sanitizePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length > 10) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** Landline-tolerant variant (hotel front-desk numbers may include STD
 *  codes): digits only, capped at 12. */
export function sanitizeLandline(value: string): string {
  return value.replace(/\D/g, "").slice(0, 12);
}

/** Pincode: exactly 6 digits. */
export function sanitizePincode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export interface IdRule {
  /** Hard input cap. */
  maxLength: number;
  /** Keyboard hint. */
  inputMode: "numeric" | "text";
  /** Sanitize while typing (strip disallowed chars, case-fold). */
  sanitize: (value: string) => string;
  /** Full-value validity check (for optional soft warnings). */
  isComplete: (value: string) => boolean;
  placeholder: string;
}

const digits = (v: string) => v.replace(/\D/g, "");
const alnumUpper = (v: string) => v.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

/**
 * Per-ID-type rules (client: "aadhar card number then pan number then
 * passport … we need to manage discipline"):
 * - Aadhaar: 12 digits
 * - PAN: AAAAA9999A — 10 chars, auto-uppercase
 * - Passport (India): 1 letter + 7 digits = 8 chars, auto-uppercase
 * - Driving License: up to 16 alphanumeric, auto-uppercase
 * - Voter ID: AAA9999999 — 10 chars, auto-uppercase
 * Keys match the ID-type option values used across the product.
 */
export const ID_RULES: Record<string, IdRule> = {
  "Aadhar Card": {
    maxLength: 12,
    inputMode: "numeric",
    sanitize: (v) => digits(v).slice(0, 12),
    isComplete: (v) => /^\d{12}$/.test(v),
    placeholder: "123412341234",
  },
  "PAN Card": {
    maxLength: 10,
    inputMode: "text",
    sanitize: (v) => alnumUpper(v).slice(0, 10),
    isComplete: (v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(v),
    placeholder: "ABCDE1234F",
  },
  Passport: {
    maxLength: 8,
    inputMode: "text",
    sanitize: (v) => alnumUpper(v).slice(0, 8),
    isComplete: (v) => /^[A-Z]\d{7}$/.test(v),
    placeholder: "A1234567",
  },
  "Driving License": {
    maxLength: 16,
    inputMode: "text",
    sanitize: (v) => alnumUpper(v).slice(0, 16),
    isComplete: (v) => v.length >= 10,
    placeholder: "GJ0120260012345",
  },
  "Voter ID": {
    maxLength: 10,
    inputMode: "text",
    sanitize: (v) => alnumUpper(v).slice(0, 10),
    isComplete: (v) => /^[A-Z]{3}\d{7}$/.test(v),
    placeholder: "ABC1234567",
  },
};

/** Rule lookup tolerant of unknown/legacy type labels. */
export function idRuleFor(idType: string | null | undefined): IdRule {
  return (
    ID_RULES[idType ?? ""] ?? {
      maxLength: 20,
      inputMode: "text",
      sanitize: (v: string) => alnumUpper(v).slice(0, 20),
      isComplete: (v: string) => v.length >= 4,
      placeholder: "",
    }
  );
}

/**
 * Live Title Case for NAME fields (client: "while writing names first letter
 * auto capital"). Capitalizes the first letter of every word as typed while
 * preserving what the user already cased mid-word (so "McArthur" survives).
 * Works for city/state fields too.
 */
export function liveNameCase(value: string): string {
  // Only Latin lowercase needs lifting; Devanagari has no letter case.
  return value.replace(
    /(^|[\s.'-])([a-z])/g,
    (_m, sep: string, ch: string) => sep + ch.toUpperCase(),
  );
}
