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
  Clock,
  Globe,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileText,
  LogIn,
  Minus,
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
  type LucideIcon,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { TimeInput } from "@/components/ui/time-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { GuestPicker } from "@/components/guests/guest-picker";
import { RoomAvailabilityPicker } from "@/components/rooms/room-availability-picker";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { API_BASE, ApiError, apiUpload } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { compressDocument } from "@/lib/compress-image";
import { fmtApiDate, fmtINR, localToday, localTomorrow } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import type { ListOut, RoomAvailableItem } from "@/types/hotel";
import type {
  BookAndCheckInRequest,
  BookingOut,
  CheckInChargeIn,
  CheckInCreateOut,
  CheckInRequest,
  ForeignGuestIn,
  GuestAutofill,
  GuestCreatePayload,
  GuestSearchResult,
  RoomRateOverride,
} from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

// ─── Interfaces ─────────────────────────────────────────────────────────────

/** Which face of an ID document (or selfie) a tile handles. */
type DocSide = "front" | "back" | "selfie";

interface ServiceItem {
  id: string;
  name: string;
  price: string;
  is_active: boolean;
}

/** A resolved additional guest ready to be passed to POST /checkins. */
interface ResolvedCoGuest {
  guest_id: string;
  full_name: string;
  /** Docs queued for upload after guest is created/resolved. */
  docs: { side: DocSide; file: File }[];
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

// ─── Walk-in draft (localStorage) ────────────────────────────────────────────

const DRAFT_KEY = "dmh.checkinDraft.v1";

/** Serialized walk-in form state saved to localStorage via "Save Draft". */
interface CheckinDraft {
  savedAt: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  guestType: string;
  guest: { id: string; full_name: string; phone: string } | null;
  selectedRooms: string[];
  adultsCount: number;
  childCount: number;
  specialInstructions: string;
  selectedServices: string[];
  advanceAmount: string;
  paymentMode: "cash" | "upi" | "card" | "bank_transfer" | "other";
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
}

function readDraft(): CheckinDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CheckinDraft;
  } catch {
    return null;
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

/**
 * Amount charged for a selected service chip — the staff-edited amount when
 * present and a valid non-negative number, else the service's fixed price.
 */
function serviceChargeAmount(
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

/** Mask an ID number, keeping only the last 4 characters visible. */
function maskIdValue(v: string): string {
  if (!v) return "";
  const visible = v.slice(-4);
  return "•".repeat(Math.max(v.length - visible.length, 0)) + visible;
}

/**
 * ID-number field that renders masked (••••••••1234) with a "Show" checkbox
 * beside the label. Raw value stays in parent state — only display toggles.
 * Focusing the input reveals the raw value so it stays editable.
 */
function MaskedIdInput({
  label,
  labelClassName = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
  value,
  onChange,
  placeholder,
  trailing,
}: {
  readonly label: string;
  readonly labelClassName?: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly trailing?: React.ReactNode;
}) {
  const t = useTranslations("checkin");
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  const masked = !show && !focused;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className={labelClassName}>{label}</Label>
        <label className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            className="size-3 rounded border-input"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
          />{t("show")}
        </label>
      </div>
      <div className="flex gap-2">
        <Input
          value={masked ? maskIdValue(value) : value}
          onChange={(e) => {
            if (!masked) onChange(e.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete="off"
          className="flex-1"
        />
        {trailing}
      </div>
    </div>
  );
}

/**
 * Inline camera view for desktop selfie capture — opens the front camera via
 * getUserMedia, captures a frame to canvas and returns it as a File.
 */
function InlineCameraCapture({
  onCapture,
  onClose,
}: {
  readonly onCapture: (file: File) => void;
  readonly onClose: () => void;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("unsupported");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch {
        toast.error(t("cameraUnavailable"));
        onCloseRef.current();
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [t]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error(t("captureFailed"));
          return;
        }
        onCapture(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-gold-400 bg-white p-2">
      {/* Mirrored preview like a front camera */}
      <video
        ref={videoRef}
        muted
        playsInline
        className="w-full rounded-md bg-black -scale-x-100"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-navy-900 px-2 text-xs font-semibold text-white hover:bg-navy-900/90 disabled:opacity-50"
        >
          <Camera className="size-3.5" aria-hidden />
          {t("capture")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center justify-center rounded-lg border px-2 text-xs font-medium hover:bg-muted"
        >
          {tc("cancel")}
        </button>
        </div>
    </div>
  );
}

/** "Selected special requirements" summary — shows name + ₹amount per chip
 *  (staff-edited amount when present, else the service's fixed price). */
function SelectedServicesList({
  services,
  selectedIds,
  amounts,
}: {
  readonly services: ServiceItem[];
  readonly selectedIds: string[];
  /** Staff-edited amounts keyed by service id. */
  readonly amounts?: Record<string, string>;
}) {
  const t = useTranslations("checkin");
  const chosen = services.filter((s) => selectedIds.includes(s.id));
  if (chosen.length === 0) return null;
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("selectedRequirements")}
      </p>
      <ul className="space-y-1">
        {chosen.map((s) => (
          <li key={s.id} className="flex items-center justify-between text-sm">
            <span>{s.name}</span>
            <span className="tabular-nums font-medium">
              {fmtINR(serviceChargeAmount(s, amounts ?? {}))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Service chips row with per-chip editable amount — when a chip is selected a
 * small numeric input appears next to it, prefilled with the service price;
 * edits flow into the atomic `charges` array at submit time.
 */
function ServiceChips({
  services,
  selectedIds,
  onToggle,
  amounts,
  onAmountChange,
}: {
  readonly services: ServiceItem[];
  readonly selectedIds: string[];
  readonly onToggle: (id: string) => void;
  readonly amounts: Record<string, string>;
  readonly onAmountChange: (id: string, amount: string) => void;
}) {
  const t = useTranslations("checkin");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {services.map((svc) => {
        const active = selectedIds.includes(svc.id);
        return (
          <div key={svc.id} className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggle(svc.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                active
                  ? "border-navy-900 bg-navy-900 text-white font-medium"
                  : "border-border text-muted-foreground hover:border-navy-900 hover:text-navy-900",
              )}
            >
              {svc.name}
              {!active && (
                <span className="text-xs opacity-60">{fmtINR(svc.price)}</span>
              )}
            </button>
            {active && (
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amounts[svc.id] ?? svc.price}
                onChange={(e) => onAmountChange(svc.id, e.target.value)}
                aria-label={t("serviceAmountLabel", { name: svc.name })}
                className="h-8 w-24 text-right text-sm tabular-nums"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

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

  const lbl = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

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
                <DateInput
                  value={value.passport_expiry}
                  onChange={(v) => set("passport_expiry", v)}
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
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
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
                <DateInput
                  value={value.visa_expiry}
                  onChange={(v) => set("visa_expiry", v)}
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
                <DateInput
                  value={value.arrived_in_india_on}
                  onChange={(v) => set("arrived_in_india_on", v)}
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
function Section({
  icon: Icon,
  title,
  subtitle,
  children,
  defaultOpen = true,
  badge,
}: {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly subtitle?: string;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-4"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="flex size-7 items-center justify-center rounded-md bg-gold-50">
              <Icon className="size-4 text-gold-600" aria-hidden />
            </div>
          )}
          <div className="text-left">
            <p className="font-semibold text-sm text-foreground">{title}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {badge && (
            <span className="ml-2 rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-semibold text-gold-700">
              {badge}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" aria-hidden />
        )}
              </button>
      {open && <div className="border-t px-5 py-5">{children}</div>}
            </div>
  );
}

/** Document upload tile — shows image preview after upload + optional OCR.
 *
 *  • Front face  → full OCR (name, DOB, gender, ID number, address)
 *  • Back face   → address-only OCR (Aadhar address lives on the back)
 *  • existingDocId → on mount, fetches the previously-stored image from B2
 *    so returning guests never have empty tiles (staff can still re-upload).
 */
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
    const url = `/api/v1/guests/${guestId}/documents/${existingDocId}/file`;
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
    setBusy(true);
    // Show local preview immediately — before upload
    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);
    try {
      const compressed = await compressDocument(file);

      // Run OCR in parallel with upload — on the ORIGINAL file, not the
      // compressed one: OCR accuracy depends on resolution, while the upload
      // uses the compressed copy to save bandwidth/storage.
      // Front → full extraction (name, DOB, gender, ID number, address).
      // Back  → address-only (Aadhar address lives on the back face; we only
      //          surface it if the callback is wired by the parent).
      if ((side === "front" || side === "back") && onOcrResult) {
        setOcrRunning(true);
        const { parseIdDocument } = await import("@/lib/id-ocr");
        parseIdDocument(file, idType ?? "Aadhar Card")
          .then((result) => {
            if (side === "back") {
              // Back face: surface address field only — don't overwrite
              // name/DOB/gender already captured from the front.
              const addressOnly = {
                ...result,
                fields: { address: result.fields.address },
              };
              onOcrResult(addressOnly);
            } else {
              onOcrResult(result);
            }
          })
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
    tileStateClass = "border-green-400 p-0 h-28";
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
              className="h-full w-full object-cover"
            />
            {/* Status overlay */}
            <div className={cn(
              "absolute bottom-0 left-0 right-0 px-2 py-1 text-[10px] font-semibold text-center",
              uploaded ? "bg-green-600/80 text-white" : "bg-gold-500/80 text-navy-900",
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
              <span className="text-[10px] text-gold-600">{t("extractingDetails")}</span>
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
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors disabled:opacity-40"
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
function AutofillBanner({
  result,
  onAccept,
  onDismiss,
}: {
  readonly result: import("@/lib/id-ocr").IdOcrResult;
  readonly onAccept: (fields: import("@/lib/id-ocr").ParsedIdFields) => void;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations("checkin");
  if (!result.can_autofill) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-orange-500 mt-0.5" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold text-orange-700">{t("unableAutofill")}</p>
          <p className="mt-0.5 text-orange-600 text-xs">{result.message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-orange-400 hover:text-orange-600 text-base leading-none"
          aria-label={t("dismiss")}
        >
          ×
        </button>
      </div>
    );
  }

  const { fields } = result;
  const detectedItems = [
    fields.name && { label: t("fieldName"), value: fields.name },
    fields.id_number && { label: t("fieldIdNumber"), value: fields.id_number },
    fields.date_of_birth && { label: t("fieldDob"), value: fields.date_of_birth },
    fields.gender && { label: t("fieldGender"), value: fields.gender },
    fields.address && { label: t("fieldAddress"), value: fields.address.slice(0, 60) + (fields.address.length > 60 ? "…" : "") },
  ].filter(Boolean) as { label: string; value: string }[];

  const pct = Math.round(result.confidence * 100);

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-green-200">
        <div className="flex items-center gap-2">
          <BadgeCheck className="size-4 text-green-600" aria-hidden />
          <span className="text-sm font-semibold text-green-800">
            {t("idDetected")}
          </span>
          <span className="rounded-full bg-green-200 px-2 py-0.5 text-[10px] font-bold text-green-700">
            {t("confidencePct", { pct })}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-green-400 hover:text-green-600 text-base leading-none"
          aria-label={t("dismiss")}
        >
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {detectedItems.map((item) => (
          <div key={item.label} className="flex gap-2 text-xs">
            <span className="w-24 shrink-0 font-semibold text-green-700">{item.label}</span>
            <span className="text-green-800 truncate">{item.value}</span>
          </div>
              ))}
            </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-green-200 bg-green-50/50">
        <button
          type="button"
          onClick={() => onAccept(fields)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-green-600 px-3 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
        >
          <BadgeCheck className="size-3.5" aria-hidden />
          {t("autofillForm")}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-8 items-center px-3 text-xs font-medium text-green-700 hover:underline"
        >
          {t("skipManual")}
              </button>
            </div>
    </div>
  );
}

/** Queued doc upload tile — shows preview thumbnail; queues file for upload after guest creation. */
function QueuedDocUpload({
  side,
  label,
  onQueued,
  onOriginal,
}: {
  readonly side: DocSide;
  readonly label: string;
  readonly onQueued: (side: DocSide, file: File) => void;
  /** Receives the ORIGINAL (uncompressed) file — use for OCR, which needs
   *  full resolution. The queued/uploaded file is the compressed copy. */
  readonly onOriginal?: (side: DocSide, file: File) => void;
}) {
  const t = useTranslations("checkin");
  const [queued, setQueued] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);
    onOriginal?.(side, file);
    try {
      const compressed = await compressDocument(file);
      onQueued(side, compressed);
      setQueued(true);
    } catch {
      setPreview(null);
      toast.error(t("processImageFailed"));
    }
  };

  return (
    <div className="space-y-1.5">
      <label
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 overflow-hidden text-center text-xs transition-colors",
          preview
            ? "border-gold-400 p-0 h-28"
            : "border-dashed border-border hover:border-gold-400 hover:bg-gold-50 text-muted-foreground p-4",
        )}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={side === "selfie" ? t("selfieAlt") : t("idDocumentAlt")}
              className="h-full w-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gold-500/80 px-2 py-1 text-[10px] font-semibold text-navy-900 text-center">
              {queued ? t("readyToUpload") : t("processing")}
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
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
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

// ─── Additional Guest entry component ────────────────────────────────────────

function AdditionalGuestEntry({
  idx,
  onResolved,
  onRemove,
}: {
  readonly idx: number;
  readonly onResolved: (guest: ResolvedCoGuest) => void;
  readonly onRemove: () => void;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const tg = useTranslations("guestPicker");
  const api = useApi();
  const [searchPhone, setSearchPhone] = useState("");
  const [searchResults, setSearchResults] = useState<GuestSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolved, setResolved] = useState<ResolvedCoGuest | null>(null);
  const [mode, setMode] = useState<"search" | "form">("search");
  const [docs, setDocs] = useState<{ side: DocSide; file: File }[]>([]);
  const [coOcrResult, setCoOcrResult] = useState<import("@/lib/id-ocr").IdOcrResult | null>(null);

  // New guest form state
  const [form, setForm] = useState<GuestCreatePayload>({
    full_name: "",
    phone: "",
    email: "",
    address: "",
    gender: "",
    date_of_birth: "",
    id_proof_type: "Aadhar Card",
    id_number: "",
    postal_code: "",
  });

  const set = (k: keyof GuestCreatePayload, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSearch = async () => {
    if (!searchPhone.trim()) return;
    setSearching(true);
    try {
      const res = await api<{ items: GuestSearchResult[] }>(
        `/api/v1/guests/search?q=${encodeURIComponent(searchPhone.trim())}`,
      );
      setSearchResults(res.items);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectExisting = async (g: GuestSearchResult) => {
    try {
      const full = await api<GuestAutofill>(`/api/v1/guests/${g.id}/autofill`, { method: "POST" });
      const resolved: ResolvedCoGuest = {
        guest_id: g.id,
        full_name: full.full_name,
        docs: [],
      };
      setResolved(resolved);
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

  if (resolved) {
    return (
      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-green-600" aria-hidden />
            <span className="text-sm font-semibold">{resolved.full_name}</span>
        </div>
          <button
            type="button"
            onClick={() => {
              setResolved(null);
              setSearchPhone("");
              setSearchResults([]);
              onRemove();
            }}
            className="text-danger hover:opacity-70"
            aria-label={t("removeGuest")}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <QueuedDocUpload side="front" label={t("uploadFront")} onQueued={handleQueueDoc} />
          <QueuedDocUpload side="back" label={t("uploadBack")} onQueued={handleQueueDoc} />
          <QueuedDocUpload side="selfie" label={t("selfieCapture")} onQueued={handleQueueDoc} />
        </div>
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
          onClick={() => setMode("search")}
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
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden />
              <Input
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                placeholder={t("searchByPhone")}
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSearch())}
              />
            </div>
            <Button type="button" size="sm" onClick={handleSearch} disabled={searching}>
              <Search className="size-4" aria-hidden />
              {searching ? "…" : tc("search")}
                      </Button>
          </div>
          {searchResults.length > 0 && (
            <ul className="rounded-lg border divide-y">
              {searchResults.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectExisting(g)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                  >
                    <span className="font-medium">{g.full_name}</span>
                    <span className="ml-2 text-muted-foreground">{g.phone_masked}</span>
                    {g.id_last4 && (
                      <span className="ml-1 text-xs text-muted-foreground">{t("idLast4", { last4: g.id_last4 })}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchResults.length === 0 && searchPhone && !searching && (
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
          {/* ID verification */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("idType")}</Label>
              <select
                value={form.id_proof_type}
                onChange={(e) => set("id_proof_type", e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
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
              onChange={(v) => set("id_number", v)}
              placeholder={t("last4Min")}
            />
        </div>

          {/* Doc uploads — front triggers OCR */}
          <div className="grid grid-cols-3 gap-2">
            <QueuedDocUpload
              side="front"
              label={t("uploadFront")}
              onQueued={handleQueueDoc}
              onOriginal={(_side, original) => {
                // OCR runs on the ORIGINAL (full-resolution) image.
                import("@/lib/id-ocr").then(({ parseIdDocument }) =>
                  parseIdDocument(original, form.id_proof_type ?? "Aadhar Card").then(setCoOcrResult),
                );
              }}
            />
            <QueuedDocUpload side="back" label={t("uploadBack")} onQueued={handleQueueDoc} />
            <QueuedDocUpload side="selfie" label={t("selfieCapture")} onQueued={handleQueueDoc} />
          </div>

          {/* OCR autofill banner for additional guest */}
          {coOcrResult && (
            <AutofillBanner
              result={coOcrResult}
              onAccept={(fields) => {
                if (fields.name) set("full_name", fields.name);
                if (fields.id_number) set("id_number", fields.id_number);
                if (fields.gender) set("gender", fields.gender);
                if (fields.date_of_birth) set("date_of_birth", fields.date_of_birth);
                if (fields.address) set("address", fields.address);
                if (fields.id_type_detected) set("id_proof_type", fields.id_type_detected);
                setCoOcrResult(null);
                toast.success(t("guestAutofilled"));
              }}
              onDismiss={() => setCoOcrResult(null)}
            />
          )}

          {/* Guest details */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{tg("fullName")} *</Label>
              <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder={tg("fullName")} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{tg("phoneNumber")} *</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder={t("mobile10")} inputMode="tel" required />
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
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">{t("selectOption")}</option>
                <option value="Male">{t("male")}</option>
                <option value="Female">{t("female")}</option>
                <option value="Other">{t("genderOther")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("fieldDob")}</Label>
              <DateInput value={form.date_of_birth ?? ""} onChange={(v) => set("date_of_birth", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("pincode")}</Label>
              <Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} placeholder={t("pincode")} inputMode="numeric" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">{t("fieldAddress")}</Label>
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder={t("fieldAddress")} />
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            className="bg-navy-900 text-white hover:bg-navy-900/90"
            disabled={!form.full_name.trim() || !form.phone.trim()}
            onClick={() => {
              // Will be created in the mutation; mark as pending-creation
              const pending: ResolvedCoGuest = {
                guest_id: `__new__${Date.now()}`,
                full_name: form.full_name,
                docs,
              };
              // Attach the form data to the resolved object for the mutation
              (pending as ResolvedCoGuest & { _newForm?: GuestCreatePayload })._newForm = { ...form };
              setResolved(pending);
              onResolved(pending);
            }}
          >
            {t("confirmGuestDetails")}
                      </Button>
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
        <div className="flex size-16 items-center justify-center rounded-full bg-green-100 mx-auto">
          <BadgeCheck className="size-8 text-green-600" aria-hidden />
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
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-medium text-white hover:bg-green-700"
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
  booking,
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

  // ── Primary guest editable state ──
  const [pgName, setPgName] = useState(booking.primary_guest_name ?? "");
  const [pgPhone, setPgPhone] = useState(booking.primary_guest_phone ?? "");
  const [pgIdType, setPgIdType] = useState("Aadhar Card");
  const [pgIdNumber, setPgIdNumber] = useState("");
  const [pgGender, setPgGender] = useState("");
  const [pgDob, setPgDob] = useState("");
  const [pgAddress, setPgAddress] = useState("");
  const [pgPostalCode, setPgPostalCode] = useState("");
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
        if (full.id_proof_type) setPgIdType((v) => (v === "Aadhar Card" ? full.id_proof_type! : v));
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
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "card" | "bank_transfer" | "other">("cash");
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

  // ── Early check-in (auto-computed from check-in time) ──
  const [checkInTime, setCheckInTime] = useState(booking.check_in_time?.slice(0, 5) ?? "");
  const [earlyFee, setEarlyFee] = useState(0);

  // ── Expected checkout time — staff correction sent as check_out_time ──
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
      }>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });

  // Hotel GST settings for accurate payment breakdown.
  const gstSettings = useQuery({
    queryKey: ["hotel-gst", activeHotelId],
    queryFn: () =>
      api<{ default_cgst_rate: string; default_sgst_rate: string }>(
        "/api/v1/hotels/me/gst",
      ),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });
  // Total rate = CGST + SGST. Falls back to 5 if data not yet loaded.
  const hotelGstRate =
    Number.parseFloat(gstSettings.data?.default_cgst_rate ?? "0") +
    Number.parseFloat(gstSettings.data?.default_sgst_rate ?? "0") || 5;

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
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr/image`, {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "X-Hotel-Id": activeHotelId ?? "",
        },
        credentials: "include",
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
  // Note: booking.total_amount does not include GST (GST is only on the invoice).
  // We show an *approximate* GST for the balance display only, using the
  // hotel's configured rate. The authoritative amount is on the invoice.
  const gstAmount = Math.round((bookingTotal + extraChargesNum) * (hotelGstRate / 100) * 100) / 100;
  // Only subtract the new advance when staff confirmed it was actually collected —
  // otherwise it is not recorded and the balance would be dishonest.
  const collectedAdvance = paymentReceived ? newAdvance : 0;
  const balance = Math.max(bookingTotal + extraChargesNum + gstAmount - advPaid - collectedAdvance, 0);

  // ── Mutation ─────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async () => {
      if (fgEnabled && fgForm.passport_number.trim().length < 3) {
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
        if (pgIdType) body.id_proof_type = pgIdType;
        if (pgIdNumber) body.id_number = pgIdNumber;
        if (Object.keys(body).length > 0) {
          await api(`/api/v1/guests/${booking.primary_guest_id}`, {
            method: "PATCH",
            body,
          });
        }
      }

      // 2. Create new additional guests + resolve IDs
      const resolvedIds: string[] = [];
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
              postal_code: newForm.postal_code?.trim() || undefined,
              gender: newForm.gender?.trim() || undefined,
              date_of_birth: newForm.date_of_birth?.trim() || undefined,
              id_proof_type: newForm.id_proof_type?.trim() || undefined,
              id_number: newForm.id_number?.trim() || undefined,
            },
          });
          // Upload queued docs for the new guest
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            await apiUpload(`/api/v1/guests/${created.id}/documents`, form, {
              hotelId: activeHotelId ?? undefined,
            });
          }
          resolvedIds.push(created.id);
        } else {
          // Existing guest — upload any queued docs
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            await apiUpload(`/api/v1/guests/${cg.guest_id}/documents`, form, {
              hotelId: activeHotelId ?? undefined,
            });
          }
          resolvedIds.push(cg.guest_id);
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
        co_guests: resolvedIds.map((id) => ({ guest_id: id })),
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
      queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
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
      <Section icon={ClipboardList} title={ts("bookingDetailsTitle")} subtitle={ts("bookingDetailsSubtitle")}>
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tb("bookingNumber")}</Label>
              <p className="mt-1 font-semibold text-foreground">{booking.booking_number}</p>
            </div>
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tb("checkinDate")}</Label>
              <p className="mt-1">{fmtApiDate(booking.check_in_date)}</p>
            </div>
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tb("checkoutDate")}</Label>
              <p className="mt-1">{fmtApiDate(booking.check_out_date)}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("checkinTime")}</Label>
              <TimeInput
                value={checkInTime}
                onChange={setCheckInTime}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("checkoutTime")}</Label>
              <TimeInput
                value={checkOutTime}
                onChange={setCheckOutTime}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              />
            </div>
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("guestTypeLabel")}</Label>
              <select
                value={pgPurpose}
                onChange={(e) => setPgPurpose(e.target.value)}
                className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
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
              <div className="sm:col-span-2">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("company")}</Label>
                <Input className="mt-1" value={pgCompany} onChange={(e) => setPgCompany(e.target.value)} placeholder={t("companyPlaceholder")} />
              </div>
            )}
          </div>
          {earlyFee > 0 && (() => {
            const rate = Number.parseFloat(checkinSettings.data?.early_checkin_fee_per_hour ?? "1") || 1;
            const hrs = Math.max(1, Math.round(earlyFee / rate));
            return (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Early check-in by {hrs} hr{hrs !== 1 ? "s" : ""} — {fmtINR(earlyFee)} fee will be added to the bill
              </div>
            );
          })()}
        </div>
      </Section>

      {/* ── 2. Primary Guest Identity Verification ────────────────────────── */}
      <Section icon={BadgeCheck} title={ts("primaryGuestTitle")} subtitle={ts("primaryGuestSubtitle")}>
        <div className="space-y-5">
          {/* ID type + number */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("idType")}</Label>
              <select
                value={pgIdType}
                onChange={(e) => setPgIdType(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
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
                value={pgIdNumber}
                onChange={setPgIdNumber}
                placeholder={t("enterIdNumber", { type: pgIdType })}
                trailing={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      if (pgIdNumber) toast.success(t("idRecorded"));
                    }}
                  >
                    {t("submit")}
                  </Button>
                }
              />
            </div>
          </div>

          {/* Document uploads — pre-filled from B2; key=guestId+side prevents
              stale blob from prior session leaking into a re-opened booking. */}
          <div className="grid grid-cols-3 gap-3">
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
                if (fields.id_number) setPgIdNumber(fields.id_number);
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
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tg("fullName")}</Label>
              <Input value={pgName} onChange={(e) => setPgName(e.target.value)} placeholder={tg("fullName")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("phoneNumber")}</Label>
              <Input value={pgPhone} onChange={(e) => setPgPhone(e.target.value)} placeholder={t("phonePlaceholder")} inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldGender")}</Label>
              <select
                value={pgGender}
                onChange={(e) => setPgGender(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">{t("selectOption")}</option>
                <option value="Male">{t("male")}</option>
                <option value="Female">{t("female")}</option>
                <option value="Other">{t("genderOther")}</option>
              </select>
          </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldDob")}</Label>
              <DateInput value={pgDob} onChange={setPgDob} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldAddress")}</Label>
              <Input value={pgAddress} onChange={(e) => setPgAddress(e.target.value)} placeholder={t("fieldAddress")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldPincode")}</Label>
              <Input
                value={pgPostalCode}
                onChange={(e) => setPgPostalCode(e.target.value)}
                placeholder={t("fieldPincode")}
                inputMode="numeric"
                maxLength={6}
              />
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
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tr("roomNumber")}</Label>
                <div className="h-9 rounded-lg border bg-muted/40 px-2.5 flex items-center text-sm font-medium">
                  {room.room_number}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tr("roomType")}</Label>
                <div className="h-9 rounded-lg border bg-muted/40 px-2.5 flex items-center text-sm text-muted-foreground">
                  {room.room_type_name}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tb("adults")}</Label>
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
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tb("children")}</Label>
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
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("bookingAmount")}
              </Label>
              <p className="mt-1 tabular-nums font-medium">{fmtINR(booking.total_amount)}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("gst")}
              </Label>
              <p className="mt-1 tabular-nums">{fmtINR(booking.tax_amount)}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("alreadyPaid")}
                <span className="ml-1 text-[9px] font-normal text-muted-foreground/70">{t("fromBooking")}</span>
              </Label>
              {/* Read-only — this is advance paid when booking was created */}
              <p
                className={cn(
                  "mt-1 tabular-nums font-semibold",
                  advPaid > 0 ? "text-green-600" : "text-muted-foreground",
                )}
              >
                {fmtINR(booking.advance_amount || "0")}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {tb("securityDeposit")}
              </Label>
              <p className="mt-1 tabular-nums">{fmtINR(booking.security_deposit)}</p>
            </div>
          </div>

          {/* Bottom row: collection inputs */}
          <div className="rounded-xl border bg-muted/20 px-4 py-4 space-y-4">
            {/* Payment summary breakdown */}
            <div className="grid grid-cols-5 gap-2 rounded-lg border bg-background px-3 py-3">
              <div className="space-y-1 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Room Rent</p>
                <p className="text-sm font-bold tabular-nums">{fmtINR(bookingTotal)}</p>
              </div>
              <div className="space-y-1 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Extra Charges</p>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={extraCharges}
                  onChange={(e) => setExtraCharges(e.target.value)}
                  className="h-7 text-center text-sm tabular-nums px-1"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Advance Paid</p>
                <p className="text-sm font-bold tabular-nums">{fmtINR(advPaid)}</p>
              </div>
              <div className="space-y-1 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">GST ({hotelGstRate}%)</p>
                <p className="text-sm font-bold tabular-nums">{fmtINR(gstAmount)}</p>
              </div>
              <div className="space-y-1 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Remaining</p>
                <p className={cn("text-sm font-bold tabular-nums", balance > 0 ? "text-gold-600" : "text-green-600")}>{fmtINR(balance)}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("collectAtCheckin")}
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  className="tabular-nums"
                  placeholder="0.00"
                />
                <p className="text-[10px] text-muted-foreground">{t("enterZeroHint")}</p>
            </div>
            <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("paymentMode")}
                </Label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as "cash" | "upi" | "card" | "bank_transfer" | "other")}
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  disabled={newAdvance === 0}
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Net Banking</option>
                  <option value="other">Other</option>
                </select>
                {showQrCheckin && (
                  <div className="mt-2">
                    {qrImageQueryCheckin.data ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrImageQueryCheckin.data}
                        alt="UPI QR code"
                        className="h-36 w-36 rounded-lg object-contain border"
                      />
                    ) : qrImageQueryCheckin.isLoading ? (
                      <Skeleton className="h-36 w-36 rounded-lg" />
                    ) : null}
            </div>
                )}
          </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("balanceAfterCheckin")}
                </Label>
                <p
                  className={cn(
                    "mt-2 text-lg tabular-nums font-bold",
                    balance > 0 ? "text-gold-600" : "text-green-600",
                  )}
                >
                  {fmtINR(balance)}
                </p>
                {balance > 0 && (
                  <p className="text-[10px] text-muted-foreground">{t("dueAtCheckout")}</p>
                )}
                {balance === 0 && newAdvance > 0 && (
                  <p className="text-[10px] text-green-600">{t("fullyPaid")}</p>
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
              <p className="text-xs font-medium text-amber-600">
                {t("advanceNotRecordedWarning")}
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* ── 7. Emergency Contact ──────────────────────────────────────────── */}
      <Section icon={AlertTriangle} title={t("emergencyContact")} subtitle={t("optional")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("contactName")}</Label>
            <Input value={emName} onChange={(e) => setEmName(e.target.value)} placeholder={t("contactNamePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("contactRelation")}</Label>
            <Input value={emRelation} onChange={(e) => setEmRelation(e.target.value)} placeholder={t("relationPlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("phoneNumber")}</Label>
            <Input value={emPhone} onChange={(e) => setEmPhone(e.target.value)} placeholder={t("phonePlaceholder")} inputMode="tel" />
          </div>
        </div>
      </Section>

      {/* ── 8. Vehicle Details ────────────────────────────────────────────── */}
      <Section icon={Car} title={t("vehicleDetails")} subtitle={t("optional")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("vehicleNumber")}</Label>
            <Input value={vehNumber} onChange={(e) => setVehNumber(e.target.value)} placeholder="MH 12 AB 1234" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("vehicleType")}</Label>
            <select
              value={vehType}
              onChange={(e) => setVehType(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
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
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("vehicleTypeName")}</Label>
              <Input
                value={vehTypeOther}
                onChange={(e) => setVehTypeOther(e.target.value)}
                placeholder={t("vehicleTypeNamePlaceholder")}
                maxLength={40}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("makeName")}</Label>
            <Input value={vehMake} onChange={(e) => setVehMake(e.target.value)} placeholder={t("makePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("parkingSlot")}</Label>
            <Input value={parkingSlot} onChange={(e) => setParkingSlot(e.target.value)} placeholder="A-12" />
          </div>
        </div>
      </Section>

      {/* Early check-in fee is now auto-computed and shown in the Booking Details banner above. */}

      {/* ── Footer: Terms + Actions ───────────────────────────────────────── */}
      <div className="rounded-xl border bg-white shadow-sm px-5 py-4 space-y-4">
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
            <Button
              type="button"
              disabled={mutation.isPending || !terms}
              className="bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold"
              onClick={() => mutation.mutate()}
            >
              <LogIn className="size-4" aria-hidden />
              {mutation.isPending ? t("checkingIn") : tb("checkInAction")}
            </Button>
          </div>
        </div>
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
  const tg = useTranslations("guestPicker");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();

  // ── 1. Booking details (dates + times + guest type) ──
  // Local dates (not UTC) so the default isn't "yesterday" east of UTC.
  const [checkInDate, setCheckInDate] = useState(localToday);
  const [checkOutDate, setCheckOutDate] = useState(localTomorrow);
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [guestType, setGuestType] = useState("");

  // Hotel settings for default check-in/out times + early check-in fee
  const settings = useQuery({
    queryKey: ["hotel-settings", activeHotelId],
    queryFn: () =>
      api<{
        check_in_time: string;
        check_out_time: string;
        early_checkin_fee_per_hour?: string;
        early_checkin_grace_minutes?: number;
      }>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });

  // Hotel GST settings for accurate payment breakdown.
  const gstSettings = useQuery({
    queryKey: ["hotel-gst", activeHotelId],
    queryFn: () =>
      api<{ default_cgst_rate: string; default_sgst_rate: string }>(
        "/api/v1/hotels/me/gst",
      ),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });
  // Total rate = CGST + SGST. Falls back to 5 if data not yet loaded.
  const hotelGstRate =
    Number.parseFloat(gstSettings.data?.default_cgst_rate ?? "0") +
    Number.parseFloat(gstSettings.data?.default_sgst_rate ?? "0") || 5;

  // Default the time inputs from hotel settings once loaded (unless edited).
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setCheckInTime((t) => t || s.check_in_time?.slice(0, 5) || "");
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
  const [pgName, setPgName] = useState("");
  const [pgPhone, setPgPhone] = useState("");
  const [pgIdType, setPgIdType] = useState("Aadhar Card");
  const [pgIdNumber, setPgIdNumber] = useState("");
  const [pgGender, setPgGender] = useState("");
  const [pgDob, setPgDob] = useState("");
  const [pgAddress, setPgAddress] = useState("");
  const [pgPostalCode, setPgPostalCode] = useState("");
  const [pgCompany, setPgCompany] = useState("");
  const [pgOcrResult, setPgOcrResult] = useState<import("@/lib/id-ocr").IdOcrResult | null>(null);

  // Existing doc IDs for the selected returning guest — keyed by side.
  // DocUpload uses these to pre-fill tiles from B2.
  const [pgExistingDocs, setPgExistingDocs] = useState<
    Partial<Record<DocSide, string>>
  >({});

  const handleGuestSelected = async (g: { id: string; full_name: string; phone: string }) => {
    if (!g.id) {
      setGuest(null);
      setPgBaseline(null);
      setPgExistingDocs({});
      return;
    }
    setGuest({ id: g.id, full_name: g.full_name });
    setPgName(g.full_name);
    setPgPhone(g.phone);
    setPgExistingDocs({});

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
      if (full.id_proof_type) setPgIdType(full.id_proof_type);
    } else {
      setPgBaseline(null);
    }

    if (docsResult.status === "fulfilled") {
      // Pick the most recent document per side.
      const docs: Partial<Record<DocSide, string>> = {};
      for (const d of docsResult.value) {
        if (d.side === "front" || d.side === "back" || d.side === "selfie") {
          docs[d.side] = d.id; // later entries overwrite — list is newest-first
        }
      }
      setPgExistingDocs(docs);
    }
  };

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
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "card" | "bank_transfer" | "other">("cash");
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
    if (selectedAvailRooms.length === 0) return 0;
    // Day-use rates are whole-stay totals; overnight rates are per night.
    const factor = isSameDay ? 1 : nights;
    return selectedAvailRooms.reduce(
      (sum, r) => sum + effectiveRoomRate(r) * factor,
      0,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAvailRooms, nights, isSameDay, dayUseHours, rateEdits]);
  const extraChargesNumWI = Number.parseFloat(extraCharges || "0") || 0;
  const gstAmountWI = Math.round((roomRentWalkIn + extraChargesNumWI) * (hotelGstRate / 100) * 100) / 100;
  // Only subtract the advance when staff confirmed it was actually collected —
  // otherwise it is not recorded and the remaining balance would be dishonest.
  const collectedAdvanceWI = paymentReceived ? newAdvance : 0;
  const remainingWI = Math.max(roomRentWalkIn + extraChargesNumWI + gstAmountWI - collectedAdvanceWI, 0);

  // UPI QR code — fetched as a blob URL when UPI + amount > 0.
  const showQr = paymentMode === "upi" && newAdvance > 0;
  const qrImageQuery = useQuery({
    queryKey: ["hotel-qr-png", activeHotelId],
    queryFn: async () => {
      const token = getAccessToken();
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr/image`, {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "X-Hotel-Id": activeHotelId ?? "",
        },
        credentials: "include",
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

  // ── Draft (localStorage) ──
  // Read once on mount; a non-null value shows the "Restore / Discard" banner.
  const [draft, setDraft] = useState<CheckinDraft | null>(null);
  useEffect(() => {
    setDraft(readDraft());
  }, []);

  const saveDraft = () => {
    const d: CheckinDraft = {
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
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      toast.success(t("draftSaved"));
    } catch {
      toast.error(t("draftSaveFailed"));
    }
  };

  const restoreDraft = (d: CheckinDraft) => {
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
    setDraft(null);
    toast.success(t("draftRestored"));
  };

  const discardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    setDraft(null);
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
      if (pgIdNumber.trim()) {
        patch.id_number = pgIdNumber.trim();
        patch.id_proof_type = pgIdType;
      }
      if (Object.keys(patch).length > 0) {
        await api(`/api/v1/guests/${guest.id}`, { method: "PATCH", body: patch });
      }

      // 2. Create new additional guests + upload queued docs (same as MODE B).
      const resolvedIds: string[] = [];
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
              postal_code: newForm.postal_code?.trim() || undefined,
              gender: newForm.gender?.trim() || undefined,
              date_of_birth: newForm.date_of_birth?.trim() || undefined,
              id_proof_type: newForm.id_proof_type?.trim() || undefined,
              id_number: newForm.id_number?.trim() || undefined,
            },
          });
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            await apiUpload(`/api/v1/guests/${created.id}/documents`, form, {
              hotelId: activeHotelId ?? undefined,
            });
          }
          resolvedIds.push(created.id);
        } else {
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            await apiUpload(`/api/v1/guests/${cg.guest_id}/documents`, form, {
              hotelId: activeHotelId ?? undefined,
            });
          }
          resolvedIds.push(cg.guest_id);
        }
      }

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
        co_guests: resolvedIds.map((id) => ({ guest_id: id })),
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

      return checkinOut;
    },
    onSuccess: (result) => {
      setCheckinResult(result);
      setError(null);
      // Check-in completed — the saved draft (if any) is now stale.
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
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

  return (
    <div className="space-y-4">
      {/* ── Saved draft banner ─────────────────────────────────────────────── */}
      {draft && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <FileText className="size-4 shrink-0 text-gold-600" aria-hidden />
            <span className="text-gold-800">
              {t("draftFrom", { date: new Date(draft.savedAt).toLocaleString() })}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => restoreDraft(draft)}
              className="inline-flex h-8 items-center rounded-lg bg-navy-900 px-3 text-xs font-semibold text-white hover:bg-navy-900/90"
            >
              {t("restore")}
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="inline-flex h-8 items-center rounded-lg border border-gold-400 px-3 text-xs font-medium text-gold-700 hover:bg-gold-100"
            >
              {t("discard")}
                </button>
              </div>
        </div>
      )}

      {/* ── 1. Booking Details ─────────────────────────────────────────────── */}
      <Section
        icon={ClipboardList}
        title={ts("bookingDetailsTitle")}
        subtitle={t("walkInSubtitle")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="wi-cin" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
            <Label htmlFor="wi-cout" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                <Clock className="size-3.5" aria-hidden />
                {t("dayUseBadge", { hrs: dayUseHours })}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="wi-guest-type" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("guestTypeLabel")}
            </Label>
            <select
              id="wi-guest-type"
              value={guestType}
              onChange={(e) => setGuestType(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="">{t("select")}</option>
              <option value="business">{t("guestType_business")}</option>
              <option value="personal">{t("guestType_personal")}</option>
              <option value="family">{t("guestType_family")}</option>
              <option value="group">{t("guestType_group")}</option>
              <option value="other">{t("guestType_other")}</option>
            </select>
          </div>
          {guestType === "business" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("company")}</Label>
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
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Early check-in by {hrs} hr{hrs !== 1 ? "s" : ""} — {fmtINR(earlyFee)} fee will be added to the bill
            </div>
          );
        })()}
      </Section>

      {/* ── 2. Primary Guest Identity ─────────────────────────────────────── */}
      <Section icon={BadgeCheck} title={t("primaryGuestIdentity")} subtitle={t("primaryGuestIdentitySubtitle")}>
        <div className="space-y-5">
          <GuestPicker
            selected={guest?.id ? guest : null}
            onSelected={handleGuestSelected}
          />

          {guest && (
            <>
              {/* ID type + number */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("idType")}</Label>
                  <select
                    value={pgIdType}
                    onChange={(e) => setPgIdType(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
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
                    value={pgIdNumber}
                    onChange={setPgIdNumber}
                    placeholder={t("enterIdNumber", { type: pgIdType })}
                  />
                </div>
              </div>

              {/* Document uploads — key={guestId+side} so React remounts when
                  guest changes, clearing stale blob previews from prior guest. */}
              <div className="grid grid-cols-3 gap-3">
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
                    if (fields.id_number) setPgIdNumber(fields.id_number);
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
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tg("fullName")}</Label>
                  <Input value={pgName} onChange={(e) => setPgName(e.target.value)} placeholder={tg("fullName")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("phoneNumber")}</Label>
                  <Input value={pgPhone} onChange={(e) => setPgPhone(e.target.value)} placeholder={t("phonePlaceholder")} inputMode="tel" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldGender")}</Label>
                  <select
                    value={pgGender}
                    onChange={(e) => setPgGender(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    <option value="">{t("selectOption")}</option>
                    <option value="Male">{t("male")}</option>
                    <option value="Female">{t("female")}</option>
                    <option value="Other">{t("genderOther")}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldDob")}</Label>
                  <DateInput value={pgDob} onChange={setPgDob} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldAddress")}</Label>
                  <Input value={pgAddress} onChange={(e) => setPgAddress(e.target.value)} placeholder={t("fieldAddress")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("fieldPincode")}</Label>
                  <Input
                    value={pgPostalCode}
                    onChange={(e) => setPgPostalCode(e.target.value)}
                    placeholder={t("fieldPincode")}
                    inputMode="numeric"
                    maxLength={6}
                  />
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
      <Section icon={BedDouble} title={t("roomInformation")} subtitle={t("roomInfoSubtitleWalkIn")}>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tb("adults")}</Label>
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
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tb("children")}</Label>
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
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                      <span className="block text-[10px] text-muted-foreground">
                        {isSameDay ? t("rateDayUseTotal") : t("ratePerNight")}
                      </span>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
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
              <p className="text-[10px] text-muted-foreground">
                {t("rateOverrideHint")}
              </p>
            </div>
          )}
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
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
          {/* Payment summary breakdown */}
          <div className="grid grid-cols-5 gap-2 rounded-lg border bg-background px-3 py-3">
            <div className="space-y-1 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Room Rent</p>
              <p className={cn("text-sm font-bold tabular-nums", roomRentWalkIn === 0 ? "text-muted-foreground" : "")}>
                {roomRentWalkIn === 0 ? "—" : fmtINR(roomRentWalkIn)}
              </p>
            </div>
            <div className="space-y-1 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Extra Charges</p>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={extraCharges}
                onChange={(e) => setExtraCharges(e.target.value)}
                className="h-7 text-center text-sm tabular-nums px-1"
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Advance Paid</p>
              <p className="text-sm font-bold tabular-nums">{fmtINR(collectedAdvanceWI)}</p>
            </div>
            <div className="space-y-1 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">GST ({hotelGstRate}%)</p>
              <p className="text-sm font-bold tabular-nums">{fmtINR(gstAmountWI)}</p>
            </div>
            <div className="space-y-1 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Remaining</p>
              <p className={cn("text-sm font-bold tabular-nums", remainingWI > 0 ? "text-gold-600" : "text-green-600")}>{fmtINR(remainingWI)}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("collectAtCheckin")}
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                className="tabular-nums"
                placeholder="0.00"
              />
              <p className="text-[10px] text-muted-foreground">{t("enterZeroHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("paymentMode")}
              </Label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as "cash" | "upi" | "card" | "bank_transfer" | "other")}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                disabled={newAdvance === 0}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Net Banking</option>
                <option value="other">Other</option>
              </select>
              {showQr && (
                <div className="mt-2">
                  {qrImageQuery.data ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrImageQuery.data}
                      alt="UPI QR code"
                      className="h-36 w-36 rounded-lg object-contain border"
                    />
                  ) : qrImageQuery.isLoading ? (
                    <Skeleton className="h-36 w-36 rounded-lg" />
                  ) : null}
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
            <p className="text-xs font-medium text-amber-600">
              {t("advanceNotRecordedWarning")}
            </p>
          )}
          </div>
      </Section>

      {/* ── 7. Emergency Contact ──────────────────────────────────────────── */}
      <Section icon={AlertTriangle} title={t("emergencyContact")} subtitle={t("optional")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("contactName")}</Label>
            <Input value={emName} onChange={(e) => setEmName(e.target.value)} placeholder={t("contactNamePlaceholder")} />
            </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("contactRelation")}</Label>
            <Input value={emRelation} onChange={(e) => setEmRelation(e.target.value)} placeholder={t("relationPlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("phoneNumber")}</Label>
            <Input value={emPhone} onChange={(e) => setEmPhone(e.target.value)} placeholder={t("phonePlaceholder")} inputMode="tel" />
          </div>
        </div>
      </Section>

      {/* ── 8. Vehicle Details ────────────────────────────────────────────── */}
      <Section icon={Car} title={t("vehicleDetails")} subtitle={t("optional")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("vehicleNumber")}</Label>
            <Input value={vehNumber} onChange={(e) => setVehNumber(e.target.value)} placeholder="MH 12 AB 1234" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("vehicleType")}</Label>
            <select
              value={vehType}
              onChange={(e) => setVehType(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
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
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("vehicleTypeName")}</Label>
              <Input
                value={vehTypeOther}
                onChange={(e) => setVehTypeOther(e.target.value)}
                placeholder={t("vehicleTypeNamePlaceholder")}
                maxLength={40}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("makeName")}</Label>
            <Input value={vehMake} onChange={(e) => setVehMake(e.target.value)} placeholder={t("makePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("parkingSlot")}</Label>
            <Input value={parkingSlot} onChange={(e) => setParkingSlot(e.target.value)} placeholder="A-12" />
          </div>
        </div>
      </Section>

      {/* ── Footer: Terms + Check In ──────────────────────────────────────── */}
      <div className="rounded-xl border bg-white shadow-sm px-5 py-4 space-y-4">
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
            disabled={mutation.isPending}
            onClick={saveDraft}
          >
            <FileText className="size-4" aria-hidden />
            {ts("saveDraft")}
            </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            className="bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold"
            onClick={() => {
              if (!guest) {
                setError(t("selectOrCreateGuest"));
                return;
              }
              if (selectedRooms.length === 0) {
                setError(t("selectAtLeastOneRoom"));
                return;
              }
              if (!datesValid) {
                setError(isSameDay ? t("sameDayTimesInvalid") : t("datesInvalid"));
                return;
              }
              if (fgEnabled && fgForm.passport_number.trim().length < 3) {
                setError(t("passportRequired"));
                return;
              }
              setError(null);
              mutation.mutate();
            }}
          >
            <LogIn className="size-4" aria-hidden />
            {mutation.isPending ? t("checkingIn") : tb("checkInAction")}
          </Button>
        </div>
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
}: {
  readonly bookings: BookingOut[];
  readonly isLoading: boolean;
  readonly onSelect: (booking: BookingOut) => void;
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
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {fmtApiDate(booking.check_in_date)}
              {booking.check_in_time ? `, ${booking.check_in_time}` : ""} →{" "}
              {fmtApiDate(booking.check_out_date)}
              {booking.check_out_time ? `, ${booking.check_out_time}` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Page content ─────────────────────────────────────────────────────────────

const CHECKIN_SESSION_KEY = "dmh.checkin.selectedBookingId";

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
    return fromUrl ?? sessionStorage.getItem(CHECKIN_SESSION_KEY);
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

  useEffect(() => {
    if (!pendingBookingId || !bookings.data) return;
    const match = bookings.data.items.find((b) => b.id === pendingBookingId);
    if (match) setSelectedBooking(match);
    setPendingBookingId(null);
    sessionStorage.removeItem(CHECKIN_SESSION_KEY);
  }, [pendingBookingId, bookings.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

  if (selectedBooking) {
    return (
      <>
        <PartnerHeader title={ts("checkinTitle")} subtitle={tn("frontDesk")} />
        <main className="flex-1 overflow-y-auto bg-[#f5f5f0] px-4 py-6">
          <CheckinForm
            booking={selectedBooking}
            onBack={() => {
              sessionStorage.removeItem(CHECKIN_SESSION_KEY);
              setSelectedBooking(null);
            }}
            onDone={() => {
              sessionStorage.removeItem(CHECKIN_SESSION_KEY);
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
            onSelect={(booking) => {
              sessionStorage.setItem(CHECKIN_SESSION_KEY, booking.id);
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

          <div className="space-y-1">
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
