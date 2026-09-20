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

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BedDouble,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Info,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";
import { fmtApiDateTime, fmtINR } from "@/lib/formatting";
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
  /** Number of adults — used for capacity validation warning. */
  readonly adults?: number;
  /** Number of child guests (avoid React's reserved `children` prop name). */
  readonly guestChildren?: number;
  /**
   * Increment this to force a re-fetch (e.g. after a double_booking error).
   * The picker watches this value and calls refetch() when it changes.
   */
  readonly refreshKey?: number;
}

// ─── Status filter chips (client 9-06) ───────────────────────────────────────

type RoomFilter = "all" | "available" | "reserved" | "occupied" | "cleaning" | "maintenance";

/** Categorise a bookable room's live status into a filter bucket. */
function availableFilterCategory(status: string): RoomFilter {
  switch (status) {
    case "occupied":             return "occupied";
    case "reserved":             return "reserved";
    case "cleaning_required":
    case "cleaning_in_progress":
    case "inspection_required":  return "cleaning";
    default:                     return "available"; // available / clean_ready
  }
}

/** Categorise an unavailable room's reason into a filter bucket. */
function unavailableFilterCategory(reason: string): RoomFilter {
  switch (reason) {
    case "booked":   return "reserved";
    case "occupied": return "occupied";
    case "cleaning": return "cleaning";
    default:         return "maintenance"; // maintenance / out_of_service
  }
}

