/**
 * Unified WhatsApp sharing utility for DigitalMyHotels.
 *
 * Handles:
 * 1. Indian & international phone number normalization (91 prefix for 10-digit Indian mobiles).
 * 2. Instant client-side PDF download with clean, professional filenames.
 * 3. Native Web Share API file attachment (attaches physical .pdf file on mobile devices).
 * 4. Opening WhatsApp directly to the customer's phone number with beautifully formatted,
 *    warm, and complete messages containing direct 1-click official PDF download links for:
 *    - Tax Invoices (in /invoices and /checkout)
 *    - Advance Booking Confirmation & Receipt Vouchers (in /advance-bookings)
 *    - Guest Registration Cards & Stay Slips (in /current-guests)
 */

export function normalizeWhatsAppPhone(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return null;

  // 12 digits starting with 91 (e.g. 919876543210)
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }
  // 10 digits standard Indian mobile number (e.g. 9876543210 -> 919876543210)
  if (digits.length === 10) {
    return `91${digits}`;
  }
  // 11 digits starting with 0 (e.g. 09876543210 -> 919876543210)
  if (digits.length === 11 && digits.startsWith("0")) {
    return `91${digits.slice(1)}`;
  }
  // International format with 10+ digits
  if (digits.length >= 10) {
    return digits;
  }
  return null;
}

export function downloadPdfBlob(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function getAbsolutePublicUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const origin = window.location.origin.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${cleanPath}`;
}

/**
 * Opens WhatsApp directly to the customer's chat with the pre-filled message.
 *
 * Uses the canonical, official Meta universal link: https://wa.me/<cleanPhone>?text=<encodedText>
 * - On Mobile (Android/iOS): App Links / Universal Links immediately open the native WhatsApp application
 *   directly into the customer's chat without opening WhatsApp Web.
 * - On Desktop: Seamlessly gives the choice to launch the WhatsApp Desktop app or use WhatsApp Web.
 * - Never forces web.whatsapp.com onto a mobile browser.
 */
export function openWhatsAppToCustomer(
  phone: string | null | undefined,
  message: string,
): { success: boolean; cleanPhone: string | null } {
  if (typeof window === "undefined") return { success: false, cleanPhone: null };
  const cleanPhone = normalizeWhatsAppPhone(phone);
  const encodedText = encodeURIComponent(message);

  const targetUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodedText}`
    : `https://wa.me/?text=${encodedText}`;

  // Check if running on a touch/mobile device
  const isMobile =
    typeof navigator !== "undefined" &&
    (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 1));

  if (isMobile) {
    // On mobile devices: direct window location navigation cleanly triggers iOS Universal Links
    // or Android App Links directly into the native WhatsApp app without leaving an empty browser tab
    window.location.href = targetUrl;
  } else {
    // On desktop: open in a new tab so the hotel management dashboard remains active
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }

  return { success: !!cleanPhone, cleanPhone };
}

export async function sharePdfFileViaNative(
  blob: Blob,
  filename: string,
  title: string,
  text: string,
): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  ) {
    try {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title,
          text,
        });
        return true;
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return true;
      return false;
    }
  }
  return false;
}

export interface InvoiceShareParams {
  hotelName: string;
  hotelPhone?: string | null;
  hotelAddress?: string | null;
  guestName: string;
  guestPhone?: string | null;
  invoiceNumber: string;
  bookingNumber?: string | null;
  roomNumbers?: string | null;
  checkInDate?: string | null;
  checkInTime?: string | null;
  checkOutDate?: string | null;
  checkOutTime?: string | null;
  nights?: number | null;
  roomCharges?: string | number | null;
  servicesCharges?: string | number | null;
  gstTotal?: string | number | null;
  totalAmount: string | number;
  paidAmount: string | number;
  dueAmount: string | number;
  paymentMethod?: string | null;
  pdfUrl?: string | null;
}

