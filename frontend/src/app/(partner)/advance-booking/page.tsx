"use client";

/**
 * Advance Booking — Full-page form styled like the check-in page sections.
 *
 * Flow:
 *  1. Booking Details  — check-in/out dates + optional times + guest type
 *  2. Guest            — shared GuestPicker (search/create)
 *  3. Room Information — RoomAvailabilityPicker + adults/children counters
 *  4. Special Instructions
 *  5. Payment          — optional advance amount + payment mode
 *
 * Mutation sequence:
 *  1. POST /api/v1/bookings  — with guest_type, check_in_time, check_out_time
 *  2. POST /api/v1/payments  — if advance amount > 0 (purpose: "advance")
 */

import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  BadgeCheck,
  BedDouble,
  CalendarPlus,
  Check,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  Minus,
  Pencil,
  Phone,
  Plus,
  UserPlus,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionPanel } from "@/components/ui/section-panel";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { GuestPicker } from "@/components/guests/guest-picker";
import { AdvanceBookingVoucherModal } from "@/components/stay/advance-booking-voucher-modal";
import { RoomAvailabilityPicker } from "@/components/rooms/room-availability-picker";
import { UpiQrBlock } from "@/components/checkin/upi-qr-block";
import { useApi } from "@/lib/api/use-api";
import { invalidateRoomState } from "@/lib/query-invalidation";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_BASE, apiUpload } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { localToday, localTomorrow } from "@/lib/formatting";
import {
  liveNameCase,
  sanitizeGuestPhone,
  sanitizeAadhaarOcr,
  isIdMask,
} from "@/lib/input-discipline";
import type {
  BookingOut,
  GuestAutofill,
  GuestCreatePayload,
  GuestOut,
  GuestType,
  RoomRateOverride,
} from "@/types/stay";
import { GUEST_TYPES } from "@/types/stay";
import type { RoomAvailabilityOut, RoomAvailableItem } from "@/types/hotel";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import {
  NewGuestFullForm,
  DocUpload,
  DocSide,
  MaskedIdInput,
  AutofillBanner,
  ForeignGuestSection,
  ForeignGuestFormState,
  EMPTY_FOREIGN_GUEST,
  buildForeignGuestPayload,
} from "@/components/stay/new-guest-full-form";
import type { IdOcrResult } from "@/lib/id-ocr";

const GUEST_TYPE_OPTIONS: { value: GuestType; label: string }[] = GUEST_TYPES.map(
  (value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }),
);

/** "HH:MM" → minutes since midnight; NaN when malformed. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
}

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "credit_card", label: "Credit Card" },
  { value: "debit_card", label: "Debit Card" },
  { value: "bank_transfer", label: "Net Banking" },
  { value: "other", label: "Other" },
];

/** Static card section matching the check-in page look. */
const Card = SectionPanel;

