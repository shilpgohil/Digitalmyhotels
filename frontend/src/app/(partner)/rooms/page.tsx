"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
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
  Ban,
  CheckCircle2,
  LogIn,
  LogOut,
  Phone,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/** Top status shade line colors for room grid cards based on live current bucket. */
const ROOM_BUCKET_BAR_COLOR: Record<RoomBucket, string> = {
  occupied: "bg-danger",
  available: "bg-success",
  reserved: "bg-info",
  cleaning: "bg-warning",
  maintenance: "bg-navy-800 dark:bg-slate-600",
};

/** Subtle border tint on card hover matching its live status. */
const ROOM_BUCKET_BORDER_HOVER: Record<RoomBucket, string> = {
  occupied: "hover:border-danger/40 dark:hover:border-danger/40",
  available: "hover:border-success/40 dark:hover:border-success/40",
  reserved: "hover:border-info/40 dark:hover:border-info/40",
  cleaning: "hover:border-warning/40 dark:hover:border-warning/40",
  maintenance: "hover:border-navy-500/40 dark:hover:border-slate-500/40",
};

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
      {/* Staff-supplied reason (maintenance / out_of_service) */}
      {room.status_note && (
        <span className="text-micro text-muted-foreground italic truncate max-w-full px-1">
          {room.status_note}
        </span>
      )}
      {/* In-house guest on stayover clean or maintenance */}
      {room.current_booking_id && room.status !== "occupied" && (
        <span className="text-micro font-medium text-amber-700 dark:text-amber-400 truncate max-w-full px-1">
          {room.current_guest_name ? `${room.current_guest_name} (${t("stayoverBadge")})` : t("inHouseGuest")}
        </span>
      )}
    </div>
  );
}

