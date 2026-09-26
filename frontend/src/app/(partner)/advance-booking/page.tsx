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

import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BedDouble,
  CalendarPlus,
  Check,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  Minus,
  Plus,
  UserRound,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionPanel } from "@/components/ui/section-panel";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Label } from "@/components/ui/label";
import { GuestPicker } from "@/components/guests/guest-picker";
import { AdvanceBookingVoucherModal } from "@/components/stay/advance-booking-voucher-modal";
import { RoomAvailabilityPicker } from "@/components/rooms/room-availability-picker";
import { useApi } from "@/lib/api/use-api";
import { invalidateRoomState } from "@/lib/query-invalidation";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { localToday, localTomorrow } from "@/lib/formatting";
import type {
  BookingOut,
  GuestOut,
  GuestType,
  RoomRateOverride,
} from "@/types/stay";
import { GUEST_TYPES } from "@/types/stay";
import type { RoomAvailabilityOut, RoomAvailableItem } from "@/types/hotel";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

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
// Local Card alias removed — uses shared SectionPanel instead.
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

/** Quick guest registration for advance bookings — ID proof and photos deferred to check-in. */
function QuickGuestForm({
  initialPhone = "",
  pending = false,
  onConfirm,
  onCancel,
}: {
  readonly initialPhone?: string;
  readonly pending?: boolean;
  readonly onConfirm: (data: {
    full_name: string;
    phone: string;
    email?: string;
    id_proof_type?: string;
    id_number?: string;
  }) => void;
  readonly onCancel: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState("");
  const [idProofType, setIdProofType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const tc = useTranslations("common");

  const canSave = !!fullName.trim() && !!phone.trim() && !pending;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
      <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-900 dark:text-blue-200">
        <p className="font-semibold">Quick Guest Registration for Advance Booking</p>
        <p className="mt-0.5 text-muted-foreground dark:text-blue-300">
          Only Guest Name and Phone Number are required to reserve rooms in advance. Government ID verification and document photos can be collected upon guest arrival during check-in.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="qg-name" className="text-xs font-semibold">
            Full Name *
          </Label>
          <Input
            id="qg-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ramesh Kumar"
            required
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="qg-phone" className="text-xs font-semibold">
            Phone Number *
          </Label>
          <Input
            id="qg-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 9876543210"
            inputMode="tel"
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="qg-email" className="text-xs">
            Email (Optional)
          </Label>
          <Input
            id="qg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. guest@example.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="qg-idtype" className="text-xs">
              ID Type (Optional)
            </Label>
            <select
              id="qg-idtype"
              value={idProofType}
              onChange={(e) => setIdProofType(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs"
            >
              <option value="">None / At Check-in</option>
              <option value="Aadhar Card">Aadhaar Card</option>
              <option value="PAN Card">PAN Card</option>
              <option value="Passport">Passport</option>
              <option value="Driving License">Driving License</option>
              <option value="Voter ID">Voter ID</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="qg-idnum" className="text-xs">
              ID Number (Optional)
            </Label>
            <Input
              id="qg-idnum"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder="e.g. Last 4 digits"
              maxLength={20}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          disabled={!canSave}
          onClick={() =>
            onConfirm({
              full_name: fullName.trim(),
              phone: phone.trim(),
              email: email.trim() || undefined,
              id_proof_type: idProofType || undefined,
              id_number: idNumber.trim() || undefined,
            })
          }
          className="bg-navy-900 text-white hover:bg-navy-800"
        >
          {pending ? tc("saving") : "Save & Select Guest"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          {tc("cancel")}
        </Button>
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
  // Full Aadhaar-upload creation form (same UX as check-in's walk-in flow) —
  // opened when GuestPicker's search finds no match and staff clicks
  // "Create new guest". Replaces the old inline mini-form.
  const [showNewGuest, setShowNewGuest] = useState(false);
  const [newGuestPhone, setNewGuestPhone] = useState("");
  const [createdBooking, setCreatedBooking] = useState<BookingOut | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);

  // Quick guest creation for advance bookings without mandatory ID proof.
  const createGuest = useMutation({
    mutationFn: async (payload: {
      full_name: string;
      phone: string;
      email?: string;
      id_proof_type?: string;
      id_number?: string;
    }) => {
      return api<GuestOut>("/api/v1/guests", {
        method: "POST",
        body: {
          full_name: payload.full_name,
          phone: payload.phone,
          email: payload.email,
          id_proof_type: payload.id_proof_type,
          id_number: payload.id_number,
        },
      });
    },
    onSuccess: (created) => {
      setShowNewGuest(false);
      setGuest({ id: created.id, full_name: created.full_name });
      toast.success(tg("guestCreated"));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  // ── 3. Rooms ──
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [availRefreshKey, setAvailRefreshKey] = useState(0);
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
  const [qrObjectUrl, setQrObjectUrl] = useState<string | null>(null);
  const [qrNotConfigured, setQrNotConfigured] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    if (paymentMode !== "upi") {
      setQrObjectUrl(null);
      setQrNotConfigured(false);
      return;
    }

    let cancelled = false;
    let currentUrl: string | null = null;

    const fetchQr = async () => {
      setQrLoading(true);
      try {
        const token = getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;

        const response = await fetch(
          `${API_BASE}/api/v1/hotels/me/payment-qr/image?v=${Date.now()}`,
          {
            headers,
            credentials: "include",
            cache: "no-store",
          },
        );

        if (cancelled) return;

        if (response.status === 404) {
          setQrNotConfigured(true);
          setQrLoading(false);
          return;
        }

        if (!response.ok) {
          setQrLoading(false);
          return;
        }

        const blob = await response.blob();
        if (cancelled) return;

        currentUrl = URL.createObjectURL(blob);
        setQrObjectUrl(currentUrl);
        setQrNotConfigured(false);
      } catch {
        // Silently fail — QR is optional
      } finally {
        if (!cancelled) setQrLoading(false);
      }
    };

    fetchQr();

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      setQrObjectUrl(null);
      setQrNotConfigured(false);
      setQrLoading(false);
    };
  }, [paymentMode, activeHotelId]);

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
  const availData = queryClient.getQueryData<RoomAvailabilityOut>([
    "room-availability",
    activeHotelId,
    checkIn,
    checkOut,
  ]);
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

  const mutation = useMutation({
    mutationFn: async () => {
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

      // 1. Create the booking
      const booking = await api<BookingOut>("/api/v1/bookings", {
        method: "POST",
        body: {
          primary_guest_id: guest?.id,
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
        },
      });

      // 2. Collect advance payment only if explicitly collected from guest
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

          {/* ── 2. Guest ───────────────────────────────────────────────── */}
          <Card icon={UserRound} title={t("abGuest")} subtitle={t("abGuestSub")}>
            <div className="space-y-4">
              <GuestPicker
                selected={guest?.id ? guest : null}
                onSelected={(g) => {
                  setGuest(g.id ? g : null);
                  if (g.id) setShowNewGuest(false);
                }}
                onCreateNew={(searchedPhone) => {
                  // Client flow: no mini-form — open the full Aadhaar-upload
                  // guest creation form (same UX as Guest Check-in).
                  setNewGuestPhone(searchedPhone);
                  setShowNewGuest(true);
                }}
              />
              {showNewGuest && !guest?.id && (
                <div className="space-y-3">
                  <QuickGuestForm
                    key={newGuestPhone}
                    initialPhone={newGuestPhone}
                    pending={createGuest.isPending}
                    onConfirm={(data) => createGuest.mutate(data)}
                    onCancel={() => setShowNewGuest(false)}
                  />
                </div>
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
              {paymentMode === "upi" && (parseFloat(advanceAmount) || 0) > 0 && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-col items-center gap-2">
                  {qrNotConfigured ? (
                    <p className="text-sm text-muted-foreground">UPI QR not configured</p>
                  ) : qrLoading ? (
                    <p className="text-sm text-muted-foreground">Loading QR…</p>
                  ) : qrObjectUrl ? (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Scan to Pay via UPI
                      </p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrObjectUrl}
                        alt="UPI payment QR code"
                        className="h-48 w-48 rounded-lg object-contain"
                      />
                    </>
                  ) : null}
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