export function buildInvoiceWhatsAppMessage(p: InvoiceShareParams): string {
  const isPaid = Number(p.dueAmount || 0) <= 0;
  const paymentMethodStr = p.paymentMethod ? ` (${p.paymentMethod.toUpperCase()})` : "";
  const lines: string[] = [
    `Dear *${p.guestName || "Guest"}*,`,
    ``,
    `Greetings from *${p.hotelName}*! 🏨✨`,
    `Thank you for choosing to stay with us. Please find below the Tax Invoice summary for your recent stay:`,
    ``,
    `📄 *TAX INVOICE DETAILS*`,
    `• *Invoice No:* ${p.invoiceNumber}`,
  ];

  if (p.bookingNumber) {
    lines.push(`• *Booking ID:* ${p.bookingNumber}`);
  }
  if (p.roomNumbers) {
    lines.push(`• *Room(s):* ${p.roomNumbers}`);
  }
  if (p.checkInDate && p.checkOutDate) {
    const nightsStr = p.nights ? ` (${p.nights} Night${p.nights > 1 ? "s" : ""})` : "";
    lines.push(`• *Stay Dates:* ${p.checkInDate} to ${p.checkOutDate}${nightsStr}`);
  }
  lines.push(`• *Guest Name:* ${p.guestName || "Guest"}`);

  lines.push(``, `💳 *BILLING & PAYMENT SUMMARY*`);
  if (p.roomCharges !== undefined && p.roomCharges !== null) {
    lines.push(`• Room Tariff: ₹${p.roomCharges}`);
  }
  if (p.servicesCharges && Number(p.servicesCharges) > 0) {
    lines.push(`• Add-ons & Services: ₹${p.servicesCharges}`);
  }
  if (p.gstTotal && Number(p.gstTotal) > 0) {
    lines.push(`• GST / Taxes: ₹${p.gstTotal}`);
  }
  lines.push(`• *Total Amount:* ₹${p.totalAmount}`);
  lines.push(`• *Amount Paid:* ₹${p.paidAmount}${paymentMethodStr}`);

  if (isPaid) {
    lines.push(`• Payment Status: *Paid in Full ✅*`);
  } else {
    lines.push(`• *Balance Due:* ₹${p.dueAmount}`);
  }

  if (p.pdfUrl) {
    lines.push(
      ``,
      `📥 *VIEW / DOWNLOAD OFFICIAL TAX INVOICE (PDF):*`,
      `👉 ${p.pdfUrl}`,
    );
  } else {
    lines.push(
      ``,
      `📎 _Your official Tax Invoice PDF has been downloaded and is ready to attach for your records & tax filing._`,
    );
  }

  lines.push(
    ``,
    `For any questions or future reservations, please feel free to contact us:`,
  );
  if (p.hotelPhone) {
    lines.push(`📞 Phone: ${p.hotelPhone}`);
  }
  if (p.hotelAddress) {
    lines.push(`📍 Address: ${p.hotelAddress}`);
  }
  lines.push(``, `We look forward to welcoming you again! Have a safe and pleasant journey ahead! 🙏`);

  return lines.join("\n");
}

export interface AdvanceBookingShareParams {
  hotelName: string;
  hotelPhone?: string | null;
  hotelAddress?: string | null;
  guestName: string;
  guestPhone?: string | null;
  voucherNumber: string;
  checkInDate: string;
  checkInTime?: string | null;
  checkOutDate: string;
  checkOutTime?: string | null;
  nights?: number | null;
  roomNumbersOrType?: string | null;
  adults?: number | null;
  children?: number | null;
  totalEstimatedTariff: string | number;
  advancePaid: string | number;
  paymentMethod?: string | null;
  balanceDue: string | number;
  pdfUrl?: string | null;
}

export function buildAdvanceBookingWhatsAppMessage(p: AdvanceBookingShareParams): string {
  const payMethod = p.paymentMethod ? ` (${p.paymentMethod.toUpperCase()})` : "";
  const childrenStr = p.children ? `, ${p.children} Children` : "";
  const cinTime = p.checkInTime ? ` (${p.checkInTime})` : "";
  const coutTime = p.checkOutTime ? ` (${p.checkOutTime})` : "";
  const nightsStr = p.nights ? ` (${p.nights} Night${p.nights > 1 ? "s" : ""})` : "";

  const lines: string[] = [
    `Dear *${p.guestName || "Guest"}*,`,
    ``,
    `Greetings from *${p.hotelName}*! 🏨✨`,
    `We are delighted to confirm your room reservation. Your advance booking confirmation and receipt voucher details are below:`,
    ``,
    `📅 *RESERVATION DETAILS*`,
    `• *Booking ID / Voucher:* ${p.voucherNumber}`,
    `• *Guest Name:* ${p.guestName || "Guest"}`,
    `• *Check-In:* ${p.checkInDate}${cinTime}`,
    `• *Check-Out:* ${p.checkOutDate}${coutTime}`,
  ];

  if (p.nights) {
    lines.push(`• *Duration:* ${p.nights} Night(s)`);
  }
  if (p.roomNumbersOrType) {
    lines.push(`• *Room(s) / Type:* ${p.roomNumbersOrType}`);
  }
  lines.push(`• *Guests:* ${p.adults ?? 1} Adult(s)${childrenStr}`);

  lines.push(
    ``,
    `💰 *TARIFF & ADVANCE RECEIPT*`,
    `• Total Estimated Tariff: ₹${p.totalEstimatedTariff}`,
    `• *Advance Received:* ₹${p.advancePaid}${payMethod} ✅`,
    `• *Balance Due at Check-In:* ₹${p.balanceDue}`,
    ``,
    `ℹ️ *IMPORTANT CHECK-IN GUIDELINES*`,
    `• Valid Government Photo ID (Aadhaar / Passport / DL / Voter ID) is required for all adult guests at check-in.`,
    `• Standard Check-In: ${p.checkInTime || "12:00 PM"} | Check-Out: ${p.checkOutTime || "11:00 AM"}`,
  );

  if (p.pdfUrl) {
    lines.push(
      ``,
      `📥 *VIEW / DOWNLOAD OFFICIAL BOOKING VOUCHER (PDF):*`,
      `👉 ${p.pdfUrl}`,
    );
  } else {
    lines.push(
      ``,
      `📎 _Your official Advance Booking Confirmation & Receipt Voucher PDF has been downloaded and is ready to attach._`,
    );
  }

  lines.push(
    ``,
    `For directions, airport/station pickup, or special requests, please contact our front desk:`,
  );

  if (p.hotelPhone) {
    lines.push(`📞 Phone: ${p.hotelPhone}`);
  }
  if (p.hotelAddress) {
    lines.push(`📍 Address: ${p.hotelAddress}`);
  }
  lines.push(``, `We look forward to hosting you at ${p.hotelName}! 🌟`);

  return lines.join("\n");
}

