"use client";

/**
 * RoomAvailabilityPicker
 *
 * Date-aware room selection component used in the booking creation form.
 *
 * Behaviour:
 *  • While dates are not set → prompt to enter dates first.
 *  • When valid dates are provided → calls GET /rooms/availability?check_in=&check_out=
 *  • Shows available rooms as selectable chips.
 *  • Shows "Booked for these dates" section: sorted by earliest free date
 *    so staff can immediately suggest the next-available alternative.
 *  • Shows maintenance / out-of-service / cleaning rooms in a collapsed section.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BedDouble,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Wrench,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";
import type {
  RoomAvailabilityOut,
  RoomAvailableItem,
  RoomUnavailableItem,
} from "@/types/hotel";

interface Props {
  /** ISO date string YYYY-MM-DD */
  readonly checkIn: string;
  readonly checkOut: string;
  readonly selectedRooms: string[];
  readonly onSelectionChange: (ids: string[]) => void;
  /** Hotel's standard check-in time e.g. "14:00:00" */
  readonly checkInTime?: string;
  /** Hotel's standard check-out time e.g. "11:00:00" */
  readonly checkOutTime?: string;
}

/** Format ISO date string as a human-readable short date. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Convert "14:00:00" → "2:00 PM" */
function fmtTime(hhmm: string | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Colour + icon for unavailable reason. */
function reasonMeta(reason: string): { label: string; colour: string } {
  switch (reason) {
    case "booked":       return { label: "Booked",       colour: "text-orange-600 bg-orange-50 border-orange-200" };
    case "occupied":     return { label: "Occupied",     colour: "text-red-600 bg-red-50 border-red-200" };
    case "cleaning":     return { label: "Cleaning",     colour: "text-blue-600 bg-blue-50 border-blue-200" };
    case "maintenance":  return { label: "Maintenance",  colour: "text-yellow-700 bg-yellow-50 border-yellow-200" };
    case "out_of_service": return { label: "Out of service", colour: "text-gray-500 bg-gray-50 border-gray-200" };
    default:             return { label: reason,         colour: "text-muted-foreground bg-muted border-border" };
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Map room status to a small hint label + colour for the chip. */
function statusHint(status: string): { label: string; colour: string } | null {
  switch (status) {
    case "occupied":          return { label: "Occupied now",  colour: "text-orange-600 bg-orange-50" };
    case "reserved":          return { label: "Reserved",      colour: "text-blue-600   bg-blue-50"   };
    case "cleaning_required": return { label: "Cleaning soon", colour: "text-sky-600    bg-sky-50"    };
    case "cleaning_in_progress": return { label: "Cleaning",   colour: "text-sky-600    bg-sky-50"    };
    case "clean_ready":       return null; // same as available — no hint needed
    case "inspection_required": return { label: "Inspection",  colour: "text-purple-600 bg-purple-50" };
    default:                  return null;
  }
}

function AvailableChip({
  room,
  selected,
  onClick,
}: {
  readonly room: RoomAvailableItem;
  readonly selected: boolean;
  readonly onClick: () => void;
}) {
  const hint = statusHint(room.status);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "relative flex flex-col rounded-xl border-2 px-3 py-2.5 text-left transition-all min-w-[90px]",
        selected
          ? "border-gold-500 bg-gold-50 shadow-sm"
          : "border-border hover:border-gold-300 hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-sm">{room.room_number}</span>
        {selected && (
          <span className="size-4 rounded-full bg-gold-500 flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-navy-900">✓</span>
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground leading-tight mt-0.5">
        {room.room_type_name ?? "—"}
      </span>
      {room.bed_type && (
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground mt-0.5">
          <BedDouble className="size-2.5" aria-hidden />
          {room.bed_type}
        </span>
      )}
      <span className="mt-1 text-xs font-semibold text-navy-900">
        ₹{Number(room.room_type_base_price).toLocaleString("en-IN")}
        <span className="font-normal text-muted-foreground">/night</span>
      </span>
      {/* Show current status as a small hint — room is still bookable */}
      {hint && (
        <span className={cn("mt-1 rounded px-1.5 py-0.5 text-[9px] font-semibold", hint.colour)}>
          {hint.label}
        </span>
      )}
    </button>
  );
}

function UnavailableCard({ room }: { readonly room: RoomUnavailableItem }) {
  const { label, colour } = reasonMeta(room.unavailable_reason);
  return (
    <div className="flex items-start justify-between rounded-xl border px-3 py-2.5 opacity-70">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-foreground">{room.room_number}</span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", colour)}>
            {label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{room.room_type_name ?? "—"}</p>
      </div>
      {room.occupied_until && (
        <div className="ml-3 shrink-0 text-right">
          <p className="text-[10px] text-muted-foreground">Free from</p>
          <p className="text-xs font-semibold text-foreground">{fmtDate(room.occupied_until)}</p>
        </div>
      )}
      {!room.occupied_until && room.unavailable_reason === "cleaning" && (
        <div className="ml-3 shrink-0 flex items-center gap-1 text-blue-500 text-xs">
          <Clock className="size-3" aria-hidden />
          <span>Soon</span>
        </div>
      )}
      {!room.occupied_until && room.unavailable_reason === "maintenance" && (
        <Wrench className="size-4 ml-3 shrink-0 text-yellow-600" aria-hidden />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RoomAvailabilityPicker({
  checkIn,
  checkOut,
  selectedRooms,
  onSelectionChange,
  checkInTime,
  checkOutTime,
}: Props) {
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [showUnavailable, setShowUnavailable] = useState(false);

  const datesValid = !!(
    checkIn &&
    checkOut &&
    checkIn < checkOut
  );

  const { data, isLoading, isError } = useQuery<RoomAvailabilityOut>({
    queryKey: ["room-availability", activeHotelId, checkIn, checkOut],
    queryFn: () =>
      api<RoomAvailabilityOut>(
        `/api/v1/rooms/availability?check_in=${checkIn}&check_out=${checkOut}`,
      ),
    enabled: datesValid && !!activeHotelId,
    staleTime: 30_000,
  });

  // Clear selection when dates change so previously-selected rooms
  // are not silently carried over if they're now unavailable.
  useEffect(() => {
    if (!data) return;
    const availableIds = new Set(data.available.map((r) => r.id));
    const stillAvailable = selectedRooms.filter((id) => availableIds.has(id));
    if (stillAvailable.length !== selectedRooms.length) {
      onSelectionChange(stillAvailable);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const toggleRoom = (id: string) => {
    onSelectionChange(
      selectedRooms.includes(id)
        ? selectedRooms.filter((r) => r !== id)
        : [...selectedRooms, id],
    );
  };

  // Partition unavailable rooms into "coming soon" (booked / cleaning / occupied)
  // vs "not bookable" (maintenance / out_of_service).
  const { comingSoon, notBookable } = useMemo(() => {
    const cs = (data?.unavailable ?? []).filter((r) =>
      ["booked", "cleaning", "occupied"].includes(r.unavailable_reason),
    );
    const nb = (data?.unavailable ?? []).filter((r) =>
      ["maintenance", "out_of_service"].includes(r.unavailable_reason),
    );
    return { comingSoon: cs, notBookable: nb };
  }, [data]);

  // ── No dates yet ─────────────────────────────────────────────────────────────
  if (!datesValid) {
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
        <Calendar className="size-5 shrink-0 text-muted-foreground/50" aria-hidden />
        <p>Select check-in and check-out dates to see available rooms.</p>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <p className="text-sm text-danger">
        Could not load room availability. Please try again.
      </p>
    );
  }

  const available = data?.available ?? [];

  return (
    <div className="space-y-4">
      {/* ── Available rooms ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Available for {fmtDate(checkIn)}
            {checkInTime && (
              <span className="ml-1 text-gold-600 font-bold">@ {fmtTime(checkInTime)}</span>
            )}
            {" → "}
            {fmtDate(checkOut)}
            {checkOutTime && (
              <span className="ml-1 text-gold-600 font-bold">@ {fmtTime(checkOutTime)}</span>
            )}
          </p>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold",
            available.length > 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600",
          )}>
            {available.length} room{available.length !== 1 ? "s" : ""}
          </span>
        </div>

        {available.length === 0 ? (
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
            No rooms available for these dates.
            {comingSoon.length > 0 && (
              <span className="ml-1 font-medium">
                See {comingSoon.length} room{comingSoon.length !== 1 ? "s" : ""} coming free below.
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((room) => (
              <AvailableChip
                key={room.id}
                room={room}
                selected={selectedRooms.includes(room.id)}
                onClick={() => toggleRoom(room.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Coming soon (booked / cleaning / occupied) ─────────────────────── */}
      {comingSoon.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowUnavailable(!showUnavailable)}
            className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
          >
            <span className="flex items-center gap-2">
              <Clock className="size-3.5 text-orange-500" aria-hidden />
              <span>
                {comingSoon.length} room{comingSoon.length !== 1 ? "s" : ""} booked for these dates
              </span>
              <span className="text-[10px] text-muted-foreground font-normal">
                — earliest free: {fmtDate(comingSoon[0]?.occupied_until)}
              </span>
            </span>
            {showUnavailable
              ? <ChevronUp className="size-3.5" aria-hidden />
              : <ChevronDown className="size-3.5" aria-hidden />}
          </button>

          {showUnavailable && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {comingSoon.map((room) => (
                <UnavailableCard key={room.id} room={room} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Not bookable (maintenance / OOS) ──────────────────────────────── */}
      {notBookable.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
            Unavailable — Maintenance / Out of service
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {notBookable.map((room) => (
              <UnavailableCard key={room.id} room={room} />
            ))}
          </div>
        </div>
      )}

      {/* ── Selection summary ─────────────────────────────────────────────── */}
      {selectedRooms.length > 0 && (
        <div className="rounded-xl border border-gold-200 bg-gold-50 px-3 py-2 text-sm">
          <span className="font-semibold text-gold-700">
            {selectedRooms.length} room{selectedRooms.length !== 1 ? "s" : ""} selected
          </span>
          <span className="ml-2 text-gold-600">
            {available
              .filter((r) => selectedRooms.includes(r.id))
              .map((r) => r.room_number)
              .join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