/** Shared status-change menu items — identical options for grid and table views. */
function RoomStatusMenuItems({
  room,
  onSelectStatus,
  onCheckIn,
  onCheckOut,
}: {
  readonly room: RoomOut;
  readonly onSelectStatus: (status: RoomStatus) => void;
  readonly onCheckIn: () => void;
  readonly onCheckOut: (bookingId: string) => void;
}) {
  const t = useTranslations("rooms");
  const hasInHouseGuest = Boolean(room.current_booking_id);
  const isOccupied = room.status === "occupied";
  const isAvailable = room.status === "available" || room.status === "clean_ready";
  const isCleaning =
    room.status === "cleaning_required" ||
    room.status === "cleaning_in_progress" ||
    room.status === "inspection_required";
  const isMaintenanceOrOos =
    room.status === "maintenance" || room.status === "out_of_service";

  return (
    <>
      {/* Room header / In-house guest header */}
      {hasInHouseGuest ? (
        <div className="px-3 py-2 border-b bg-muted/40">
          <div className="flex items-center justify-between gap-1 text-xs font-semibold text-foreground">
            <div className="flex items-center gap-1.5 truncate">
              <User className="size-3.5 text-navy-600 dark:text-gold-500 shrink-0" />
              <span className="truncate">{room.current_guest_name || t("inHouseGuest")}</span>
            </div>
            {isCleaning && (
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0">
                {t("stayoverBadge")}
              </span>
            )}
          </div>
          {room.current_guest_phone && (
            <div className="flex items-center gap-1.5 text-micro text-muted-foreground mt-0.5">
              <Phone className="size-3 shrink-0" />
              <span>{room.current_guest_phone}</span>
            </div>
          )}
        </div>
      ) : (
        <DropdownMenuLabel className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground border-b mb-1">
          {t("roomNumber")} {room.room_number}
        </DropdownMenuLabel>
      )}

      {/* ── CASE 1: OCCUPIED ── */}
      {isOccupied && (
        <>
          {room.current_booking_id && (
            <DropdownMenuItem
              className="cursor-pointer gap-2 font-medium text-destructive focus:text-destructive focus:bg-destructive/10"
              onClick={() => onCheckOut(room.current_booking_id!)}
            >
              <LogOut className="size-4" />
              <span>{t("checkOutGuest")}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => onSelectStatus("cleaning_required")}
          >
            <Sparkles className="size-4 text-warning" />
            <span>{t("stayoverClean")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => onSelectStatus("maintenance")}
          >
            <Wrench className="size-4 text-muted-foreground" />
            <span>{t("markMaintenance")}</span>
          </DropdownMenuItem>
        </>
      )}

      {/* ── CASE 2: AVAILABLE / CLEAN & READY ── */}
      {isAvailable && (
        <>
          <DropdownMenuItem
            className="cursor-pointer gap-2 font-medium text-navy-800 dark:text-gold-500 focus:bg-accent"
            onClick={onCheckIn}
          >
            <LogIn className="size-4 text-emerald-600" />
            <span>{t("quickCheckIn")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => onSelectStatus("cleaning_required")}
          >
            <Sparkles className="size-4 text-warning" />
            <span>{t("markDirty")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => onSelectStatus("maintenance")}
          >
            <Wrench className="size-4 text-muted-foreground" />
            <span>{t("markMaintenance")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => onSelectStatus("out_of_service")}
          >
            <Ban className="size-4 text-destructive" />
            <span>{t("markOutOfService")}</span>
          </DropdownMenuItem>
        </>
      )}

      {/* ── CASE 3: CLEANING (REQUIRED / IN PROGRESS / INSPECTION) ── */}
      {isCleaning && (
        <>
          {hasInHouseGuest ? (
            /* Stayover cleaning: guest is still living here! */
            <>
              <DropdownMenuItem
                className="cursor-pointer gap-2 font-medium text-emerald-600 focus:text-emerald-700"
                onClick={() => onSelectStatus("occupied")}
              >
                <CheckCircle2 className="size-4" />
                <span>{t("finishStayoverClean")}</span>
              </DropdownMenuItem>
              {room.current_booking_id && (
                <DropdownMenuItem
                  className="cursor-pointer gap-2 font-medium text-destructive focus:text-destructive focus:bg-destructive/10"
                  onClick={() => onCheckOut(room.current_booking_id!)}
                >
                  <LogOut className="size-4" />
                  <span>{t("checkOutGuest")}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                onClick={() => onSelectStatus("maintenance")}
              >
                <Wrench className="size-4 text-muted-foreground" />
                <span>{t("markMaintenance")}</span>
              </DropdownMenuItem>
            </>
          ) : (
            /* Vacant / checkout cleaning: room is empty! */
            <>
              <DropdownMenuItem
                className="cursor-pointer gap-2 font-medium text-emerald-600 focus:text-emerald-700"
                onClick={() => onSelectStatus("available")}
              >
                <CheckCircle2 className="size-4" />
                <span>{t("fastTrackAvailable")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                onClick={() => onSelectStatus("clean_ready")}
              >
                <Sparkles className="size-4 text-emerald-600" />
                <span>{t("markCleanReady")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                onClick={() => onSelectStatus("maintenance")}
              >
                <Wrench className="size-4 text-muted-foreground" />
                <span>{t("markMaintenance")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                onClick={() => onSelectStatus("out_of_service")}
              >
                <Ban className="size-4 text-destructive" />
                <span>{t("markOutOfService")}</span>
              </DropdownMenuItem>
            </>
          )}
        </>
      )}

      {/* ── CASE 4: MAINTENANCE / OUT OF SERVICE ── */}
      {isMaintenanceOrOos && (
        <>
          <DropdownMenuItem
            className="cursor-pointer gap-2 font-medium text-emerald-600 focus:text-emerald-700"
            onClick={() => onSelectStatus("available")}
          >
            <CheckCircle2 className="size-4" />
            <span>{t("repairCompleted")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => onSelectStatus("cleaning_required")}
          >
            <Sparkles className="size-4 text-warning" />
            <span>{t("sendToCleaning")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => onSelectStatus("clean_ready")}
          >
            <Sparkles className="size-4 text-emerald-600" />
            <span>{t("markCleanReady")}</span>
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

function RoomsContent() {
  const router = useRouter();
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
  //
  // IMPORTANT: useSearchParams() is reactive — it re-runs whenever the URL
  // changes (e.g. client-side navigation from the dashboard stat cards).
  // The old window.location.search approach used a lazy useState initializer
  // that only fired once on mount, so navigating from the dashboard to
  // /rooms?filter=occupied never applied the filter until a second click.
  const searchParams = useSearchParams();
  const [gridFilter, setGridFilter] = useState<RoomBucket | "all">("all");

  useEffect(() => {
    const param = searchParams.get("filter");
    if (!param) { setGridFilter("all"); return; }
    if (GRID_FILTERS.includes(param as RoomBucket | "all")) {
      setGridFilter(param as RoomBucket | "all");
    } else {
      setGridFilter(LEGACY_FILTER_MAP[param] ?? "all");
    }
  }, [searchParams]);

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

  const [pendingStatusRoom, setPendingStatusRoom] = useState<{
    room: RoomOut;
    status: RoomStatus;
  } | null>(null);
  const [statusReason, setStatusReason] = useState("");

  const statusMutation = useMutation({
    mutationFn: ({
      roomId,
      status,
      reason,
    }: {
      roomId: string;
      status: RoomStatus;
      reason?: string;
    }) =>
      api<RoomOut>(`/api/v1/rooms/${roomId}/status`, {
        method: "PUT",
        body: { status, reason },
      }),
    onSuccess: () => {
      toast.success(t("statusUpdated"));
      setPendingStatusRoom(null);
      setStatusReason("");
      invalidate();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : tc("error"));
    },
  });

  const handleSelectStatus = (room: RoomOut, nextStatus: RoomStatus) => {
    if (nextStatus === "maintenance" || nextStatus === "out_of_service") {
      setPendingStatusRoom({ room, status: nextStatus });
      setStatusReason("");
    } else {
      statusMutation.mutate({ roomId: room.id, status: nextStatus });
    }
  };

  const handleConfirmReasonStatus = () => {
    if (!pendingStatusRoom) return;
    statusMutation.mutate({
      roomId: pendingStatusRoom.room.id,
      status: pendingStatusRoom.status,
      reason: statusReason.trim(),
    });
  };

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
                options={GRID_FILTERS.map((filter) => {
                  const count = filter === "all"
                    ? (rooms.data?.items.length ?? 0)
                    : (bucketCounts[filter as RoomBucket] ?? 0);
                  const label = filter === "all" ? t("filterAll") : t(`bucket_${filter}`);
                  return {
                    value: filter,
                    // Show count next to label so it always matches the grid (ss4)
                    label: count > 0 ? `${label} (${count})` : label,
                  };
                })}
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
                    .map((room) => {
                      const bucket = roomBucket(room);
                      return (
                        <div
                          key={room.id}
                          className={cn(
                            "relative flex flex-col items-center gap-2 rounded-xl border bg-card p-4 pt-5 text-center shadow-2xs transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 overflow-hidden",
                            ROOM_BUCKET_BORDER_HOVER[bucket],
                          )}
                        >
                          {/* Live status top horizontal shade line */}
                          <div
                            className={cn(
                              "absolute top-0 inset-x-0 h-1.5",
                              ROOM_BUCKET_BAR_COLOR[bucket],
                            )}
                            aria-hidden
                          />

                          {/* Room number — centered; ··· menu is absolutely-positioned
                              so it doesn't push the number off-centre
                              (client 09/2026: "All Items Center, room number should also be center"). */}
                          <span className="w-full text-center text-lg font-semibold">{room.room_number}</span>
                          {can(PERMISSIONS.roomsUpdateStatus) && (
                            <div className="absolute top-2.5 right-2">
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className="flex size-6 items-center justify-center rounded hover:bg-muted"
                                  aria-label={t("changeStatus")}
                                >
                                  <MoreHorizontal className="size-3.5" aria-hidden />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64 rounded-xl border border-border shadow-lg">
                                  <RoomStatusMenuItems
                                    room={room}
                                    onSelectStatus={(status) => handleSelectStatus(room, status)}
                                    onCheckIn={() => router.push("/checkin")}
                                    onCheckOut={(bookingId) => router.push(`/checkout?booking=${bookingId}`)}
                                  />
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                          <RoomStatusCell room={room} />
                          <span className="text-xs text-muted-foreground">
                            {room.room_type_name}
                          </span>
                        </div>
                      );
                    })}
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
                                  room={room}
                                  onSelectStatus={(status) => handleSelectStatus(room, status)}
                                  onCheckIn={() => router.push("/checkin")}
                                  onCheckOut={(bookingId) => router.push(`/checkout?booking=${bookingId}`)}
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

      {/* Reason dialog for Maintenance and Out of Service statuses */}
      <Dialog
        open={!!pendingStatusRoom}
        onOpenChange={(open) => {
          if (!open) {
            setPendingStatusRoom(null);
            setStatusReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingStatusRoom?.status === "maintenance"
                ? t("maintenanceReasonTitle", {
                    roomNumber: pendingStatusRoom.room.room_number,
                  })
                : t("outOfServiceReasonTitle", {
                    roomNumber: pendingStatusRoom?.room.room_number ?? "",
                  })}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t("reasonPrompt")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-3">
            <Label htmlFor="room-status-reason">{t("reasonLabel")}</Label>
            <Input
              id="room-status-reason"
              placeholder={t("reasonPlaceholder")}
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  statusReason.trim().length >= 3 &&
                  !statusMutation.isPending
                ) {
                  e.preventDefault();
                  handleConfirmReasonStatus();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingStatusRoom(null);
                setStatusReason("");
              }}
              disabled={statusMutation.isPending}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={statusReason.trim().length < 3 || statusMutation.isPending}
              onClick={handleConfirmReasonStatus}
            >
              {statusMutation.isPending ? tc("saving") : tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      {/* Suspense is required by Next.js whenever useSearchParams() is used
          inside a client component (build-time enforcement). The fallback is
          null so there's no flash — the component hydrates immediately. */}
      <Suspense fallback={null}>
        <RoomsContent />
      </Suspense>
    </RequirePermission>
  );
}
