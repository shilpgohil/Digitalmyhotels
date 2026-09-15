/**
 * Shared room-status bucketing (room-status redesign, 15/09).
 *
 * "Reserved" is a CALENDAR fact derived from bookings — not a stored room
 * status. A room counts as Reserved on the grid/stat cards ONLY when a
 * confirmed guest arrives TODAY and the room is physically free for them.
 * A physically-free room with a future booking stays in the AVAILABLE
 * bucket (it IS sellable now) and shows a "Reserved from …" ribbon instead.
 *
 * Buckets are a strict partition — every room lands in exactly one — so the
 * stat cards always sum to the room total (client bug report: "Room Status
 * wrong count").
 *
 * Used by BOTH the dashboard cards and the Room Status page. Keep in sync.
 */

export type RoomBucket =
  | "occupied"
  | "available"
  | "reserved"
  | "cleaning"
  | "maintenance";

export interface BucketableRoom {
  status: string;
  /** Derived flag from the rooms API — confirmed guest arrives today. */
  arriving_today?: boolean;
}

export function roomBucket(room: BucketableRoom): RoomBucket {
  switch (room.status) {
    case "occupied":
      return "occupied";
    case "maintenance":
    case "out_of_service":
      return "maintenance";
    case "cleaning_required":
    case "cleaning_in_progress":
    case "inspection_required":
      return "cleaning";
    case "reserved":
      // Legacy stored flag (pre-migration rows only) — treat as reserved.
      return "reserved";
    default:
      // available / clean_ready: reserved ONLY when the guest arrives today.
      return room.arriving_today ? "reserved" : "available";
  }
}
