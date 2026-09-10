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
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { ListOut, RoomOut, RoomStatus } from "@/types/hotel";
import { RequirePermission } from "@/components/auth/require-permission";

/**
 * Stat cards shown above the room grid (per the "Room Status - Meridian Court"
 * figma). Colors/classes mirror the dashboard's stat-card row. `statuses` is
 * the group of room statuses counted by the card (null = all rooms), and
 * `filter` is the grid filter applied when the card is clicked — the same
 * status the matching filter chip uses ("all" clears the filter).
 */
const STAT_CARDS: Array<{
  key: string;
  labelKey: string;
  /** Which i18n namespace the label lives in. */
  labelNs: "rooms" | "dashboard";
  icon: React.ComponentType<{ className?: string }>;
  className: string;
  statuses: RoomStatus[] | null;
  filter: RoomStatus | "all";
}> = [
  {
    key: "total",
    labelKey: "statTotal",
    labelNs: "rooms",
    icon: Building2,
    className: "bg-navy-900 text-white",
    statuses: null,
    filter: "all",
  },
  {
    key: "booked",
    labelKey: "statBooked",
    labelNs: "rooms",
    icon: DoorClosed,
    className: "bg-danger text-white",
    statuses: ["occupied"],
    filter: "occupied",
  },
  {
    key: "available",
    labelKey: "available",
    labelNs: "dashboard",
    icon: DoorOpen,
    className: "bg-success text-white",
    statuses: ["available", "clean_ready"],
    filter: "available",
  },
  {
    key: "reserved",
    labelKey: "reserved",
    labelNs: "dashboard",
    icon: Bookmark,
    className: "bg-info text-white",
    statuses: ["reserved"],
    filter: "reserved",
  },
  {
    key: "cleaning",
    labelKey: "cleaning",
    labelNs: "dashboard",
    icon: Sparkles,
    className: "bg-warning text-white",
    statuses: ["cleaning_required", "cleaning_in_progress", "inspection_required"],
    filter: "cleaning_required",
  },
  {
    key: "maintenance",
    labelKey: "maintenance",
    labelNs: "dashboard",
    icon: Wrench,
    className: "bg-navy-700 text-white",
    statuses: ["maintenance", "out_of_service"],
    filter: "maintenance",
  },
];

const GRID_FILTERS: Array<RoomStatus | "all"> = [
  "all",
  "available",
  "reserved",
  "occupied",
  "cleaning_required",
  "maintenance",
];

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
  // ?filter=<status> deep link — the dashboard's room-status cards land here
  // pre-filtered (client 9-08 item 17).
  const [gridFilter, setGridFilter] = useState<RoomStatus | "all">(() => {
    if (typeof window === "undefined") return "all";
    const param = new URLSearchParams(window.location.search).get("filter");
    return param && GRID_FILTERS.includes(param as RoomStatus | "all")
      ? (param as RoomStatus | "all")
      : "all";
  });

  const rooms = useQuery({
    queryKey: ["rooms", activeHotelId],
    queryFn: () => api<ListOut<RoomOut>>("/api/v1/rooms?limit=200"),
    enabled: !!activeHotelId,
  });

  /** Room counts per status, derived from the already-fetched rooms list. */
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<RoomStatus, number>> = {};
    for (const room of rooms.data?.items ?? []) {
      counts[room.status] = (counts[room.status] ?? 0) + 1;
    }
    return counts;
  }, [rooms.data]);

  const cardValue = (statuses: RoomStatus[] | null) =>
    statuses === null
      ? (rooms.data?.items.length ?? 0)
      : statuses.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

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
      <main className="flex-1 overflow-y-auto p-6">
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
            <section
              aria-label={t("statTotal")}
              className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
            >
              {rooms.isLoading &&
                STAT_CARDS.map((card) => (
                  <Skeleton key={card.key} className="h-28 rounded-lg" />
                ))}
              {rooms.data &&
                STAT_CARDS.map((card) => {
                  const Icon = card.icon;
                  const label =
                    card.labelNs === "rooms" ? t(card.labelKey) : td(card.labelKey);
                  return (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => setGridFilter(card.filter)}
                      aria-pressed={gridFilter === card.filter}
                      className={cn(
                        "relative overflow-hidden rounded-lg p-4 text-left transition-shadow",
                        card.className,
                        gridFilter === card.filter && "ring-2 ring-gold-500 ring-offset-2",
                      )}
                    >
                      <Icon
                        className="absolute right-3 bottom-3 size-8 opacity-25"
                        aria-hidden
                      />
                      <p className="text-3xl font-semibold tabular-nums">
                        {cardValue(card.statuses)}
                      </p>
                      <p className="mt-1 text-xs font-medium tracking-wide uppercase opacity-80">
                        {label}
                      </p>
                    </button>
                  );
                })}
            </section>

            {/* View toggle + status filter chips (grid mode) */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              {/* Filter chips — shown in BOTH grid AND table views (client 9-10 row 7:
                  previously only visible in grid mode, causing inconsistency). */}
              <div className="flex flex-wrap gap-1.5">
                {GRID_FILTERS.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setGridFilter(filter)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        gridFilter === filter
                          ? "border-navy-900 bg-navy-900 font-medium text-white"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {filter === "all" ? t("filterAll") : t(`status_${filter}`)}
                    </button>
                  ))}
              </div>
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
                  rooms.data.items.every((room) => room.status !== gridFilter) && (
                    <p className="p-10 text-center text-sm text-muted-foreground">
                      {t("noRoomsInStatus", { status: t(`status_${gridFilter}`) })}
                    </p>
                  )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                  {rooms.data?.items
                    .filter((room) => gridFilter === "all" || room.status === gridFilter)
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
                        <StatusBadge tone={ROOM_STATUS_TONE[room.status]}>
                          {t(`status_${room.status}`)}
                        </StatusBadge>
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
                      .filter((room) => gridFilter === "all" || room.status === gridFilter)
                      .map((room) => (
                      <TableRow key={room.id}>
                        <TableCell className="font-medium">{room.room_number}</TableCell>
                        <TableCell>{room.floor ?? "—"}</TableCell>
                        <TableCell>{room.room_type_name}</TableCell>
                        <TableCell className="max-w-52 truncate text-muted-foreground">
                          {room.amenities.join(", ") || "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={ROOM_STATUS_TONE[room.status]}>
                            {t(`status_${room.status}`)}
                          </StatusBadge>
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
