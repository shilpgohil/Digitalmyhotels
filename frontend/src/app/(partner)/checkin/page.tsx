"use client";

/**
 * Guest Check-in — unified flow (client's new admin flow).
 *
 * MODE A — Walk-in Check-in (DEFAULT when no booking is selected):
 *   The check-in page IS the booking. One long form:
 *     1. Booking Details (dates + times + guest type)
 *     2. Primary Guest Identity (guest picker + editable fields + ID docs + OCR)
 *     3. Additional Guests
 *     4. Room Information (date-aware availability + adults/children counters)
 *     5. Special Requirements / Instructions
 *     6. Payment Details (advance collection only — new booking, nothing paid yet)
 *     7. Emergency Contact + Vehicle Details
 *   Single "Check In" button → POST /api/v1/checkins/book-and-checkin
 *   (books AND checks in atomically), then charges + advance payment.
 *
 * MODE B — Existing-booking check-in (?booking=<id> deep link, or a card from
 *   the arrivals strip): the original CheckinForm flow, unchanged — checks in
 *   an existing confirmed booking via POST /api/v1/checkins.
 *
 * The arrivals strip at the top shows confirmed bookings as compact clickable
 * cards (up to 10 with a "more" toggle); clicking one enters MODE B.
 *
 * MODE B mutation sequence (unchanged):
 *  1. PATCH /guests/{primary_guest_id}  — if any primary-guest field changed
 *  2. POST /guests per new additional guest
 *  3. Upload docs for primary + additional guests
 *  4. PATCH /bookings/{id}             — emergency contact + vehicle + adults/children
 *  5. POST /checkins                   — with resolved co-guest IDs
 *  6. POST /charges                    — for each selected service
 *  7. POST /payments                   — if advance payment > 0
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    ArrowLeft,
  BadgeCheck,
  BedDouble,
  Camera,
  Car,
  ChevronDown,
  Clock,
  Globe,
  CreditCard,
  FileText,
  LogIn,
  Minus,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
  AlertTriangle,
  ClipboardList,
  Star,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { GuestPicker } from "@/components/guests/guest-picker";
import { RoomAvailabilityPicker } from "@/components/rooms/room-availability-picker";
import { useApi } from "@/lib/api/use-api";
import { invalidateMoney, invalidateRoomState } from "@/lib/query-invalidation";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE, ApiError, apiUpload } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { docAspectFor, useImageEditor } from "@/components/media/image-editor";
import { compressDocument } from "@/lib/compress-image";
import { fmtApiDate, fmtApiDateTime, fmtINR, localToday, localTomorrow } from "@/lib/formatting"; // eslint-disable-line @typescript-eslint/no-unused-vars
import { cn } from "@/lib/utils";
import type { ListOut, RoomAvailableItem } from "@/types/hotel";
import type {
  BookAndCheckInRequest,
  BookingOut,
  CheckInChargeIn,
  CheckInCreateOut,
  CheckInRequest,
  CoGuestIn,
  ForeignGuestIn,
  GuestAutofill,
  GuestCreatePayload,
  GuestOut,
  GuestSearchResult,
  RoomRateOverride,
} from "@/types/stay";
import { GUEST_TYPES } from "@/types/stay";
import type { GuestType } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { MaskedIdInput } from "@/components/checkin/masked-id-input";
import { liveNameCase, sanitizeGuestPhone, sanitizeAadhaarOcr, isIdMask } from "@/lib/input-discipline";
import { InlineCameraCapture } from "@/components/checkin/inline-camera-capture";
import { UpiQrBlock } from "@/components/checkin/upi-qr-block";
import { CollapsibleSection } from "@/components/checkin/collapsible-section";
import { RoomReplaceControl } from "@/components/checkin/room-replace-control";
import { SelectedServicesList } from "@/components/checkin/selected-services-list";
import { ServiceChips } from "@/components/checkin/service-chips";
import { AutofillBanner } from "@/components/checkin/autofill-banner";
import { serviceChargeAmount } from "@/components/checkin/service-utils";
import type { ServiceItem, DocSide } from "@/components/checkin/types";

// ─── Interfaces ─────────────────────────────────────────────────────────────
// DocSide + ServiceItem → src/components/checkin/types.ts (imported above)

/** A resolved additional guest ready to be passed to POST /checkins. */
interface ResolvedCoGuest {
  guest_id: string;
  full_name: string;
  /** Resolved phone — shown on the guest card (client 9-08 item 9). */
  phone?: string;
  /** Booking-only contact phone override — does NOT change master guest record.
   *  Used when a family member wants a different phone registered for this stay. */
  alternate_contact_phone?: string;
  /** Docs queued for upload after guest is created/resolved.
   *  `key` is set when the file already lives in draft storage — re-save
   *  reuses it instead of uploading a second copy. */
  docs: { side: DocSide; file: File; key?: string }[];
  /** Form C details when this co-guest is a foreign national. */
  foreign_guest?: ForeignGuestIn | null;
}

/** Editable Form C fields — all strings so inputs stay controlled. */
interface ForeignGuestFormState {
  passport_number: string;
  passport_place_of_issue: string;
  passport_expiry: string;
  visa_number: string;
  visa_type: string;
  visa_place_of_issue: string;
  visa_expiry: string;
  place_of_birth: string;
  country_of_birth: string;
  nationality: string;
  arrived_in_india_on: string;
  arrival_place: string;
  coming_from_city: string;
  coming_from_country: string;
  next_destination: string;
  next_destination_country: string;
  purpose_of_visit: string;
}

const EMPTY_FOREIGN_GUEST: ForeignGuestFormState = {
  passport_number: "",
  passport_place_of_issue: "",
  passport_expiry: "",
  visa_number: "",
  visa_type: "",
  visa_place_of_issue: "",
  visa_expiry: "",
  place_of_birth: "",
  country_of_birth: "",
  nationality: "",
  arrived_in_india_on: "",
  arrival_place: "",
  coming_from_city: "",
  coming_from_country: "",
  next_destination: "",
  next_destination_country: "",
  purpose_of_visit: "",
};

/** Build the API foreign_guest payload from the form state (null when disabled). */
function buildForeignGuestPayload(
  enabled: boolean,
  f: ForeignGuestFormState,
): ForeignGuestIn | null {
  if (!enabled) return null;
  const opt = (v: string) => v.trim() || null;
  return {
    passport_number: f.passport_number.trim(),
    passport_place_of_issue: opt(f.passport_place_of_issue),
    passport_expiry: opt(f.passport_expiry),
    visa_number: opt(f.visa_number),
    visa_type: opt(f.visa_type),
    visa_place_of_issue: opt(f.visa_place_of_issue),
    visa_expiry: opt(f.visa_expiry),
    place_of_birth: opt(f.place_of_birth),
    country_of_birth: opt(f.country_of_birth),
    nationality: opt(f.nationality),
    arrived_in_india_on: opt(f.arrived_in_india_on),
    arrival_place: opt(f.arrival_place),
    coming_from_city: opt(f.coming_from_city),
    coming_from_country: opt(f.coming_from_country),
    next_destination: opt(f.next_destination),
    next_destination_country: opt(f.next_destination_country),
    purpose_of_visit: opt(f.purpose_of_visit),
  };
}

// ─── Walk-in drafts (localStorage) ───────────────────────────────────────────
// Multiple drafts are kept (client 09/2026: "only the last draft stays" was a
// bug — every saved draft must survive until restored+checked-in or discarded).
//
// TENANT ISOLATION (client 15/09/2026, plan §1.1): drafts are stored PER HOTEL.
// The old v2/v1 keys were global — drafts from Hotel A appeared under Hotel B on
// the same browser. v3 keys embed the hotel id; on first read for a hotel, any
// remaining GLOBAL drafts are adopted into that hotel once (they were almost
// certainly created there — single-hotel devices are the normal case) and the
// global keys are deleted so no other hotel can ever see them.

/** Hotel-scoped drafts key (v3). */
const draftsKey = (hotelId: string) => `dmh.checkinDrafts.v3:${hotelId}`;
/** Pre-isolation GLOBAL keys — migrated into the active hotel's v3 list once. */
const GLOBAL_DRAFTS_KEY_V2 = "dmh.checkinDrafts.v2";
const GLOBAL_DRAFT_KEY_V1 = "dmh.checkinDraft.v1";
const MAX_DRAFTS = 10;

/** Serialized walk-in form state saved to localStorage via "Save Draft". */
interface CheckinDraft {
  /** Unique per saved draft (missing on legacy drafts — backfilled on read). */
  id?: string;
  savedAt: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  guestType: GuestType | "";
  guest: { id: string; full_name: string; phone: string } | null;
  selectedRooms: string[];
  adultsCount: number;
  childCount: number;
  specialInstructions: string;
  selectedServices: string[];
  advanceAmount: string;
  paymentMode: "cash" | "upi" | "credit_card" | "debit_card" | "bank_transfer" | "other";
  /** Money state — MUST round-trip or a collected advance silently vanishes
   *  on restore (client-reported). All optional for old-draft compatibility. */
  paymentReceived?: boolean;
  extraCharges?: string;
  /** Staff-edited service chip amounts, keyed by service id. */
  serviceAmounts?: Record<string, string>;
  /** Staff-edited room rates, keyed by room id. */
  rateEdits?: Record<string, string>;
  /** Snapshot of room prices at draft-save time (room_id → displayed amount).
   *  Used as fallback when the availability query can't price rooms at restore
   *  time (e.g. draft has past dates, or rooms are now occupied). Without this
   *  the "Room Rent" cell shows "—" after restoring. */
  roomPriceSnapshot?: Record<string, number>;
  terms?: boolean;
  emName: string;
  emRelation: string;
  emPhone: string;
  vehNumber: string;
  vehType: string;
  /** Free-text vehicle type name when vehType is "Other". */
  vehTypeOther?: string;
  vehMake: string;
  parkingSlot: string;
  pgCompany: string;
  foreignEnabled: boolean;
  foreignGuest: ForeignGuestFormState;
  /** Additional guests (plan §4.2 + client 16/09). Queued photo FILES cannot
   *  live in localStorage, so "Save Draft" uploads them to hotel-scoped B2
   *  draft storage and only their object KEYS are stored here; restore
   *  re-downloads them into the tiles. */
  coGuests?: {
    guest_id: string;
    full_name: string;
    phone?: string;
    newForm?: GuestCreatePayload;
    foreign_guest?: ForeignGuestIn | null;
    /** Server-persisted draft photos: side → storage object key. */
    draft_docs?: { side: DocSide; key: string }[];
  }[];
}

/** Every draft-photo key referenced by a draft (for cleanup on discard). */
function draftDocKeys(d: CheckinDraft): string[] {
  return (d.coGuests ?? []).flatMap((cg) => (cg.draft_docs ?? []).map((x) => x.key));
}

function draftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Parse a stored draft list, tolerating corrupt/legacy shapes. */
function parseDraftList(raw: string | null): CheckinDraft[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as CheckinDraft[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Read the ACTIVE HOTEL's drafts (newest first), adopting any pre-isolation
 *  global drafts into this hotel exactly once (plan §1.1 migration). */
function readDrafts(hotelId: string | null): CheckinDraft[] {
  if (!hotelId) return [];
  try {
    const list = parseDraftList(localStorage.getItem(draftsKey(hotelId)));

    // One-time migration of the old GLOBAL keys (v2 list + v1 single draft).
    // After adoption the global keys are removed so no other hotel sees them.
    const globalV2 = localStorage.getItem(GLOBAL_DRAFTS_KEY_V2);
    const globalV1 = localStorage.getItem(GLOBAL_DRAFT_KEY_V1);
    if (globalV2 || globalV1) {
      list.push(...parseDraftList(globalV2));
      if (globalV1) {
        try {
          const legacy = JSON.parse(globalV1) as CheckinDraft;
          list.push(legacy);
        } catch {
          // corrupt legacy draft — drop it
        }
      }
      localStorage.removeItem(GLOBAL_DRAFTS_KEY_V2);
      localStorage.removeItem(GLOBAL_DRAFT_KEY_V1);
      // Backfill ids BEFORE persisting so adopted drafts keep stable ids
      // across reloads (discard-by-id stays reliable in every tab).
      for (const d of list) d.id = d.id ?? draftId();
      localStorage.setItem(draftsKey(hotelId), JSON.stringify(list));
    }

    // Backfill ids for any old entries so per-draft discard always works.
    for (const d of list) d.id = d.id ?? draftId();
    return list.slice(0, MAX_DRAFTS);
  } catch {
    return [];
  }
}

function writeDrafts(hotelId: string | null, list: CheckinDraft[]): void {
  if (!hotelId) return;
  try {
    localStorage.setItem(draftsKey(hotelId), JSON.stringify(list));
  } catch {
    // storage full/blocked — non-fatal
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Pure state-updater factory shared by both check-in forms: writes `guest`
 * into the co-guest slot matching `key`'s position within `keys`.
 */
function resolveCoGuestUpdater(keys: number[], key: number, guest: ResolvedCoGuest) {
  return (prev: ResolvedCoGuest[]): ResolvedCoGuest[] => {
    const idx = keys.indexOf(key);
    const next = [...prev];
    next[idx] = guest;
    return next;
  };
}

/**
 * Pure helper — computes early check-in fee based on chosen vs standard time.
 * Returns 0 when on-time, within grace, or if rate is 0.
 */
function calcEarlyCheckinFee(
  chosenTime: string,       // "HH:MM"
  standardTime: string,     // "HH:MM" or "HH:MM:SS"
  graceMinutes: number,
  ratePerHour: number,
): number {
  const [ch, cm] = chosenTime.split(":").map(Number);
  const [sh, sm] = standardTime.split(":").map(Number);
  if ([ch, cm, sh, sm].some((n) => !Number.isFinite(n))) return 0;
  const chosenMins = ch * 60 + cm;
  const standardMins = sh * 60 + sm;
  if (chosenMins >= standardMins) return 0;
  const earlyMins = standardMins - chosenMins;
  if (earlyMins <= graceMinutes) return 0;
  const billableHours = Math.ceil((earlyMins - graceMinutes) / 60);
  return billableHours * ratePerHour;
}

/** Fixed values of the vehicle-type select (i18n only changes the labels). */
const VEHICLE_TYPE_OPTIONS = ["Car", "Bike", "Auto", "Taxi", "Bus", "Other"];

/** Current local time rounded UP to the next 5 minutes, as "HH:MM". */
function nowRoundedUpTo5(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + ((5 - (d.getMinutes() % 5)) % 5), 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// wholeRupees → src/components/checkin/service-utils.ts (imported above)

/** "HH:MM" → minutes since midnight; NaN when malformed. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
}

/**
 * Resolve the vehicle_type value sent to the API: the select value as-is,
 * or — when "Other" is chosen — the staff-entered type name (max 40 chars).
 */
function effectiveVehicleType(vehType: string, otherName: string): string {
  if (vehType !== "Other") return vehType;
  return otherName.trim().slice(0, 40) || "Other";
}

// serviceChargeAmount → src/components/checkin/service-utils.ts (imported above)

// maskIdValue + MaskedIdInput → src/components/checkin/masked-id-input.tsx

// RoomReplaceControl → src/components/checkin/room-replace-control.tsx

// RevealIdButton → src/components/checkin/reveal-id-button.tsx

/**
 * Inline camera view for desktop selfie capture — opens the front camera via
 * getUserMedia, captures a frame to canvas and returns it as a File.
 */
// InlineCameraCapture → src/components/checkin/inline-camera-capture.tsx

/** "Selected special requirements" summary — shows name + ₹amount per chip
 *  (staff-edited amount when present, else the service's fixed price). */
// SelectedServicesList → src/components/checkin/selected-services-list.tsx

/**
 * Service chips row with per-chip editable amount — when a chip is selected a
 * small numeric input appears next to it, prefilled with the service price;
 * edits flow into the atomic `charges` array at submit time.
 */
// ServiceChips → src/components/checkin/service-chips.tsx

/**
 * Foreign Guest (Form C) — checkbox that reveals passport/visa/journey fields
 * grouped per the FRRO Form C layout. State lives in the parent form.
 */
function ForeignGuestSection({
  enabled,
  onEnabledChange,
  value,
  onChange,
}: {
  readonly enabled: boolean;
  readonly onEnabledChange: (v: boolean) => void;
  readonly value: ForeignGuestFormState;
  readonly onChange: (v: ForeignGuestFormState) => void;
}) {
  const t = useTranslations("checkin");
  const ts = useTranslations("stay");
  const set = (k: keyof ForeignGuestFormState, v: string) =>
    onChange({ ...value, [k]: v });

  const lbl = "text-label font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          className="size-4 rounded border-input"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        <span className="font-medium">{t("foreignGuestToggle")}</span>
      </label>

      {enabled && (
        <div className="rounded-xl border bg-muted/10 p-4 space-y-5">
          <div className="flex items-center gap-2">
            <Globe className="size-4 text-gold-600" aria-hidden />
            <p className="text-sm font-semibold">{t("foreignGuestDetails")}</p>
          </div>

          {/* Passport */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("passport")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className={lbl}>{t("passportNumber")} *</Label>
                <Input
                  value={value.passport_number}
                  onChange={(e) => set("passport_number", e.target.value)}
                  placeholder={t("passportNumber")}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("placeOfIssue")}</Label>
                <Input
                  value={value.passport_place_of_issue}
                  onChange={(e) => set("passport_place_of_issue", e.target.value)}
                  placeholder={t("placeOfIssue")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("passportExpiry")}</Label>
                {/* Valid document required: expiry ≥ today, selectable 15 y out
                    (client 9-08 item 6 — picker previously capped at +5 y). */}
                <DatePicker
                  value={value.passport_expiry}
                  onChange={(v) => set("passport_expiry", v)}
                  min={localToday()}
                />
              </div>
            </div>
          </div>

          {/* Visa */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("visa")}</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label className={lbl}>{t("visaNumber")}</Label>
                <Input
                  value={value.visa_number}
                  onChange={(e) => set("visa_number", e.target.value)}
                  placeholder={t("visaNumber")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("visaType")}</Label>
                <select
                  value={value.visa_type}
                  onChange={(e) => set("visa_type", e.target.value)}
                  className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                >
                  <option value="">{t("selectOption")}</option>
                  <option value="Tourist">{t("visa_tourist")}</option>
                  <option value="Business">{t("visa_business")}</option>
                  <option value="Medical">{t("visa_medical")}</option>
                  <option value="Student">{t("visa_student")}</option>
                  <option value="Employment">{t("visa_employment")}</option>
                  <option value="Other">{t("visa_other")}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("placeOfIssue")}</Label>
                <Input
                  value={value.visa_place_of_issue}
                  onChange={(e) => set("visa_place_of_issue", e.target.value)}
                  placeholder={t("placeOfIssue")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("visaExpiry")}</Label>
                <DatePicker
                  value={value.visa_expiry}
                  onChange={(v) => set("visa_expiry", v)}
                  min={localToday()}
                />
              </div>
            </div>
          </div>

          {/* Personal */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("personal")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className={lbl}>{t("placeOfBirth")}</Label>
                <Input
                  value={value.place_of_birth}
                  onChange={(e) => set("place_of_birth", e.target.value)}
                  placeholder={t("placeOfBirth")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("countryOfBirth")}</Label>
                <Input
                  value={value.country_of_birth}
                  onChange={(e) => set("country_of_birth", e.target.value)}
                  placeholder={t("countryOfBirth")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("nationality")}</Label>
                <Input
                  value={value.nationality}
                  onChange={(e) => set("nationality", e.target.value)}
                  placeholder={t("nationality")}
                />
              </div>
            </div>
          </div>

          {/* Journey */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("journey")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className={lbl}>{t("arrivedInIndiaOn")}</Label>
                <DatePicker
                  value={value.arrived_in_india_on}
                  onChange={(v) => set("arrived_in_india_on", v)}
                  max={localToday()}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("arrivalPlace")}</Label>
                <Input
                  value={value.arrival_place}
                  onChange={(e) => set("arrival_place", e.target.value)}
                  placeholder={t("phArrivalPort")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("comingFromCity")}</Label>
                <Input
                  value={value.coming_from_city}
                  onChange={(e) => set("coming_from_city", e.target.value)}
                  placeholder={t("phCity")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("comingFromCountry")}</Label>
                <Input
                  value={value.coming_from_country}
                  onChange={(e) => set("coming_from_country", e.target.value)}
                  placeholder={t("phCountry")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("nextDestination")}</Label>
                <Input
                  value={value.next_destination}
                  onChange={(e) => set("next_destination", e.target.value)}
                  placeholder={t("phCityPlace")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("nextDestinationCountry")}</Label>
                <Input
                  value={value.next_destination_country}
                  onChange={(e) => set("next_destination_country", e.target.value)}
                  placeholder={t("phCountry")}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label className={lbl}>{ts("purposeOfVisit")}</Label>
                <Input
                  value={value.purpose_of_visit}
                  onChange={(e) => set("purpose_of_visit", e.target.value)}
                  placeholder={ts("purposeOfVisit")}
                />
              </div>
            </div>
          </div>
            </div>
          )}
    </div>
  );
}

/** Collapsible section wrapper. */
/**
 * UPI QR panel — shared by both check-in flows (client 9-06: 30% bigger QR,
 * same treatment as the checkout page: h-56 image + permission-gated UPI ID
 * with a copy button).
 */
// UpiQrBlock → src/components/checkin/upi-qr-block.tsx

// Section (collapsible accordion) → src/components/checkin/collapsible-section.tsx
// Aliased here so existing JSX uses <Section ...> unchanged:
const Section = CollapsibleSection;

function DocUpload({
  guestId,
  side,
  label,
  idType,
  existingDocId,
  onUploaded,
  onOcrResult,
}: {
  readonly guestId: string | null;
  readonly side: DocSide;
  readonly label: string;
  readonly idType?: string;
  /** Existing document ID — pre-fills the tile from B2 on mount. */
  readonly existingDocId?: string | null;
  readonly onUploaded?: () => void;
  readonly onOcrResult?: (result: import("@/lib/id-ocr").IdOcrResult) => void;
}) {
  const t = useTranslations("checkin");
  const { activeHotelId } = useAuth();
  const { edit } = useImageEditor();
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  // Clean up blob URL when component unmounts
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  // Pre-fill tile from Backblaze when a returning guest has existing documents.
  useEffect(() => {
    if (!existingDocId || !guestId || preview) return;
    let cancelled = false;
    setBusy(true);
    // Absolute URL — in production the API is on a different origin, so a
    // relative fetch would hit the Next.js host and silently 404 (blank tile).
    const url = `${API_BASE}/api/v1/guests/${guestId}/documents/${existingDocId}/file`;
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
    fetch(url, { headers, credentials: "include" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((blob) => {
        if (!cancelled) {
          setPreview(URL.createObjectURL(blob));
          setUploaded(true);
        }
      })
      .catch(() => { /* silent — tile stays empty so staff can upload */ })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDocId, guestId]);

  const onFile = async (file: File | undefined) => {
    if (!file || !guestId) return;
    // Selfie: 1000px (face recognition doesn't need more).
    // ID docs: 1800px (Tesseract OCR works best at full card resolution).
    // Crop frame matches the document shape (Aadhaar/DL card vs passport page).
    const edited = await edit(file, {
      aspect: docAspectFor(idType, side),
      maxDimension: side === "selfie" ? 1000 : 1800,
    });
    if (!edited) return;
    setBusy(true);
    // Show local preview immediately — before upload
    const previewUrl = URL.createObjectURL(edited);
    setPreview(previewUrl);
    try {
      const compressed = await compressDocument(edited);

      // Run OCR on the edited photo (crop/rotate is the region staff chose).
      // Upload still uses the compressed copy.
      // Front → full extraction (name, DOB, gender, ID number, address).
      // Back  → address-only (Aadhar address lives on the back face; we only
      //          surface it if the callback is wired by the parent).
      if ((side === "front" || side === "back") && onOcrResult) {
        setOcrRunning(true);
        const { parseIdDocument } = await import("@/lib/id-ocr");
        parseIdDocument(edited, idType ?? "Aadhar Card", side)
          .then((result) => {
            if (side === "back") {
              // Back face: surface address + pincode only — don't overwrite
              // name/DOB/gender already captured from the front. The back
              // parser has a strict quality gate (valid pincode required),
              // so garbage is never offered for autofill.
              const addressOnly = {
                ...result,
                fields: {
                  address: result.fields.address,
                  pincode: result.fields.pincode,
                  city: result.fields.city,
                  state: result.fields.state,
                },
              };
              onOcrResult(addressOnly);
            } else {
              onOcrResult(result);
            }
          })
          // OCR failure must not be silent — staff wonder where the autofill
          // banner went (plan §4.3). Upload continues regardless.
          .catch(() => toast.warning(t("ocrFailed")))
          .finally(() => setOcrRunning(false));
      }

      const form = new FormData();
      form.append("side", side);
      form.append("document_type", "id_proof");
      form.append("file", compressed);
      await apiUpload(`/api/v1/guests/${guestId}/documents`, form, {
        hotelId: activeHotelId ?? undefined,
      });
      setUploaded(true);
      onUploaded?.();
    } catch (e) {
      setPreview(null);
      toast.error(e instanceof ApiError ? e.message : t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  // Tile border/background — preview wins, then OCR-in-progress, then idle.
  let tileStateClass: string;
  if (preview) {
    // Taller preview so the ID text is actually readable at the desk
    // (client 9-08 item 5 — the old h-28 strip cropped most of the card).
    tileStateClass = "border-green-400 p-0 h-40";
  } else if (ocrRunning) {
    tileStateClass = "border-gold-400 bg-gold-50 text-gold-700 animate-pulse p-4";
  } else {
    tileStateClass = "border-dashed border-border hover:border-gold-400 hover:bg-gold-50 text-muted-foreground p-4";
  }

  // Status text — OCR running wins, then uploading; fallback differs per view.
  let overlayStatusText: string;
  if (ocrRunning) {
    overlayStatusText = t("readingId");
  } else if (busy) {
    overlayStatusText = t("uploading");
  } else {
    overlayStatusText = t("uploaded");
  }

  let tileLabelText: string;
  if (ocrRunning) {
    tileLabelText = t("readingId");
  } else if (busy) {
    tileLabelText = t("uploading");
  } else {
    tileLabelText = label;
  }

  return (
    <div className="space-y-1.5">
      <label
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 overflow-hidden text-center text-xs transition-colors",
          !guestId && "pointer-events-none opacity-40",
          tileStateClass,
        )}
      >
        {preview ? (
          /* Image thumbnail fills the tile */
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={side === "selfie" ? t("selfieAlt") : t("idDocumentAlt")}
              className={side === "selfie" ? "h-full w-full object-cover" : "h-full w-full bg-navy-900/5 object-contain"}
            />
            {/* Status overlay */}
            <div className={cn(
              "absolute bottom-0 left-0 right-0 px-2 py-1 text-micro font-semibold text-center",
              uploaded ? "bg-success/80 text-white" : "bg-gold-500/80 text-navy-900",
            )}>
              {overlayStatusText}
        </div>
          </>
        ) : (
          <>
            <Upload className={cn("size-5", ocrRunning && "animate-spin")} aria-hidden />
            <span className="font-medium">
              {tileLabelText}
            </span>
            {ocrRunning && (
              <span className="text-micro text-gold-600">{t("extractingDetails")}</span>
            )}
          </>
        )}
        <input
          type="file"
          // Selfie tile: any image + front camera on mobile.
          accept={side === "selfie" ? "image/*" : "image/png,image/jpeg,image/webp"}
          capture={side === "selfie" ? "user" : undefined}
          className="hidden"
          disabled={!guestId || busy}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {side === "selfie" && !cameraOpen && (
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={!guestId || busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-label font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors disabled:opacity-40"
        >
          <Camera className="size-3.5" aria-hidden />
          {t("useCamera")}
        </button>
      )}
      {side === "selfie" && cameraOpen && (
        <InlineCameraCapture
          onCapture={(file) => onFile(file)}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Autofill Banner ─────────────────────────────────────────────────────────

/**
 * Shown after OCR completes.
 *  - High confidence → shows extracted fields + "Auto-fill" button.
 *  - Low confidence  → shows warning message only.
 */
// AutofillBanner → src/components/checkin/autofill-banner.tsx

/** Queued doc upload tile — shows preview thumbnail; queues file for upload after guest creation. */
function QueuedDocUpload({
  side,
  label,
  onQueued,
  onOriginal,
  guestId,
  existingDocId,
  idType,
  onOcrResult,
  initialFile,
}: {
  readonly side: DocSide;
  readonly label: string;
  readonly onQueued: (side: DocSide, file: File) => void;
  /** Receives the ORIGINAL (uncompressed) file — use for OCR, which needs
   *  full resolution. The queued/uploaded file is the compressed copy. */
  readonly onOriginal?: (side: DocSide, file: File) => void;
  /** With existingDocId: preload the returning guest's saved document so the
   *  tile is never blank (client 9-08 item 11). Staff can still re-upload. */
  readonly guestId?: string | null;
  readonly existingDocId?: string | null;
  /** ID proof type — picks the matching crop frame (Aadhaar card vs passport). */
  readonly idType?: string | null;
  /** OCR result — wired when front/back face is uploaded; same behaviour as
   *  primary-guest DocUpload so co-guest identity can also be auto-filled. */
  readonly onOcrResult?: (result: import("@/lib/id-ocr").IdOcrResult) => void;
  /** Already-QUEUED file (plan §5.1): when the tile remounts after "Confirm
   *  Guest Details", the parent passes the queued file back so the preview
   *  survives — previously the card showed three BLANK tiles (client bug). */
  readonly initialFile?: File | null;
}) {
  const t = useTranslations("checkin");
  const { activeHotelId } = useAuth();
  const { edit } = useImageEditor();
  const [queued, setQueued] = useState(!!initialFile);
  const [preview, setPreview] = useState<string | null>(() =>
    initialFile ? URL.createObjectURL(initialFile) : null,
  );
  /** True while the preview shows the SAVED document (nothing new queued). */
  const [showingExisting, setShowingExisting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  // Preload the saved document for returning guests (same pattern as the
  // primary guest's DocUpload tile).
  useEffect(() => {
    if (!existingDocId || !guestId || guestId.startsWith("__new__") || preview) return;
    let cancelled = false;
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
    fetch(`${API_BASE}/api/v1/guests/${guestId}/documents/${existingDocId}/file`, {
      headers,
      credentials: "include",
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        if (!cancelled) {
          setPreview(URL.createObjectURL(blob));
          setShowingExisting(true);
        }
      })
      .catch(() => { /* silent — tile stays empty so staff can upload */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDocId, guestId]);

  const [ocrRunning, setOcrRunning] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const edited = await edit(file, {
      aspect: docAspectFor(idType, side),
      maxDimension: side === "selfie" ? 1000 : 1800,
    });
    if (!edited) return;
    const previewUrl = URL.createObjectURL(edited);
    setPreview(previewUrl);
    setShowingExisting(false);
    onOriginal?.(side, edited);
    try {
      const compressed = await compressDocument(edited);
      onQueued(side, compressed);
      setQueued(true);
    } catch {
      setPreview(null);
      toast.error(t("processImageFailed"));
      return;
    }
    // Run OCR for front/back faces — same pipeline as the primary-guest tile
    // (client request: co-guests should have identical OCR autofill behaviour).
    if ((side === "front" || side === "back") && onOcrResult) {
      setOcrRunning(true);
      try {
        const { parseIdDocument } = await import("@/lib/id-ocr");
        const ocrFile = edited; // use the cropped high-res image
        // BUG FIX (plan §4.3): the side was passed as the ID TYPE, so back
        // faces never reached the back-face address parser and the autofill
        // banner silently never appeared (client: "Autofill button not
        // showing — both guest flows").
        const result = await parseIdDocument(
          ocrFile,
          idType ?? "Aadhar Card",
          side === "back" ? "back" : "front",
        );
        if (result) onOcrResult(result);
      } catch {
        // OCR failure is non-fatal, but no longer SILENT — staff must know
        // why no autofill banner appeared (plan §4.3).
        toast.warning(t("ocrFailed"));
      } finally {
        setOcrRunning(false);
      }
    }
  };

  return (
    <div className="space-y-1.5">
      <label
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 overflow-hidden text-center text-xs transition-colors",
          preview
            ? "border-gold-400 p-0 h-40"
            : "border-dashed border-border hover:border-gold-400 hover:bg-gold-50 text-muted-foreground p-4",
        )}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={side === "selfie" ? t("selfieAlt") : t("idDocumentAlt")}
              className={side === "selfie" ? "h-full w-full object-cover" : "h-full w-full bg-navy-900/5 object-contain"}
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gold-500/80 px-2 py-1 text-micro font-semibold text-navy-900 text-center">
              {ocrRunning
                ? t("readingId")
                : queued
                  ? t("readyToUpload")
                  : showingExisting
                    ? t("savedOnFile")
                    : t("processing")}
            </div>
          </>
        ) : (
          <>
            <Upload className="size-5" aria-hidden />
            <span className="font-medium">{label}</span>
          </>
        )}
        <input
          type="file"
          // Selfie tile: any image + front camera on mobile.
          accept={side === "selfie" ? "image/*" : "image/png,image/jpeg,image/webp"}
          capture={side === "selfie" ? "user" : undefined}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {side === "selfie" && !cameraOpen && (
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-label font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
        >
          <Camera className="size-3.5" aria-hidden />
          {t("useCamera")}
              </button>
      )}
      {side === "selfie" && cameraOpen && (
        <InlineCameraCapture
          onCapture={(file) => onFile(file)}
          onClose={() => setCameraOpen(false)}
        />
      )}
            </div>
  );
}

// ─── New guest rich form (shared by primary + additional guests) ────────────

/**
 * Full identity form for creating a NEW guest: ID type/number, three queued
 * doc tiles (front/back/selfie) with OCR autofill, personal details and a
 * confirm button. Docs are only QUEUED here — the parent uploads them after
 * the guest record is created (primary: immediately; additional: at submit).
 */
function NewGuestForm({
  initialPhone = "",
  initial,
  confirmLabel,
  pending = false,
  onConfirm,
  beforeConfirm,
  existingDocs = {},
  guestId = null,
}: {
  /** Seeds the mobile field (e.g. the phone that was searched with no match). */
  readonly initialPhone?: string;
  /** Pre-fills the whole form — used to EDIT an already-resolved co-guest. */
  readonly initial?: Partial<GuestCreatePayload>;
  readonly confirmLabel: string;
  /** Disables the confirm button while the parent is creating the guest. */
  readonly pending?: boolean;
  readonly onConfirm: (
    form: GuestCreatePayload,
    docs: { side: DocSide; file: File }[],
  ) => void;
  /** Rendered between the form fields and the confirm button — used to slot
   *  the Foreign Guest (Form C) section so the confirm button always sits
   *  BELOW all guest inputs (client UX request 09/2026). */
  readonly beforeConfirm?: React.ReactNode;
  /** Existing saved document IDs per side — passed in edit mode so the photo
   *  tiles show the already-uploaded Aadhaar/passport images instead of
   *  appearing blank (client 17/09: photos missing when editing co-guest). */
  readonly existingDocs?: Partial<Record<DocSide, string>>;
  /**
   * DB guest ID for the person being edited. When provided, the "Show"
   * checkbox on the ID field decrypts the full ID from the server instead
   * of just toggling the masked placeholder (replaces RevealIdButton).
   */
  readonly guestId?: string | null;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const tg = useTranslations("guestPicker");
  const api = useApi();
  const [docs, setDocs] = useState<{ side: DocSide; file: File }[]>([]);
  const [ocrResult, setOcrResult] = useState<import("@/lib/id-ocr").IdOcrResult | null>(null);
  const [form, setForm] = useState<GuestCreatePayload>({
    full_name: "",
    phone: initialPhone,
    email: "",
    address: "",
    city: "",
    state: "",
    country: "India",
    gender: "",
    date_of_birth: "",
    id_proof_type: "Aadhar Card",
    id_number: "",
    postal_code: "",
    ...initial,
  });

  const set = (k: keyof GuestCreatePayload, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleQueueDoc = (side: DocSide, file: File) =>
    setDocs((prev) => prev.filter((d) => d.side !== side).concat({ side, file }));

  return (
    <div className="space-y-4">
      {/* ID verification */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("idType")}</Label>
          <select
            value={form.id_proof_type}
            onChange={(e) => set("id_proof_type", e.target.value)}
            className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="Aadhar Card">{t("idAadhar")}</option>
            <option value="PAN Card">{t("idPan")}</option>
            <option value="Passport">{t("idPassport")}</option>
            <option value="Driving License">{t("idDrivingLicense")}</option>
            <option value="Voter ID">{t("idVoter")}</option>
          </select>
        </div>
        <MaskedIdInput
          label={t("fieldIdNumber")}
          labelClassName="text-xs"
          value={form.id_number ?? ""}
          idType={form.id_proof_type}
          onChange={(v) => set("id_number", v)}
          placeholder={t("last4Min")}
          onReveal={
            guestId && !guestId.startsWith("__new__")
              ? async () => {
                  const res = await api<{ id_number: string | null }>(
                    `/api/v1/guests/${guestId}/reveal-id`,
                    { method: "POST" },
                  );
                  return res.id_number;
                }
              : undefined
          }
        />
      </div>

      {/* Doc uploads — front triggers OCR.
          existingDocId pre-fills the tile with the already-saved B2 image
          so edit mode shows the Aadhaar/passport instead of a blank tile
          (client 17/09: photos missing when editing co-guest). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {/* guestId + existingDocId both required by QueuedDocUpload to fetch the
            B2-stored image. Passing guestId (null for new guests) ensures edit
            mode shows "✓ Saved on file" thumbnails. */}
        <QueuedDocUpload
          side="front"
          label={t("uploadFront")}
          onQueued={handleQueueDoc}
          idType={form.id_proof_type}
          existingDocId={existingDocs.front}
          guestId={guestId ?? undefined}
          onOriginal={(_side, original) => {
            // OCR runs on the ORIGINAL (full-resolution) image.
            import("@/lib/id-ocr").then(({ parseIdDocument }) =>
              parseIdDocument(original, form.id_proof_type ?? "Aadhar Card").then(setOcrResult),
            );
          }}
        />
        <QueuedDocUpload
          side="back"
          label={t("uploadBack")}
          onQueued={handleQueueDoc}
          idType={form.id_proof_type}
          existingDocId={existingDocs.back}
          guestId={guestId ?? undefined}
          onOriginal={(_side, original) => {
            // Back face → dedicated Aadhaar address/pincode parser.
            import("@/lib/id-ocr").then(({ parseIdDocument }) =>
              parseIdDocument(original, form.id_proof_type ?? "Aadhar Card", "back").then(
                (result) => {
                  if (result.fields.address) {
                    setForm((prev) => ({
                      ...prev,
                      address: prev.address || result.fields.address || "",
                      postal_code: prev.postal_code || result.fields.pincode || "",
                      city: prev.city || result.fields.city || "",
                      state: prev.state || result.fields.state || "",
                    }));
                    toast.success(t("formAutofilled"));
                  } else {
                    toast.warning(result.message);
                  }
                },
              ),
            );
          }}
        />
        <QueuedDocUpload
          side="selfie"
          label={t("selfieCapture")}
          onQueued={handleQueueDoc}
          existingDocId={existingDocs.selfie}
          guestId={guestId ?? undefined}
        />
      </div>

      {/* OCR autofill banner */}
      {ocrResult && (
        <AutofillBanner
          result={ocrResult}
          onAccept={(fields) => {
            if (fields.name) set("full_name", fields.name);
            if (fields.id_number && !isIdMask(fields.id_number)) {
              // Strip spaces (OCR returns "1234 5678 9012" — spaces inflate length past 12)
              const rawId = fields.id_number;
              const idType = fields.id_type_detected ?? form.id_proof_type ?? "Aadhar Card";
              const cleaned = idType === "Aadhar Card" ? sanitizeAadhaarOcr(rawId) : rawId.trim();
              set("id_number", cleaned);
            }
            if (fields.gender) set("gender", fields.gender);
            if (fields.date_of_birth) set("date_of_birth", fields.date_of_birth);
            if (fields.address) set("address", fields.address);
            if (fields.id_type_detected) set("id_proof_type", fields.id_type_detected);
            setOcrResult(null);
            toast.success(t("guestAutofilled"));
          }}
          onDismiss={() => setOcrResult(null)}
        />
      )}

      {/* Guest details */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{tg("fullName")} *</Label>
          <Input value={form.full_name} onChange={(e) => set("full_name", liveNameCase(e.target.value))} placeholder={tg("fullName")} required />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{tg("phoneNumber")} *</Label>
          <Input value={form.phone} onChange={(e) => set("phone", sanitizeGuestPhone(e.target.value))} maxLength={15} placeholder={t("mobile10")} inputMode="tel" required />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("emailOptional")}</Label>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="email@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldGender")}</Label>
          <select
            value={form.gender}
            onChange={(e) => set("gender", e.target.value)}
            className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="">{t("selectOption")}</option>
            <option value="Male">{t("male")}</option>
            <option value="Female">{t("female")}</option>
            <option value="Other">{t("genderOther")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldDob")}</Label>
          <DatePicker value={form.date_of_birth ?? ""} onChange={(v) => set("date_of_birth", v)} max={localToday()} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("pincode")}</Label>
          <Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} placeholder={t("pincode")} inputMode="numeric" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">{t("fieldAddress")}</Label>
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder={t("fieldAddress")} />
        </div>
        {/* City / State / Country — client reference layout (Aadhaar-style). */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldCity")}</Label>
          <Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} placeholder={t("fieldCity")} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldState")}</Label>
          <Input value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} placeholder={t("fieldState")} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldCountry")}</Label>
          <Input value={form.country ?? ""} onChange={(e) => set("country", e.target.value)} placeholder={t("fieldCountry")} />
        </div>
      </div>

      {/* Slot for Foreign Guest (Form C) etc. — keeps confirm button LAST */}
      {beforeConfirm}

      <Button
        type="button"
        size="sm"
        className="bg-navy-900 text-white hover:bg-navy-900/90"
        disabled={!form.full_name.trim() || !form.phone.trim() || pending}
        onClick={() => onConfirm({ ...form }, docs)}
      >
        {pending ? tc("saving") : confirmLabel}
      </Button>
    </div>
  );
}

// ─── Additional Guest entry component ────────────────────────────────────────

function AdditionalGuestEntry({
  idx,
  onResolved,
  onRemove,
  initial,
}: {
  readonly idx: number;
  readonly onResolved: (guest: ResolvedCoGuest) => void;
  readonly onRemove: () => void;
  /** Draft restore (plan §4.2): mount directly in the resolved state. */
  readonly initial?: ResolvedCoGuest | null;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const tg = useTranslations("guestPicker");
  const api = useApi();
  const [searchPhone, setSearchPhone] = useState("");
  const [searchIdLast4, setSearchIdLast4] = useState("");
  const [searchResults, setSearchResults] = useState<GuestSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // True once a Search request has actually completed — prevents "No match"
  // showing prematurely while the user is still typing (before hitting Search).
  const [hasSearched, setHasSearched] = useState(false);
  // Track if the most recent search was by ID (Aadhaar) rather than phone.
  // Used to show the "duplicate record" warning and post-selection hint.
  const [wasIdSearch, setWasIdSearch] = useState(false);
  // After selection — optional contact phone override (does NOT change master record).
  // Stored as a note so family can use a different phone for THIS booking only.
  const [contactPhoneOverride, setContactPhoneOverride] = useState("");

  // Sync the alternate_contact_phone override into the resolved guest object
  // so the parent receives it when building the check-in payload.
  useEffect(() => {
    if (!resolved) return;
    const phone = contactPhoneOverride.trim() || undefined;
    // Only update when the value actually changed to avoid re-render loops.
    if (phone === resolved.alternate_contact_phone) return;
    const updated = { ...resolved, alternate_contact_phone: phone };
    setResolved(updated);
    onResolved(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactPhoneOverride]);
  const [resolved, setResolved] = useState<ResolvedCoGuest | null>(initial ?? null);
  const [mode, setMode] = useState<"search" | "form">("search");
  // Seed from a restored draft's docs — otherwise the tiles render blank and
  // queuing ONE new photo would wipe the restored ones (docs replace, not merge).
  const [docs, setDocs] = useState<{ side: DocSide; file: File; key?: string }[]>(
    initial?.docs ?? [],
  );
  /** Saved document ids per side for a returning guest (preloads the tiles). */
  const [existingDocs, setExistingDocs] = useState<Partial<Record<DocSide, string>>>({});
  // Edit mode — re-opens the guest form pre-filled with the resolved guest.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Full details of an existing guest (from /autofill) — used to pre-fill edits. */
  const [autofill, setAutofill] = useState<GuestAutofill | null>(null);
  /** OCR result from a co-guest doc upload — triggers auto-edit (client bug fix). */
  const [coGuestOcrResult, setCoGuestOcrResult] = useState<import("@/lib/id-ocr").IdOcrResult | null>(null);
  /** Full ID number extracted by OCR (stored separately since GuestAutofill
   *  only carries id_last4). Used to pre-fill the edit form with the real ID
   *  instead of a masked placeholder (fix: co-guest OCR drops full ID). */
  const [coGuestOcrId, setCoGuestOcrId] = useState<string | null>(null);

  // Foreign guest (Form C) — same fields as the primary guest's section.
  const [fgEnabled, setFgEnabled] = useState(false);
  const [fgForm, setFgForm] = useState<ForeignGuestFormState>(EMPTY_FOREIGN_GUEST);

  // Draft-restore rehydration (plan §4.2): a restored EXISTING guest re-fetches
  // profile + saved documents so the summary grid and doc tiles fill back in.
  // Pending (__new__) guests already carry their form data via _newForm.
  useEffect(() => {
    if (!initial || initial.guest_id.startsWith("__new__")) return;
    let cancelled = false;
    void (async () => {
      try {
        const [full, docsList] = await Promise.all([
          api<GuestAutofill>(`/api/v1/guests/${initial.guest_id}/autofill`, { method: "POST" }),
          api<{ id: string; side: string | null }[]>(
            `/api/v1/guests/${initial.guest_id}/documents`,
          ).catch(() => [] as { id: string; side: string | null }[]),
        ]);
        if (cancelled) return;
        const bySide: Partial<Record<DocSide, string>> = {};
        for (const doc of docsList) {
          if ((doc.side === "front" || doc.side === "back" || doc.side === "selfie") && !bySide[doc.side]) {
            bySide[doc.side] = doc.id;
          }
        }
        setExistingDocs(bySide);
        setAutofill(full);
      } catch {
        // Non-fatal: the card still shows name/phone from the draft.
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Update Form C state and propagate it into the resolved co-guest. */
  const applyForeign = (enabled: boolean, f: ForeignGuestFormState) => {
    setFgEnabled(enabled);
    setFgForm(f);
    if (resolved) {
      const updated = {
        ...resolved,
        foreign_guest: buildForeignGuestPayload(enabled, f),
      };
      setResolved(updated);
      onResolved(updated);
    }
  };

  const handleSearch = async () => {
    const phone = searchPhone.trim();
    const idLast4 = searchIdLast4.trim().replace(/\D/g, "").slice(-4);
    if (!phone && !idLast4) return;
    const byId = !!idLast4 && !phone;
    setWasIdSearch(byId);
    setSearching(true);
    setHasSearched(false);
    try {
      const qs = phone
        ? `phone=${encodeURIComponent(phone)}`
        : `id_last4=${encodeURIComponent(idLast4)}`;
      const res = await api<{ items: GuestSearchResult[] }>(
        `/api/v1/guests/search?${qs}`,
      );
      // Sort: when searching by ID, put newest entries first (most recent bookings
      // at the top) so staff picks the "active" record naturally.
      const sorted = byId
        ? [...res.items].sort((a, b) => (a.full_name > b.full_name ? 1 : -1))
        : res.items;
      setSearchResults(sorted);
      setHasSearched(true);
      if (sorted.length === 0) setMode("form");
    } catch {
      setSearchResults([]);
      setHasSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectExisting = async (g: GuestSearchResult) => {
    try {
      // Cross-hotel hit (plan §1.7): IMPORT the guest into this hotel first
      // (explicit, phone-proofed, audited — copies base data + ID photos),
      // then continue with the fresh LOCAL record.
      let guestId = g.id;
      if (g.cross_hotel) {
        const imported = await api<GuestOut>("/api/v1/guests/import", {
          method: "POST",
          body: { source_guest_id: g.id, phone: searchPhone.trim() },
        });
        guestId = imported.id;
        toast.success(t("guestImported"));
      }
      // Parallel: full profile + saved documents, so a returning co-guest's
      // card shows their phone AND existing front/back/selfie tiles
      // (client 9-08 items 9 + 11).
      const [full, docsList] = await Promise.all([
        api<GuestAutofill>(`/api/v1/guests/${guestId}/autofill`, { method: "POST" }),
        api<{ id: string; side: string | null }[]>(
          `/api/v1/guests/${guestId}/documents`,
        ).catch(() => [] as { id: string; side: string | null }[]),
      ]);
      const bySide: Partial<Record<DocSide, string>> = {};
      for (const d of docsList) {
        if ((d.side === "front" || d.side === "back" || d.side === "selfie") && !bySide[d.side]) {
          bySide[d.side] = d.id; // list is newest-first — keep the first hit
        }
      }
      setExistingDocs(bySide);
      const resolved: ResolvedCoGuest = {
        guest_id: guestId,
        full_name: full.full_name,
        phone: full.phone,
        docs: [],
        foreign_guest: buildForeignGuestPayload(fgEnabled, fgForm),
      };
      setAutofill(full);
      setResolved(resolved);
      setContactPhoneOverride(""); // reset override on new selection
      onResolved(resolved);
      setSearchResults([]);
    } catch {
      toast.error(t("guestLoadFailed"));
    }
  };

  const handleQueueDoc = (side: DocSide, file: File) => {
    const newDocs = docs.filter((d) => d.side !== side).concat({ side, file });
    setDocs(newDocs);
    if (resolved) {
      const updated = { ...resolved, docs: newDocs };
      setResolved(updated);
      onResolved(updated);
    }
  };

  /** Pre-fill the guest form when editing a resolved co-guest.
   *
   * Priority: _newForm (pending guest) → autofill (fetched profile) → resolved
   * fields (safe fallback so the form is never empty even while autofill loads).
   * The ID number is intentionally masked — show "••••XXXX" as placeholder
   * (security: only last-4 returned by API; full number re-entered if changed).
   */
  const buildEditInitial = (): Partial<GuestCreatePayload> => {
    if (resolved?.guest_id.startsWith("__new__")) {
      const nf = (resolved as ResolvedCoGuest & { _newForm?: GuestCreatePayload })._newForm;
      if (nf) return { ...nf };
    }
    const base = autofill ?? null;
    return {
      full_name:   base?.full_name   ?? resolved?.full_name ?? "",
      phone:       base?.phone       ?? resolved?.phone    ?? "",
      email:       base?.email       ?? "",
      address:     base?.address     ?? "",
      city:        base?.city        ?? "",
      state:       base?.state       ?? "",
      country:     base?.country     ?? "India",
      postal_code: base?.postal_code ?? "",
      gender:      base?.gender      ?? "",
      date_of_birth: base?.date_of_birth ?? "",
      id_proof_type: base?.id_proof_type ?? "Aadhar Card",
      // Use the full OCR ID if captured (co-guest OCR accept flow).
      // Otherwise fall back to masked placeholder from last-4, or empty.
      id_number: coGuestOcrId
        ? coGuestOcrId
        : base?.id_last4
          ? `••••${base.id_last4}`
          : "",
    };
  };

  /**
   * Save edited co-guest details.
   *  • Pending-creation guest (__new__) → just update the queued _newForm.
   *  • Existing guest → PATCH /api/v1/guests/{guest_id} immediately.
   */
  const handleEditConfirm = async (
    form: GuestCreatePayload,
    formDocs: { side: DocSide; file: File }[],
  ) => {
    if (!resolved) return;
    // Docs queued in the edit form replace same-side queued docs.
    const mergedDocs = [
      ...docs.filter((d) => !formDocs.some((f) => f.side === d.side)),
      ...formDocs,
    ];

    if (resolved.guest_id.startsWith("__new__")) {
      const updated: ResolvedCoGuest & { _newForm?: GuestCreatePayload } = {
        ...resolved,
        full_name: form.full_name.trim() || resolved.full_name,
        docs: mergedDocs,
      };
      updated._newForm = { ...form };
      setDocs(mergedDocs);
      setResolved(updated);
      onResolved(updated);
      setEditing(false);
      toast.success(t("guestUpdated"));
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (form.full_name.trim()) body.full_name = form.full_name.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.email?.trim()) body.email = form.email.trim();
      if (form.address?.trim()) body.address = form.address.trim();
      if (form.city?.trim()) body.city = form.city.trim();
      if (form.state?.trim()) body.state = form.state.trim();
      if (form.country?.trim()) body.country = form.country.trim();
      if (form.postal_code?.trim()) body.postal_code = form.postal_code.trim();
      if (form.gender?.trim()) body.gender = form.gender.trim();
      if (form.date_of_birth?.trim()) body.date_of_birth = form.date_of_birth.trim();
      if (form.id_proof_type?.trim()) body.id_proof_type = form.id_proof_type.trim();
      // Only patch ID if it's a REAL number, not a masked placeholder (••••4777).
      // Sending a masked value would corrupt the stored ID. Same guard as primary.
      if (form.id_number?.trim() && !isIdMask(form.id_number)) {
        const rawId = form.id_number.trim();
        body.id_number = form.id_proof_type === "Aadhar Card"
          ? sanitizeAadhaarOcr(rawId)
          : rawId;
      }
      await api(`/api/v1/guests/${resolved.guest_id}`, { method: "PATCH", body });

      const updated = {
        ...resolved,
        full_name: form.full_name.trim() || resolved.full_name,
        docs: mergedDocs,
      };
      setDocs(mergedDocs);
      setResolved(updated);
      onResolved(updated);
      // Keep the pre-fill fresh for a subsequent edit.
      setAutofill((prev) =>
        prev
          ? {
              ...prev,
              full_name: body.full_name ?? prev.full_name,
              phone: body.phone ?? prev.phone,
              email: body.email ?? prev.email,
              address: body.address ?? prev.address,
              city: body.city ?? prev.city,
              state: body.state ?? prev.state,
              country: body.country ?? prev.country,
              postal_code: body.postal_code ?? prev.postal_code,
              gender: body.gender ?? prev.gender,
              date_of_birth: body.date_of_birth ?? prev.date_of_birth,
              id_proof_type: body.id_proof_type ?? prev.id_proof_type,
            }
          : prev,
      );
      setEditing(false);
      toast.success(t("guestUpdated"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit mode — re-open the guest form pre-filled ──────────────────────────
  if (resolved && editing) {
    return (
      <div className="rounded-xl border bg-muted/30 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t("editGuest")}
          </p>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {tc("cancel")}
          </button>
        </div>
        {/* key remounts the form when autofill data arrives after the
            edit is opened — prevents the empty-form race condition.
            existingDocs passes the saved B2 document IDs so the photo
            tiles (front/back/selfie) pre-load the existing Aadhaar/passport
            images instead of showing blank (client 17/09). */}
        <NewGuestForm
          key={`edit-${resolved.guest_id}-${autofill ? "loaded" : "pending"}`}
          initial={buildEditInitial()}
          existingDocs={existingDocs}
          guestId={resolved.guest_id}
          confirmLabel={t("updateGuest")}
          pending={saving}
          onConfirm={(form, formDocs) => void handleEditConfirm(form, formDocs)}
        />
      </div>
    );
  }

  if (resolved) {
    // Read-only details summary (plan §5.1): confirming must never HIDE what
    // was entered (client: "Confirm Guest Details click button then hide
    // customer"). Pending guests read from the queued form; returning guests
    // from the autofill profile.
    const nf = (resolved as ResolvedCoGuest & { _newForm?: GuestCreatePayload })._newForm;
    const summary: { label: string; value: string | null | undefined }[] = [
      { label: t("fieldGender"), value: nf?.gender ?? autofill?.gender },
      { label: t("fieldDob"), value: nf?.date_of_birth ?? autofill?.date_of_birth },
      { label: t("fieldAddress"), value: nf?.address ?? autofill?.address },
      { label: t("fieldCity"), value: nf?.city ?? autofill?.city },
      { label: t("fieldState"), value: nf?.state ?? autofill?.state },
      { label: t("pincode"), value: nf?.postal_code ?? autofill?.postal_code },
      {
        label: t("idType"),
        value: nf?.id_proof_type ?? autofill?.id_proof_type,
      },
      {
        label: t("idNumberShort"),
        value: nf?.id_number
          ? `••••${nf.id_number.slice(-4)}`
          : autofill?.id_last4
            ? `••••${autofill.id_last4}`
            : null,
      },
    ].filter((row) => !!row.value);

    return (
      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-success" aria-hidden />
            <div>
              <span className="text-sm font-semibold">{resolved.full_name}</span>
              {resolved.phone && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {resolved.phone}
            </p>
          )}
            </div>
        </div>
          <div className="flex items-center gap-2">
            {/* Auto-fill — always visible for existing guests; re-fetches the
                saved profile from the server so the Edit form is never empty,
                even when autofill data loaded from a previous session. */}
            {!resolved.guest_id.startsWith("__new__") && (
              <button
                type="button"
                onClick={() => {
                  // Fetch latest autofill + documents THEN open the edit form
                  // so the form is pre-filled AND photo tiles show "Saved on file"
                  // (image 4: "Auto-fill doesn't do anything", image 5: blank tiles).
                  void Promise.all([
                    api<GuestAutofill>(`/api/v1/guests/${resolved.guest_id}/autofill`, { method: "POST" }),
                    api<{ id: string; side: string | null }[]>(`/api/v1/guests/${resolved.guest_id}/documents`)
                      .catch(() => [] as { id: string; side: string | null }[]),
                  ]).then(([full, docsList]) => {
                    const bySide: Partial<Record<DocSide, string>> = {};
                    for (const d of docsList) {
                      if ((d.side === "front" || d.side === "back" || d.side === "selfie") && !bySide[d.side as DocSide]) {
                        bySide[d.side as DocSide] = d.id;
                      }
                    }
                    setExistingDocs(bySide);
                    setAutofill(full);
                    setEditing(true);
                  }).catch(() => setEditing(true));
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gold-400 bg-gold-50 px-2.5 text-xs font-semibold text-gold-700 transition-colors hover:bg-gold-100"
              >
                {t("autofillLabel")}
              </button>
            )}
            {/* Labeled Edit — opens the form pre-filled with latest data.
                Also re-fetches autofill/docs so photo tiles are never blank
                (fix image 5: Upload tiles empty when editing co-guest). */}
            <button
              type="button"
              onClick={() => {
                if (!resolved.guest_id.startsWith("__new__") && !autofill) {
                  // Fetch autofill + docs before opening so photo tiles are populated
                  void Promise.all([
                    api<GuestAutofill>(`/api/v1/guests/${resolved.guest_id}/autofill`, { method: "POST" }),
                    api<{ id: string; side: string | null }[]>(`/api/v1/guests/${resolved.guest_id}/documents`)
                      .catch(() => [] as { id: string; side: string | null }[]),
                  ]).then(([full, docsList]) => {
                    const bySide: Partial<Record<DocSide, string>> = {};
                    for (const d of docsList) {
                      if ((d.side === "front" || d.side === "back" || d.side === "selfie") && !bySide[d.side as DocSide]) {
                        bySide[d.side as DocSide] = d.id;
                      }
                    }
                    setExistingDocs(bySide);
                    setAutofill(full);
                    setEditing(true);
                  }).catch(() => setEditing(true));
                } else {
                  setEditing(true);
                }
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-white px-2.5 text-xs font-semibold transition-colors hover:bg-muted"
            >
              <Pencil className="size-3.5" aria-hidden />
              {t("editGuest")}
            </button>
            <button
              type="button"
                      onClick={() => {
                setResolved(null);
                setSearchPhone("");
                setSearchResults([]);
                setExistingDocs({});
                setCoGuestOcrId(null);
                onRemove();
              }}
              className="p-1 text-danger hover:opacity-70"
              aria-label={t("removeGuest")}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* Captured details — read-only grid; edits go through Edit above. */}
        {summary.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-white px-3 py-2.5 sm:grid-cols-3">
            {summary.map((row) => (
              <div key={row.label} className="min-w-0">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  {row.label}
                </p>
                <p className="truncate text-xs font-medium" title={row.value ?? ""}>
                  {row.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── Duplicate-ID hint (shown when selected via Aadhaar search) ────
            Guides staff: if the phone is outdated, use Edit to update it.
            If they just want a different contact for THIS booking, they can
            enter it below without changing the master guest record. */}
        {wasIdSearch && (
          <div className="rounded-lg border border-info/20 bg-info-bg/40 px-3 py-2 space-y-2">
            <p className="flex items-start gap-1.5 text-xs text-info">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{t("idSearchSelectedHint")}</span>
            </p>
            {/* Contact phone override — optional, does NOT change the master
                guest record. Stored as an emergency contact note. */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" aria-hidden />
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={15}
                  value={contactPhoneOverride}
                  onChange={(e) => setContactPhoneOverride(sanitizeGuestPhone(e.target.value))}
                  placeholder={t("contactOverridePlaceholder")}
                  className="h-8 w-full rounded-lg border border-input bg-white pl-8 pr-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
        </div>
              {contactPhoneOverride && (
                <button
                  type="button"
                  onClick={() => setContactPhoneOverride("")}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {tc("clear")}
                </button>
              )}
            </div>
            {contactPhoneOverride && (
              <p className="text-micro text-muted-foreground">
                {t("contactOverrideNote")}
              </p>
            )}
          </div>
        )}
        {/* OCR confirm panel for co-guest — same autofill behaviour as primary guest */}
        {coGuestOcrResult && (
          <AutofillBanner
            result={coGuestOcrResult}
            onAccept={(fields) => {
              setCoGuestOcrResult(null);
              setEditing(true); // open edit form
              // Pre-populate autofill so buildEditInitial uses the OCR fields
              setAutofill((prev) => ({
                ...(prev ?? {
                  id: resolved.guest_id,
                  full_name: resolved.full_name,
                  phone: resolved.phone ?? "",
                  email: null,
                  address: null,
                  city: null,
                  state: null,
                  country: "India",
                  postal_code: null,
                  gender: null,
                  date_of_birth: null,
                  id_proof_type: null,
                  id_last4: null,
                }),
                ...(fields.name && { full_name: fields.name }),
                ...(fields.gender && { gender: fields.gender }),
                ...(fields.date_of_birth && { date_of_birth: fields.date_of_birth }),
                ...(fields.address && { address: fields.address }),
                ...(fields.pincode && { postal_code: fields.pincode }),
                ...(fields.city && { city: fields.city }),
                ...(fields.state && { state: fields.state }),
                ...(fields.id_number && { id_last4: fields.id_number.slice(-4) }),
              }));
              // Store full OCR ID separately so buildEditInitial can pre-fill
              // the edit form with the real number (autofill only carries last-4).
              if (fields.id_number) {
                const idType = fields.id_type_detected ?? "Aadhar Card";
                setCoGuestOcrId(
                  idType === "Aadhar Card"
                    ? sanitizeAadhaarOcr(fields.id_number)
                    : fields.id_number.trim(),
                );
              }
            }}
            onDismiss={() => setCoGuestOcrResult(null)}
          />
        )}

        {/* key includes whether a queued file exists so a tile picks up its
            preview when the card (re)mounts after Confirm (plan §5.1). */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <QueuedDocUpload
            side="front"
            label={t("uploadFront")}
            onQueued={handleQueueDoc}
            onOcrResult={(r) => { setCoGuestOcrResult(r); }}
            guestId={resolved.guest_id}
            existingDocId={existingDocs.front}
            initialFile={docs.find((d) => d.side === "front")?.file ?? null}
          />
          <QueuedDocUpload
            side="back"
            label={t("uploadBack")}
            onQueued={handleQueueDoc}
            onOcrResult={(r) => { setCoGuestOcrResult(r); }}
            guestId={resolved.guest_id}
            existingDocId={existingDocs.back}
            initialFile={docs.find((d) => d.side === "back")?.file ?? null}
          />
          <QueuedDocUpload
            side="selfie"
            label={t("selfieCapture")}
            onQueued={handleQueueDoc}
            guestId={resolved.guest_id}
            existingDocId={existingDocs.selfie}
            initialFile={docs.find((d) => d.side === "selfie")?.file ?? null}
          />
        </div>
        {/* Foreign guest (Form C) — per co-guest, same fields as the primary. */}
        <ForeignGuestSection
          enabled={fgEnabled}
          onEnabledChange={(v) => applyForeign(v, fgForm)}
          value={fgForm}
          onChange={(f) => applyForeign(fgEnabled, f)}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t("additionalGuestN", { n: idx + 1 })}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="text-danger hover:opacity-70"
          aria-label={t("remove")}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
            </div>

      {/* Mode toggle */}
      <div className="flex rounded-lg overflow-hidden border text-xs font-medium w-fit">
        <button
          type="button"
          onClick={() => { setMode("search"); setHasSearched(false); }}
          className={cn(
            "px-3 py-1.5 transition-colors",
            mode === "search" ? "bg-navy-900 text-white" : "hover:bg-muted",
          )}
        >
          {t("searchExisting")}
        </button>
        <button
          type="button"
          onClick={() => setMode("form")}
          className={cn(
            "px-3 py-1.5 border-l transition-colors",
            mode === "form" ? "bg-navy-900 text-white" : "hover:bg-muted",
          )}
        >
          {t("createNew")}
              </button>
            </div>

      {mode === "search" ? (
        <div className="space-y-3">
          {/* Search row — identical layout to GuestPicker (primary guest):
              grid sm:grid-cols-[1fr_auto_auto], no Phone icon, same widths */}
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input
              value={searchPhone}
              onChange={(e) => { setSearchPhone(sanitizeGuestPhone(e.target.value)); setSearchIdLast4(""); setHasSearched(false); }}
              placeholder={t("searchByPhoneFull")}
              inputMode="tel"
              maxLength={15}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void handleSearch())}
            />
            <Input
              value={searchIdLast4}
              onChange={(e) => { setSearchIdLast4(e.target.value.replace(/\D/g, "").slice(0, 4)); setSearchPhone(""); setHasSearched(false); }}
              placeholder={t("last4DigitsId")}
              maxLength={4}
              inputMode="numeric"
              className="sm:w-36"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void handleSearch())}
            />
            <Button
              type="button"
              className="h-[42px] bg-navy-900 text-white hover:bg-navy-800 px-4"
              onClick={() => void handleSearch()}
              disabled={searching || (!searchPhone.trim() && !searchIdLast4.trim())}
            >
              <Search className="size-4" aria-hidden />
              {searching ? "…" : t("searchGuest")}
            </Button>
          </div>
          {searchResults.length > 0 && (() => {
            // Detect if multiple results share the same id_last4 — same person,
            // different phones. Show a warning so staff picks the right record.
            const idLast4Counts: Record<string, number> = {};
            for (const g of searchResults) {
              if (g.id_last4) idLast4Counts[g.id_last4] = (idLast4Counts[g.id_last4] ?? 0) + 1;
            }
            const hasDuplicates = wasIdSearch && Object.values(idLast4Counts).some((c) => c > 1);
            return (
              <div className="space-y-2">
                {/* Duplicate warning — only when ID search returns multiple records */}
                {hasDuplicates && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                      {t("duplicateIdWarning", { count: searchResults.length })}
                    </span>
                  </div>
                )}
                <ul className="rounded-lg border divide-y">
                  {searchResults.map((g) => {
                    const isDupInResults = wasIdSearch && g.id_last4 && (idLast4Counts[g.id_last4] ?? 0) > 1;
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectExisting(g)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                        >
                          {/* Guest info — mirrors GuestPicker row layout */}
                          <span className="font-medium flex-1 min-w-0 truncate">{g.full_name}</span>
                          <span className="text-muted-foreground tabular-nums shrink-0">{g.phone_masked}</span>
                          {g.id_last4 && (
                            <span className="text-xs text-muted-foreground shrink-0">{t("idLast4", { last4: g.id_last4 })}</span>
                          )}
                          {isDupInResults && (
                            <span className="rounded-full bg-warning-bg px-2 py-0.5 text-micro font-semibold text-warning shrink-0">
                              {t("sameIdDiffPhone")}
                            </span>
                          )}
                          {g.cross_hotel && (
                            <span className="rounded-full bg-info-bg px-2 py-0.5 text-micro font-semibold text-info shrink-0">
                              {t("otherHotelBadge")}
                            </span>
                          )}
                          {/* "Select" chip — mirrors GuestPicker primary-guest rows exactly */}
                          <span className="ml-auto shrink-0 inline-flex h-7 items-center rounded-md bg-navy-900 px-2.5 text-xs font-semibold text-white">
                            {g.cross_hotel ? tg("importAction") : tg("selectGuest")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {hasDuplicates && (
                  <p className="text-micro text-muted-foreground px-1">
                    {t("duplicateIdHint")}
                  </p>
                )}
              </div>
            );
          })()}
          {/* Only show "No match" after a real search — not while typing */}
          {hasSearched && searchResults.length === 0 && !searching && (
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="text-xs text-muted-foreground">{t("noMatchFound")}</p>
              <button
                type="button"
                onClick={() => setMode("form")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gold-500 px-3 text-xs font-semibold text-navy-900 hover:bg-gold-400 transition-colors"
              >
                <UserPlus className="size-3.5" aria-hidden />
                {t("createNewGuest")}
              </button>
        </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Shared rich identity form (same one the primary guest uses).
              Foreign guest (Form C) is slotted INSIDE via beforeConfirm so
              the Confirm button always renders below it (client UX 09/2026). */}
          <NewGuestForm
            confirmLabel={t("confirmGuestDetails")}
            /* Seed the mobile field with the number that was just searched —
               same behaviour as the primary guest flow (client 09/2026). */
            initialPhone={searchPhone.trim()}
            beforeConfirm={
              <ForeignGuestSection
                enabled={fgEnabled}
                onEnabledChange={(v) => applyForeign(v, fgForm)}
                value={fgForm}
                onChange={(f) => applyForeign(fgEnabled, f)}
              />
            }
            onConfirm={(form, formDocs) => {
              // Will be created in the mutation; mark as pending-creation.
              setDocs(formDocs);
              const pending: ResolvedCoGuest = {
                guest_id: `__new__${Date.now()}`,
                full_name: form.full_name,
                phone: form.phone.trim() || undefined,
                docs: formDocs,
                foreign_guest: buildForeignGuestPayload(fgEnabled, fgForm),
              };
              // Attach the form data to the resolved object for the mutation
              (pending as ResolvedCoGuest & { _newForm?: GuestCreatePayload })._newForm = { ...form };
              setResolved(pending);
              onResolved(pending);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Post-check-in success state (shared by both modes) ─────────────────────

function CheckinSuccess({
  result,
  bookingId,
  onDone,
  doneLabel,
}: {
  readonly result: CheckInCreateOut;
  readonly bookingId: string;
  readonly onDone: () => void;
  readonly doneLabel?: string;
}) {
  const t = useTranslations("checkin");
  const ti = useTranslations("invoices");
  const api = useApi();
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  const generateInvoice = async () => {
    setGeneratingInvoice(true);
    try {
      const inv = await api<{ id: string }>("/api/v1/invoices", {
        method: "POST",
        body: { booking_id: bookingId, interstate: false },
      });
      setInvoiceId(inv.id);
      toast.success(ti("generated"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("invoiceGenerationFailed"));
    } finally {
      setGeneratingInvoice(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div className="rounded-xl border bg-white shadow-sm p-8 text-center space-y-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-success-bg mx-auto">
          <BadgeCheck className="size-8 text-success" aria-hidden />
        </div>
        <h2 className="text-xl font-bold text-foreground">{t("guestCheckedIn")}</h2>
        <div className="rounded-lg bg-muted/40 px-4 py-3">
          <p className="text-xs text-muted-foreground mb-1">{t("registrationNumbers")}</p>
          <p className="font-bold text-lg tabular-nums">
            {result.registration_numbers.join(" · ")}
          </p>
        </div>
        {invoiceId ? (
          <a
            href={`/invoices`}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-success px-4 text-sm font-medium text-white hover:bg-success"
          >
            <FileText className="size-4" aria-hidden />
            {t("viewInvoice")}
          </a>
        ) : (
          <button
            type="button"
            onClick={generateInvoice}
            disabled={generatingInvoice}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-gold-500 px-4 text-sm font-medium text-gold-700 hover:bg-gold-50 disabled:opacity-50"
          >
            <FileText className="size-4" aria-hidden />
            {generatingInvoice ? t("generating") : ti("generate")}
          </button>
        )}
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={onDone}
            className="inline-flex h-9 items-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-900/90"
          >
            {doneLabel ?? t("backToCheckin")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main check-in form ───────────────────────────────────────────────────────

function CheckinForm({
  booking: bookingProp,
  onBack,
  onDone,
}: {
  readonly booking: BookingOut;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const t = useTranslations("checkin");
  const ts = useTranslations("stay");
  const tc = useTranslations("common");
  const tb = useTranslations("bookings");
  const tg = useTranslations("guestPicker");
  const ti = useTranslations("invoices");
  const tr = useTranslations("rooms");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();

  // Live copy of the booking — room replacement reprices/reallocates it on
  // the server, so the form must re-read totals and rooms afterwards.
  const [booking, setBooking] = useState(bookingProp);
  useEffect(() => {
    setBooking(bookingProp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingProp.id]);

  const refreshBooking = async () => {
    try {
      const fresh = await api<BookingOut>(`/api/v1/bookings/${bookingProp.id}`);
      setBooking(fresh);
    } catch {
      /* keep the current copy; next action will surface the error */
    }
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-availability", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
  };

  // ── Primary guest editable state ──
  const [pgName, setPgName] = useState(booking.primary_guest_name ?? "");
  const [pgPhone, setPgPhone] = useState(booking.primary_guest_phone ?? "");
  const [pgIdType, setPgIdType] = useState("Aadhar Card");
  const [pgIdNumber, setPgIdNumber] = useState("");
  const [pgGender, setPgGender] = useState("");
  const [pgDob, setPgDob] = useState("");
  const [pgAddress, setPgAddress] = useState("");
  const [pgPostalCode, setPgPostalCode] = useState("");
  const [pgCity, setPgCity] = useState("");
  const [pgState, setPgState] = useState("");
  const [pgCountry, setPgCountry] = useState("India");
  const [pgPurpose, setPgPurpose] = useState("");
  const [pgCompany, setPgCompany] = useState("");

  // Existing doc IDs so DocUpload tiles pre-fill from B2 on mount.
  const [pgExistingDocs, setPgExistingDocs] = useState<
    Partial<Record<DocSide, string>>
  >({});

  // ── Profile autofill — advance-booking guests already have a profile; pull
  // everything we know (gender, DOB, address, ID type) AND existing document
  // images from Backblaze so the front desk never re-types or re-uploads
  // data captured at booking time.
  useEffect(() => {
    if (!booking.primary_guest_id) return;
    let cancelled = false;
    (async () => {
      const [autofillResult, docsResult] = await Promise.allSettled([
        api<GuestAutofill>(
          `/api/v1/guests/${booking.primary_guest_id}/autofill`,
          { method: "POST" },
        ),
        api<{ id: string; side: string | null }[]>(
          `/api/v1/guests/${booking.primary_guest_id}/documents`,
        ),
      ]);

      if (cancelled) return;

      if (autofillResult.status === "fulfilled") {
        const full = autofillResult.value;
        setPgName((v) => v || full.full_name);
        setPgPhone((v) => v || full.phone);
        setPgGender((v) => v || (full.gender ?? ""));
        setPgDob((v) => v || (full.date_of_birth ?? ""));
        setPgAddress((v) => v || (full.address ?? ""));
        setPgPostalCode((v) => v || (full.postal_code ?? ""));
        setPgCity((v) => v || (full.city ?? ""));
        setPgState((v) => v || (full.state ?? ""));
        setPgCountry((v) => v || (full.country ?? "India"));
        if (full.id_proof_type) setPgIdType((v) => (v === "Aadhar Card" ? full.id_proof_type! : v));
        // Show saved ID hint (client 9-08 item 8): if the guest has a stored ID
        // number, pre-fill with masked placeholder so the desk knows it's on file.
        if (full.id_last4) setPgIdNumber((v) => v || `••••••••${full.id_last4}`);
      }

      if (docsResult.status === "fulfilled") {
        const docs: Partial<Record<DocSide, string>> = {};
        for (const d of docsResult.value) {
          if (d.side === "front" || d.side === "back" || d.side === "selfie") {
            docs[d.side] = d.id;
          }
        }
        setPgExistingDocs(docs);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.primary_guest_id]);

  // ── OCR autofill state (primary guest) ──
  const [pgOcrResult, setPgOcrResult] = useState<import("@/lib/id-ocr").IdOcrResult | null>(null);

  // ── Additional guests ──
  const [coGuests, setCoGuests] = useState<ResolvedCoGuest[]>([]);
  const [guestKeys, setGuestKeys] = useState<number[]>([]); // keys for entry components

  const addGuestEntry = () => {
    const key = Date.now();
    setGuestKeys((prev) => [...prev, key]);
  };
  const removeGuestEntry = (key: number) => {
    setGuestKeys((prev) => prev.filter((k) => k !== key));
    setCoGuests((prev) => prev.filter((_, i) => i !== guestKeys.indexOf(key)));
  };
  const resolveGuest = (key: number, guest: ResolvedCoGuest) =>
    setCoGuests(resolveCoGuestUpdater(guestKeys, key, guest));

  // ── Per-room occupancy — keyed by room_id so each room is independent ──
  const [roomOccupancy, setRoomOccupancy] = useState<
    Record<string, { adults: number; children: number }>
  >(() => {
    const current = booking.rooms.filter((r) => r.is_current);
    const count = Math.max(current.length, 1);
    // Distribute the booking's initial totals across rooms.
    // Room 0 gets the remainder so the sum always equals booking totals.
    return Object.fromEntries(
      current.map((room, idx) => {
        const baseAdults = Math.max(1, Math.floor(booking.adults / count));
        const baseChildren = Math.max(0, Math.floor(booking.children / count));
        const extraAdults = idx === 0 ? booking.adults - baseAdults * count : 0;
        const extraChildren = idx === 0 ? booking.children - baseChildren * count : 0;
        return [
          room.room_id,
          {
            adults: Math.max(1, baseAdults + extraAdults),
            children: Math.max(0, baseChildren + extraChildren),
          },
        ];
      }),
    );
  });

  const setRoomAdults = (roomId: string, delta: number) =>
    setRoomOccupancy((prev) => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        adults: Math.max(1, Math.min(20, (prev[roomId]?.adults ?? 1) + delta)),
      },
    }));

  const setRoomChildren = (roomId: string, delta: number) =>
    setRoomOccupancy((prev) => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        children: Math.max(0, Math.min(10, (prev[roomId]?.children ?? 0) + delta)),
      },
    }));

  // Totals for the booking PATCH (sum of all rooms)
  const totalAdults = Object.values(roomOccupancy).reduce((s, r) => s + r.adults, 0);
  const totalChildren = Object.values(roomOccupancy).reduce((s, r) => s + r.children, 0);

  // ── Special requirements ──
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [serviceAmounts, setServiceAmounts] = useState<Record<string, string>>({});
  const [specialInstructions, setSpecialInstructions] = useState("");
  const toggleService = (id: string) =>
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  // ── Payment details ──
  const [advanceAmount, setAdvanceAmount] = useState("0");
  const [extraCharges, setExtraCharges] = useState("0");
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "credit_card" | "debit_card" | "bank_transfer" | "other">("cash");
  const [paymentReceived, setPaymentReceived] = useState(false);

  // ── Emergency + vehicle ──
  const [emName, setEmName] = useState(booking.emergency_contact_name ?? "");
  const [emRelation, setEmRelation] = useState(booking.emergency_contact_relation ?? "");
  const [emPhone, setEmPhone] = useState(booking.emergency_contact_phone ?? "");
  const [vehNumber, setVehNumber] = useState(booking.vehicle_number ?? "");
  // A stored vehicle_type outside the fixed options means "Other" was chosen
  // with a custom name — re-open as Other + prefill the name input.
  const knownVehType =
    !booking.vehicle_type || VEHICLE_TYPE_OPTIONS.includes(booking.vehicle_type);
  const [vehType, setVehType] = useState(
    knownVehType ? (booking.vehicle_type ?? "Car") : "Other",
  );
  const [vehTypeOther, setVehTypeOther] = useState(
    knownVehType ? "" : (booking.vehicle_type ?? ""),
  );
  const [vehMake, setVehMake] = useState("");
  const [parkingSlot, setParkingSlot] = useState(booking.parking_slot ?? "");

  // ── Stay dates + times (same custom DateTimePicker as walk-in) ──
  const [checkInDate, setCheckInDate] = useState(booking.check_in_date ?? "");
  const [checkOutDate, setCheckOutDate] = useState(booking.check_out_date ?? "");
  const [checkInTime, setCheckInTime] = useState(booking.check_in_time?.slice(0, 5) ?? "");
  const [earlyFee, setEarlyFee] = useState(0);
  const [checkOutTime, setCheckOutTime] = useState(
    booking.check_out_time?.slice(0, 5) ?? "",
  );

  // ── Foreign guest (Form C) ──
  const [fgEnabled, setFgEnabled] = useState(false);
  const [fgForm, setFgForm] = useState<ForeignGuestFormState>(EMPTY_FOREIGN_GUEST);

  // ── Terms ──
  const [terms, setTerms] = useState(false);

  // ── Post-check-in state ──
  const [checkinResult, setCheckinResult] = useState<CheckInCreateOut | null>(null);

  // ── Error ──
  const [error, setError] = useState<string | null>(null);

  // ── Section refs — scroll the first invalid section into view on submit ──
  const identitySectionRefB = useRef<HTMLDivElement | null>(null);
  const termsSectionRefB = useRef<HTMLDivElement | null>(null);

  // ── Hotel services ──
  const services = useQuery({
    queryKey: ["hotel-services", activeHotelId],
    queryFn: () => api<ServiceItem[]>("/api/v1/hotels/me/services"),
    enabled: !!activeHotelId,
  });

  // ── Hotel settings (for early check-in fee calculation) ──
  const checkinSettings = useQuery({
    queryKey: ["hotel-settings", activeHotelId],
    queryFn: () =>
      api<{
        check_in_time: string;
        check_out_time: string;
        early_checkin_fee_per_hour?: string;
        early_checkin_grace_minutes?: number;
        collect_emergency_contact?: boolean;
        collect_vehicle_details?: boolean;
      }>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });

  // Hotel GST settings for accurate payment breakdown.
  const gstSettings = useQuery({
    queryKey: ["gst-settings", activeHotelId],
    queryFn: () =>
      api<{ gst_mode: string; default_cgst_rate: string; default_sgst_rate: string }>(
        "/api/v1/hotels/me/gst",
      ),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });
  // GST is only ADDED ON TOP for "included_by_customer" hotels (client
  // 09/2026 modes): no_gst charges no tax, included_by_hotel keeps tax
  // inside the rate — in both cases nothing extra appears in the balance.
  const hotelGstRate =
    gstSettings.data?.gst_mode === "included_by_customer"
      ? Number.parseFloat(gstSettings.data.default_cgst_rate) +
          Number.parseFloat(gstSettings.data.default_sgst_rate) || 5
      : 0;

  // Prefill hotel standard times when the booking has none — keeps the
  // custom picker from opening on an empty native clock.
  useEffect(() => {
    const s = checkinSettings.data;
    if (!s) return;
    setCheckInTime((t) => t || s.check_in_time?.slice(0, 5) || "");
    setCheckOutTime((t) => t || s.check_out_time?.slice(0, 5) || "");
  }, [checkinSettings.data]);

  // Auto early check-in fee — recomputed whenever check-in time changes.
  useEffect(() => {
    const s = checkinSettings.data;
    if (!s || !checkInTime) { setEarlyFee(0); return; }
    const rate = Number.parseFloat(s.early_checkin_fee_per_hour ?? "0");
    if (rate <= 0) { setEarlyFee(0); return; }
    const grace = s.early_checkin_grace_minutes ?? 0;
    const standardTime = s.check_in_time?.slice(0, 5) ?? "";
    if (!standardTime) { setEarlyFee(0); return; }
    setEarlyFee(calcEarlyCheckinFee(checkInTime, standardTime, grace, rate));
  }, [checkInTime, checkinSettings.data]);

  // UPI QR code — fetched as a blob URL when mode is UPI.
  const advanceAmountNum = Number.parseFloat(advanceAmount) || 0;
  const showQrCheckin = paymentMode === "upi" && advanceAmountNum > 0;
  const qrImageQueryCheckin = useQuery({
    queryKey: ["hotel-qr-png", activeHotelId],
    queryFn: async () => {
      const token = getAccessToken();
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr/image?v=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "X-Hotel-Id": activeHotelId ?? "",
        },
        credentials: "include",
        cache: "no-store",
      });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    },
    enabled: showQrCheckin && !!activeHotelId,
    staleTime: 300_000,
  });

  const currentRooms = booking.rooms.filter((r) => r.is_current);

  // ── Computed balance ──
  const bookingTotal = Number.parseFloat(booking.total_amount) || 0;
  const advPaid = Number.parseFloat(booking.advance_amount) || 0;
  const newAdvance = Number.parseFloat(advanceAmount) || 0;
  const extraChargesNum = Number.parseFloat(extraCharges || "0") || 0;
  // Selected service chips (staff-edited amounts) — they are billed via the
  // atomic charges array, so the balance must include them.
  const chipsTotal = useMemo(
    () =>
      (services.data ?? [])
        .filter((s) => selectedServices.includes(s.id))
        .reduce(
          (sum, s) =>
            sum + (Number.parseFloat(serviceChargeAmount(s, serviceAmounts)) || 0),
          0,
        ),
    [services.data, selectedServices, serviceAmounts],
  );
  // Early check-in fee is billed too (is_early/early_fee on the request).
  const displayExtra = chipsTotal + extraChargesNum + earlyFee;
  // Booking totals are GST-AWARE since plan §3.1 (room GST is already inside
  // booking.total_amount) — the approximate GST here applies ONLY to the NEW
  // extras being added at the desk (they get real GST via add_charge).
  // Adding GST on the booking total again would double-count it.
  const gstAmount = Math.round(displayExtra * (hotelGstRate / 100));
  // Only subtract the new advance when staff confirmed it was actually collected —
  // otherwise it is not recorded and the balance would be dishonest.
  const collectedAdvance = paymentReceived ? newAdvance : 0;
  const payable = bookingTotal + displayExtra + gstAmount;
  const balance = Math.max(payable - advPaid - collectedAdvance, 0);
  // Collected more than the bill → say so instead of silently showing ₹0.
  const overpaid = Math.max(advPaid + collectedAdvance - payable, 0);

  // ── Mutation ─────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async () => {
      if (fgEnabled && fgForm.passport_number.trim().length < 3) {
        throw new ApiError(400, "validation", t("passportRequired"));
      }
      // Co-guests marked foreign need a passport number too.
      if (
        coGuests
          .filter(Boolean)
          .some((cg) => cg.foreign_guest && cg.foreign_guest.passport_number.trim().length < 3)
      ) {
        throw new ApiError(400, "validation", t("passportRequired"));
      }

      // 1. Update primary guest if anything changed
      const originalName = booking.primary_guest_name ?? "";
      if (
        booking.primary_guest_id &&
        (pgName !== originalName ||
          pgIdType ||
          pgIdNumber ||
          pgGender ||
          pgDob ||
          pgAddress)
      ) {
        const body: Record<string, string | null> = {};
        if (pgName && pgName !== originalName) body.full_name = pgName;
        if (pgPhone && pgPhone !== (booking.primary_guest_phone ?? "")) body.phone = pgPhone;
        if (pgGender) body.gender = pgGender;
        if (pgDob) body.date_of_birth = pgDob;
        if (pgAddress) body.address = pgAddress;
        if (pgPostalCode) body.postal_code = pgPostalCode;
        if (pgCity) body.city = pgCity;
        if (pgState) body.state = pgState;
        if (pgCountry) body.country = pgCountry;
        if (pgIdType) body.id_proof_type = pgIdType;
        // Skip masked placeholder and strip any OCR whitespace before sending.
        if (pgIdNumber && !isIdMask(pgIdNumber)) body.id_number = pgIdNumber.replace(/\s/g, "");
        if (Object.keys(body).length > 0) {
          await api(`/api/v1/guests/${booking.primary_guest_id}`, {
            method: "PATCH",
            body,
          });
        }
      }

      // 2. Create new additional guests + resolve IDs (incl. Form C payloads)
      const resolvedCoGuests: CoGuestIn[] = [];
      for (const cg of coGuests.filter(Boolean)) {
        const isNew = cg.guest_id.startsWith("__new__");
        if (isNew) {
          const newForm = (
            cg as ResolvedCoGuest & { _newForm?: GuestCreatePayload }
          )._newForm;
          if (!newForm) continue;
          const created = await api<{ id: string }>("/api/v1/guests", {
        method: "POST",
        body: {
              full_name: newForm.full_name.trim(),
              phone: newForm.phone.trim(),
              email: newForm.email?.trim() || undefined,
              address: newForm.address?.trim() || undefined,
              city: newForm.city?.trim() || undefined,
              state: newForm.state?.trim() || undefined,
              country: newForm.country?.trim() || undefined,
              postal_code: newForm.postal_code?.trim() || undefined,
              gender: newForm.gender?.trim() || undefined,
              date_of_birth: newForm.date_of_birth?.trim() || undefined,
              id_proof_type: newForm.id_proof_type?.trim() || undefined,
              id_number: newForm.id_number?.trim() || undefined,
            },
          });
          // Non-blocking doc uploads (audit finding storage HIGH #5): a failed
          // upload must not abort check-in; docs can be added later in settings.
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            apiUpload(`/api/v1/guests/${created.id}/documents`, form, {
              hotelId: activeHotelId ?? undefined,
            }).catch((err: unknown) => {
              console.warn("[checkin] co-guest doc upload failed:", err);
            });
          }
          resolvedCoGuests.push({
            guest_id: created.id,
            foreign_guest: cg.foreign_guest ?? null,
            alternate_contact_phone: cg.alternate_contact_phone || undefined,
          });
        } else {
          // Existing guest — upload queued docs (non-blocking; failures just warn)
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            apiUpload(`/api/v1/guests/${cg.guest_id}/documents`, form, {
              hotelId: activeHotelId ?? undefined,
            }).catch((err: unknown) => console.warn("[checkin] co-guest doc upload:", err));
          }
          resolvedCoGuests.push({
            guest_id: cg.guest_id,
            foreign_guest: cg.foreign_guest ?? null,
            alternate_contact_phone: cg.alternate_contact_phone || undefined,
          });
        }
      }

      // 3. Update booking meta (emergency + vehicle + adults/children)
      const bookingPatch: Record<string, unknown> = {};
      if (emName || emRelation || emPhone) {
        bookingPatch.emergency_contact_name = emName || null;
        bookingPatch.emergency_contact_relation = emRelation || null;
        bookingPatch.emergency_contact_phone = emPhone || null;
      }
      if (vehNumber || vehType !== "Car" || parkingSlot) {
        bookingPatch.vehicle_number = vehNumber || null;
        bookingPatch.vehicle_type = effectiveVehicleType(vehType, vehTypeOther) || null;
        bookingPatch.parking_slot = parkingSlot || null;
      }
      if (totalAdults !== booking.adults) bookingPatch.adults = totalAdults;
      if (totalChildren !== booking.children) bookingPatch.children = totalChildren;
      if (checkInDate && checkInDate !== booking.check_in_date) {
        bookingPatch.check_in_date = checkInDate;
      }
      if (checkOutDate && checkOutDate !== booking.check_out_date) {
        bookingPatch.check_out_date = checkOutDate;
      }
      if (checkInTime && checkInTime !== (booking.check_in_time?.slice(0, 5) ?? "")) {
        bookingPatch.check_in_time = checkInTime;
      }
      if (checkOutTime && checkOutTime !== (booking.check_out_time?.slice(0, 5) ?? "")) {
        bookingPatch.check_out_time = checkOutTime;
      }
      if (Object.keys(bookingPatch).length > 0) {
        await api(`/api/v1/bookings/${booking.id}`, {
          method: "PATCH",
          body: bookingPatch,
        });
      }

      // 4. Check in — charges + advance payment are applied atomically by the
      // backend inside the check-in transaction (no separate /charges or
      // /payments calls needed).
      // NOTE: early_fee is passed via is_early/early_fee — the backend
      // (stay.check_in) adds it to booking.total_amount and booking.due_amount.
      // Do NOT also put it in the charges array — that would double-charge.
      const chosen = (services.data ?? []).filter((s) =>
        selectedServices.includes(s.id),
      );
      const chargesList: CheckInChargeIn[] = chosen.map((svc) => ({
        description: svc.name,
        amount: serviceChargeAmount(svc, serviceAmounts),
        category: "other",
      }));
      const ecNum = Number.parseFloat(extraCharges) || 0;
      if (ecNum > 0) {
        chargesList.push({
          description: "Additional charges at check-in",
          amount: extraCharges,
          category: "other",
        });
      }
      const checkinBody: CheckInRequest = {
        booking_id: booking.id,
        co_guests: resolvedCoGuests,
        purpose_of_visit: pgPurpose.trim() || null,
        company_name: pgCompany.trim() || null,
        is_early: earlyFee > 0,
        early_fee: earlyFee.toString(),
        check_out_time: checkOutTime || null,
        terms_acknowledged: terms,
        foreign_guest: buildForeignGuestPayload(fgEnabled, fgForm),
        charges: chargesList,
        advance_payment:
          paymentReceived && newAdvance > 0
            ? { amount: advanceAmount, method: paymentMode }
            : null,
      };
      const checkinOut = await api<CheckInCreateOut>("/api/v1/checkins", {
        method: "POST",
        body: checkinBody,
      });

      // 5. Add special instructions as a note (via booking patch if changed)
      if (specialInstructions.trim()) {
        await api(`/api/v1/bookings/${booking.id}`, {
          method: "PATCH",
          body: { special_requests: specialInstructions.trim() },
        });
      }

      return checkinOut;
    },
    onSuccess: (result) => {
      setCheckinResult(result);
    setError(null);
      // Cross-page invalidation (plan Part 6): check-in moves rooms AND money.
      invalidateRoomState(queryClient);
      invalidateMoney(queryClient);
      toast.success(t("checkedInToastReg", { regs: result.registration_numbers.join(", ") }));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("checkinFailed")),
  });

  // ── Post-check-in success state ──────────────────────────────────────────
  if (checkinResult) {
  return (
      <CheckinSuccess
        result={checkinResult}
        bookingId={booking.id}
        onDone={onDone}
        doneLabel={t("backToCheckinList")}
      />
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-12">
      {/* Back */}
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {ts("backToList")}
      </button>

      {/* ── 1. Booking Details ─────────────────────────────────────────────── */}
      {/* Client 9-08 item 22: compact one-line summary row (BK-XXXX · dates · guest type) */}
      <Section icon={ClipboardList} title={ts("bookingDetailsTitle")} subtitle={ts("bookingDetailsSubtitle")}>
        <div className="space-y-3">
          {/* Compact summary banner — shows booking number, dates, guest type at a glance */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="font-semibold text-foreground">{booking.booking_number}</span>
            <span className="text-muted-foreground">
              {fmtApiDateTime(booking.check_in_date, booking.check_in_time)}
              {" → "}
              {fmtApiDateTime(booking.check_out_date, booking.check_out_time)}
            </span>
            {booking.guest_type && (
              <span className="rounded-full bg-gold-100 px-2 py-0.5 text-label font-semibold text-gold-700 capitalize">
                {booking.guest_type}
              </span>
            )}
          </div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("checkinDateTime")}</Label>
              <DateTimePicker
                dateValue={checkInDate}
                timeValue={checkInTime}
                onDateChange={setCheckInDate}
                onTimeChange={setCheckInTime}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("checkoutDateTime")}</Label>
              <DateTimePicker
                dateValue={checkOutDate}
                timeValue={checkOutTime}
                onDateChange={setCheckOutDate}
                onTimeChange={setCheckOutTime}
                min={checkInDate}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("guestTypeLabel")}</Label>
              <select
                value={pgPurpose}
                onChange={(e) => setPgPurpose(e.target.value)}
                className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">{t("select")}</option>
                <option value="Business">{t("purpose_business")}</option>
                <option value="Leisure">{t("purpose_leisure")}</option>
                <option value="Medical">{t("purpose_medical")}</option>
                <option value="Wedding">{t("purpose_wedding")}</option>
                <option value="Other">{t("purpose_other")}</option>
              </select>
            </div>
            {pgPurpose === "Business" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("company")}</Label>
                <Input value={pgCompany} onChange={(e) => setPgCompany(e.target.value)} placeholder={t("companyPlaceholder")} />
              </div>
            )}
          </div>

          {/* Allocated room(s) with availability-aware replacement */}
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {t("allocatedRooms")}
            </Label>
            <RoomReplaceControl booking={booking} onReplaced={() => void refreshBooking()} />
          </div>
          {earlyFee > 0 && (() => {
            const rate = Number.parseFloat(checkinSettings.data?.early_checkin_fee_per_hour ?? "1") || 1;
            const hrs = Math.max(1, Math.round(earlyFee / rate));
            return (
              <div className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
                Early check-in by {hrs} hr{hrs !== 1 ? "s" : ""} — {fmtINR(earlyFee)} fee will be added to the bill
              </div>
            );
          })()}
        </div>
      </Section>

      {/* ── 2. Primary Guest Identity Verification ────────────────────────── */}
      <div ref={identitySectionRefB}>
      <Section icon={BadgeCheck} title={ts("primaryGuestTitle")} subtitle={ts("primaryGuestSubtitle")}>
        <div className="space-y-5">
          {/* ID type + number */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("idType")}</Label>
              <select
                value={pgIdType}
                onChange={(e) => setPgIdType(e.target.value)}
                className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="Aadhar Card">{t("idAadhar")}</option>
                <option value="PAN Card">{t("idPan")}</option>
                <option value="Passport">{t("idPassport")}</option>
                <option value="Driving License">{t("idDrivingLicense")}</option>
                <option value="Voter ID">{t("idVoter")}</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <MaskedIdInput
                label={t("idNoOf", { type: pgIdType.toUpperCase() })}
                idType={pgIdType}
                value={pgIdNumber}
                onChange={setPgIdNumber}
                placeholder={t("enterIdNumber", { type: pgIdType })}
                onReveal={
                  booking.primary_guest_id
                    ? async () => {
                        const res = await api<{ id_number: string | null }>(
                          `/api/v1/guests/${booking.primary_guest_id}/reveal-id`,
                          { method: "POST" },
                        );
                        return res.id_number;
                      }
                    : undefined
                }
              />
            </div>
          </div>

          {/* Document uploads — pre-filled from B2; key=guestId+side prevents
              stale blob from prior session leaking into a re-opened booking. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <DocUpload
              key={`${booking.primary_guest_id}-front`}
              guestId={booking.primary_guest_id ?? null}
              side="front"
              label={t("uploadFrontFace")}
              idType={pgIdType}
              existingDocId={pgExistingDocs.front}
              onOcrResult={(result) => setPgOcrResult(result)}
            />
            <DocUpload
              key={`${booking.primary_guest_id}-back`}
              guestId={booking.primary_guest_id ?? null}
              side="back"
              label={t("uploadBackFace")}
              idType={pgIdType}
              existingDocId={pgExistingDocs.back}
              onOcrResult={(result) => {
                if (result.fields.address) {
                  setPgAddress((prev) => prev || (result.fields.address ?? ""));
                  if (result.fields.pincode) {
                    setPgPostalCode((prev) => prev || (result.fields.pincode ?? ""));
                  }
                  if (result.fields.city) {
                    setPgCity((prev) => prev || (result.fields.city ?? ""));
                  }
                  if (result.fields.state) {
                    setPgState((prev) => prev || (result.fields.state ?? ""));
                  }
                  toast.success(t("formAutofilled"));
                } else {
                  toast.warning(result.message);
                }
              }}
            />
            <DocUpload
              key={`${booking.primary_guest_id}-selfie`}
              guestId={booking.primary_guest_id ?? null}
              side="selfie"
              label={t("selfieCapture")}
              existingDocId={pgExistingDocs.selfie}
            />
          </div>

          {/* OCR autofill banner — appears after front-face upload */}
          {pgOcrResult && (
            <AutofillBanner
              result={pgOcrResult}
              onAccept={(fields) => {
                if (fields.name) setPgName(fields.name);
                if (fields.id_number && !isIdMask(fields.id_number)) {
                  const idType = fields.id_type_detected ?? pgIdType ?? "Aadhar Card";
                  const cleaned = idType === "Aadhar Card" ? sanitizeAadhaarOcr(fields.id_number) : fields.id_number.trim();
                  setPgIdNumber(cleaned);
                }
                if (fields.gender) setPgGender(fields.gender);
                if (fields.date_of_birth) setPgDob(fields.date_of_birth);
                if (fields.address) setPgAddress(fields.address);
                if (fields.id_type_detected) setPgIdType(fields.id_type_detected);
                setPgOcrResult(null);
                toast.success(t("formAutofilled"));
              }}
              onDismiss={() => setPgOcrResult(null)}
            />
          )}

          {/* Guest personal details */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{tg("fullName")}</Label>
              <Input value={pgName} onChange={(e) => setPgName(liveNameCase(e.target.value))} placeholder={tg("fullName")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("phoneNumber")}</Label>
              <Input value={pgPhone} onChange={(e) => setPgPhone(sanitizeGuestPhone(e.target.value))} maxLength={15} placeholder={t("phonePlaceholder")} inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldGender")}</Label>
              <select
                value={pgGender}
                onChange={(e) => setPgGender(e.target.value)}
                className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">{t("selectOption")}</option>
                <option value="Male">{t("male")}</option>
                <option value="Female">{t("female")}</option>
                <option value="Other">{t("genderOther")}</option>
              </select>
          </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldDob")}</Label>
              <DatePicker value={pgDob} onChange={setPgDob} max={localToday()} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldAddress")}</Label>
              <Input value={pgAddress} onChange={(e) => setPgAddress(e.target.value)} placeholder={t("fieldAddress")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldPincode")}</Label>
              <Input
                value={pgPostalCode}
                onChange={(e) => setPgPostalCode(e.target.value)}
                placeholder={t("fieldPincode")}
                inputMode="numeric"
                maxLength={6}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldCity")}</Label>
              <Input value={pgCity} onChange={(e) => setPgCity(e.target.value)} placeholder={t("fieldCity")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldState")}</Label>
              <Input value={pgState} onChange={(e) => setPgState(e.target.value)} placeholder={t("fieldState")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldCountry")}</Label>
              <Input value={pgCountry} onChange={(e) => setPgCountry(e.target.value)} placeholder={t("fieldCountry")} />
            </div>
          </div>

          {/* Foreign guest (Form C) */}
          <ForeignGuestSection
            enabled={fgEnabled}
            onEnabledChange={setFgEnabled}
            value={fgForm}
            onChange={setFgForm}
          />
        </div>
      </Section>
      </div>

      {/* ── 3. Additional Guests ──────────────────────────────────────────── */}
      <Section
        icon={Users}
        title={t("additionalGuests")}
        subtitle={t("addCoGuestsBooking")}
        badge={coGuests.some(Boolean) ? String(coGuests.filter(Boolean).length) : undefined}
      >
        <div className="space-y-4">
          {guestKeys.map((key, i) => (
            <AdditionalGuestEntry
              key={key}
              idx={i}
              onResolved={(g) => resolveGuest(key, g)}
              onRemove={() => removeGuestEntry(key)}
            />
          ))}
                <button
                  type="button"
            onClick={addGuestEntry}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
          >
            <Plus className="size-4" aria-hidden />
            {t("addGuest")}
                </button>
        </div>
      </Section>

      {/* ── 4. Room Information ───────────────────────────────────────────── */}
      <Section icon={BedDouble} title={t("roomInformation")} subtitle={t("roomAssignment")}>
        <div className="space-y-4">
          {currentRooms.map((room) => (
            <div key={room.room_id} className="grid gap-3 sm:grid-cols-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{tr("roomNumber")}</Label>
                <div className="h-9 rounded-lg border bg-muted/40 px-2.5 flex items-center text-sm font-medium">
                  {room.room_number}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{tr("roomType")}</Label>
                <div className="h-9 rounded-lg border bg-muted/40 px-2.5 flex items-center text-sm text-muted-foreground">
                  {room.room_type_name}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{tb("adults")}</Label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRoomAdults(room.room_id, -1)}
                    className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
                    aria-label={t("removeAdult")}
                  >
                    <Minus className="size-3.5" aria-hidden />
                  </button>
                  <span className="w-6 text-center tabular-nums font-semibold">
                    {roomOccupancy[room.room_id]?.adults ?? 1}
            </span>
                  <button
                    type="button"
                    onClick={() => setRoomAdults(room.room_id, 1)}
                    className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
                    aria-label={t("addAdult")}
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{tb("children")}</Label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRoomChildren(room.room_id, -1)}
                    className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
                    aria-label={t("removeChild")}
                  >
                    <Minus className="size-3.5" aria-hidden />
                  </button>
                  <span className="w-6 text-center tabular-nums font-semibold">
                    {roomOccupancy[room.room_id]?.children ?? 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRoomChildren(room.room_id, 1)}
                    className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
                    aria-label={t("addChild")}
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              </div>
            ))}
        </div>
      </Section>

      {/* ── 5. Special Requirements ───────────────────────────────────────── */}
      <Section icon={Star} title={ts("specialRequirements")}>
        <div className="space-y-4">
          {services.isLoading && <Skeleton className="h-10" />}
          {(services.data?.length ?? 0) > 0 && (
            <ServiceChips
              services={services.data ?? []}
              selectedIds={selectedServices}
              onToggle={toggleService}
              amounts={serviceAmounts}
              onAmountChange={(id, amount) =>
                setServiceAmounts((prev) => ({ ...prev, [id]: amount }))
              }
            />
          )}
          <SelectedServicesList
            services={services.data ?? []}
            selectedIds={selectedServices}
            amounts={serviceAmounts}
          />
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {t("specialInstructions")}
            </Label>
            <textarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder={t("instructionsPlaceholder")}
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
          </div>
        </div>
      </Section>

      {/* ── 6. Payment Details ────────────────────────────────────────────── */}
      <Section icon={CreditCard} title={ts("paymentDetails")} subtitle={t("paymentSubtitleBooking")}>
        <div className="space-y-4">
          {/* Top row: informational amounts */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                {t("bookingAmount")}
              </Label>
              <p className="mt-1 tabular-nums font-medium">{fmtINR(booking.total_amount)}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                {t("gst")}
              </Label>
              <p className="mt-1 tabular-nums">{fmtINR(booking.tax_amount)}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                {t("alreadyPaid")}
                <span className="ml-1 text-micro font-normal text-muted-foreground/70">{t("fromBooking")}</span>
              </Label>
              {/* Read-only — this is advance paid when booking was created */}
              <p
                className={cn(
                  "mt-1 tabular-nums font-semibold",
                  advPaid > 0 ? "text-success" : "text-muted-foreground",
                )}
              >
                {fmtINR(booking.advance_amount || "0")}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                {tb("securityDeposit")}
              </Label>
              <p className="mt-1 tabular-nums">{fmtINR(booking.security_deposit)}</p>
            </div>
          </div>

          {/* Bottom row: collection inputs */}
          <div className="rounded-xl border bg-muted/20 px-4 py-4 space-y-4">
            {/* Payment summary breakdown — column count follows the GST tile:
                a fixed 5-col grid left an empty bordered gap for no-GST
                hotels (client 16/09 screenshot). */}
            <div className={cn("grid grid-cols-2 gap-2 rounded-lg border bg-background px-3 py-3", hotelGstRate > 0 ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
              <div className="space-y-1 text-center">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{t("roomRentLabel")}</p>
                <p className="text-sm font-bold tabular-nums">{fmtINR(bookingTotal)}</p>
              </div>
              <div className="space-y-1 text-center">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{t("extraChargesLabel")}</p>
                {/* Auto-filled: service chips + early fee + the manual entry below. */}
                <p className="text-sm font-bold tabular-nums">{fmtINR(displayExtra)}</p>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={extraCharges}
                  onChange={(e) => setExtraCharges(e.target.value)}
                  className="h-7 text-center text-sm tabular-nums px-1"
                  placeholder="0"
                />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Advance Paid</p>
                <p className="text-sm font-bold tabular-nums">{fmtINR(advPaid)}</p>
              </div>
              {/* GST tile only when tax is added on top (client 09/2026 modes) */}
              {hotelGstRate > 0 && (
                <div className="space-y-1 text-center">
                  <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">GST ({hotelGstRate}%)</p>
                  <p className="text-sm font-bold tabular-nums">{fmtINR(gstAmount)}</p>
                </div>
              )}
              <div className="space-y-1 text-center">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Remaining</p>
                <p className={cn("text-sm font-bold tabular-nums", balance > 0 ? "text-gold-600" : "text-success")}>{fmtINR(balance)}</p>
                {overpaid > 0 && (
                  <p className="text-micro font-medium text-warning">
                    {t("overpaidHint", { amount: fmtINR(overpaid) })}
                  </p>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
                <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("collectAtCheckin")}
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  className="tabular-nums"
                  placeholder="0"
                />
                <p className="text-micro text-muted-foreground">{t("enterZeroHint")}</p>
            </div>
            <div className="space-y-1.5">
                <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("paymentMode")}
                </Label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as "cash" | "upi" | "credit_card" | "debit_card" | "bank_transfer" | "other")}
                  className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  disabled={newAdvance === 0}
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="debit_card">Debit Card</option>
                  <option value="bank_transfer">Net Banking</option>
                  <option value="other">Other</option>
                </select>
                {/* Card/bank: friendly record note */}
                {paymentMode !== "cash" && paymentMode !== "upi" && newAdvance > 0 && (
                  <p className="mt-1 text-label text-info flex items-center gap-1">
                    <span>ℹ</span>
                    {paymentMode === "credit_card" || paymentMode === "debit_card"
                      ? t("manualRecordCard")
                      : paymentMode === "bank_transfer"
                      ? t("manualRecordBank")
                      : t("manualRecordOther")}
                  </p>
                )}
                {showQrCheckin && (
                  <div className="mt-2">
                    <UpiQrBlock
                      qrUrl={qrImageQueryCheckin.data}
                      loading={qrImageQueryCheckin.isLoading}
                    />
            </div>
                )}
          </div>
              <div className="space-y-1">
                <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("balanceAfterCheckin")}
                </Label>
                <p
                  className={cn(
                    "mt-2 text-lg tabular-nums font-bold",
                    balance > 0 ? "text-gold-600" : "text-success",
                  )}
                >
                  {fmtINR(balance)}
                </p>
                {balance > 0 && (
                  <p className="text-micro text-muted-foreground">{t("dueAtCheckout")}</p>
                )}
                {balance === 0 && newAdvance > 0 && (
                  <p className="text-micro text-success">{t("fullyPaid")}</p>
                )}
              </div>
            </div>
            {/* Payment received confirmation */}
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={paymentReceived}
                onChange={(e) => setPaymentReceived(e.target.checked)}
                disabled={newAdvance === 0}
              />
              <span className={newAdvance === 0 ? "text-muted-foreground" : "font-medium"}>
                Payment collected from guest
              </span>
            </label>
            {!paymentReceived && newAdvance > 0 && (
              <p className="text-xs font-medium text-warning">
                {t("advanceNotRecordedWarning")}
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* ── 7. Emergency Contact (hidden when disabled in Edit Hotel) ────── */}
      {checkinSettings.data?.collect_emergency_contact !== false && (
      <Section icon={AlertTriangle} title={t("emergencyContact")} subtitle={t("optional")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("contactName")}</Label>
            <Input value={emName} onChange={(e) => setEmName(liveNameCase(e.target.value))} placeholder={t("contactNamePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("contactRelation")}</Label>
            <Input value={emRelation} onChange={(e) => setEmRelation(e.target.value)} placeholder={t("relationPlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("phoneNumber")}</Label>
            <Input value={emPhone} onChange={(e) => setEmPhone(sanitizeGuestPhone(e.target.value))} maxLength={15} placeholder={t("phonePlaceholder")} inputMode="tel" />
          </div>
        </div>
      </Section>
      )}

      {/* ── 8. Vehicle Details (hidden when disabled in Edit Hotel) ──────── */}
      {checkinSettings.data?.collect_vehicle_details !== false && (
      <Section icon={Car} title={t("vehicleDetails")} subtitle={t("optional")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("vehicleNumber")}</Label>
            <Input value={vehNumber} onChange={(e) => setVehNumber(e.target.value)} placeholder="MH 12 AB 1234" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("vehicleType")}</Label>
            <select
              value={vehType}
              onChange={(e) => setVehType(e.target.value)}
              className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="Car">{t("veh_car")}</option>
              <option value="Bike">{t("veh_bike")}</option>
              <option value="Auto">{t("veh_auto")}</option>
              <option value="Taxi">{t("veh_taxi")}</option>
              <option value="Bus">{t("veh_bus")}</option>
              <option value="Other">{t("veh_other")}</option>
            </select>
          </div>
          {vehType === "Other" && (
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("vehicleTypeName")}</Label>
              <Input
                value={vehTypeOther}
                onChange={(e) => setVehTypeOther(e.target.value)}
                placeholder={t("vehicleTypeNamePlaceholder")}
                maxLength={40}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("makeName")}</Label>
            <Input value={vehMake} onChange={(e) => setVehMake(e.target.value)} placeholder={t("makePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("parkingSlot")}</Label>
            <Input value={parkingSlot} onChange={(e) => setParkingSlot(e.target.value)} placeholder="A-12" />
          </div>
        </div>
      </Section>
      )}

      {/* Early check-in fee is now auto-computed and shown in the Booking Details banner above. */}

      {/* ── Footer: Terms + Actions ───────────────────────────────────────── */}
      <div ref={termsSectionRefB} className="rounded-xl border bg-white shadow-sm px-5 py-4 space-y-4">
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input shrink-0"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
          />
          <span className="text-muted-foreground leading-relaxed">
            {ts("termsAgreement")}
          </span>
        </label>

          {error && (
          <p className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" onClick={onBack}>
            {tc("cancel")}
            </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled
              title={t("availableAfterCheckin")}
            >
              <FileText className="size-4" aria-hidden />
              {ti("generate")}
            </Button>
            {/* Wrapper catches clicks while the Button is disabled
                (disabled:pointer-events-none) and scrolls to the unmet
                requirement. */}
            <span
              onClick={() => {
                if (!terms && !mutation.isPending) {
                  setError(t("requireTerms"));
                  termsSectionRefB.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }
              }}
            >
              <Button
                type="button"
                disabled={mutation.isPending || !terms}
                className="bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold"
                onClick={() => {
                  if (fgEnabled && fgForm.passport_number.trim().length < 3) {
                    setError(t("passportRequired"));
                    identitySectionRefB.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    });
                    return;
                  }
                  setError(null);
                  mutation.mutate();
                }}
              >
                <LogIn className="size-4" aria-hidden />
                {mutation.isPending ? t("checkingIn") : tb("checkInAction")}
              </Button>
            </span>
          </div>
        </div>
        {!terms && !mutation.isPending && (
          <p className="text-right text-xs text-muted-foreground">{t("requireTerms")}</p>
        )}
      </div>
    </div>
  );
}

// ─── Walk-in Check-in form (MODE A) ──────────────────────────────────────────
// The check-in page IS the booking: one form, one "Check In" button that books
// AND checks in atomically via POST /api/v1/checkins/book-and-checkin.

/** +/- counter control used for adults/children in walk-in mode. */
function CountControl({
  value,
  onDelta,
  min,
  max,
  decLabel,
  incLabel,
}: {
  readonly value: number;
  readonly onDelta: (delta: number) => void;
  readonly min: number;
  readonly max: number;
  readonly decLabel: string;
  readonly incLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
                <button
                  type="button"
        onClick={() => onDelta(-1)}
        disabled={value <= min}
        className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40"
        aria-label={decLabel}
      >
        <Minus className="size-3.5" aria-hidden />
      </button>
      <span className="w-6 text-center tabular-nums font-semibold">{value}</span>
      <button
        type="button"
        onClick={() => onDelta(1)}
        disabled={value >= max}
        className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40"
        aria-label={incLabel}
      >
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function WalkInCheckinForm({ onDone }: { readonly onDone: () => void }) {
  const t = useTranslations("checkin");
  const ts = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tc = useTranslations("common");
  const tg = useTranslations("guestPicker");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();

  // ── 1. Booking details (dates + times + guest type) ──
  // Local dates (not UTC) so the default isn't "yesterday" east of UTC.
  const [checkInDate, setCheckInDate] = useState(localToday);
  const [checkOutDate, setCheckOutDate] = useState(localTomorrow);
  // Walk-ins check in NOW — default to the current time rounded up to the
  // next 5 minutes (client request), not the hotel's standard check-in time.
  const [checkInTime, setCheckInTime] = useState(nowRoundedUpTo5);
  const [checkOutTime, setCheckOutTime] = useState("");
  const [guestType, setGuestType] = useState<GuestType | "">("");

  // Hotel settings for default check-in/out times + early check-in fee
  const settings = useQuery({
    queryKey: ["hotel-settings", activeHotelId],
    queryFn: () =>
      api<{
        check_in_time: string;
        check_out_time: string;
        early_checkin_fee_per_hour?: string;
        early_checkin_grace_minutes?: number;
        collect_emergency_contact?: boolean;
        collect_vehicle_details?: boolean;
      }>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });

  // Hotel GST settings for accurate payment breakdown.
  const gstSettings = useQuery({
    queryKey: ["gst-settings", activeHotelId],
    queryFn: () =>
      api<{ gst_mode: string; default_cgst_rate: string; default_sgst_rate: string }>(
        "/api/v1/hotels/me/gst",
      ),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });
  // GST is only ADDED ON TOP for "included_by_customer" hotels (client
  // 09/2026 modes): no_gst charges no tax, included_by_hotel keeps tax
  // inside the rate — in both cases nothing extra appears in the balance.
  const hotelGstRate =
    gstSettings.data?.gst_mode === "included_by_customer"
      ? Number.parseFloat(gstSettings.data.default_cgst_rate) +
          Number.parseFloat(gstSettings.data.default_sgst_rate) || 5
      : 0;

  // Default the checkout time from hotel settings once loaded (unless edited).
  // Check-in time is NOT defaulted from settings — walk-ins start at "now".
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setCheckOutTime((t) => t || s.check_out_time?.slice(0, 5) || "");
  }, [settings.data]);

  // Auto early check-in fee — recomputed whenever check-in time changes.
  useEffect(() => {
    const s = settings.data;
    if (!s || !checkInTime) { setEarlyFee(0); return; }
    const rate = Number.parseFloat(s.early_checkin_fee_per_hour ?? "0");
    if (rate <= 0) { setEarlyFee(0); return; }
    const grace = s.early_checkin_grace_minutes ?? 0;
    const standardTime = s.check_in_time?.slice(0, 5) ?? "";
    if (!standardTime) { setEarlyFee(0); return; }
    setEarlyFee(calcEarlyCheckinFee(checkInTime, standardTime, grace, rate));
  }, [checkInTime, settings.data]);

  // ── 2. Primary guest ──
  const [guest, setGuest] = useState<{ id: string; full_name: string } | null>(null);
  const [pgBaseline, setPgBaseline] = useState<GuestAutofill | null>(null);
  /** When true, shows the inline editable form. When false, shows the read-only
   *  summary card (like CoGuestCard's resolved state). Starts false so a newly
   *  selected returning guest shows the summary first. */
  const [pgEditing, setPgEditing] = useState(false);
  const [pgName, setPgName] = useState("");
  const [pgPhone, setPgPhone] = useState("");
  const [pgIdType, setPgIdType] = useState("Aadhar Card");
  const [pgIdNumber, setPgIdNumber] = useState("");
  const [pgGender, setPgGender] = useState("");
  const [pgDob, setPgDob] = useState("");
  const [pgAddress, setPgAddress] = useState("");
  const [pgPostalCode, setPgPostalCode] = useState("");
  const [pgCity, setPgCity] = useState("");
  const [pgState, setPgState] = useState("");
  const [pgCountry, setPgCountry] = useState("India");
  const [pgCompany, setPgCompany] = useState("");
  const [pgOcrResult, setPgOcrResult] = useState<import("@/lib/id-ocr").IdOcrResult | null>(null);

  // Existing doc IDs for the selected returning guest — keyed by side.
  // DocUpload uses these to pre-fill tiles from B2.
  const [pgExistingDocs, setPgExistingDocs] = useState<
    Partial<Record<DocSide, string>>
  >({});

  // True when the primary guest was found via ID last-4 search (not phone).
  // Triggers the "Aadhaar found — phone may be outdated" hint + contact override.
  const [pgWasIdSearch, setPgWasIdSearch] = useState(false);
  // Optional alternate contact for THIS booking only (does not change master record).
  const [pgContactOverride, setPgContactOverride] = useState("");

  const handleGuestSelected = async (g: { id: string; full_name: string; phone: string; wasIdSearch?: boolean }) => {
    if (!g.id) {
      // "Edit" / clear-selection clicked — deselect the guest ID so the search
      // box reappears, but KEEP all the pre-filled form data so the desk doesn't
      // lose what they just loaded (client 9-08 item 8).
      setGuest(null);
      setPgBaseline(null);
      // Keep pgExistingDocs so document tiles stay visible.
      return;
    }
    setGuest({ id: g.id, full_name: g.full_name });
    setPgName(g.full_name);
    setPgPhone(g.phone);
    setPgExistingDocs({});
    // Track how the guest was found so we can show the "Aadhaar — phone may be
    // outdated" hint (same as co-guest flow).
    setPgWasIdSearch(g.wasIdSearch ?? false);
    setPgContactOverride(""); // reset override on new selection
    // Show summary card (not edit form) after selecting an existing guest —
    // same pattern as CoGuestCard. Staff can tap Auto-fill or Edit to open form.
    setPgEditing(false);

    // Parallel fetch: text profile + existing document list.
    const [autofillResult, docsResult] = await Promise.allSettled([
      api<GuestAutofill>(`/api/v1/guests/${g.id}/autofill`, { method: "POST" }),
      api<{ id: string; side: string | null }[]>(`/api/v1/guests/${g.id}/documents`),
    ]);

    if (autofillResult.status === "fulfilled") {
      const full = autofillResult.value;
      setPgBaseline(full);
      setPgGender(full.gender ?? "");
      setPgDob(full.date_of_birth ?? "");
      setPgAddress(full.address ?? "");
      setPgPostalCode(full.postal_code ?? "");
      setPgCity(full.city ?? "");
      setPgState(full.state ?? "");
      setPgCountry(full.country ?? "India");
      if (full.id_proof_type) setPgIdType(full.id_proof_type);
      // Always reset the ID field on guest switch so the PREVIOUS guest's
      // masked ID (••••••••4546) never persists onto the new guest (fix: walk-in
      // guest switch keeping prior masked ID — audit item #3).
      setPgIdNumber(full.id_last4 ? `••••••••${full.id_last4}` : "");
    } else {
      setPgBaseline(null);
    }

    if (docsResult.status === "fulfilled") {
      // Keep FIRST match per side (API returns newest-first, so first = newest).
      // Previously used "later entries overwrite" which kept the OLDEST doc
      // (last item in newest-first list). Now matches co-guest's logic.
      const docs: Partial<Record<DocSide, string>> = {};
      for (const d of docsResult.value) {
        if ((d.side === "front" || d.side === "back" || d.side === "selfie") && !docs[d.side]) {
          docs[d.side] = d.id;
        }
      }
      setPgExistingDocs(docs);
    }
  };

  // ── Primary guest creation — rich form (same as additional guests) shown
  // when GuestPicker's search finds no match and staff clicks "Create new
  // guest". Creates the guest, uploads the queued docs, then selects them
  // exactly like GuestPicker's onSelected would.
  const [showPgCreate, setShowPgCreate] = useState(false);
  const [pgCreatePhone, setPgCreatePhone] = useState("");

  const createPrimaryGuest = useMutation({
    mutationFn: async ({
      form,
      docs,
    }: {
      form: GuestCreatePayload;
      docs: { side: DocSide; file: File }[];
    }) => {
      const created = await api<GuestOut>("/api/v1/guests", {
        method: "POST",
        body: {
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          email: form.email?.trim() || undefined,
          address: form.address?.trim() || undefined,
          city: form.city?.trim() || undefined,
          state: form.state?.trim() || undefined,
          country: form.country?.trim() || undefined,
          postal_code: form.postal_code?.trim() || undefined,
          gender: form.gender?.trim() || undefined,
          date_of_birth: form.date_of_birth?.trim() || undefined,
          id_proof_type: form.id_proof_type?.trim() || undefined,
          id_number: form.id_number?.trim() || undefined,
        },
      });
      // Upload the queued ID docs (front/back/selfie) for the new guest.
      // AWAITED (plan §5.1): the previous fire-and-forget version raced the
      // document-list fetch in handleGuestSelected — the tiles rendered blank
      // even though the uploads finished a second later (client: "uploaded
      // aadhaar card and photo but not show"). A failed upload still never
      // aborts guest creation — it is reported via a warning toast instead.
      const uploadResults = await Promise.allSettled(
        docs.map((doc) => {
          const fd = new FormData();
          fd.append("side", doc.side);
          fd.append("document_type", "id_proof");
          fd.append("file", doc.file);
          return apiUpload(`/api/v1/guests/${created.id}/documents`, fd, {
            hotelId: activeHotelId ?? undefined,
          });
        }),
      );
      const failedUploads = uploadResults.filter(
        (r) => r.status === "rejected",
      ).length;
      return { created, failedUploads };
    },
    onSuccess: async ({ created, failedUploads }) => {
      setShowPgCreate(false);
      toast.success(tg("guestCreated"));
      if (failedUploads > 0) {
        toast.warning(t("someDocsFailed", { count: failedUploads }));
      }
      // Select like GuestPicker.onSelected → also re-fetches autofill + docs
      // so the identity fields and doc tiles below fill in (uploads are now
      // complete, so the document list includes them).
      await handleGuestSelected({
        id: created.id,
        full_name: created.full_name,
        phone: created.normalized_phone,
      });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  // ── 3. Additional guests ──
  const [coGuests, setCoGuests] = useState<ResolvedCoGuest[]>([]);
  const [guestKeys, setGuestKeys] = useState<number[]>([]);

  const addGuestEntry = () => setGuestKeys((prev) => [...prev, Date.now()]);
  const removeGuestEntry = (key: number) => {
    setGuestKeys((prev) => prev.filter((k) => k !== key));
    setCoGuests((prev) => prev.filter((_, i) => i !== guestKeys.indexOf(key)));
  };
  const resolveGuest = (key: number, g: ResolvedCoGuest) =>
    setCoGuests(resolveCoGuestUpdater(guestKeys, key, g));

  // Room price snapshot from the most recently restored draft — used as
  // fallback when selectedAvailRooms can't be priced (past dates etc.).
  const [draftRoomPriceSnapshot, setDraftRoomPriceSnapshot] = useState<Record<string, number>>({});

  // ── 4. Rooms + occupancy ──
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [availRefreshKey, setAvailRefreshKey] = useState(0);
  const [adultsCount, setAdultsCount] = useState(1);
  const [childCount, setChildCount] = useState(0);
  // Staff-edited room rates keyed by room_id (per night, or whole stay for
  // day use). Only edits that differ from the computed default are sent as
  // rate_overrides in the booking payload.
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});

  // ── 5. Special requirements ──
  const services = useQuery({
    queryKey: ["hotel-services", activeHotelId],
    queryFn: () => api<ServiceItem[]>("/api/v1/hotels/me/services"),
    enabled: !!activeHotelId,
  });
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [serviceAmounts, setServiceAmounts] = useState<Record<string, string>>({});
  const [specialInstructions, setSpecialInstructions] = useState("");
  const toggleService = (id: string) =>
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  // ── 6. Payment (advance collection only — new booking, nothing paid yet) ──
  const [advanceAmount, setAdvanceAmount] = useState("0");
  const [extraCharges, setExtraCharges] = useState("0");
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "credit_card" | "debit_card" | "bank_transfer" | "other">("cash");
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [earlyFee, setEarlyFee] = useState(0);
  const newAdvance = Number.parseFloat(advanceAmount) || 0;

  // ── Day use (same-day stay) — valid when both times are set and check-out
  // is after check-in; billed as ceil(hours) × room_type hourly rate (fallback:
  // full-night base price when the room type has no hourly rate).
  const isSameDay =
    !!checkInDate && !!checkOutDate && checkInDate === checkOutDate;
  const sameDayValid =
    isSameDay &&
    !!checkInTime &&
    !!checkOutTime &&
    Number.isFinite(timeToMinutes(checkInTime)) &&
    Number.isFinite(timeToMinutes(checkOutTime)) &&
    timeToMinutes(checkOutTime) > timeToMinutes(checkInTime);
  const dayUseHours = sameDayValid
    ? Math.ceil((timeToMinutes(checkOutTime) - timeToMinutes(checkInTime)) / 60)
    : 0;

  // ── Room rent: read the room availability cache (same queryKey as the picker)
  // to get rates per selected room. Overnight = per-night rate × nights;
  // day use = hourly rate × hours (or base price when no hourly rate).
  const availData = queryClient.getQueryData<import("@/types/hotel").RoomAvailabilityOut>([
    "room-availability",
    activeHotelId,
    checkInDate,
    checkOutDate,
  ]);
  const nights = useMemo(() => {
    if (!checkInDate || !checkOutDate) return 1;
    const d = (new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / 86_400_000;
    return Math.max(Math.ceil(d), 1);
  }, [checkInDate, checkOutDate]);
  const selectedAvailRooms = useMemo(
    () =>
      (availData?.available ?? []).filter((r) => selectedRooms.includes(r.id)),
    [availData, selectedRooms],
  );
  /** Default rate for a room: base price per night, or day-use total. */
  const defaultRoomRate = (r: RoomAvailableItem): number => {
    const base = Number.parseFloat(r.room_type_base_price) || 0;
    if (!isSameDay) return base;
    const hourly =
      r.room_type_hourly_rate != null
        ? Number.parseFloat(r.room_type_hourly_rate)
        : Number.NaN;
    return Number.isFinite(hourly) && hourly > 0 && dayUseHours > 0
      ? hourly * dayUseHours
      : base;
  };
  /** Rate actually used: the staff edit when valid, else the default. */
  const effectiveRoomRate = (r: RoomAvailableItem): number => {
    const edited = rateEdits[r.id]?.trim();
    if (edited) {
      const parsed = Number.parseFloat(edited);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return defaultRoomRate(r);
  };
  const roomRentWalkIn = useMemo(() => {
    const factor = isSameDay ? 1 : nights;
    if (selectedAvailRooms.length > 0) {
      // Normal path: availability data loaded — compute from live prices.
      return selectedAvailRooms.reduce(
        (sum, r) => sum + effectiveRoomRate(r) * factor,
        0,
      );
    }
    // Fallback path (draft restore with past/unavailable rooms): use the
    // price snapshot saved at draft-save time so the amount isn't "—".
    const snapshotRooms = selectedRooms.filter((id) => draftRoomPriceSnapshot[id] !== undefined);
    if (snapshotRooms.length > 0) {
      return snapshotRooms.reduce(
        (sum, id) => sum + (draftRoomPriceSnapshot[id] ?? 0) * factor,
        0,
      );
    }
    return 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAvailRooms, selectedRooms, draftRoomPriceSnapshot, nights, isSameDay, dayUseHours, rateEdits]);
  const extraChargesNumWI = Number.parseFloat(extraCharges || "0") || 0;
  // Sum of the selected service chips (staff-edited amount when present).
  // DISPLAY ONLY — the atomic payload still sends each chip as its own charge
  // plus the manual extra as a separate charge, so nothing is double-counted.
  const chipsTotalWI = useMemo(
    () =>
      (services.data ?? [])
        .filter((s) => selectedServices.includes(s.id))
        .reduce(
          (sum, s) =>
            sum + (Number.parseFloat(serviceChargeAmount(s, serviceAmounts)) || 0),
          0,
        ),
    [services.data, selectedServices, serviceAmounts],
  );
  // Extra-charges cell auto-fills with chips + manual entry + early check-in
  // fee (client request). The early fee IS billed (it rides in the atomic
  // charges array), so hiding it here understated Remaining.
  const displayExtraWI = chipsTotalWI + extraChargesNumWI + earlyFee;
  // Whole-rupee GST — matches backend money() (ROUND_HALF_UP to ₹1).
  const gstAmountWI = Math.round((roomRentWalkIn + displayExtraWI) * (hotelGstRate / 100));
  // Only subtract the advance when staff confirmed it was actually collected —
  // otherwise it is not recorded and the remaining balance would be dishonest.
  const collectedAdvanceWI = paymentReceived ? newAdvance : 0;
  const payableWI = roomRentWalkIn + displayExtraWI + gstAmountWI;
  const remainingWI = Math.max(payableWI - collectedAdvanceWI, 0);
  // Collected more than the bill → say so instead of silently showing ₹0.
  const overpaidWI = Math.max(collectedAdvanceWI - payableWI, 0);

  // UPI QR code — fetched as a blob URL when UPI + amount > 0.
  const showQr = paymentMode === "upi" && newAdvance > 0;
  const qrImageQuery = useQuery({
    queryKey: ["hotel-qr-png", activeHotelId],
    queryFn: async () => {
      const token = getAccessToken();
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr/image?v=${Date.now()}`, {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "X-Hotel-Id": activeHotelId ?? "",
        },
        credentials: "include",
        cache: "no-store",
      });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    },
    enabled: showQr && !!activeHotelId,
    staleTime: 300_000,
  });

  // ── 7. Emergency contact + vehicle ──
  const [emName, setEmName] = useState("");
  const [emRelation, setEmRelation] = useState("");
  const [emPhone, setEmPhone] = useState("");
  const [vehNumber, setVehNumber] = useState("");
  const [vehType, setVehType] = useState("Car");
  const [vehTypeOther, setVehTypeOther] = useState("");
  const [vehMake, setVehMake] = useState("");
  const [parkingSlot, setParkingSlot] = useState("");

  // ── Foreign guest (Form C) ──
  const [fgEnabled, setFgEnabled] = useState(false);
  const [fgForm, setFgForm] = useState<ForeignGuestFormState>(EMPTY_FOREIGN_GUEST);

  // ── Terms / result / error ──
  const [terms, setTerms] = useState(false);
  const [checkinResult, setCheckinResult] = useState<CheckInCreateOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Section refs — scroll the first invalid section into view on submit ──
  const formTopRef = useRef<HTMLDivElement | null>(null);
  const datesSectionRef = useRef<HTMLDivElement | null>(null);
  const guestSectionRef = useRef<HTMLDivElement | null>(null);
  const roomsSectionRef = useRef<HTMLDivElement | null>(null);
  const termsSectionRef = useRef<HTMLDivElement | null>(null);

  /** Smooth-scroll to an element. block="start" for the form top so the header stays visible. */
  const scrollToSection = (ref: React.RefObject<HTMLDivElement | null>, block: ScrollLogicalPosition = "center") => {
    ref.current?.scrollIntoView({ behavior: "smooth", block });
  };

  // ── Drafts (localStorage) ──
  // ALL saved drafts are listed (newest first); each can be restored or
  // discarded independently. A restored draft is only deleted after its
  // check-in completes — abandoning the restore never loses the draft.
  const [drafts, setDrafts] = useState<CheckinDraft[]>([]);
  const [restoredDraftId, setRestoredDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [restoringDraftId, setRestoringDraftId] = useState<string | null>(null);
  // When true the draft panel is collapsed (user tapped outside / restored one).
  const [draftsCollapsed, setDraftsCollapsed] = useState(false);
  // Re-read whenever the active hotel changes — drafts are hotel-scoped (§1.1).
  useEffect(() => {
    setDrafts(readDrafts(activeHotelId));
    setRestoredDraftId(null);
    setRestoringDraftId(null);
    setDraftsCollapsed(false);
  }, [activeHotelId]);

  /** Upload one queued photo to hotel-scoped draft storage → object key. */
  const uploadDraftDoc = async (file: File): Promise<string | null> => {
    try {
      const fd = new FormData();
      fd.append("file", file, file.name || "draft.jpg");
      const out = await apiUpload<{ key: string }>(
        "/api/v1/guests/draft-documents",
        fd,
        { hotelId: activeHotelId ?? undefined },
      );
      return out.key;
    } catch {
      return null;
    }
  };

  /** Fire-and-forget removal of a draft's server-side photos. */
  const deleteDraftDocs = (keys: string[]) => {
    for (const key of keys) {
      void api(`/api/v1/guests/draft-documents?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      }).catch(() => {
        // The 7-day TTL sweep is the safety net for failed deletes.
      });
    }
  };

  /** Delete a draft's photos EXCEPT keys still referenced by surviving drafts.
   *  Restore→re-save reuses object keys, so two drafts can legitimately share
   *  a key — deleting blindly would destroy the other draft's photos. */
  const deleteDraftDocsUnlessShared = (keys: string[], remaining: CheckinDraft[]) => {
    const stillReferenced = new Set(remaining.flatMap(draftDocKeys));
    deleteDraftDocs(keys.filter((k) => !stillReferenced.has(k)));
  };

  const saveDraft = async () => {
    if (!activeHotelId || savingDraft) {
      if (!activeHotelId) toast.error(t("draftSaveFailed"));
      return;
    }
    setSavingDraft(true);
    try {
      // Persist queued co-guest photos FIRST (client 16/09: draft photos used
      // to vanish — Files can't live in localStorage, so they go to B2 draft
      // storage and the draft carries only their keys). Already-uploaded keys
      // are reused so restore→save does not create a second B2 object.
      const coGuestDraftDocs: ({ side: DocSide; key: string }[] | undefined)[] = [];
      let failedPhotos = 0;
      for (const cg of coGuests.filter(Boolean)) {
        if (!cg.docs || cg.docs.length === 0) {
          coGuestDraftDocs.push(undefined);
          continue;
        }
        const uploaded: { side: DocSide; key: string }[] = [];
        for (const doc of cg.docs) {
          if (doc.key) {
            uploaded.push({ side: doc.side, key: doc.key });
            continue;
          }
          const key = await uploadDraftDoc(doc.file);
          if (key) uploaded.push({ side: doc.side, key });
          else failedPhotos++;
        }
        coGuestDraftDocs.push(uploaded.length > 0 ? uploaded : undefined);
      }
      if (failedPhotos > 0) {
        toast.warning(t("draftPhotoUploadFailed", { count: failedPhotos }));
      }

      // Snapshot room prices so restore can show amounts even when the
      // availability query can't run (past dates / rooms now occupied).
      const roomPriceSnapshot: Record<string, number> = {};
      for (const r of selectedAvailRooms) {
        roomPriceSnapshot[r.id] = effectiveRoomRate(r);
      }

      const d: CheckinDraft = {
        id: draftId(),
        savedAt: new Date().toISOString(),
        checkInDate,
        checkOutDate,
        checkInTime,
        checkOutTime,
        guestType,
        guest: guest ? { id: guest.id, full_name: guest.full_name, phone: pgPhone } : null,
        selectedRooms,
        adultsCount,
        childCount,
        specialInstructions,
        selectedServices,
        advanceAmount,
        paymentMode,
        paymentReceived,
        extraCharges,
        serviceAmounts,
        rateEdits,
        roomPriceSnapshot: Object.keys(roomPriceSnapshot).length > 0 ? roomPriceSnapshot : undefined,
        terms,
        emName,
        emRelation,
        emPhone,
        vehNumber,
        vehType,
        vehTypeOther,
        vehMake,
        parkingSlot,
        pgCompany,
        foreignEnabled: fgEnabled,
        foreignGuest: fgForm,
        // Additional guests — text data + server-persisted photo keys (16/09).
        // PRIVACY: the full ID number is NEVER written to localStorage (same
        // rule as the primary guest) — staff re-enter it after restore.
        coGuests: coGuests.filter(Boolean).map((cg, i) => {
          const nf = (cg as ResolvedCoGuest & { _newForm?: GuestCreatePayload })._newForm;
          return {
            guest_id: cg.guest_id,
            full_name: cg.full_name,
            phone: cg.phone,
            newForm: nf ? { ...nf, id_number: "" } : undefined,
            foreign_guest: cg.foreign_guest ?? null,
            draft_docs: coGuestDraftDocs[i],
          };
        }),
      };
      // Newest first; keep at most MAX_DRAFTS. Evicted drafts' B2 objects
      // are deleted immediately (unless shared with a surviving draft) so
      // they don't wait for the 7-day sweep.
      const next = [d, ...drafts].slice(0, MAX_DRAFTS);
      const keptIds = new Set(next.map((x) => x.id));
      for (const old of drafts.filter((x) => !keptIds.has(x.id))) {
        deleteDraftDocsUnlessShared(draftDocKeys(old), next);
      }
      writeDrafts(activeHotelId, next);
      setDrafts(next);
      toast.success(t("draftSaved"));
    } catch {
      toast.error(t("draftSaveFailed"));
    } finally {
      setSavingDraft(false);
    }
  };

  /** Download one server-persisted draft photo back into a File. */
  const fetchDraftDoc = async (side: DocSide, key: string): Promise<File | null> => {
    try {
      const token = getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
      const resp = await fetch(
        `${API_BASE}/api/v1/guests/draft-documents/content?key=${encodeURIComponent(key)}`,
        { headers, credentials: "include" },
      );
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return new File([blob], `${side}.jpg`, { type: blob.type || "image/jpeg" });
    } catch {
      return null;
    }
  };

  const restoreDraft = async (d: CheckinDraft) => {
    if (restoringDraftId) return;
    setRestoringDraftId(d.id ?? "restoring");
    try {
    setCheckInDate(d.checkInDate);
    setCheckOutDate(d.checkOutDate);
    setCheckInTime(d.checkInTime);
    setCheckOutTime(d.checkOutTime);
    setGuestType(d.guestType);
    setSelectedRooms(d.selectedRooms ?? []);
    setAdultsCount(d.adultsCount ?? 1);
    setChildCount(d.childCount ?? 0);
    setSpecialInstructions(d.specialInstructions ?? "");
    setSelectedServices(d.selectedServices ?? []);
    setAdvanceAmount(d.advanceAmount ?? "0");
    setPaymentMode(d.paymentMode ?? "cash");
    setPaymentReceived(d.paymentReceived ?? false);
    setExtraCharges(d.extraCharges ?? "0");
    setServiceAmounts(d.serviceAmounts ?? {});
    setRateEdits(d.rateEdits ?? {});
    // Restore the price snapshot so room amounts show immediately, even
    // before the availability query refetches (or when dates are in the past).
    setDraftRoomPriceSnapshot(d.roomPriceSnapshot ?? {});
    setTerms(d.terms ?? false);
    setEmName(d.emName ?? "");
    setEmRelation(d.emRelation ?? "");
    setEmPhone(d.emPhone ?? "");
    setVehNumber(d.vehNumber ?? "");
    setVehType(d.vehType ?? "Car");
    setVehTypeOther(d.vehTypeOther ?? "");
    setVehMake(d.vehMake ?? "");
    setParkingSlot(d.parkingSlot ?? "");
    setPgCompany(d.pgCompany ?? "");
    setFgEnabled(d.foreignEnabled ?? false);
    setFgForm(d.foreignGuest ?? EMPTY_FOREIGN_GUEST);
    if (d.guest) {
      // Re-select the guest (also re-fetches identity autofill, non-fatal).
      void handleGuestSelected(d.guest);
    }
    // Additional guests round-trip (plan §4.2 + client 16/09): rebuild
    // resolved entries from the serialized text data AND re-download any
    // server-persisted draft photos back into their tiles. Existing guests
    // additionally re-fetch their saved profile documents on mount.
    let failedRestore = 0;
    const restoredCoGuests = await Promise.all(
      (d.coGuests ?? []).map(async (sg) => {
        const docs: { side: DocSide; file: File; key?: string }[] = [];
        for (const dd of sg.draft_docs ?? []) {
          const file = await fetchDraftDoc(dd.side, dd.key);
          if (file) docs.push({ side: dd.side, file, key: dd.key });
          else failedRestore++;
        }
        const rg: ResolvedCoGuest & { _newForm?: GuestCreatePayload } = {
          guest_id: sg.guest_id,
          full_name: sg.full_name,
          phone: sg.phone,
          docs,
          foreign_guest: sg.foreign_guest ?? null,
        };
        if (sg.newForm) rg._newForm = sg.newForm;
        return rg;
      }),
    );
    setCoGuests(restoredCoGuests);
    setGuestKeys(restoredCoGuests.map((_, i) => Date.now() + i));
    // Keep the draft in the list until this check-in actually completes —
    // deleted then (or via its own Discard button), never on restore alone.
    setRestoredDraftId(d.id ?? null);
    // Collapse the draft panel and scroll the user to the filled form so
    // the result of the restore is immediately visible.
    setDraftsCollapsed(true);
    toast.success(t("draftRestored"));
    if (failedRestore > 0) {
      toast.warning(t("draftPhotoRestoreFailed", { count: failedRestore }));
    }
    // Small delay so the panel collapses before we scroll (avoids layout jump).
    setTimeout(() => scrollToSection(formTopRef, "start"), 80);
    } finally {
      setRestoringDraftId(null);
    }
  };

  const discardDraft = (id: string | undefined) => {
    // Clean up the discarded draft's server-side photos (16/09) — but never
    // keys another surviving draft still references.
    const discarded = drafts.find((d) => d.id === id);
    const next = drafts.filter((d) => d.id !== id);
    if (discarded) deleteDraftDocsUnlessShared(draftDocKeys(discarded), next);
    writeDrafts(activeHotelId, next);
    setDrafts(next);
    if (restoredDraftId === id) setRestoredDraftId(null);
    // If no drafts remain, collapse and scroll to the clean form.
    if (next.length === 0) {
      setDraftsCollapsed(true);
      setTimeout(() => scrollToSection(formTopRef, "start"), 80);
    }
  };

  // Same-day is allowed as a day-use stay when both times are set and
  // check-out time is after check-in time.
  const datesValid =
    !!checkInDate &&
    !!checkOutDate &&
    (checkInDate < checkOutDate || sameDayValid);

  // ── Mutation: book + check in atomically, then charges + advance payment ──
  const mutation = useMutation({
    mutationFn: async () => {
      if (!guest) throw new ApiError(400, "validation", t("selectGuestFirst"));
      // Co-guests marked foreign need a passport number too.
      if (
        coGuests
          .filter(Boolean)
          .some((cg) => cg.foreign_guest && cg.foreign_guest.passport_number.trim().length < 3)
      ) {
        throw new ApiError(400, "validation", t("passportRequired"));
      }

      // 1. Update primary guest profile if identity fields were edited.
      const patch: Record<string, string> = {};
      if (pgName.trim() && pgName.trim() !== (pgBaseline?.full_name ?? guest.full_name))
        patch.full_name = pgName.trim();
      if (pgPhone.trim() && pgPhone.trim() !== (pgBaseline?.phone ?? pgPhone.trim()))
        patch.phone = pgPhone.trim();
      if (pgGender && pgGender !== (pgBaseline?.gender ?? "")) patch.gender = pgGender;
      if (pgDob && pgDob !== (pgBaseline?.date_of_birth ?? "")) patch.date_of_birth = pgDob;
      if (pgAddress && pgAddress !== (pgBaseline?.address ?? "")) patch.address = pgAddress;
      if (pgPostalCode && pgPostalCode !== (pgBaseline?.postal_code ?? "")) patch.postal_code = pgPostalCode;
      if (pgCity && pgCity !== (pgBaseline?.city ?? "")) patch.city = pgCity;
      if (pgState && pgState !== (pgBaseline?.state ?? "")) patch.state = pgState;
      if (pgCountry && pgCountry !== (pgBaseline?.country ?? "India")) patch.country = pgCountry;
      // Only send id_number if the desk typed a real number (not the mask).
      // Strip OCR whitespace before sending.
      if (pgIdNumber.trim() && !isIdMask(pgIdNumber)) {
        patch.id_number = pgIdNumber.trim().replace(/\s/g, "");
        patch.id_proof_type = pgIdType;
      }
      if (Object.keys(patch).length > 0) {
        await api(`/api/v1/guests/${guest.id}`, { method: "PATCH", body: patch });
      }

      // 2. Create new additional guests + upload queued docs (same as MODE B).
      const resolvedCoGuests: CoGuestIn[] = [];
      const coGuestDocUploads: Promise<unknown>[] = [];
      for (const cg of coGuests.filter(Boolean)) {
        const isNew = cg.guest_id.startsWith("__new__");
        if (isNew) {
          const newForm = (
            cg as ResolvedCoGuest & { _newForm?: GuestCreatePayload }
          )._newForm;
          if (!newForm) continue;
          const created = await api<{ id: string }>("/api/v1/guests", {
            method: "POST",
            body: {
              full_name: newForm.full_name.trim(),
              phone: newForm.phone.trim(),
              email: newForm.email?.trim() || undefined,
              address: newForm.address?.trim() || undefined,
              city: newForm.city?.trim() || undefined,
              state: newForm.state?.trim() || undefined,
              country: newForm.country?.trim() || undefined,
              postal_code: newForm.postal_code?.trim() || undefined,
              gender: newForm.gender?.trim() || undefined,
              date_of_birth: newForm.date_of_birth?.trim() || undefined,
              id_proof_type: newForm.id_proof_type?.trim() || undefined,
              id_number: newForm.id_number?.trim() || undefined,
            },
          });
          // Awaited uploads — failures must not abort check-in, but they must
          // be COUNTED so the draft backup isn't destroyed and staff is told
          // (previously fire-and-forget: a failed upload lost the photo
          // silently while the draft copy was deleted on success).
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            coGuestDocUploads.push(
              apiUpload(`/api/v1/guests/${created.id}/documents`, form, {
                hotelId: activeHotelId ?? undefined,
              }),
            );
          }
          resolvedCoGuests.push({
            guest_id: created.id,
            foreign_guest: cg.foreign_guest ?? null,
            alternate_contact_phone: cg.alternate_contact_phone || undefined,
          });
        } else {
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            coGuestDocUploads.push(
              apiUpload(`/api/v1/guests/${cg.guest_id}/documents`, form, {
                hotelId: activeHotelId ?? undefined,
              }),
            );
          }
          resolvedCoGuests.push({
            guest_id: cg.guest_id,
            foreign_guest: cg.foreign_guest ?? null,
            alternate_contact_phone: cg.alternate_contact_phone || undefined,
          });
        }
      }
      const docResults = await Promise.allSettled(coGuestDocUploads);
      const failedDocUploads = docResults.filter((r) => r.status === "rejected").length;

      // 3. Book + check in atomically — service charges, early check-in fee,
      // extra charges and the advance payment are all applied by the backend
      // inside the same transaction (no separate /charges or /payments calls).
      const chosen = (services.data ?? []).filter((s) =>
        selectedServices.includes(s.id),
      );
      const chargesList: CheckInChargeIn[] = chosen.map((svc) => ({
        description: svc.name,
        amount: serviceChargeAmount(svc, serviceAmounts),
        category: "other",
      }));
      if (earlyFee > 0) {
        chargesList.push({
          description: "Early check-in fee",
          amount: earlyFee.toString(),
          category: "other",
        });
      }
      const ecNumWI = Number.parseFloat(extraCharges) || 0;
      if (ecNumWI > 0) {
        chargesList.push({
          description: "Additional charges at check-in",
          amount: extraCharges,
          category: "other",
        });
      }
      // Only rates actually edited away from the computed default are sent.
      const rateOverrides: RoomRateOverride[] = selectedAvailRooms
        .filter((r) => {
          const edited = rateEdits[r.id]?.trim();
          if (!edited) return false;
          const parsed = Number.parseFloat(edited);
          return (
            Number.isFinite(parsed) &&
            parsed >= 0 &&
            parsed !== defaultRoomRate(r)
          );
        })
        .map((r) => ({ room_id: r.id, rate: rateEdits[r.id].trim() }));

      const payload: BookAndCheckInRequest = {
        booking: {
          primary_guest_id: guest.id,
          room_ids: selectedRooms,
          rate_overrides: rateOverrides.length > 0 ? rateOverrides : undefined,
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          adults: adultsCount,
          children: childCount,
          guest_type: guestType || null,
          check_in_time: checkInTime || null,
          check_out_time: checkOutTime || null,
          special_requests: specialInstructions.trim() || null,
          emergency_contact_name: emName.trim() || null,
          emergency_contact_relation: emRelation.trim() || null,
          emergency_contact_phone: emPhone.trim() || null,
          vehicle_number: vehNumber.trim() || null,
          vehicle_type: vehNumber.trim()
            ? effectiveVehicleType(vehType, vehTypeOther)
            : null,
          parking_slot: parkingSlot.trim() || null,
        },
        checked_in_at: null,
        co_guests: resolvedCoGuests,
        // Alternate contact for primary guest when found by Aadhaar ID search.
        primary_alternate_contact_phone: pgContactOverride.trim() || null,
        purpose_of_visit: null,
        company_name: guestType === "business" ? pgCompany.trim() || null : null,
        notes: null,
        terms_acknowledged: terms,
        foreign_guest: buildForeignGuestPayload(fgEnabled, fgForm),
        charges: chargesList,
        advance_payment:
          paymentReceived && newAdvance > 0
            ? { amount: advanceAmount, method: paymentMode }
            : null,
      };
      const checkinOut = await api<CheckInCreateOut>(
        "/api/v1/checkins/book-and-checkin",
        {
          method: "POST",
          body: payload,
        },
      );

      return { result: checkinOut, failedDocUploads };
    },
    onSuccess: ({ result, failedDocUploads }) => {
      setCheckinResult(result);
      setError(null);
      // Check-in completed — only the RESTORED draft (if any) is now stale.
      // Other saved drafts belong to other guests and must survive.
      if (restoredDraftId) {
        const consumed = drafts.find((d) => d.id === restoredDraftId);
        if (failedDocUploads > 0) {
          // Some co-guest ID photos did NOT make it onto the guest profile.
          // Keep the draft (and its server-side photos) so they can be
          // recovered — deleting them here would lose the photos entirely.
          toast.warning(t("someDocsFailed", { count: failedDocUploads }));
          setRestoredDraftId(null);
        } else {
          // Its server-side draft photos are consumed too (16/09) — the real
          // guest documents were uploaded during check-in. Never delete keys
          // another surviving draft still references.
          const next = drafts.filter((d) => d.id !== restoredDraftId);
          if (consumed) deleteDraftDocsUnlessShared(draftDocKeys(consumed), next);
          writeDrafts(activeHotelId, next);
          setDrafts(next);
          setRestoredDraftId(null);
        }
      } else if (failedDocUploads > 0) {
        toast.warning(t("someDocsFailed", { count: failedDocUploads }));
      }
      // Cross-page invalidation (plan Part 6): check-in moves rooms AND money.
      invalidateRoomState(queryClient);
      invalidateMoney(queryClient);
      toast.success(t("checkedInToastReg", { regs: result.registration_numbers.join(", ") }));
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : t("checkinFailed"));
      // Rooms got taken between selection and submit — refresh availability.
      if (e instanceof ApiError && e.code === "double_booking") {
        setSelectedRooms([]);
        setAvailRefreshKey((k) => k + 1);
        queryClient.invalidateQueries({ queryKey: ["room-availability", activeHotelId] });
      }
    },
  });

  // ── Post-check-in success state ──
  if (checkinResult) {
    return (
      <CheckinSuccess
        result={checkinResult}
        bookingId={checkinResult.booking_id}
        onDone={onDone}
        doneLabel={t("newCheckin")}
      />
    );
  }

  const canSubmit =
    !!guest && selectedRooms.length > 0 && datesValid && terms && !mutation.isPending;

  const submitHint = !guest
    ? t("requireGuest")
    : selectedRooms.length === 0
      ? t("requireRooms")
      : !datesValid
        ? t("requireDates")
        : !terms
          ? t("requireTerms")
          : null;

  /** Validate in section order, set the error, scroll to the failing section. */
  const validateAndSubmit = () => {
    if (mutation.isPending) return;
    if (!guest) {
      setError(t("selectOrCreateGuest"));
      scrollToSection(guestSectionRef);
      return;
    }
    if (selectedRooms.length === 0) {
      setError(t("selectAtLeastOneRoom"));
      scrollToSection(roomsSectionRef);
      return;
    }
    if (!datesValid) {
      setError(isSameDay ? t("sameDayTimesInvalid") : t("datesInvalid"));
      scrollToSection(datesSectionRef);
      return;
    }
    if (fgEnabled && fgForm.passport_number.trim().length < 3) {
      setError(t("passportRequired"));
      scrollToSection(guestSectionRef);
      return;
    }
    if (!terms) {
      setError(t("requireTerms"));
      scrollToSection(termsSectionRef);
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <div className="space-y-4">
      {/* ── Saved drafts (collapsible panel) ──────────────────────────────── */}
      {drafts.length > 0 && (
        <div className={`rounded-xl border transition-all duration-200 ${draftsCollapsed ? "border-gold-200 bg-gold-50/60" : "border-gold-300 bg-gold-50"}`}>
          {/* Header — always visible; click to expand/collapse */}
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            onClick={() => setDraftsCollapsed((v) => !v)}
            aria-expanded={!draftsCollapsed}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="size-4 shrink-0 text-gold-600" aria-hidden />
              <span className="text-sm font-medium text-gold-800 truncate">
                {draftsCollapsed
                  ? t("draftsCollapsedLabel", { count: drafts.length })
                  : t("draftsExpandedLabel", { count: drafts.length })}
              </span>
            </div>
            <ChevronDown
              className={`size-4 shrink-0 text-gold-600 transition-transform duration-200 ${draftsCollapsed ? "" : "rotate-180"}`}
              aria-hidden
            />
                </button>

          {/* Draft rows — hidden when collapsed */}
          {!draftsCollapsed && (
            <div className="border-t border-gold-200 px-4 pb-3 pt-2 space-y-2 text-sm">
              {drafts.map((d) => {
                const isRestoring = restoringDraftId === d.id;
                const isThisRestored = restoredDraftId === d.id;
                return (
                  <div
                    key={d.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors cursor-pointer
                      ${isThisRestored
                        ? "bg-success-bg border border-success/30"
                        : "hover:bg-gold-100 active:bg-gold-200 border border-transparent"}
                      ${isRestoring ? "animate-pulse" : ""}
                    `}
                    onClick={() => {
                      if (!restoringDraftId) void restoreDraft(d);
                    }}
                    role="button"
                    tabIndex={restoringDraftId ? -1 : 0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (!restoringDraftId) void restoreDraft(d);
                      }
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isThisRestored
                        ? <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden />
                        : <FileText className="size-4 shrink-0 text-gold-600" aria-hidden />}
                      <span className={`truncate ${isThisRestored ? "text-success font-medium" : "text-gold-800"}`}>
                        {t("draftFrom", { date: new Date(d.savedAt).toLocaleString() })}
                        {d.guest?.full_name ? ` — ${d.guest.full_name}` : ""}
                        {!d.guest?.full_name && d.selectedRooms?.length
                          ? ` — ${d.selectedRooms.length} room(s)` : ""}
                      </span>
              </div>
                    <div
                      className="flex shrink-0 gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={!!restoringDraftId}
                        onClick={() => void restoreDraft(d)}
                        className={`inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-60
                          ${isThisRestored
                            ? "bg-success text-white hover:bg-success/90"
                            : "bg-navy-900 text-white hover:bg-navy-900/85 active:bg-navy-900/70"}`}
                      >
                        {isRestoring
                          ? t("draftRestoring")
                          : isThisRestored
                            ? t("restored")
                            : t("restore")}
                      </button>
                      <button
                        type="button"
                        disabled={!!restoringDraftId}
                        onClick={() => discardDraft(d.id)}
                        className="inline-flex h-8 items-center rounded-lg border border-gold-400 px-3 text-xs font-medium text-gold-700 hover:bg-gold-100 active:bg-gold-200 transition-colors disabled:opacity-60"
                      >
                        {t("discard")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 1. Booking Details ─────────────────────────────────────────────── */}
      {/* formTopRef = first section element; both scroll targets live here */}
      <div ref={(el) => { (formTopRef as React.MutableRefObject<HTMLDivElement | null>).current = el; (datesSectionRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}>
      <Section
        icon={ClipboardList}
        title={ts("bookingDetailsTitle")}
        subtitle={t("walkInSubtitle")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="wi-cin" className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {t("checkinDateTime")} *
            </Label>
            <DateTimePicker
              id="wi-cin"
              required
              dateValue={checkInDate}
              timeValue={checkInTime}
              onDateChange={setCheckInDate}
              onTimeChange={setCheckInTime}
              min={localToday()}
            />
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="wi-cout" className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {t("checkoutDateTime")} *
            </Label>
            <DateTimePicker
              id="wi-cout"
              required
              dateValue={checkOutDate}
              timeValue={checkOutTime}
              onDateChange={setCheckOutDate}
              onTimeChange={setCheckOutTime}
              min={checkInDate || localToday()}
            />
          </div>
          {isSameDay && sameDayValid && (
            <div className="sm:col-span-2 lg:col-span-4">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-bg px-3 py-1 text-xs font-semibold text-warning">
                <Clock className="size-3.5" aria-hidden />
                {t("dayUseBadge", { hrs: dayUseHours })}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="wi-guest-type" className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {t("guestTypeLabel")}
            </Label>
            <select
              id="wi-guest-type"
              value={guestType}
              onChange={(e) => setGuestType(e.target.value as GuestType | "")}
              className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="">{t("select")}</option>
              {GUEST_TYPES.map((gt) => (
                <option key={gt} value={gt}>
                  {t(`guestType_${gt}`)}
                </option>
              ))}
            </select>
          </div>
          {guestType === "business" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("company")}</Label>
              <Input value={pgCompany} onChange={(e) => setPgCompany(e.target.value)} placeholder={t("companyPlaceholder")} />
            </div>
          )}
          {!datesValid && (
            <p className="sm:col-span-2 lg:col-span-4 text-xs text-danger">
              {isSameDay ? t("sameDayTimesInvalid") : t("datesInvalid")}
            </p>
          )}
        </div>
        {earlyFee > 0 && (() => {
          const rate = Number.parseFloat(settings.data?.early_checkin_fee_per_hour ?? "1") || 1;
          const hrs = Math.max(1, Math.round(earlyFee / rate));
          return (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
              Early check-in by {hrs} hr{hrs !== 1 ? "s" : ""} — {fmtINR(earlyFee)} fee will be added to the bill
            </div>
          );
        })()}
      </Section>
      </div>

      {/* ── 2. Primary Guest Identity ─────────────────────────────────────── */}
      <div ref={guestSectionRef}>
      <Section icon={BadgeCheck} title={t("primaryGuestIdentity")} subtitle={t("primaryGuestIdentitySubtitle")}>
        <div className="space-y-5">
              <GuestPicker
            selected={guest?.id ? guest : null}
                onSelected={(g) => {
              setShowPgCreate(false);
              void handleGuestSelected(g);
            }}
            onCreateNew={(phone) => {
              setPgCreatePhone(phone);
              setShowPgCreate(true);
            }}
          />

          {/* Rich new-guest form (same as Additional Guests → Create New) —
              replaces GuestPicker's old inline mini-form for walk-ins. */}
          {!guest && showPgCreate && (
            <div className="rounded-xl border p-4 space-y-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                <UserPlus className="size-3.5" aria-hidden />
                {tg("newGuest")}
              </p>
              <NewGuestForm
                key={pgCreatePhone}
                initialPhone={pgCreatePhone}
                confirmLabel={t("createGuestAction")}
                pending={createPrimaryGuest.isPending}
                onConfirm={(form, docs) => createPrimaryGuest.mutate({ form, docs })}
              />
            </div>
          )}

          {/* ── Primary guest SUMMARY CARD (same pattern as CoGuestCard resolved) ─── */}
          {guest && !pgEditing && (
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              {/* Header: name + phone + action buttons */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="size-4 text-success" aria-hidden />
                  <div>
                    <span className="text-sm font-semibold">{pgName || guest.full_name}</span>
                    {pgPhone && (
                      <p className="text-xs text-muted-foreground tabular-nums">{pgPhone}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Auto-fill: re-fetches latest profile + docs then opens edit */}
                  <button
                    type="button"
                    onClick={() => {
                      void Promise.all([
                        api<GuestAutofill>(`/api/v1/guests/${guest.id}/autofill`, { method: "POST" }),
                        api<{ id: string; side: string | null }[]>(`/api/v1/guests/${guest.id}/documents`)
                          .catch(() => [] as { id: string; side: string | null }[]),
                      ]).then(([full, docsList]) => {
                        const bySide: Partial<Record<DocSide, string>> = {};
                        for (const d of docsList) {
                          if ((d.side === "front" || d.side === "back" || d.side === "selfie") && !bySide[d.side as DocSide]) {
                            bySide[d.side as DocSide] = d.id;
                          }
                        }
                        setPgExistingDocs(bySide);
                        setPgBaseline(full);
                        // Update all editable fields with latest data
                        if (full.full_name) setPgName(full.full_name);
                        if (full.phone) setPgPhone(full.phone);
                        setPgGender(full.gender ?? pgGender);
                        setPgDob(full.date_of_birth ?? pgDob);
                        setPgAddress(full.address ?? pgAddress);
                        setPgPostalCode(full.postal_code ?? pgPostalCode);
                        setPgCity(full.city ?? pgCity);
                        setPgState(full.state ?? pgState);
                        if (full.id_proof_type) setPgIdType(full.id_proof_type);
                        setPgIdNumber(full.id_last4 ? `••••••••${full.id_last4}` : pgIdNumber);
                        setPgEditing(true);
                      }).catch(() => setPgEditing(true));
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gold-400 bg-gold-50 px-2.5 text-xs font-semibold text-gold-700 transition-colors hover:bg-gold-100"
                  >
                    {t("autofillLabel")}
                  </button>
                  {/* Edit Guest Details */}
                  <button
                    type="button"
                    onClick={() => setPgEditing(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-white px-2.5 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    {t("editGuest")}
                  </button>
                </div>
              </div>

              {/* Read-only profile summary grid */}
              {[
                { label: t("fieldGender"),  value: pgGender },
                { label: t("fieldDob"),     value: pgDob },
                { label: t("fieldAddress"), value: pgAddress },
                { label: t("fieldCity"),    value: pgCity },
                { label: t("fieldState"),   value: pgState },
                { label: t("pincode"),      value: pgPostalCode },
                { label: t("idType"),       value: pgIdType },
                { label: t("idNumberShort"), value: pgIdNumber ? `••••${pgIdNumber.slice(-4)}` : null },
              ].filter((row) => !!row.value).length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-white px-3 py-2.5 sm:grid-cols-3">
                  {[
                    { label: t("fieldGender"),  value: pgGender },
                    { label: t("fieldDob"),     value: pgDob },
                    { label: t("fieldAddress"), value: pgAddress },
                    { label: t("fieldCity"),    value: pgCity },
                    { label: t("fieldState"),   value: pgState },
                    { label: t("pincode"),      value: pgPostalCode },
                    { label: t("idType"),       value: pgIdType },
                    { label: t("idNumberShort"), value: pgIdNumber ? `••••${pgIdNumber.slice(-4)}` : null },
                  ].filter((row) => !!row.value).map((row) => (
                    <div key={row.label} className="min-w-0">
                      <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</p>
                      <p className="truncate text-xs font-medium" title={row.value ?? ""}>{row.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* ── "Found by Aadhaar ID" hint + contact override (mirrors co-guest) ──
                  Shown only when the guest was located via last-4 ID digits.
                  Guides staff: if the phone is outdated, use Edit to update it.
                  If a different contact is needed for THIS booking only, enter it here. */}
              {pgWasIdSearch && (
                <div className="rounded-lg border border-info/20 bg-info-bg/40 px-3 py-2 space-y-2">
                  <p className="flex items-start gap-1.5 text-xs text-info">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{t("idSearchSelectedHint")}</span>
                  </p>
                  {/* Alternate contact for THIS booking only — does not change master record */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" aria-hidden />
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={15}
                        value={pgContactOverride}
                        onChange={(e) => setPgContactOverride(sanitizeGuestPhone(e.target.value))}
                        placeholder={t("contactOverridePlaceholder")}
                        className="h-8 w-full rounded-lg border border-input bg-white pl-8 pr-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    {pgContactOverride && (
                      <button type="button" onClick={() => setPgContactOverride("")} className="text-xs text-muted-foreground hover:text-foreground">{tc("clear")}</button>
                    )}
                  </div>
                </div>
              )}

              {/* Photo tiles (read-only display — same as co-guest summary card) */}
              <div className="grid grid-cols-3 gap-2">
                <DocUpload key={`${guest.id}-front`} guestId={guest.id} side="front" label={t("uploadFrontFace")} idType={pgIdType} existingDocId={pgExistingDocs.front} onOcrResult={() => {}} />
                <DocUpload key={`${guest.id}-back`}  guestId={guest.id} side="back"  label={t("uploadBackFace")}  idType={pgIdType} existingDocId={pgExistingDocs.back}  onOcrResult={() => {}} />
                <DocUpload key={`${guest.id}-selfie`} guestId={guest.id} side="selfie" label={t("selfieCapture")} existingDocId={pgExistingDocs.selfie} onOcrResult={() => {}} />
              </div>
            </div>
          )}

          {/* ── Primary guest EDIT FORM (shows when pgEditing = true) ─────── */}
          {guest && pgEditing && (
            <>
              {/* Edit header with cancel */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("editGuest")}</p>
                <button type="button" onClick={() => setPgEditing(false)} className="text-xs font-medium text-muted-foreground hover:text-foreground">{tc("cancel")}</button>
              </div>

              {/* ID type + number */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("idType")}</Label>
                  <select
                    value={pgIdType}
                    onChange={(e) => setPgIdType(e.target.value)}
                    className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    <option value="Aadhar Card">{t("idAadhar")}</option>
                    <option value="PAN Card">{t("idPan")}</option>
                    <option value="Passport">{t("idPassport")}</option>
                    <option value="Driving License">{t("idDrivingLicense")}</option>
                    <option value="Voter ID">{t("idVoter")}</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <MaskedIdInput
                    label={t("idNoOf", { type: pgIdType.toUpperCase() })}
                    idType={pgIdType}
                    value={pgIdNumber}
                    onChange={setPgIdNumber}
                    placeholder={t("enterIdNumber", { type: pgIdType })}
                    onReveal={
                      guest?.id
                        ? async () => {
                            const res = await api<{ id_number: string | null }>(
                              `/api/v1/guests/${guest.id}/reveal-id`,
                              { method: "POST" },
                            );
                            return res.id_number;
                          }
                        : undefined
                    }
                  />
                </div>
              </div>

              {/* Document uploads — key={guestId+side} so React remounts when
                  guest changes, clearing stale blob previews from prior guest. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <DocUpload
                  key={`${guest.id}-front`}
                  guestId={guest.id}
                  side="front"
                  label={t("uploadFrontFace")}
                  idType={pgIdType}
                  existingDocId={pgExistingDocs.front}
                  onOcrResult={(result) => setPgOcrResult(result)}
                />
                <DocUpload
                  key={`${guest.id}-back`}
                  guestId={guest.id}
                  side="back"
                  label={t("uploadBackFace")}
                  idType={pgIdType}
                  existingDocId={pgExistingDocs.back}
                  onOcrResult={(result) => {
                    if (result.fields.address) {
                      setPgAddress((prev) => prev || (result.fields.address ?? ""));
                      if (result.fields.pincode) {
                        setPgPostalCode((prev) => prev || (result.fields.pincode ?? ""));
                      }
                      if (result.fields.city) {
                        setPgCity((prev) => prev || (result.fields.city ?? ""));
                      }
                      if (result.fields.state) {
                        setPgState((prev) => prev || (result.fields.state ?? ""));
                      }
                      toast.success(t("formAutofilled"));
                    } else {
                      toast.warning(result.message);
                  }
                }}
              />
                <DocUpload
                  key={`${guest.id}-selfie`}
                  guestId={guest.id}
                  side="selfie"
                  label={t("selfieCapture")}
                  existingDocId={pgExistingDocs.selfie}
                />
              </div>

              {/* OCR autofill banner */}
              {pgOcrResult && (
                <AutofillBanner
                  result={pgOcrResult}
                  onAccept={(fields) => {
                    if (fields.name) setPgName(fields.name);
                    if (fields.id_number && !isIdMask(fields.id_number)) {
                      const idType = fields.id_type_detected ?? pgIdType ?? "Aadhar Card";
                      const cleaned = idType === "Aadhar Card" ? sanitizeAadhaarOcr(fields.id_number) : fields.id_number.trim();
                      setPgIdNumber(cleaned);
                    }
                    if (fields.gender) setPgGender(fields.gender);
                    if (fields.date_of_birth) setPgDob(fields.date_of_birth);
                    if (fields.address) setPgAddress(fields.address);
                    if (fields.id_type_detected) setPgIdType(fields.id_type_detected);
                    setPgOcrResult(null);
                    toast.success(t("formAutofilled"));
                  }}
                  onDismiss={() => setPgOcrResult(null)}
                />
              )}

              {/* Guest personal details */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{tg("fullName")}</Label>
                  <Input value={pgName} onChange={(e) => setPgName(liveNameCase(e.target.value))} placeholder={tg("fullName")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("phoneNumber")}</Label>
                  <Input value={pgPhone} onChange={(e) => setPgPhone(sanitizeGuestPhone(e.target.value))} maxLength={15} placeholder={t("phonePlaceholder")} inputMode="tel" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldGender")}</Label>
                  <select
                    value={pgGender}
                    onChange={(e) => setPgGender(e.target.value)}
                    className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    <option value="">{t("selectOption")}</option>
                    <option value="Male">{t("male")}</option>
                    <option value="Female">{t("female")}</option>
                    <option value="Other">{t("genderOther")}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldDob")}</Label>
                  <DatePicker value={pgDob} onChange={setPgDob} max={localToday()} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldAddress")}</Label>
                  <Input value={pgAddress} onChange={(e) => setPgAddress(e.target.value)} placeholder={t("fieldAddress")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldPincode")}</Label>
                  <Input
                    value={pgPostalCode}
                    onChange={(e) => setPgPostalCode(e.target.value)}
                    placeholder={t("fieldPincode")}
                    inputMode="numeric"
                    maxLength={6}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldCity")}</Label>
                  <Input value={pgCity} onChange={(e) => setPgCity(e.target.value)} placeholder={t("fieldCity")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldState")}</Label>
                  <Input value={pgState} onChange={(e) => setPgState(e.target.value)} placeholder={t("fieldState")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldCountry")}</Label>
                  <Input value={pgCountry} onChange={(e) => setPgCountry(e.target.value)} placeholder={t("fieldCountry")} />
                </div>
              </div>
            </>
          )}

          {/* Foreign guest (Form C) */}
          <ForeignGuestSection
            enabled={fgEnabled}
            onEnabledChange={setFgEnabled}
            value={fgForm}
            onChange={setFgForm}
          />
        </div>
      </Section>
      </div>

      {/* ── 3. Additional Guests ──────────────────────────────────────────── */}
      <Section
        icon={Users}
        title={t("additionalGuests")}
        subtitle={t("addCoGuestsStay")}
        badge={coGuests.some(Boolean) ? String(coGuests.filter(Boolean).length) : undefined}
      >
        <div className="space-y-4">
          {guestKeys.map((key, i) => (
            <AdditionalGuestEntry
              key={key}
              idx={i}
              onResolved={(g) => resolveGuest(key, g)}
              onRemove={() => removeGuestEntry(key)}
              /* Draft restore (§4.2): mount straight into the resolved card. */
              initial={coGuests[i] ?? null}
            />
          ))}
          <button
                type="button"
            onClick={addGuestEntry}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
              >
                <Plus className="size-4" aria-hidden />
            {t("addGuest")}
          </button>
        </div>
      </Section>

      {/* ── 4. Room Information ───────────────────────────────────────────── */}
      <div ref={roomsSectionRef}>
      <Section icon={BedDouble} title={t("roomInformation")} subtitle={t("roomInfoSubtitleWalkIn")}>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{tb("adults")}</Label>
              <CountControl
                value={adultsCount}
                onDelta={(d) => setAdultsCount((v) => Math.max(1, Math.min(40, v + d)))}
                min={1}
                max={40}
                decLabel={t("removeAdult")}
                incLabel={t("addAdult")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{tb("children")}</Label>
              <CountControl
                value={childCount}
                onDelta={(d) => setChildCount((v) => Math.max(0, Math.min(40, v + d)))}
                min={0}
                max={40}
                decLabel={t("removeChild")}
                incLabel={t("addChild")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {tb("selectRooms")} *
            </Label>
            <RoomAvailabilityPicker
              checkIn={checkInDate}
              checkOut={checkOutDate}
              selectedRooms={selectedRooms}
              onSelectionChange={setSelectedRooms}
              checkInTime={checkInTime || settings.data?.check_in_time}
              checkOutTime={checkOutTime || settings.data?.check_out_time}
              adults={adultsCount}
              guestChildren={childCount}
              refreshKey={availRefreshKey}
            />
          </div>

          {/* Editable per-room rates for the selected rooms — prefilled with
              the computed default (base price per night, or day-use total). */}
          {selectedAvailRooms.length > 0 && (
            <div className="space-y-2">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                {t("roomRatesTitle")}
              </Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedAvailRooms.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {r.room_number}
                      </span>
                      <span className="block text-micro text-muted-foreground">
                        {isSameDay ? t("rateDayUseTotal") : t("ratePerNight")}
                      </span>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      value={rateEdits[r.id] ?? String(defaultRoomRate(r))}
                      onChange={(e) =>
                        setRateEdits((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      aria-label={t("rateForRoom", { room: r.room_number })}
                      className="h-8 w-28 shrink-0 text-right text-sm tabular-nums"
                    />
                  </div>
                ))}
              </div>
              <p className="text-micro text-muted-foreground">
                {t("rateOverrideHint")}
              </p>
            </div>
          )}
        </div>
      </Section>
          </div>

      {/* ── 5. Special Requirements ───────────────────────────────────────── */}
      <Section icon={Star} title={ts("specialRequirements")}>
        <div className="space-y-4">
          {services.isLoading && <Skeleton className="h-10" />}
          {(services.data?.length ?? 0) > 0 && (
            <ServiceChips
              services={services.data ?? []}
              selectedIds={selectedServices}
              onToggle={toggleService}
              amounts={serviceAmounts}
              onAmountChange={(id, amount) =>
                setServiceAmounts((prev) => ({ ...prev, [id]: amount }))
              }
            />
          )}
          <SelectedServicesList
            services={services.data ?? []}
            selectedIds={selectedServices}
            amounts={serviceAmounts}
          />
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
              {t("specialInstructions")}
            </Label>
            <textarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder={t("instructionsPlaceholder")}
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
          </div>
        </div>
      </Section>

      {/* ── 6. Payment Details ────────────────────────────────────────────── */}
      <Section icon={CreditCard} title={ts("paymentDetails")} subtitle={t("paymentSubtitleWalkIn")}>
        <div className="rounded-xl border bg-muted/20 px-4 py-4 space-y-4">
          {/* Payment summary breakdown — column count follows the GST tile:
              a fixed 5-col grid left an empty bordered gap for no-GST hotels
              (client 16/09 screenshot). */}
          <div className={cn("grid grid-cols-2 gap-2 rounded-lg border bg-background px-3 py-3", hotelGstRate > 0 ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
            <div className="space-y-1 text-center">
              <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{t("roomRentLabel")}</p>
              <p className={cn("text-sm font-bold tabular-nums", roomRentWalkIn === 0 ? "text-muted-foreground" : "")}>
                {roomRentWalkIn === 0 ? "—" : fmtINR(roomRentWalkIn)}
              </p>
            </div>
            <div className="space-y-1 text-center">
              <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{t("extraChargesLabel")}</p>
              {/* Auto-filled: selected service chips + the manual entry below. */}
              <p className="text-sm font-bold tabular-nums">{fmtINR(displayExtraWI)}</p>
              <Input
                type="number"
                min={0}
                step="1"
                value={extraCharges}
                onChange={(e) => setExtraCharges(e.target.value)}
                aria-label={t("manualExtraCharges")}
                title={t("manualExtraCharges")}
                className="h-7 text-center text-sm tabular-nums px-1"
                placeholder="0"
              />
              {chipsTotalWI > 0 && (
                <p className="text-micro text-muted-foreground">
                  {t("extraIncludesServices", { amount: fmtINR(chipsTotalWI) })}
                </p>
              )}
            </div>
            <div className="space-y-1 text-center">
              <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Advance Paid</p>
              <p className="text-sm font-bold tabular-nums">{fmtINR(collectedAdvanceWI)}</p>
            </div>
            {/* GST tile only when tax is added on top (client 09/2026 modes) */}
            {hotelGstRate > 0 && (
              <div className="space-y-1 text-center">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">GST ({hotelGstRate}%)</p>
                <p className="text-sm font-bold tabular-nums">{fmtINR(gstAmountWI)}</p>
              </div>
            )}
            <div className="space-y-1 text-center">
              <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Remaining</p>
              <p className={cn("text-sm font-bold tabular-nums", remainingWI > 0 ? "text-gold-600" : "text-success")}>{fmtINR(remainingWI)}</p>
              {overpaidWI > 0 && (
                <p className="text-micro font-medium text-warning">
                  {t("overpaidHint", { amount: fmtINR(overpaidWI) })}
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                {t("collectAtCheckin")}
              </Label>
              <Input
                type="number"
                min={0}
                step="1"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                className="tabular-nums"
                placeholder="0"
              />
              <p className="text-micro text-muted-foreground">{t("enterZeroHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                {t("paymentMode")}
              </Label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as "cash" | "upi" | "credit_card" | "debit_card" | "bank_transfer" | "other")}
                className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                disabled={newAdvance === 0}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="credit_card">Credit Card</option>
                <option value="debit_card">Debit Card</option>
                <option value="bank_transfer">Net Banking</option>
                <option value="other">Other</option>
              </select>
              {showQr && (
                <div className="mt-2">
                  <UpiQrBlock
                    qrUrl={qrImageQuery.data}
                    loading={qrImageQuery.isLoading}
                  />
                </div>
              )}
            </div>
          </div>
          {/* Payment received confirmation */}
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={paymentReceived}
              onChange={(e) => setPaymentReceived(e.target.checked)}
              disabled={newAdvance === 0}
            />
            <span className={newAdvance === 0 ? "text-muted-foreground" : "font-medium"}>
              Payment collected from guest
            </span>
          </label>
          {!paymentReceived && newAdvance > 0 && (
            <p className="text-xs font-medium text-warning">
              {t("advanceNotRecordedWarning")}
            </p>
          )}
          </div>
      </Section>

      {/* ── 7. Emergency Contact (hidden when disabled in Edit Hotel) ────── */}
      {settings.data?.collect_emergency_contact !== false && (
      <Section icon={AlertTriangle} title={t("emergencyContact")} subtitle={t("optional")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("contactName")}</Label>
            <Input value={emName} onChange={(e) => setEmName(liveNameCase(e.target.value))} placeholder={t("contactNamePlaceholder")} />
            </div>
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("contactRelation")}</Label>
            <Input value={emRelation} onChange={(e) => setEmRelation(e.target.value)} placeholder={t("relationPlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("phoneNumber")}</Label>
            <Input value={emPhone} onChange={(e) => setEmPhone(sanitizeGuestPhone(e.target.value))} maxLength={15} placeholder={t("phonePlaceholder")} inputMode="tel" />
          </div>
        </div>
      </Section>
      )}

      {/* ── 8. Vehicle Details (hidden when disabled in Edit Hotel) ──────── */}
      {settings.data?.collect_vehicle_details !== false && (
      <Section icon={Car} title={t("vehicleDetails")} subtitle={t("optional")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("vehicleNumber")}</Label>
            <Input value={vehNumber} onChange={(e) => setVehNumber(e.target.value)} placeholder="MH 12 AB 1234" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("vehicleType")}</Label>
            <select
              value={vehType}
              onChange={(e) => setVehType(e.target.value)}
              className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="Car">{t("veh_car")}</option>
              <option value="Bike">{t("veh_bike")}</option>
              <option value="Auto">{t("veh_auto")}</option>
              <option value="Taxi">{t("veh_taxi")}</option>
              <option value="Bus">{t("veh_bus")}</option>
              <option value="Other">{t("veh_other")}</option>
            </select>
          </div>
          {vehType === "Other" && (
            <div className="space-y-1.5">
              <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("vehicleTypeName")}</Label>
              <Input
                value={vehTypeOther}
                onChange={(e) => setVehTypeOther(e.target.value)}
                placeholder={t("vehicleTypeNamePlaceholder")}
                maxLength={40}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{t("makeName")}</Label>
            <Input value={vehMake} onChange={(e) => setVehMake(e.target.value)} placeholder={t("makePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">{ts("parkingSlot")}</Label>
            <Input value={parkingSlot} onChange={(e) => setParkingSlot(e.target.value)} placeholder="A-12" />
          </div>
        </div>
      </Section>
      )}

      {/* ── Footer: Terms + Check In ──────────────────────────────────────── */}
      <div ref={termsSectionRef} className="rounded-xl border bg-white shadow-sm px-5 py-4 space-y-4">
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input shrink-0"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
          />
          <span className="text-muted-foreground leading-relaxed">
            {ts("termsAgreement")}
          </span>
        </label>

          {error && (
          <p className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending || savingDraft}
            onClick={() => void saveDraft()}
          >
            <FileText className="size-4" aria-hidden />
            {savingDraft ? ts("savingDraft") : ts("saveDraft")}
            </Button>
          {/* Wrapper catches clicks while the Button is disabled
              (disabled:pointer-events-none) and scrolls to the first
              invalid section. */}
          <span
            onClick={() => {
              if (!canSubmit) validateAndSubmit();
            }}
          >
            <Button
              type="button"
              disabled={!canSubmit}
              className="bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold"
              onClick={validateAndSubmit}
            >
              <LogIn className="size-4" aria-hidden />
              {mutation.isPending ? t("checkingIn") : tb("checkInAction")}
            </Button>
          </span>
        </div>
        {submitHint && !mutation.isPending && (
          <p className="text-right text-xs text-muted-foreground">{submitHint}</p>
        )}
      </div>
    </div>
  );
}

// ─── Arrivals strip ──────────────────────────────────────────────────────────
// Compact clickable cards for confirmed bookings arriving — clicking one enters
// MODE B (existing-booking check-in). Hidden when there are none.

const ARRIVALS_VISIBLE = 10;

function ArrivalsStrip({
  bookings,
  isLoading,
  onSelect,
  defaultInTime,
  defaultOutTime,
}: {
  readonly bookings: BookingOut[];
  readonly isLoading: boolean;
  readonly onSelect: (booking: BookingOut) => void;
  /** Hotel standard times — shown when a booking has no per-booking time. */
  readonly defaultInTime?: string;
  readonly defaultOutTime?: string;
}) {
  const t = useTranslations("checkin");
  const [showAll, setShowAll] = useState(false);

  if (isLoading) {
    return (
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-48 rounded-xl" />
        ))}
      </div>
    );
  }

  if (bookings.length === 0) return null;

  const visible = showAll ? bookings : bookings.slice(0, ARRIVALS_VISIBLE);
  const hiddenCount = bookings.length - ARRIVALS_VISIBLE;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t("arrivingBookings")}
        </h2>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-xs font-medium text-gold-600 hover:underline"
          >
            {showAll ? t("showLess") : t("moreCount", { count: hiddenCount })}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((booking) => (
          <button
            key={booking.id}
            type="button"
            onClick={() => onSelect(booking)}
            className="flex min-w-[180px] flex-col rounded-xl border-2 border-border bg-white px-3 py-2.5 text-left shadow-sm transition-all hover:border-gold-400 hover:bg-gold-50"
          >
            <span className="flex items-center gap-1.5">
              <LogIn className="size-3.5 text-gold-600 shrink-0" aria-hidden />
              <span className="text-xs font-bold tabular-nums">{booking.booking_number}</span>
            </span>
            <span className="mt-0.5 text-sm font-semibold truncate max-w-[200px]">
              {booking.primary_guest_name ?? "—"}
            </span>
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {booking.rooms
                .filter((r) => r.is_current)
                .map((r) => r.room_number)
                .join(", ") || t("noRooms")}
            </span>
            <span className="text-micro text-muted-foreground mt-0.5">
              {fmtApiDateTime(booking.check_in_date, booking.check_in_time || defaultInTime || "14:00")} →{" "}
              {fmtApiDateTime(booking.check_out_date, booking.check_out_time || defaultOutTime || "11:00")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Page content ─────────────────────────────────────────────────────────────

/** Hotel-scoped (plan §1.2): the selected-booking hand-off must never survive a
 *  hotel switch in the same tab. The id was already validated against the
 *  current hotel's booking list, but scoping the key removes the class. */
const checkinSessionKey = (hotelId: string | null) =>
  `dmh.checkin.selectedBookingId:${hotelId ?? "none"}`;

function CheckinContent() {
  const t = useTranslations("checkin");
  const ts = useTranslations("stay");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();
  const [selectedBooking, setSelectedBooking] = useState<BookingOut | null>(null);
  // Remount key to reset the walk-in form after a completed check-in.
  const [walkInKey, setWalkInKey] = useState(0);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    // ?booking=<id> lets other pages (e.g. Advance Bookings) deep-link into
    // the check-in form for a specific booking.
    const fromUrl = new URLSearchParams(window.location.search).get("booking");
    return fromUrl ?? sessionStorage.getItem(checkinSessionKey(activeHotelId));
  });

  // Clean ?new=1 / ?booking= from URL after reading them (prevents re-opening
  // on back navigation). ?new=1 is a legacy link — walk-in mode is now the
  // default view, so the param is simply ignored.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1" || params.get("booking")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      url.searchParams.delete("booking");
      window.history.replaceState({}, "", url.toString());
    }
  }, []); // run once on mount

  // Confirmed bookings arriving — rendered as the compact arrivals strip.
  const bookings = useQuery({
    queryKey: ["bookings", activeHotelId, "confirmed", 0],
    queryFn: () =>
      api<ListOut<BookingOut>>(`/api/v1/bookings?status=confirmed&limit=50&offset=0`),
    enabled: !!activeHotelId,
  });

  // Hotel default times — arrival cards fall back to these when a booking
  // carries no per-booking times (client: "Time missing here").
  const hotelSettings = useQuery({
    queryKey: ["hotel-settings", activeHotelId],
    queryFn: () =>
      api<{ check_in_time: string; check_out_time: string }>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
  });
  const defaultInTime = hotelSettings.data?.check_in_time?.slice(0, 5);
  const defaultOutTime = hotelSettings.data?.check_out_time?.slice(0, 5);

  useEffect(() => {
    if (!pendingBookingId || !bookings.data) return;
    const match = bookings.data.items.find((b) => b.id === pendingBookingId);
    if (match) setSelectedBooking(match);
    setPendingBookingId(null);
    sessionStorage.removeItem(checkinSessionKey(activeHotelId));
  }, [pendingBookingId, bookings.data]);

  // Check-in changes room state AND money (advance collected) — refresh both
  // families across every page (plan Part 6).
  const invalidate = () => {
    invalidateRoomState(queryClient);
    invalidateMoney(queryClient);
  };

  if (selectedBooking) {
    return (
      <>
        <PartnerHeader title={ts("checkinTitle")} subtitle={tn("frontDesk")} />
        <main className="flex-1 overflow-y-auto bg-[#f5f5f0] px-4 py-6">
          <CheckinForm
            booking={selectedBooking}
            onBack={() => {
              sessionStorage.removeItem(checkinSessionKey(activeHotelId));
              setSelectedBooking(null);
            }}
            onDone={() => {
              sessionStorage.removeItem(checkinSessionKey(activeHotelId));
              setSelectedBooking(null);
              invalidate();
            }}
          />
        </main>
      </>
    );
  }

  // MODE A — walk-in check-in (default) with the arrivals strip on top.
  return (
    <>
      <PartnerHeader title={ts("checkinTitle")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto bg-[#f5f5f0] px-4 py-6">
        <div className="mx-auto max-w-4xl space-y-6 pb-12">
          <ArrivalsStrip
            bookings={bookings.data?.items ?? []}
            isLoading={bookings.isLoading}
            defaultInTime={defaultInTime}
            defaultOutTime={defaultOutTime}
            onSelect={(booking) => {
              sessionStorage.setItem(checkinSessionKey(activeHotelId), booking.id);
              setSelectedBooking(booking);
            }}
          />
          {bookings.isError && (
            <p className="text-sm text-danger">
              {t("arrivalsLoadFailed")}{" "}
              <button type="button" className="underline" onClick={() => bookings.refetch()}>
                {tc("retry")}
              </button>
            </p>
          )}

          <div id="walkin-section" className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">{t("walkInTitle")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("walkInDescription")}
            </p>
          </div>
          <WalkInCheckinForm
            key={walkInKey}
            onDone={() => {
              invalidate();
              setWalkInKey((k) => k + 1);
              // Scroll back to the top of the walk-in area so the freshly
              // reset form is immediately visible.
              setTimeout(() => {
                document.getElementById("walkin-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 50);
            }}
          />
        </div>
      </main>
    </>
  );
}

export default function CheckinPage() {
  return (
    <RequirePermission permission={PERMISSIONS.checkin}>
      <CheckinContent />
    </RequirePermission>
  );
}
