/**
 * formatStatus — ONE display formatter for status/enum values
 * (plan §7.4, client: `Expiring_soon` must render "Expiring Soon";
 * "Common Changes: First Letter Capital").
 *
 * snake_case / kebab-case / lowercase enums → spaced Title Case words,
 * with domain acronyms preserved. Never use raw enum values in JSX.
 */

const ACRONYMS: Record<string, string> = {
  upi: "UPI",
  gst: "GST",
  id: "ID",
  qr: "QR",
  pan: "PAN",
};

export function formatStatus(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replaceAll(/[_-]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