export interface StaySlipShareParams {
  hotelName: string;
  hotelPhone?: string | null;
  hotelAddress?: string | null;
  guestName: string;
  guestPhone?: string | null;
  bookingNumber: string;
  roomNumbers: string;
  checkInDate: string;
  checkInTime?: string | null;
  checkOutDate: string;
  checkOutTime?: string | null;
  adults?: number | null;
  children?: number | null;
  totalAmount?: string | number | null;
  paidAmount?: string | number | null;
  dueAmount: string | number;
  paymentStatus?: string | null;
  pdfUrl?: string | null;
}

export function buildStaySlipWhatsAppMessage(p: StaySlipShareParams): string {
  const childrenStr = p.children ? `, ${p.children} Children` : "";
  const cinTime = p.checkInTime ? ` (${p.checkInTime})` : "";
  const coutTime = p.checkOutTime ? ` (${p.checkOutTime})` : "";

  const lines: string[] = [
    `Dear *${p.guestName || "Guest"}*,`,
    ``,
    `Welcome to *${p.hotelName}*! 🏨✨`,
    `We hope you are having a pleasant and comfortable stay with us. Here is your official Guest Registration Card & Stay summary:`,
    ``,
    `📋 *CURRENT STAY DETAILS*`,
    `• *Guest Name:* ${p.guestName || "Guest"}`,
    `• *Room Assigned:* ${p.roomNumbers}`,
    `• *Booking ID:* ${p.bookingNumber}`,
    `• *Check-In:* ${p.checkInDate}${cinTime}`,
    `• *Scheduled Check-Out:* ${p.checkOutDate}${coutTime}`,
    `• *Guests Registered:* ${p.adults ?? 1} Adult(s)${childrenStr}`,
    ``,
    `💳 *CURRENT FOLIO SUMMARY*`,
  ];

  if (p.totalAmount !== undefined && p.totalAmount !== null) {
    lines.push(`• Room Charges (Estimated): ₹${p.totalAmount}`);
  }
  if (p.paidAmount !== undefined && p.paidAmount !== null && Number(p.paidAmount) > 0) {
    lines.push(`• *Advance / Paid:* ₹${p.paidAmount} ✅`);
  }
  lines.push(`• *Current Balance Due:* ₹${p.dueAmount}`);
  if (p.paymentStatus) {
    lines.push(`• Folio Status: *${p.paymentStatus.toUpperCase()}*`);
  }

  if (p.pdfUrl) {
    lines.push(
      ``,
      `📥 *VIEW / DOWNLOAD OFFICIAL STAY REGISTRATION SLIP (PDF):*`,
      `👉 ${p.pdfUrl}`,
    );
  } else {
    lines.push(
      ``,
      `📎 _Your official Guest Registration Card & Stay Slip PDF has been downloaded and is ready to attach._`,
    );
  }

  lines.push(
    ``,
    `🛎️ *IN-STAY HOTEL ASSISTANCE*`,
    `• Front Desk / Room Service: Dial *9* from your room intercom or call *${p.hotelPhone || "Front Desk"}*`,
    `• High-Speed Wi-Fi is available across all rooms and lobby areas.`,
    `• Need housekeeping, fresh linens, or dining assistance? Our team is at your service 24/7!`,
    ``,
    `Please let us know if there is anything we can do to make your stay more comfortable. Enjoy your stay! 🙏`,
  );

  return lines.join("\n");
}
