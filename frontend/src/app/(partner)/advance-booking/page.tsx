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

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  BedDouble,
  CalendarPlus,
  ClipboardList,
  CreditCard,
  FileText,
  Minus,
  Plus,
  UserRound,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { TimeInput } from "@/components/ui/time-input";
import { Label } from "@/components/ui/label";
import { GuestPicker } from "@/components/guests/guest-picker";
import { RoomAvailabilityPicker } from "@/components/rooms/room-availability-picker";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { localToday, localTomorrow } from "@/lib/formatting";
import type { BookingOut } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

const GUEST_TYPES = [
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
  { value: "family", label: "Family" },
  { value: "group", label: "Group" },
  { value: "other", label: "Other" },
];

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Net Banking" },
  { value: "other", label: "Other" },
];

/** Static card section matching the check-in page look. */
function Card({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly title: string;
  readonly subtitle?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-gold-50">
          <Icon className="size-4 text-gold-600" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="border-t px-5 py-5">{children}</div>
    </div>
  );
}

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
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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

  // ── 1. Booking details ──
  const [checkIn, setCheckIn] = useState(localToday);
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOut, setCheckOut] = useState(localTomorrow);
  const [checkOutTime, setCheckOutTime] = useState("");
  const [guestType, setGuestType] = useState("");

  // ── 2. Guest ──
  const [guest, setGuest] = useState<{ id: string; full_name: string } | null>(null);

  // ── 3. Rooms ──
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [availRefreshKey, setAvailRefreshKey] = useState(0);

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

        const response = await fetch(`${API_BASE}/api/v1/hotels/me/payment-qr`, {
          headers,
          credentials: "include",
        });

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

  const mutation = useMutation({
    mutationFn: async () => {
      // 1. Create the booking
      const booking = await api<BookingOut>("/api/v1/bookings", {
        method: "POST",
        body: {
          primary_guest_id: guest?.id,
          room_ids: selectedRooms,
          check_in_date: checkIn,
          check_out_date: checkOut,
          check_in_time: checkInTime || null,
          check_out_time: checkOutTime || null,
          guest_type: guestType || null,
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
      queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
      toast.success(`Advance booking created — ${booking.booking_number}`);
      router.push("/advance-bookings");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : "Failed to create booking";
      setError(msg);
      if (e instanceof ApiError && e.code === "double_booking") {
        setSelectedRooms([]);
        setAvailRefreshKey((k) => k + 1);
        queryClient.invalidateQueries({ queryKey: ["room-availability", activeHotelId] });
      }
    },
  });

  const canSubmit = !!guest?.id && selectedRooms.length > 0 && !mutation.isPending;

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
            setError(null);
            mutation.mutate();
          }}
        >
          {/* ── 1. Booking Details ─────────────────────────────────────── */}
          <Card icon={ClipboardList} title="Booking Details" subtitle="Stay dates and guest type">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="ab-cin" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Check-in Date *
                </Label>
                <DateInput id="ab-cin" required value={checkIn} onChange={setCheckIn} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ab-cin-time" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Check-in Time
                  {settings.data?.check_in_time && (
                    <span className="ml-1 text-gold-600 font-bold normal-case">
                      (default {settings.data.check_in_time.slice(0, 5)})
                    </span>
                  )}
                </Label>
                <TimeInput
                  id="ab-cin-time"
                  value={checkInTime}
                  onChange={setCheckInTime}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ab-cout" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Check-out Date *
                </Label>
                <DateInput id="ab-cout" required value={checkOut} onChange={setCheckOut} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ab-cout-time" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Check-out Time
                  {settings.data?.check_out_time && (
                    <span className="ml-1 text-gold-600 font-bold normal-case">
                      (default {settings.data.check_out_time.slice(0, 5)})
                    </span>
                  )}
                </Label>
                <TimeInput
                  id="ab-cout-time"
                  value={checkOutTime}
                  onChange={setCheckOutTime}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ab-guest-type" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Guest Type
                </Label>
                <select
                  id="ab-guest-type"
                  value={guestType}
                  onChange={(e) => setGuestType(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                >
                  <option value="">— Select —</option>
                  {GUEST_TYPES.map((gt) => (
                    <option key={gt.value} value={gt.value}>
                      {gt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* ── 2. Guest ───────────────────────────────────────────────── */}
          <Card icon={UserRound} title="Guest" subtitle="Search an existing guest or create a new one">
            <GuestPicker
              selected={guest?.id ? guest : null}
              onSelected={(g) => setGuest(g.id ? g : null)}
            />
          </Card>

          {/* ── 3. Room Information ────────────────────────────────────── */}
          <Card icon={BedDouble} title="Room Information" subtitle="Pick available rooms for the stay dates">
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
          <Card icon={CreditCard} title="Payment" subtitle="Collect an optional advance now">
            <div className="space-y-4">
              {/* Amount + mode row */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ab-advance" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Advance Amount (₹)
                  </Label>
                  <Input
                    id="ab-advance"
                    type="number"
                    min={0}
                    step="0.01"
                    value={advanceAmount}
                    onChange={(e) => setAdvanceAmount(e.target.value)}
                    className="tabular-nums"
                    placeholder="0.00"
                  />
                  <p className="text-[10px] text-muted-foreground">Enter 0 if collecting later</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ab-mode" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                  <span className="text-sm font-medium text-foreground">
                    Payment collected from guest ✓
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