/** Format ISO date string as a human-readable short date. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Colour + icon for unavailable reason — uses semantic design tokens. */
function reasonMeta(reason: string): { label: string; colour: string } {
  switch (reason) {
    case "booked":         return { label: "Booked",          colour: "text-warning  bg-warning-bg  border-warning/30"  };
    case "occupied":       return { label: "Occupied",         colour: "text-danger   bg-danger-bg   border-danger/30"   };
    case "cleaning":       return { label: "Cleaning",         colour: "text-info     bg-info-bg     border-info/30"     };
    case "maintenance":    return { label: "Maintenance",      colour: "text-warning  bg-warning-bg  border-warning/30"  };
    case "out_of_service": return { label: "Out of Service",   colour: "text-muted-foreground bg-muted border-border"    };
    default:               return { label: reason,             colour: "text-muted-foreground bg-muted border-border"    };
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Map room status to a small hint label + colour for the chip. */
function statusHint(status: string): { label: string; colour: string } | null {
  switch (status) {
    case "occupied":             return { label: "Occupied Now",  colour: "text-danger  bg-danger-bg"  };
    case "reserved":             return { label: "Reserved",      colour: "text-info    bg-info-bg"    };
    case "cleaning_required":    return { label: "Cleaning Soon", colour: "text-info    bg-info-bg"    };
    case "cleaning_in_progress": return { label: "Cleaning",      colour: "text-info    bg-info-bg"    };
    case "clean_ready":          return null; // same as available — no hint needed
    case "inspection_required":  return { label: "Inspection",    colour: "text-warning bg-warning-bg" };
    default:                     return null;
  }
}

/**
 * AvailableChip — room selection card with FIXED equal size regardless of:
 *  - whether bed_type is present
 *  - whether there's status info (ⓘ button)
 *  - which room number or name length
 *
 * Design decisions (client 19/09):
 *  - All cards: same fixed h-[88px] so rows are always uniform
 *  - ⓘ button: ALWAYS reserved in top-right (invisible when no info) so
 *    the card layout never shifts — no more width/height inconsistency
 *  - ⓘ touch target: 36×36px (well above 44px guideline via padding) so
 *    it's easily tappable on mobile
 *  - Info panel: click/tap-toggled inline panel (not hover tooltip) so it
 *    works on both desktop and mobile
 */
function AvailableChip({
  room,
  selected,
  onClick,
  dayUse,
}: {
  readonly room: RoomAvailableItem;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly dayUse: boolean;
}) {
  const hint = statusHint(room.status);
  const hourlyRate = dayUse ? room.room_type_hourly_rate : null;
  const [infoOpen, setInfoOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Rooms with these PHYSICAL statuses cannot be assigned right now — even if
  // the backend confirms they're free for the requested dates (they may be
  // available date-wise but not yet physically ready). Client explicitly asked:
  // "Reserved Occupied Cleaning Maintenance — these should NOT be selectable."
  const NOT_SELECTABLE = new Set([
    "occupied",
    "reserved",
    "cleaning_required",
    "cleaning_in_progress",
    "inspection_required",
    "maintenance",
    "out_of_service",
  ]);
  const isDisabled = NOT_SELECTABLE.has(room.status);

  // Close on outside click / scroll
  useEffect(() => {
    if (!infoOpen) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [infoOpen]);

  // ── Build info lines ─────────────────────────────────────────────────────
  const infoLines: { icon?: "clock"; text: string }[] = [];
  if (hint) infoLines.push({ text: hint.label });
  if (room.status === "occupied" && room.current_checkout_time) {
    infoLines.push({
      icon: "clock",
      text: room.current_checkout_date
        ? `Free ${fmtApiDateTime(room.current_checkout_date, room.current_checkout_time)}`
        : `Free at ${room.current_checkout_time}`,
    });
  }
  if (room.next_booking_date) {
    infoLines.push({
      icon: "clock",
      text: `Booked from ${fmtApiDateTime(room.next_booking_date, room.next_booking_time)} — Free for Your Dates`,
    });
  }
  const hasInfo = infoLines.length > 0;

  return (
    <div ref={containerRef} className="relative">
      {/* ── Main card button ─────────────────────────────────────────────── */}
      <button
        type="button"
        aria-pressed={selected}
        onClick={isDisabled ? undefined : onClick}
        disabled={isDisabled}
        title={isDisabled && hint ? hint.label + " — Not available right now" : undefined}
        className={cn(
          // Fixed size — ALWAYS the same regardless of content.
          // h-[88px] = room number row + type name + bed type (or spacer) + price.
          // pr-7 is ALWAYS applied (reserves space for the ⓘ slot).
          "relative flex flex-col rounded-xl border-2 px-3 py-2.5 pr-7 text-left",
          "transition-all w-full h-[88px]",
          isDisabled
            ? "opacity-50 cursor-not-allowed border-border bg-muted/20 pointer-events-auto"
            : selected
              ? "border-gold-500 bg-gold-50 shadow-sm"
              : "border-border hover:border-gold-300 hover:bg-muted/40",
        )}
      >
        {/* Row 1: room number + selected tick */}
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm truncate">{room.room_number}</span>
          {selected && (
            <span className="size-4 rounded-full bg-gold-500 flex items-center justify-center shrink-0">
              <Check className="size-2.5 text-navy-900" aria-hidden />
            </span>
          )}
        </div>

        {/* Row 2: room type name — single line, truncated */}
        <span className="text-xs text-muted-foreground leading-tight mt-0.5 truncate block">
          {room.room_type_name ?? "—"}
        </span>

        {/* Row 3: bed type OR invisible spacer — keeps row 4 at fixed position */}
        <span className="flex items-center gap-0.5 text-micro text-muted-foreground mt-0.5 h-[14px]">
          {room.bed_type ? (
            <>
              <BedDouble className="size-2.5 shrink-0" aria-hidden />
              <span className="truncate">{room.bed_type}</span>
            </>
          ) : null /* spacer height maintained by fixed h-[14px] */}
        </span>

        {/* Row 4: price — always at the bottom */}
        <span className="mt-auto text-xs font-semibold text-navy-900">
          {hourlyRate != null ? (
            <>{fmtINR(hourlyRate)}<span className="font-normal text-muted-foreground">/hr</span></>
          ) : (
            <>{fmtINR(room.room_type_base_price)}<span className="font-normal text-muted-foreground">/night</span></>
          )}
        </span>
      </button>

      {/* ── ⓘ button — only rendered when there is actual info to show.
          Previously used opacity-0 to "hide" it on no-info cards which
          caused mobile browsers to render ghost touch artifacts (small
          colored dots). Conditional rendering is safe because the button
          is absolute-positioned and does not affect card height. */}
      {hasInfo && (
        <button
          type="button"
          aria-label="Room status details"
          aria-expanded={infoOpen}
          onClick={(e) => {
            e.stopPropagation();
            setInfoOpen((v) => !v);
          }}
          className={cn(
            "absolute top-1 right-1 z-10",
            "flex size-[26px] items-center justify-center rounded-full transition-colors",
            infoOpen
              ? "bg-navy-900 text-white"
              : selected
                ? "text-gold-600 hover:bg-gold-100 active:bg-gold-200"
                : "text-muted-foreground hover:bg-muted active:bg-muted/80",
          )}
        >
          {infoOpen ? <X className="size-3" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
        </button>
      )}

      {/* ── Info panel — opens ABOVE the card so it doesn't overlap content below ─── */}
      {infoOpen && hasInfo && (
        <div className="absolute left-0 right-0 bottom-[calc(100%+4px)] z-50
                        rounded-xl border bg-foreground px-3 py-2 text-xs text-background
                        shadow-lg space-y-1.5"
        >
          {infoLines.map((line, i) => (
            <p key={i} className="flex items-start gap-1.5">
              {line.icon === "clock" && (
                <Clock className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden />
              )}
              <span>{line.text}</span>
            </p>
          ))}
          {/* Arrow pointing DOWN toward the card */}
          <div className="absolute -bottom-1.5 right-3 size-3 rotate-45 rounded-sm bg-foreground border-r border-b border-foreground" />
        </div>
      )}
    </div>
  );
}

function UnavailableCard({ room }: { readonly room: RoomUnavailableItem }) {
  const { label, colour } = reasonMeta(room.unavailable_reason);
  const [infoOpen, setInfoOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const infoLines: string[] = [];
  if (room.occupied_until) {
    infoLines.push(
      `Free from ${fmtDate(room.occupied_until)}${room.occupied_until_time ? ` at ${room.occupied_until_time}` : ""}`,
    );
  } else if (room.unavailable_reason === "cleaning") {
    infoLines.push("Cleaning in Progress — Will Be Available Soon");
  } else if (room.unavailable_reason === "maintenance") {
    infoLines.push("Under Maintenance");
  }
  const hasInfo = infoLines.length > 0;

  useEffect(() => {
    if (!infoOpen) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setInfoOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [infoOpen]);

  return (
    <div ref={containerRef} className="relative flex items-center rounded-xl border px-3 py-2.5 opacity-70">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-foreground">{room.room_number}</span>
          <span className={cn("rounded-full border px-2 py-0.5 text-micro font-semibold", colour)}>
            {label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{room.room_type_name ?? "—"}</p>
      </div>

      {/* ⓘ — click/tap-toggled, larger touch target for mobile */}
      {hasInfo && (
        <button
          type="button"
          onClick={() => setInfoOpen((v) => !v)}
          className="ml-2 flex size-[26px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:bg-muted/80"
          aria-label="Room availability details"
          aria-expanded={infoOpen}
        >
          {infoOpen ? <X className="size-3" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
        </button>
      )}

      {/* Click-toggled info panel — opens ABOVE */}
      {infoOpen && hasInfo && (
        <div className="absolute left-0 right-0 bottom-[calc(100%+4px)] z-50
                        rounded-xl border bg-foreground px-3 py-2 text-xs text-background
                        shadow-lg space-y-1.5">
          {infoLines.map((line, i) => (
            <p key={i} className="flex items-start gap-1.5">
              <Clock className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden />
              <span>{line}</span>
            </p>
          ))}
          <div className="absolute -bottom-1.5 right-4 size-3 rotate-45 rounded-sm bg-foreground border-r border-b" />
        </div>
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
  adults = 1,
  guestChildren: childCount = 0,
  refreshKey = 0,
}: Props) {
  const api = useApi();
  const { activeHotelId } = useAuth();
  const t = useTranslations("roomPicker");
  const [showUnavailable, setShowUnavailable] = useState(false);
  // Display-only status filter — never affects selection state (client 9-06).
  const [filter, setFilter] = useState<RoomFilter>("all");

  // Same-day (check-in === check-out) is a valid day-use booking.
  const datesValid = !!(
    checkIn &&
    checkOut &&
    checkIn <= checkOut
  );
  const dayUse = datesValid && checkIn === checkOut;

  const { data, isLoading, isError, refetch } = useQuery<RoomAvailabilityOut>({
    queryKey: ["room-availability", activeHotelId, checkIn, checkOut],
    queryFn: () =>
      api<RoomAvailabilityOut>(
        `/api/v1/rooms/availability?check_in=${checkIn}&check_out=${checkOut}`,
      ),
    enabled: datesValid && !!activeHotelId,
    staleTime: 30_000,
    // Multi-device desks converge without manual refresh (plan Part 6):
    // housekeeping completing a clean on another device shows up here.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Re-fetch when parent increments refreshKey (e.g. after double_booking error).
  useEffect(() => {
    if (refreshKey > 0 && datesValid) void refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ── Capacity validation ────────────────────────────────────────────────────
  const totalGuests = adults + childCount;
  const selectedAvailableItems = useMemo(
    () => (data?.available ?? []).filter((r) => selectedRooms.includes(r.id)),
    [data, selectedRooms],
  );
  const totalCapacity = useMemo(
    () => selectedAvailableItems.reduce((sum, r) => sum + r.max_occupancy, 0),
    [selectedAvailableItems],
  );
  const capacityWarning =
    selectedAvailableItems.length > 0 && totalGuests > totalCapacity;

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

  const NOT_SELECTABLE_STATUSES = new Set([
    "occupied", "reserved", "cleaning_required", "cleaning_in_progress",
    "inspection_required", "maintenance", "out_of_service",
  ]);
  const toggleRoom = (id: string) => {
    // Guard: rooms in non-ready states cannot be selected (client agreement).
    const room = data?.available.find((r) => r.id === id);
    if (room && NOT_SELECTABLE_STATUSES.has(room.status)) return;
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
        <p>{t("selectDatesFirst")}</p>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <p className="text-sm text-danger">
        {t("loadFailed")}
      </p>
    );
  }

  // Client (9-06): rooms physically ready NOW (available/clean) come first so
  // staff always see the immediately usable rooms before the "will be ready
  // later" ones (reserved/occupied-but-free-for-dates/cleaning).
  const _READY_NOW = new Set(["available", "clean_ready"]);
  const available = [...(data?.available ?? [])].sort((a, b) => {
    const aReady = _READY_NOW.has(a.status) ? 0 : 1;
    const bReady = _READY_NOW.has(b.status) ? 0 : 1;
    if (aReady !== bReady) return aReady - bReady;
    return a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
  });

  // ── Display-only filtering (available-first sorting is preserved) ──────────
  const filteredAvailable =
    filter === "all"
      ? available
      : available.filter((r) => availableFilterCategory(r.status) === filter);
  const filteredComingSoon =
    filter === "all"
      ? comingSoon
      : comingSoon.filter((r) => unavailableFilterCategory(r.unavailable_reason) === filter);
  const filteredNotBookable =
    filter === "all"
      ? notBookable
      : notBookable.filter((r) => unavailableFilterCategory(r.unavailable_reason) === filter);

  const filterChips: { key: RoomFilter; label: string }[] = [
    { key: "all",         label: t("filterAll") },
    { key: "available",   label: t("filterAvailable") },
    { key: "reserved",    label: t("filterReserved") },
    { key: "occupied",    label: t("filterOccupied") },
    { key: "cleaning",    label: t("filterCleaning") },
    { key: "maintenance", label: t("filterMaintenance") },
  ];

  return (
    <div className="space-y-4">
      {/* ── Available rooms ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          {/* Status filter chips — display-only, selection is untouched */}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filterLabel")}>
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                aria-pressed={filter === chip.key}
                onClick={() => setFilter(chip.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  filter === chip.key
                    ? "border-navy-900 bg-navy-900 text-white"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-micro font-bold",
            filteredAvailable.length > 0 ? "bg-success-bg text-success" : "bg-danger-bg text-danger",
          )}>
            {filteredAvailable.length} room{filteredAvailable.length !== 1 ? "s" : ""}
          </span>
        </div>

        {available.length > 0 && filteredAvailable.length === 0 && (
          <p className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
            {t("filterNoRooms")}
          </p>
        )}
        {available.length === 0 ? (
          <div className="rounded-xl border border-warning/20 bg-warning-bg px-4 py-3 text-sm text-warning">
            {t("noneAvailable")}
            {comingSoon.length > 0 && (
              <span className="ml-1 font-medium">
                See {comingSoon.length} room{comingSoon.length !== 1 ? "s" : ""} coming free below.
              </span>
            )}
          </div>
        ) : (
          <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 lg:grid-cols-5">
            {filteredAvailable.map((room) => (
              <AvailableChip
                key={room.id}
                room={room}
                selected={selectedRooms.includes(room.id)}
                onClick={() => toggleRoom(room.id)}
                dayUse={dayUse}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Coming soon (booked / cleaning / occupied) ─────────────────────── */}
      {filteredComingSoon.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowUnavailable(!showUnavailable)}
            className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
          >
            <span className="flex items-center gap-2">
              <Clock className="size-3.5 text-warning" aria-hidden />
              <span>
                {filteredComingSoon.length} room{filteredComingSoon.length !== 1 ? "s" : ""} booked for these dates
              </span>
              <span className="text-micro text-muted-foreground font-normal">
                — earliest free: {fmtDate(filteredComingSoon[0]?.occupied_until)}
              </span>
            </span>
            {showUnavailable
              ? <ChevronUp className="size-3.5" aria-hidden />
              : <ChevronDown className="size-3.5" aria-hidden />}
          </button>

          {showUnavailable && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {filteredComingSoon.map((room) => (
                <UnavailableCard key={room.id} room={room} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Not bookable (maintenance / OOS) ──────────────────────────────── */}
      {filteredNotBookable.length > 0 && (
        <div>
          <p className="text-micro uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
            {t("unavailableMaintenance")}
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {filteredNotBookable.map((room) => (
              <UnavailableCard key={room.id} room={room} />
            ))}
          </div>
        </div>
      )}

      {/* ── Selection summary ─────────────────────────────────────────────── */}
      {selectedRooms.length > 0 && (
        <div className="rounded-xl border border-gold-200 bg-gold-50 px-3 py-2 text-sm">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <span className="font-semibold text-gold-700">
              {selectedRooms.length} room{selectedRooms.length !== 1 ? "s" : ""} selected
            </span>
            <span className="text-gold-600 text-xs">
              {selectedAvailableItems.map((r) => r.room_number).join(", ")}
            </span>
            {totalCapacity > 0 && (
              <span className="text-xs text-muted-foreground">
                Total capacity: {totalCapacity} guest{totalCapacity !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Capacity warning ──────────────────────────────────────────────── */}
      {capacityWarning && (
        <div className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-bg px-4 py-3">
          <AlertTriangle className="size-4 text-danger shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-danger">{t("capacityExceeded")}</p>
            <p className="text-xs text-danger/80 mt-0.5">
              Selected rooms can accommodate {totalCapacity} guest{totalCapacity !== 1 ? "s" : ""},
              but you have {totalGuests} guest{totalGuests !== 1 ? "s" : ""} ({adults} adult{adults !== 1 ? "s" : ""}
              {childCount > 0 ? `, ${childCount} child${childCount !== 1 ? "ren" : ""}` : ""}).
              Consider adding more rooms or selecting a larger room type.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
