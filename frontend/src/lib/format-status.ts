/**
 * formatStatus — ONE display formatter for status/enum values
 * (plan §7.4, client: `Expiring_soon` must render "Expiring Soon";
 * "Common Changes: First Letter Capital").
 *
 * snake_case / kebab-case / lowercase enums → spaced Title Case words,
 * with domain acronyms preserved. When the active locale is Hindi ('hi')
 * or document.documentElement.lang === 'hi', returns the canonical
 * Hindi hospitality status translation.
 */

const ACRONYMS: Record<string, string> = {
  upi: "UPI",
  gst: "GST",
  id: "ID",
  qr: "QR",
  pan: "PAN",
};

const STATUS_HI: Record<string, string> = {
  // Room statuses
  available: "उपलब्ध",
  occupied: "अधिग्रहित",
  reserved: "आरक्षित",
  cleaning_required: "सफाई आवश्यक",
  cleaning_in_progress: "सफाई जारी",
  clean_ready: "सफाई पूर्ण",
  inspection_required: "निरीक्षण आवश्यक",
  maintenance: "रखरखाव",
  out_of_service: "सेवा से बाहर",

  // Booking & stay statuses
  checked_in: "चेक-इन",
  checked_out: "चेक-आउट",
  confirmed: "पुष्ट",
  pending: "लंबित",
  cancelled: "रद्द",
  completed: "पूर्ण",
  no_show: "नो-शो",
  draft: "प्रारूप",
  active: "सक्रिय",
  inactive: "निष्क्रिय",
  approved: "स्वीकृत",
  rejected: "अस्वीकृत",

  // Attendance & staff statuses
  present: "उपस्थित",
  absent: "अनुपस्थित",
  half_day: "आधा दिन",
  on_leave: "छुट्टी पर",
  working: "कार्यरत",
  not_checked_in: "चेक-इन नहीं",
  late: "देर से",
  early_departure: "जल्दी प्रस्थान",

  // Financial & payment statuses
  paid: "भुगतान पूर्ण",
  unpaid: "अदत्त",
  partially_paid: "आंशिक भुगतान",
  refunded: "वापस",
  failed: "विफल",
  collected: "प्राप्त",
  overdue: "अतिदेय",
  advance_paid: "अग्रिम भुगतान",

  // Expense & invoice statuses
  submitted: "प्रस्तुत",
  generated: "तैयार",
};

export function formatStatus(value: string | null | undefined, locale?: string): string {
  if (!value) return "—";

  const rawKey = value.toLowerCase().trim().replace(/[-\s]+/g, "_");
  const isHi =
    locale === "hi" ||
    (typeof document !== "undefined" && document.documentElement.lang === "hi");

  if (isHi && STATUS_HI[rawKey]) {
    return STATUS_HI[rawKey];
  }

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
