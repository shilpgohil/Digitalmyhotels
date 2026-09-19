"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MoreHorizontal,
  MoreVertical,
  LayoutGrid,
  List,
  Building2,
  DoorOpen,
  DoorClosed,
  Bookmark,
  Sparkles,
  Wrench,
  SquarePen,
} from "lucide-react";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { SegmentedChips } from "@/components/ui/segmented-chips";
import type { StatCardTone } from "@/components/ui/stat-card";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, ROOM_STATUS_TONE } from "@/components/feedback/status-badge";
import { useApi } from "@/lib/api/use-api";
import { fmtApiDateTime } from "@/lib/formatting";
import { invalidateRoomState } from "@/lib/query-invalidation";
import { roomBucket, type RoomBucket } from "@/lib/room-buckets";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { ListOut, RoomOut, RoomStatus } from "@/types/hotel";
import { RequirePermission } from "@/components/auth/require-permission";

/**
 * Stat cards shown above the room grid (per the "Room Status - Meridian Court"
 * figma). Counting uses the shared roomBucket() partition (redesign 15/09):
 * "Reserved" = confirmed guest arrives TODAY on a physically-free room; a
 * free room with only a future booking counts as Available (it IS sellable
 * now) and carries a "Reserved from …" ribbon on its card instead. Buckets
 * are a strict partition so the six cards always sum to the room total.
 */
const STAT_CARDS: Array<{
  key: string;
  labelKey: string;
  labelNs: "rooms" | "dashboard";
  icon: React.ComponentType<{ className?: string }>;
  tone: StatCardTone;
  bucket: RoomBucket | null;
  filter: RoomBucket | "all";
}> = [
  { key: "total",       labelKey: "statTotal",   labelNs: "rooms",      icon: Building2, tone: "navy",    bucket: null,          filter: "all"         },
  { key: "booked",      labelKey: "statBooked",  labelNs: "rooms",      icon: DoorClosed, tone: "danger", bucket: "occupied",    filter: "occupied"    },
  { key: "available",   labelKey: "available",   labelNs: "dashboard",  icon: DoorOpen,   tone: "success",bucket: "available",   filter: "available"   },
  { key: "reserved",    labelKey: "reserved",    labelNs: "dashboard",  icon: Bookmark,   tone: "info",   bucket: "reserved",    filter: "reserved"    },
  { key: "cleaning",    labelKey: "cleaning",    labelNs: "dashboard",  icon: Sparkles,   tone: "warning",bucket: "cleaning",    filter: "cleaning"    },
  { key: "maintenance", labelKey: "maintenance", labelNs: "dashboard",  icon: Wrench,     tone: "navy2",  bucket: "maintenance", filter: "maintenance" },
];

const GRID_FILTERS: Array<RoomBucket | "all"> = [
  "all",
  "available",
  "reserved",
  "occupied",
  "cleaning",
  "maintenance",
];

// Deep-link back-compat: dashboard cards / saved links may still use raw
// statuses (?filter=cleaning_required). Map them onto the bucket filters.
const LEGACY_FILTER_MAP: Record<string, RoomBucket> = {
  cleaning_required: "cleaning",
  cleaning_in_progress: "cleaning",
  inspection_required: "cleaning",
  clean_ready: "available",
  out_of_service: "maintenance",
};

/**
 * Statuses a user may set manually — the single source of truth for BOTH the
 * grid-tile menu and the table-row menu. Invalid transitions are rejected by
 * the backend with a friendly message shown verbatim in the error toast.
 */
const MANUAL_STATUSES: RoomStatus[] = [
  "available",
  "cleaning_required",
  "cleaning_in_progress",
  "clean_ready",
  "inspection_required",
  "maintenance",
  "out_of_service",
];

/**
 * Two-layer status display (redesign 15/09): physical badge + derived
 * reservation ribbons, hour-accurate. Shared by grid tiles and table rows.
 *  - Free room, guest arrives today  → "Reserved (Today)" badge + arrival time
 *  - Free room, future booking       → physical badge + "Reserved from <date, time>"
 *  - Occupied, guest departs today   → physical badge + "Departs today <time>"
 */
function RoomStatusCell({ room }: { readonly room: RoomOut }) {
  const t = useTranslations("rooms");
  const bucket = roomBucket(room);
  // Derived reserved: physically free but today's guest is due — show the
  // reservation as the primary badge (this is what "Reserved" now means).
  const derivedReserved = bucket === "reserved";
  // items-center: grid view centres badges/text; table view also looks clean centered
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      {derivedReserved ? (
        <StatusBadge tone={ROOM_STATUS_TONE.reserved}>{t("reservedToday")}</StatusBadge>
      ) : (
        <StatusBadge tone={ROOM_STATUS_TONE[room.status]}>
          {t(`status_${room.status}`)}
        </StatusBadge>
      )}
      {derivedReserved && (
        <span className="text-micro font-medium text-info">
          {room.arrival_time
            ? t("arrivesAt", { time: room.arrival_time })
            : t("arrivingToday")}
        </span>
      )}
      {/* Future-booking ribbon — the room is sellable until that date. */}
      {!room.arriving_today && room.next_booking_date && (
        <span className="text-micro font-semibold text-gold-600">
          {t("reservedFrom", {
            date: fmtApiDateTime(room.next_booking_date, room.next_booking_time),
          })}
        </span>
      )}
      {room.departing_today && (
        <span className="text-micro font-medium text-success">
          {room.departure_time
            ? t("departsToday", { time: room.departure_time })
            : t("departsTodayNoTime")}
        </span>
      )}
    </div>
  );
}