/** +/- counter matching the check-in page room occupancy controls. */
function Counter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        <span className="w-6 text-center tabular-nums font-semibold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function AdvanceBookingContent() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();
  // Shared strings with the check-in page (date/time labels, day use, rates).
  const t = useTranslations("checkin");
  const tg = useTranslations("guestPicker");
  const tc = useTranslations("common");

  // ── 1. Booking details ──
  const [checkIn, setCheckIn] = useState(localToday);
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOut, setCheckOut] = useState(localTomorrow);
  const [checkOutTime, setCheckOutTime] = useState("");
  const [guestType, setGuestType] = useState("");

  // ── 2. Guest ──
  const [guest, setGuest] = useState<{ id: string; full_name: string } | null>(null);
  const [showNewGuest, setShowNewGuest] = useState(false);
  const [newGuestPhone, setNewGuestPhone] = useState("");
  const [createdBooking, setCreatedBooking] = useState<BookingOut | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);

  // Guest details state (identical to check-in walk-in flow)
  const [pgName, setPgName] = useState("");
  const [pgPhone, setPgPhone] = useState("");
  const [pgGender, setPgGender] = useState("");
  const [pgDob, setPgDob] = useState("");
  const [pgAddress, setPgAddress] = useState("");
  const [pgPostalCode, setPgPostalCode] = useState("");
  const [pgCity, setPgCity] = useState("");
  const [pgState, setPgState] = useState("");
  const [pgCountry, setPgCountry] = useState("India");
  const [pgIdType, setPgIdType] = useState("Aadhar Card");
  const [pgIdNumber, setPgIdNumber] = useState("");
  const [pgExistingDocs, setPgExistingDocs] = useState<Partial<Record<DocSide, string>>>({});
  const [pgBaseline, setPgBaseline] = useState<GuestAutofill | null>(null);
  const [pgWasIdSearch, setPgWasIdSearch] = useState(false);
  const [pgContactOverride, setPgContactOverride] = useState("");
  const [pgEditing, setPgEditing] = useState(false);
  const [pgOcrResult, setPgOcrResult] = useState<IdOcrResult | null>(null);
  const [pgBackOcrResult, setPgBackOcrResult] = useState<IdOcrResult | null>(null);

  // Foreign guest state (Form C)
  const [fgEnabled, setFgEnabled] = useState(false);
  const [fgForm, setFgForm] = useState<ForeignGuestFormState>(EMPTY_FOREIGN_GUEST);

  const handleGuestSelected = async (g: {
    id: string;
    full_name: string;
    phone?: string;
    wasIdSearch?: boolean;
  } | null) => {
    if (!g?.id) {
      setGuest(null);
      setPgBaseline(null);
      return;
    }
    setGuest({ id: g.id, full_name: g.full_name });
    setPgName(g.full_name);
    setPgPhone(g.phone ?? "");
    setPgExistingDocs({});
    setPgWasIdSearch(g.wasIdSearch ?? false);
    setPgContactOverride("");
    setPgEditing(false);

    const [autofillResult, docsResult] = await Promise.allSettled([
      api<GuestAutofill>(`/api/v1/guests/${g.id}/autofill`, { method: "POST" }),
      api<{ id: string; side: string | null }[]>(`/api/v1/guests/${g.id}/documents`),
    ]);

    if (autofillResult.status === "fulfilled") {
      const full = autofillResult.value;
      setPgBaseline(full);
      if (full.full_name) setPgName(full.full_name);
      if (full.phone) setPgPhone(full.phone);
      setPgGender(full.gender ?? "");
      setPgDob(full.date_of_birth ?? "");
      setPgAddress(full.address ?? "");
      setPgPostalCode(full.postal_code ?? "");
      setPgCity(full.city ?? "");
      setPgState(full.state ?? "");
      setPgCountry(full.country ?? "India");
      if (full.id_proof_type) setPgIdType(full.id_proof_type);
      setPgIdNumber(full.id_last4 ? `••••••••${full.id_last4}` : "");
    } else {
      setPgBaseline(null);
    }

    if (docsResult.status === "fulfilled") {
      const docs: Partial<Record<DocSide, string>> = {};
      for (const d of docsResult.value) {
        if (
          (d.side === "front" || d.side === "back" || d.side === "selfie") &&
          !docs[d.side]
        ) {
          docs[d.side] = d.id;
        }
      }
      setPgExistingDocs(docs);
    }
  };

  // Full rich guest creation with queued document uploads (ID proof is optional)
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
      const failedUploads = uploadResults.filter((r) => r.status === "rejected").length;
      return { created, failedUploads };
    },
    onSuccess: async ({ created, failedUploads }) => {
      setShowNewGuest(false);
      toast.success(tg("guestCreated"));
      if (failedUploads > 0) {
        toast.warning(t("someDocsFailed", { count: failedUploads }));
      }
      await handleGuestSelected({
        id: created.id,
        full_name: created.full_name,
        phone: created.normalized_phone,
      });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  // ── 3. Rooms ──
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [availRefreshKey, setAvailRefreshKey] = useState(0);
  const [availDataState, setAvailDataState] = useState<RoomAvailabilityOut | null>(null);
  // Staff-edited room rates keyed by room_id (per night, or whole stay for
  // day use). Only edits that differ from the computed default are sent as
  // rate_overrides in the booking payload.
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});

  // ── 4. Special instructions ──
  const [specialInstructions, setSpecialInstructions] = useState("");

  // ── 5. Payment ──
  const [advanceAmount, setAdvanceAmount] = useState("0");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentCollected, setPaymentCollected] = useState(false);

  // ── UPI QR ──
  const advAmountNum = Number.parseFloat(advanceAmount) || 0;
  const showQr = paymentMode === "upi" && advAmountNum > 0;
  const qrImageQuery = useQuery({
    queryKey: ["hotel-qr-png", activeHotelId, advAmountNum],
    queryFn: async () => {
      const token = getAccessToken();
      const amtParam = advAmountNum > 0 ? `&amount=${advAmountNum}` : "";
      const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr/image?v=${Date.now()}${amtParam}`, {
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
    staleTime: 60_000,
  });

  const [error, setError] = useState<string | null>(null);

  // Hotel settings for default check-in/out time display
  const settings = useQuery({
    queryKey: ["hotel-settings", activeHotelId],
    queryFn: () =>
      api<{ check_in_time: string; check_out_time: string }>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
    staleTime: 5 * 60_000,
  });

  // ── Day use (same-day stay) — valid when both times are set and check-out
  // is after check-in; billed as ceil(hours) × room_type hourly rate
  // (fallback: full-night base price when the room type has no hourly rate).
  const isSameDay = !!checkIn && !!checkOut && checkIn === checkOut;
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

  // Same-day is allowed as a day-use stay when both times are set and
  // check-out time is after check-in time.
  const datesValid =
    !!checkIn && !!checkOut && (checkIn < checkOut || sameDayValid);

  // ── Room rates: read the room availability cache (same queryKey as the
  // picker) to get rates for the selected rooms.
  const ciTimeParam = (checkInTime || settings.data?.check_in_time)?.slice(0, 5) ?? "";
  const coTimeParam = (checkOutTime || settings.data?.check_out_time)?.slice(0, 5) ?? "";
  const cachedAvail = queryClient.getQueryData<RoomAvailabilityOut>([
    "room-availability",
    activeHotelId,
    checkIn,
    checkOut,
    ciTimeParam,
    coTimeParam,
  ]);
  const availData = availDataState ?? cachedAvail;
  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 1;
    const d = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000;
    return Math.max(Math.ceil(d), 1);
  }, [checkIn, checkOut]);

  const selectedAvailRooms = useMemo(
    () =>
      (availData?.available ?? []).filter((r) => selectedRooms.includes(r.id)),
    [availData, selectedRooms],
  );
  /** Default rate for a room: base price per night, or day-use total. */
  const defaultRoomRate = useCallback(
    (r: RoomAvailableItem): number => {
      const base = Number.parseFloat(r.room_type_base_price) || 0;
      if (!isSameDay) return base;
      const hourly =
        r.room_type_hourly_rate != null
          ? Number.parseFloat(r.room_type_hourly_rate)
          : Number.NaN;
      return Number.isFinite(hourly) && hourly > 0 && dayUseHours > 0
        ? hourly * dayUseHours
        : base;
    },
    [isSameDay, dayUseHours],
  );

  const totalEstimatedRent = useMemo(() => {
    const factor = isSameDay ? 1 : nights;
    return selectedAvailRooms.reduce((sum, r) => {
      const edited = rateEdits[r.id]?.trim();
      const parsed = edited ? Number.parseFloat(edited) : Number.NaN;
      const price = Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultRoomRate(r);
      return sum + price * factor;
    }, 0);
  }, [selectedAvailRooms, isSameDay, nights, rateEdits, defaultRoomRate]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!guest?.id) throw new ApiError(400, "validation", "Please select a guest");

      // 1. Update primary guest profile if identity fields were edited.
      const patch: Record<string, string> = {};
      if (pgName.trim() && pgName.trim() !== (pgBaseline?.full_name ?? guest.full_name)) {
        patch.full_name = pgName.trim();
      }
      if (pgPhone.trim() && pgPhone.trim() !== (pgBaseline?.phone ?? pgPhone.trim())) {
        patch.phone = pgPhone.trim();
      }
      if (pgGender && pgGender !== (pgBaseline?.gender ?? "")) patch.gender = pgGender;
      if (pgDob && pgDob !== (pgBaseline?.date_of_birth ?? "")) patch.date_of_birth = pgDob;
      if (pgAddress && pgAddress !== (pgBaseline?.address ?? "")) patch.address = pgAddress;
      if (pgPostalCode && pgPostalCode !== (pgBaseline?.postal_code ?? "")) patch.postal_code = pgPostalCode;
      if (pgCity && pgCity !== (pgBaseline?.city ?? "")) patch.city = pgCity;
      if (pgState && pgState !== (pgBaseline?.state ?? "")) patch.state = pgState;
      if (pgCountry && pgCountry !== (pgBaseline?.country ?? "India")) patch.country = pgCountry;
      // Only send id_number if desk entered a real number (not the mask).
      if (pgIdNumber.trim() && !isIdMask(pgIdNumber)) {
        patch.id_number = pgIdNumber.trim().replace(/\s/g, "");
        patch.id_proof_type = pgIdType;
      }
      if (Object.keys(patch).length > 0) {
        await api(`/api/v1/guests/${guest.id}`, { method: "PATCH", body: patch });
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

      // 2. Create the booking
      const booking = await api<BookingOut>("/api/v1/bookings", {
        method: "POST",
        body: {
          primary_guest_id: guest.id,
          room_ids: selectedRooms,
          rate_overrides: rateOverrides.length > 0 ? rateOverrides : undefined,
          check_in_date: checkIn,
          check_out_date: checkOut,
          check_in_time: checkInTime || null,
          check_out_time: checkOutTime || null,
          guest_type: guestType || null,
          source: "advance",
          adults,
          children,
          special_requests: specialInstructions.trim() || null,
          foreign_guest: buildForeignGuestPayload(fgEnabled, fgForm),
        },
      });

      // 3. Collect advance payment only if explicitly collected from guest
      const advance = parseFloat(advanceAmount) || 0;
      if (advance > 0 && paymentCollected) {
        await api("/api/v1/payments", {
          method: "POST",
          body: {
            booking_id: booking.id,
            amount: advanceAmount,
            method: paymentMode,
            purpose: "advance",
          },
        });
      }
      return booking;
    },
    onSuccess: (booking) => {
      setError(null);
      // Cross-page room-state invalidation (plan Part 6): a new advance
      // booking reserves rooms — the check-in picker must see it.
      invalidateRoomState(queryClient);
      toast.success(`Advance Booking Created — ${booking.booking_number}`);
      setCreatedBooking(booking);
      setVoucherOpen(true);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : "Failed to Create Booking";
      setError(msg);
      if (e instanceof ApiError && e.code === "double_booking") {
        setSelectedRooms([]);
        setAvailRefreshKey((k) => k + 1);
        queryClient.invalidateQueries({ queryKey: ["room-availability", activeHotelId] });
      }
    },
  });

  const canSubmit =
    !!guest?.id && selectedRooms.length > 0 && datesValid && !mutation.isPending;

  return (
    <>
      <PartnerHeader title="Advance Booking" subtitle="Front Desk" />
      <main className="flex-1 overflow-y-auto bg-[#f5f5f0] px-4 py-6">
        <form
          className="mx-auto max-w-4xl space-y-4 pb-12"
          onSubmit={(e) => {
            e.preventDefault();
            if (!guest?.id || selectedRooms.length === 0) {
              setError("Please select a guest and at least one room.");
              return;
            }
            if (!datesValid) {
              setError(t("sameDayTimesInvalid"));
              return;
            }
            setError(null);
            mutation.mutate();
          }}
        >
          {/* ── 1. Booking Details ─────────────────────────────────────── */}
          <Card icon={ClipboardList} title={t("abBookingDetails")} subtitle={t("abBookingDetailsSub")}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 lg:col-span-2">
                <Label htmlFor="ab-cin" className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("checkinDateTime")} *
                </Label>
                <DateTimePicker
                  id="ab-cin"
                  required
                  dateValue={checkIn}
                  timeValue={checkInTime}
                  onDateChange={setCheckIn}
                  onTimeChange={setCheckInTime}
                  min={localToday()}
                />
              </div>
              <div className="space-y-1.5 lg:col-span-2">
                <Label htmlFor="ab-cout" className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("checkoutDateTime")} *
                </Label>
                <DateTimePicker
                  id="ab-cout"
                  required
                  dateValue={checkOut}
                  timeValue={checkOutTime}
                  onDateChange={setCheckOut}
                  onTimeChange={setCheckOutTime}
                  min={checkIn || localToday()}
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
                <Label htmlFor="ab-guest-type" className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                  Guest Type
                </Label>
                <select
                  id="ab-guest-type"
                  value={guestType}
                  onChange={(e) => setGuestType(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                >
                  <option value="">— Select —</option>
                  {GUEST_TYPE_OPTIONS.map((gt) => (
                    <option key={gt.value} value={gt.value}>
                      {gt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* ── 2. Primary Guest Identity ─────────────────────────────────────── */}
          <Card
            icon={BadgeCheck}
            title={t("primaryGuestIdentity")}
            subtitle={t("primaryGuestIdentitySubtitle")}
          >
            <div className="space-y-4">
              <GuestPicker
                selected={guest?.id ? { id: guest.id, full_name: pgName || guest.full_name } : null}
                onSelected={(g) => {
                  setShowNewGuest(false);
                  void handleGuestSelected(g);
                }}
                onCreateNew={(searchedPhone) => {
                  setNewGuestPhone(searchedPhone);
                  setShowNewGuest(true);
                }}
              />

              {/* Rich new-guest form (Photo 3) */}
              {!guest && showNewGuest && (
                <div className="rounded-xl border p-4 space-y-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                    <UserPlus className="size-3.5" aria-hidden />
                    {tg("newGuest")}
                  </p>
                  <NewGuestFullForm
                    key={newGuestPhone}
                    initialPhone={newGuestPhone}
                    confirmLabel={t("createGuestAction")}
                    pending={createPrimaryGuest.isPending}
                    onConfirm={(form, docs) => createPrimaryGuest.mutate({ form, docs })}
                    onCancel={() => setShowNewGuest(false)}
                    beforeConfirm={
                      <ForeignGuestSection
                        enabled={fgEnabled}
                        onEnabledChange={setFgEnabled}
                        value={fgForm}
                        onChange={setFgForm}
                      />
                    }
                  />
                </div>
              )}

              {/* Primary guest SUMMARY CARD (Photo 2) */}
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
                              if (
                                (d.side === "front" || d.side === "back" || d.side === "selfie") &&
                                !bySide[d.side as DocSide]
                              ) {
                                bySide[d.side as DocSide] = d.id;
                              }
                            }
                            setPgExistingDocs(bySide);
                            setPgBaseline(full);
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
                    { label: t("fieldGender"), value: pgGender },
                    { label: t("fieldDob"), value: pgDob },
                    { label: t("fieldAddress"), value: pgAddress },
                    { label: t("fieldCity"), value: pgCity },
                    { label: t("fieldState"), value: pgState },
                    { label: t("pincode"), value: pgPostalCode },
                    { label: t("idType"), value: pgIdType },
                    { label: t("idNumberShort"), value: pgIdNumber ? `••••${pgIdNumber.slice(-4)}` : null },
                  ].filter((row) => !!row.value).length > 0 && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-white px-3 py-2.5 sm:grid-cols-3">
                      {[
                        { label: t("fieldGender"), value: pgGender },
                        { label: t("fieldDob"), value: pgDob },
                        { label: t("fieldAddress"), value: pgAddress },
                        { label: t("fieldCity"), value: pgCity },
                        { label: t("fieldState"), value: pgState },
                        { label: t("pincode"), value: pgPostalCode },
                        { label: t("idType"), value: pgIdType },
                        { label: t("idNumberShort"), value: pgIdNumber ? `••••${pgIdNumber.slice(-4)}` : null },
                      ].filter((row) => !!row.value).map((row) => (
                        <div key={row.label} className="min-w-0">
                          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</p>
                          <p className="truncate text-xs font-medium" title={row.value ?? ""}>{row.value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* "Found by Aadhaar ID" hint + contact override */}
                  {pgWasIdSearch && (
                    <div className="rounded-lg border border-info/20 bg-info-bg/40 px-3 py-2 space-y-2">
                      <p className="flex items-start gap-1.5 text-xs text-info">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>{t("idSearchSelectedHint")}</span>
                      </p>
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
                          <button
                            type="button"
                            onClick={() => setPgContactOverride("")}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            {tc("clear")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Photo tiles (read-only display with DocUpload) */}
                  <div className="grid grid-cols-3 gap-2">
                    <DocUpload
                      key={`${guest.id}-front`}
                      guestId={guest.id}
                      side="front"
                      label={t("uploadFrontFace")}
                      idType={pgIdType}
                      existingDocId={pgExistingDocs.front}
                      onOcrResult={() => {}}
                    />
                    <DocUpload
                      key={`${guest.id}-back`}
                      guestId={guest.id}
                      side="back"
                      label={t("uploadBackFace")}
                      idType={pgIdType}
                      existingDocId={pgExistingDocs.back}
                      onOcrResult={() => {}}
                    />
                    <DocUpload
                      key={`${guest.id}-selfie`}
                      guestId={guest.id}
                      side="selfie"
                      label={t("selfieCapture")}
                      existingDocId={pgExistingDocs.selfie}
                      onOcrResult={() => {}}
                    />
                  </div>
                </div>
              )}

              {/* Primary guest EDIT FORM (shows when pgEditing = true) */}
              {guest && pgEditing && (
                <div className="space-y-4 rounded-xl border bg-card p-4">
                  {/* Edit header with cancel */}
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("editGuest")}</p>
                    <button
                      type="button"
                      onClick={() => setPgEditing(false)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {tc("cancel")}
                    </button>
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

                  {/* Document uploads */}
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
                        if (result.fields.address || result.can_autofill) {
                          setPgBackOcrResult(result);
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

                  {/* Back-face OCR autofill banner — address fields only */}
                  {pgBackOcrResult && (
                    <AutofillBanner
                      result={pgBackOcrResult}
                      onAccept={(fields) => {
                        if (fields.address) setPgAddress(fields.address);
                        if (fields.pincode) setPgPostalCode(fields.pincode);
                        if (fields.city) setPgCity(fields.city);
                        if (fields.state) setPgState(fields.state);
                        setPgBackOcrResult(null);
                        toast.success(t("addressAutofilled"));
                      }}
                      onDismiss={() => setPgBackOcrResult(null)}
                    />
                  )}

                  {/* Personal details */}
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
                </div>
              )}

              {/* Foreign guest (Form C) for selected guest */}
              {guest && (
                <ForeignGuestSection
                  enabled={fgEnabled}
                  onEnabledChange={setFgEnabled}
                  value={fgForm}
                  onChange={setFgForm}
                />
              )}
            </div>
          </Card>

          {/* ── 3. Room Information ────────────────────────────────────── */}
          <Card icon={BedDouble} title={t("abRoomInfo")} subtitle={t("abRoomInfoSub")}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 max-w-xs">
                <Counter label="Adults" value={adults} min={1} max={40} onChange={setAdults} />
                <Counter label="Children" value={children} min={0} max={40} onChange={setChildren} />
              </div>
              <RoomAvailabilityPicker
                checkIn={checkIn}
                checkOut={checkOut}
                selectedRooms={selectedRooms}
                onSelectionChange={setSelectedRooms}
                checkInTime={checkInTime || settings.data?.check_in_time}
                checkOutTime={checkOutTime || settings.data?.check_out_time}
                adults={adults}
                guestChildren={children}
                refreshKey={availRefreshKey}
                onRoomsData={setAvailDataState}
              />

              {/* Editable per-room rates for the selected rooms — prefilled
                  with the computed default (base price per night, or day-use
                  total). */}
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
                  <div className="flex items-center justify-between rounded-lg border border-gold-400 bg-gold-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-navy-900">
                      Total Estimated Room Rent ({selectedAvailRooms.length} {selectedAvailRooms.length === 1 ? "room" : "rooms"}, {nights} {nights === 1 ? "night" : "nights"})
                    </span>
                    <span className="font-bold tabular-nums text-navy-900 text-sm">
                      ₹{totalEstimatedRent.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <p className="text-micro text-muted-foreground">
                    {t("rateOverrideHint")}
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* ── 4. Special Instructions ────────────────────────────────── */}
          <Card icon={FileText} title="Special Instructions" subtitle="Optional">
            <textarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder="Any special requests for this booking…"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
          </Card>

          {/* ── 5. Payment ─────────────────────────────────────────────── */}
          <Card icon={CreditCard} title={t("abPayment")} subtitle={t("abPaymentSub")}>
            <div className="space-y-4">
              {/* Amount + mode row */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ab-advance" className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                    Advance Amount (₹)
                  </Label>
                  <Input
                    id="ab-advance"
                    type="number"
                    min={0}
                    step="1"
                    value={advanceAmount}
                    onChange={(e) => setAdvanceAmount(e.target.value)}
                    className="tabular-nums"
                    placeholder="0"
                  />
                  <p className="text-micro text-muted-foreground">Enter 0 if collecting later</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ab-mode" className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment Mode
                  </Label>
                  <select
                    id="ab-mode"
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                    disabled={(parseFloat(advanceAmount) || 0) === 0}
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Card / Net Banking info note — record-only, no POS integration */}
              {(paymentMode === "credit_card" || paymentMode === "debit_card" || paymentMode === "bank_transfer" || paymentMode === "other") &&
                (parseFloat(advanceAmount) || 0) > 0 && (
                <p className="flex items-center gap-1.5 rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-label text-info">
                  <span>ℹ</span>
                  {paymentMode === "credit_card" || paymentMode === "debit_card"
                    ? "Collect payment via card machine, then this records it in your accounts."
                    : paymentMode === "bank_transfer"
                    ? "Collect payment via net banking, then this records it in your accounts."
                    : "Collect payment from the guest, then this records it in your accounts."}
                </p>
              )}

              {/* UPI QR — shown only when UPI is selected and amount > 0 */}
              {showQr && (
                <div className="rounded-xl border border-border bg-muted/20 p-4 flex flex-col items-center">
                  <UpiQrBlock
                    qrUrl={qrImageQuery.data}
                    loading={qrImageQuery.isLoading}
                    amount={advAmountNum}
                  />
                </div>
              )}

              {/* Payment collected checkbox — shown when amount > 0 */}
              {(parseFloat(advanceAmount) || 0) > 0 && (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-white px-4 py-3 hover:bg-muted/30">
                  <input
                    type="checkbox"
                    id="ab-collected"
                    checked={paymentCollected}
                    onChange={(e) => setPaymentCollected(e.target.checked)}
                    className="size-4 rounded accent-gold-500"
                  />
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    Payment collected from guest
                    <Check className="size-3.5 text-success" aria-hidden />
                  </span>
                </label>
              )}
            </div>
          </Card>

          {error && (
            <p className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          {/* ── Actions ────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between rounded-xl border bg-white px-5 py-4 shadow-sm">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => router.push("/advance-bookings")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold"
            >
              <CalendarPlus className="size-4" aria-hidden />
              {mutation.isPending ? "Saving…" : "Add Advance Booking"}
            </Button>
          </div>
        </form>

        <AdvanceBookingVoucherModal
          open={voucherOpen}
          onClose={() => {
            setVoucherOpen(false);
            router.push("/advance-bookings");
          }}
          booking={createdBooking}
          paymentInfo={
            paymentCollected && parseFloat(advanceAmount) > 0
              ? { amount: advanceAmount, method: paymentMode }
              : null
          }
        />
      </main>
    </>
  );
}

export default function AdvanceBookingPage() {
  return (
    <RequirePermission permission={PERMISSIONS.bookingsView}>
      <AdvanceBookingContent />
    </RequirePermission>
  );
}
