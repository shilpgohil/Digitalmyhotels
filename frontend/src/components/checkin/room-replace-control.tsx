"use client";
/**
 * RoomReplaceControl — Room replacement/addition for a NOT-yet-checked-in
 * advance booking (client 9-08 item 22).
 *
 * Shows the allocated room(s) with:
 *  - "Change room" action per room (1:1 swap via POST /bookings/{id}/replace-room)
 *  - "+ Add Room" button for multi-room selection (POST /bookings/{id}/add-room)
 *
 * All room operations are atomic on the backend (availability check, repricing,
 * ledger, audit). The parent refetches the booking after each operation.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BedDouble, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoomAvailabilityPicker } from "@/components/rooms/room-availability-picker";
import { useApi } from "@/lib/api/use-api";
import { ApiError } from "@/lib/api/client";
import { fmtINR, localToday } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import type { BookingOut } from "@/types/stay";

interface RoomReplaceControlProps {
  booking: BookingOut;
  onReplaced: () => void;
}

export function RoomReplaceControl({ booking, onReplaced }: RoomReplaceControlProps) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const api = useApi();
  const [openFor, setOpenFor] = useState<string | null>(null);
  /** "add" mode opens the room picker for adding a NEW room (not replacing). */
  const [addMode, setAddMode] = useState(false);
  /** Room chosen in the picker, awaiting explicit confirmation. */
  const [pendingTarget, setPendingTarget] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // The availability endpoint rejects past check-in dates (422). A guest
  // arriving AFTER the scheduled date (late advance-booking check-in) still
  // needs a replacement room, so clamp the queried window to today while the
  // actual swap keeps pricing against the booking's real dates server-side.
  const availFrom =
    booking.check_in_date < localToday() ? localToday() : booking.check_in_date;
  const availTo =
    booking.check_out_date < availFrom ? availFrom : booking.check_out_date;

  const currentRooms = booking.rooms.filter((r) => r.is_current);
  const currentIds = new Set(currentRooms.map((r) => r.room_id));
  const fromRoom = currentRooms.find((r) => r.room_id === openFor);

  const replace = async (toRoomId: string) => {
    if (!openFor) return;
    setBusy(true);
    try {
      await api(`/api/v1/bookings/${booking.id}/replace-room`, {
        method: "POST",
        body: { from_room_id: openFor, to_room_id: toRoomId },
      });
      toast.success(t("roomReplaced"));
      setOpenFor(null);
      setPendingTarget([]);
      onReplaced();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  /** Add one or more rooms sequentially; stops on first error. */
  const addRooms = async (roomIds: string[]) => {
    if (roomIds.length === 0) return;
    setBusy(true);
    try {
      for (const roomId of roomIds) {
        await api(`/api/v1/bookings/${booking.id}/add-room`, {
          method: "POST",
          body: { room_id: roomId },
        });
      }
      toast.success(
        roomIds.length === 1 ? t("roomAdded") : t("roomsAdded", { count: roomIds.length }),
      );
      setAddMode(false);
      setPendingTarget([]);
      onReplaced();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Current allocation, one chip per room with its own Change action. */}
      <div className="flex flex-wrap gap-2 items-center">
        {currentRooms.map((r) => (
          <div
            key={r.room_id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
              openFor === r.room_id ? "border-gold-400 bg-gold-50" : "bg-muted/30",
            )}
          >
            <BedDouble className="size-4 text-gold-600" aria-hidden />
            <span className="font-semibold">{r.room_number}</span>
            <span className="text-xs text-muted-foreground">
              {r.room_type_name} · {fmtINR(Number.parseFloat(r.rate) || 0)}
            </span>
            <button
              type="button"
              className="text-xs font-medium text-gold-700 underline hover:text-gold-800"
              onClick={() => {
                setPendingTarget([]);
                setAddMode(false);
                setOpenFor(openFor === r.room_id ? null : r.room_id);
              }}
              disabled={busy}
            >
              {openFor === r.room_id ? tc("cancel") : t("changeRoom")}
            </button>
          </div>
        ))}
        {/* Add Another Room button */}
        <button
          type="button"
          onClick={() => { setPendingTarget([]); setOpenFor(null); setAddMode(!addMode); }}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg border-2 border-dashed border-gold-400 px-3 py-1.5 text-xs font-medium text-gold-700 hover:bg-gold-50 transition-colors"
        >
          <Plus className="size-3.5" aria-hidden />
          {t("addRoom")}
        </button>
      </div>

      {/* Full room picker — the SAME status-filtered, badge-rich component
          used everywhere else rooms are selected (client: the change-room
          screen must match the Room Information picker, not a chip list). */}
      {openFor && fromRoom && (
        <div className="space-y-3 rounded-xl border bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("pickReplacementFor", { room: fromRoom.room_number })}
          </p>
          <RoomAvailabilityPicker
            checkIn={availFrom}
            checkOut={availTo}
            adults={booking.adults}
            guestChildren={booking.children}
            selectedRooms={pendingTarget}
            onSelectionChange={(ids) => {
              // Single-select semantics: keep only the newest pick, and the
              // rooms already on the booking can never be the target.
              const fresh = ids.filter((id) => !currentIds.has(id));
              setPendingTarget(fresh.slice(-1));
            }}
          />
          {pendingTarget.length === 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-400 bg-gold-50 px-4 py-3">
              <p className="text-sm font-medium text-navy-900">
                {t("confirmReplaceHint", { from: fromRoom.room_number })}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setPendingTarget([])}>
                  {tc("cancel")}
                </Button>
                <Button
                  size="sm"
                  className="bg-navy-900 text-white hover:bg-navy-900/90"
                  disabled={busy}
                  onClick={() => void replace(pendingTarget[0])}
                >
                  {busy ? tc("saving") : t("confirmReplace")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Room mode — multi-select, adds ALL selected rooms at once */}
      {addMode && (
        <div className="space-y-3 rounded-xl border border-gold-300 bg-gold-50/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-700 flex items-center gap-1.5">
            <Plus className="size-3.5" />
            {t("addRoomTitle")}
          </p>
          <p className="text-label text-muted-foreground -mt-1">
            Select one or more rooms to add to this booking.
          </p>
          <RoomAvailabilityPicker
            checkIn={availFrom}
            checkOut={availTo}
            adults={1}
            guestChildren={0}
            selectedRooms={pendingTarget}
            onSelectionChange={(ids) => {
              // Multi-select: allow any number of rooms except those already on the booking
              const fresh = ids.filter((id) => !currentIds.has(id));
              setPendingTarget(fresh);
            }}
          />
          {pendingTarget.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-400 bg-white px-4 py-3">
              <p className="text-sm font-medium text-navy-900">
                {pendingTarget.length === 1
                  ? t("confirmAddHint")
                  : `Add ${pendingTarget.length} rooms to this booking?`}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setPendingTarget([])}>
                  {tc("cancel")}
                </Button>
                <Button
                  size="sm"
                  className="bg-navy-900 text-white hover:bg-navy-900/90"
                  disabled={busy}
                  onClick={() => void addRooms(pendingTarget)}
                >
                  {busy
                    ? tc("saving")
                    : pendingTarget.length === 1
                    ? t("confirmAdd")
                    : `Add ${pendingTarget.length} rooms`}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