/** Shared status-change menu items — identical options for grid and table views. */
function RoomStatusMenuItems({
  currentStatus,
  onSelect,
}: {
  currentStatus: RoomStatus;
  onSelect: (status: RoomStatus) => void;
}) {
  const t = useTranslations("rooms");
  return (
    <>
      {/* Clear header title + separator (client 9-08 item 26: wider, bordered, title hierarchy). */}
      <DropdownMenuLabel className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground border-b mb-1">
        {t("changeStatus")}
      </DropdownMenuLabel>
      {MANUAL_STATUSES.filter((s) => {
        if (s === currentStatus) return false;
        // Occupied rooms stay occupied until checkout — never offer Available.
        if (
          currentStatus === "occupied" &&
          (s === "available" || s === "clean_ready")
        ) {
          return false;
        }
        return true;
      }).map((status) => (
        <DropdownMenuItem key={status} onClick={() => onSelect(status)}>
          {t(`status_${status}`)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function RoomsContent() {
  const t = useTranslations("rooms");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const td = useTranslations("dashboard");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  const [view, setView] = useState<"grid" | "table">("grid");
  // ?filter=<bucket> deep link — the dashboard's room-status cards land here
  // pre-filtered (client 9-08 item 17). Legacy raw-status params are mapped.
  const [gridFilter, setGridFilter] = useState<RoomBucket | "all">(() => {
    if (typeof window === "undefined") return "all";
    const param = new URLSearchParams(window.location.search).get("filter");
    if (!param) return "all";
    if (GRID_FILTERS.includes(param as RoomBucket | "all")) {
      return param as RoomBucket | "all";
    }
    return LEGACY_FILTER_MAP[param] ?? "all";
  });

  const rooms = useQuery({
    queryKey: ["rooms", activeHotelId],
    queryFn: () => api<ListOut<RoomOut>>("/api/v1/rooms?limit=200"),
    enabled: !!activeHotelId,
    // Multi-device desks converge without manual refresh (plan Part 6).
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  /** Room counts per BUCKET (shared partition — redesign 15/09). */
  const bucketCounts = useMemo(() => {
    const counts: Partial<Record<RoomBucket, number>> = {};
    for (const room of rooms.data?.items ?? []) {
      const bucket = roomBucket(room);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return counts;
  }, [rooms.data]);

  const cardValue = (bucket: RoomBucket | null) =>
    bucket === null
      ? (rooms.data?.items.length ?? 0)
      : (bucketCounts[bucket] ?? 0);

  // Cross-page room-state invalidation (plan Part 6).
  const invalidate = () => invalidateRoomState(queryClient);

  const statusMutation = useMutation({
    mutationFn: ({ roomId, status }: { roomId: string; status: RoomStatus }) =>
      api<RoomOut>(`/api/v1/rooms/${roomId}/status`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      toast.success(t("statusUpdated"));
      invalidate();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : tc("error"));
    },
  });

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("property")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Rooms & room types are managed on the Edit Hotel page — this page
            only shows live status (client request, 09/2026). */}
        {can(PERMISSIONS.hotelManageSettings) && (
          <div className="mb-4 flex justify-end">
            <Link
              href="/edit-hotel"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
            >
              <SquarePen className="size-4" aria-hidden />
              {t("manageInEditHotel")}
            </Link>
          </div>
        )}

        <div>
            {/* Stat cards (figma: Room Status - Meridian Court) */}
            <StatCardGrid cols={6} className="mb-4">
              {STAT_CARDS.map((card) => {
                const label = card.labelNs === "rooms" ? t(card.labelKey) : td(card.labelKey);
                return (
                  <StatCard
                    key={card.key}
                    label={label}
                    value={rooms.data ? String(cardValue(card.bucket)) : "—"}
                    icon={card.icon}
                    tone={card.tone}
                    isLoading={rooms.isLoading}
                    active={gridFilter === card.filter}
                    onClick={() => setGridFilter(card.filter)}
                  />
                );
              })}
            </StatCardGrid>

            {/* View toggle + status filter chips (grid mode) */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              {/* Filter chips — shown in BOTH grid AND table views (client 9-10 row 7:
                  previously only visible in grid mode, causing inconsistency). */}
              {/* Platform segmented chip pattern (client 09/2026) */}
              <SegmentedChips
                options={GRID_FILTERS.map((filter) => ({
                  value: filter,
                  label: filter === "all" ? t("filterAll") : t(`bucket_${filter}`),
                }))}
                value={gridFilter}
                onChange={setGridFilter}
              />
              <div className="flex rounded-lg border">
                <button
                  type="button"
                  aria-label={t("gridView")}
                  onClick={() => setView("grid")}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-l-lg",
                    view === "grid" ? "bg-navy-900 text-white" : "text-muted-foreground",
                  )}
                >
                  <LayoutGrid className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t("tableView")}
                  onClick={() => setView("table")}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-r-lg",
                    view === "table" ? "bg-navy-900 text-white" : "text-muted-foreground",
                  )}
                >
                  <List className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            {/* Grid view */}
            {view === "grid" && (
              <div className="rounded-lg border bg-card p-4">
                {rooms.isLoading && <TableSkeleton rows={4} />}
                {rooms.data && rooms.data.items.length === 0 && (
                  <p className="p-10 text-center text-sm text-muted-foreground">
                    {t("noRooms")}
                  </p>
                )}
                {/* Status-specific empty state — a blank strip told staff
                    nothing (client 9-08 item 19: "No maintenance rooms"). */}
                {rooms.data &&
                  rooms.data.items.length > 0 &&
                  gridFilter !== "all" &&
                  rooms.data.items.every((room) => roomBucket(room) !== gridFilter) && (
                    <p className="p-10 text-center text-sm text-muted-foreground">
                      {t("noRoomsInStatus", { status: t(`bucket_${gridFilter}`) })}
                    </p>
                  )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                  {rooms.data?.items
                    .filter((room) => gridFilter === "all" || roomBucket(room) === gridFilter)
                    .map((room) => (
                      <div
                        key={room.id}
                        className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center"
                      >
                        <div className="flex w-full items-start justify-between">
                          <span className="text-lg font-semibold">{room.room_number}</span>
                          {can(PERMISSIONS.roomsUpdateStatus) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                className="-mr-1 -mt-1 flex size-6 items-center justify-center rounded hover:bg-muted"
                                aria-label={t("changeStatus")}
                              >
                                <MoreHorizontal className="size-3.5" aria-hidden />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-64 rounded-xl border border-border shadow-lg">
                                <RoomStatusMenuItems
                                  currentStatus={room.status}
                                  onSelect={(status) =>
                                    statusMutation.mutate({ roomId: room.id, status })
                                  }
                                />
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                        <RoomStatusCell room={room} />
                        <span className="text-xs text-muted-foreground">
                          {room.room_type_name}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Table view */}
            {view === "table" && (
            <div className="rounded-lg border bg-card">
              {rooms.isLoading && <TableSkeleton rows={6} />}
              {rooms.isError && <ErrorRow onRetry={() => rooms.refetch()} />}
              {rooms.data && rooms.data.items.length === 0 && (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  {t("noRooms")}
                </p>
              )}
              {rooms.data && rooms.data.items.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-navy-900 hover:bg-navy-900">
                      <TableHead className="text-white">{t("roomNumber")}</TableHead>
                      <TableHead className="text-white">{t("floor")}</TableHead>
                      <TableHead className="text-white">{t("roomType")}</TableHead>
                      <TableHead className="text-white">{t("amenities")}</TableHead>
                      <TableHead className="text-white">{t("status")}</TableHead>
                      <TableHead className="text-right text-white">
                        {tc("actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rooms.data.items
                      .filter((room) => gridFilter === "all" || roomBucket(room) === gridFilter)
                      .map((room) => (
                      <TableRow key={room.id}>
                        <TableCell className="font-medium">{room.room_number}</TableCell>
                        <TableCell>{room.floor ?? "—"}</TableCell>
                        <TableCell>{room.room_type_name}</TableCell>
                        <TableCell className="max-w-52 truncate text-muted-foreground">
                          {room.amenities.join(", ") || "—"}
                        </TableCell>
                        <TableCell>
                          <RoomStatusCell room={room} />
                        </TableCell>
                        <TableCell className="text-right">
                          {can(PERMISSIONS.roomsUpdateStatus) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                                aria-label={t("changeStatus")}
                              >
                                <MoreVertical className="size-4" aria-hidden />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-64 rounded-xl border border-border shadow-lg">
                                <RoomStatusMenuItems
                                  currentStatus={room.status}
                                  onSelect={(status) =>
                                    statusMutation.mutate({ roomId: room.id, status })
                                  }
                                />
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            )}
        </div>
      </main>
    </>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function ErrorRow({ onRetry }: { onRetry: () => void }) {
  const tc = useTranslations("common");
  return (
    <div className="p-8 text-center text-sm text-danger">
      {tc("error")}{" "}
      <button className="underline" onClick={onRetry}>
        {tc("retry")}
      </button>
    </div>
  );
}

export default function RoomsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.roomsView}>
      <RoomsContent />
    </RequirePermission>
  );
}
