"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, MoreHorizontal, MoreVertical, LayoutGrid, List } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import type { ListOut, RoomOut, RoomStatus, RoomTypeOut } from "@/types/hotel";
import { RequirePermission } from "@/components/auth/require-permission";

const GRID_FILTERS: Array<RoomStatus | "all"> = [
  "all",
  "available",
  "reserved",
  "occupied",
  "cleaning_required",
  "maintenance",
];

/** Statuses offered from the grid-tile "..." menu (per Figma: Available / Cleaning / Maintenance). */
const TILE_STATUSES: RoomStatus[] = ["available", "cleaning_required", "maintenance"];

/** Rooms in these statuses must not be changed manually from the tile menu. */
const LOCKED_STATUSES: RoomStatus[] = ["occupied", "reserved"];

const MANUAL_STATUSES: RoomStatus[] = [
  "available",
  "cleaning_required",
  "cleaning_in_progress",
  "clean_ready",
  "inspection_required",
  "maintenance",
  "out_of_service",
];

function RoomsContent() {
  const t = useTranslations("rooms");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  const [view, setView] = useState<"grid" | "table">("grid");
  const [gridFilter, setGridFilter] = useState<RoomStatus | "all">("all");

  const rooms = useQuery({
    queryKey: ["rooms", activeHotelId],
    queryFn: () => api<ListOut<RoomOut>>("/api/v1/rooms?limit=200"),
    enabled: !!activeHotelId,
  });
  const types = useQuery({
    queryKey: ["room-types", activeHotelId],
    queryFn: () => api<ListOut<RoomTypeOut>>("/api/v1/rooms/types?include_inactive=true"),
    enabled: !!activeHotelId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-types", activeHotelId] });
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
        <Tabs defaultValue="rooms">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="rooms">{t("roomsTab")}</TabsTrigger>
              <TabsTrigger value="types">{t("typesTab")}</TabsTrigger>
            </TabsList>
            {can(PERMISSIONS.roomsManage) && (
              <div className="flex gap-2">
                <CreateRoomTypeDialog onCreated={invalidate} />
                <CreateRoomDialog types={types.data?.items ?? []} onCreated={invalidate} />
              </div>
            )}
          </div>

          <TabsContent value="rooms" className="mt-4">
            {/* View toggle + status filter chips (grid mode) */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {view === "grid" &&
                  GRID_FILTERS.map((filter) => (
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
                          {can(PERMISSIONS.roomsUpdateStatus) &&
                            !LOCKED_STATUSES.includes(room.status) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className="-mr-1 -mt-1 flex size-6 items-center justify-center rounded hover:bg-muted"
                                  aria-label={t("changeStatus")}
                                >
                                  <MoreHorizontal className="size-3.5" aria-hidden />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>{t("changeStatus")}</DropdownMenuLabel>
                                  {TILE_STATUSES.filter((s) => s !== room.status).map(
                                    (status) => (
                                      <DropdownMenuItem
                                        key={status}
                                        onClick={() =>
                                          statusMutation.mutate({ roomId: room.id, status })
                                        }
                                      >
                                        {t(`status_${status}`)}
                                      </DropdownMenuItem>
                                    ),
                                  )}
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
                    {rooms.data.items.map((room) => (
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
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>{t("changeStatus")}</DropdownMenuLabel>
                                {MANUAL_STATUSES.filter((s) => s !== room.status).map(
                                  (status) => (
                                    <DropdownMenuItem
                                      key={status}
                                      onClick={() =>
                                        statusMutation.mutate({ roomId: room.id, status })
                                      }
                                    >
                                      {t(`status_${status}`)}
                                    </DropdownMenuItem>
                                  ),
                                )}
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
          </TabsContent>

          <TabsContent value="types" className="mt-4">
            <div className="rounded-lg border bg-card">
              {types.isLoading && <TableSkeleton rows={3} />}
              {types.isError && <ErrorRow onRetry={() => types.refetch()} />}
              {types.data && types.data.items.length === 0 && (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  {t("noTypes")}
                </p>
              )}
              {types.data && types.data.items.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-navy-900 hover:bg-navy-900">
                      <TableHead className="text-white">{t("typeCode")}</TableHead>
                      <TableHead className="text-white">{t("typeName")}</TableHead>
                      <TableHead className="text-white">{t("basePrice")}</TableHead>
                      <TableHead className="text-white">{t("extraGuestPrice")}</TableHead>
                      <TableHead className="text-white">{t("maxOccupancy")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {types.data.items.map((type) => (
                      <TableRow key={type.id}>
                        <TableCell className="font-mono text-xs">{type.code}</TableCell>
                        <TableCell className="font-medium">{type.name}</TableCell>
                        <TableCell>₹{type.base_price}</TableCell>
                        <TableCell>₹{type.extra_guest_price}</TableCell>
                        <TableCell>{type.max_occupancy}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>
        </Tabs>
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

function CreateRoomTypeDialog({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations("rooms");
  const tc = useTranslations("common");
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      api<RoomTypeOut>("/api/v1/rooms/types", {
        method: "POST",
        body: {
          code: String(form.get("code")).trim().toUpperCase(),
          name: String(form.get("name")).trim(),
          base_price: String(form.get("base_price")),
          extra_guest_price: String(form.get("extra_guest_price") || "0"),
          max_occupancy: Number(form.get("max_occupancy") || 2),
        },
      }),
    onSuccess: () => {
      toast.success(t("typeCreated"));
      setOpen(false);
      setError(null);
      onCreated();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
      >
        <Plus className="size-4" aria-hidden />
        {t("addRoomType")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addRoomType")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rt-code">{t("typeCode")}</Label>
              <Input id="rt-code" name="code" required maxLength={64} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-name">{t("typeName")}</Label>
              <Input id="rt-name" name="name" required maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-price">{t("basePrice")}</Label>
              <Input id="rt-price" name="base_price" type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-extra">{t("extraGuestPrice")}</Label>
              <Input id="rt-extra" name="extra_guest_price" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-occ">{t("maxOccupancy")}</Label>
              <Input id="rt-occ" name="max_occupancy" type="number" min="1" max="20" defaultValue={2} />
            </div>
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              {tc("cancel")}
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateRoomDialog({
  types,
  onCreated,
}: {
  types: RoomTypeOut[];
  onCreated: () => void;
}) {
  const t = useTranslations("rooms");
  const tc = useTranslations("common");
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      api<RoomOut>("/api/v1/rooms", {
        method: "POST",
        body: {
          room_number: String(form.get("room_number")).trim(),
          floor: String(form.get("floor") || "").trim() || null,
          room_type_id: String(form.get("room_type_id")),
          amenities: String(form.get("amenities") || "")
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success(t("roomCreated"));
      setOpen(false);
      setError(null);
      onCreated();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80">
        <Plus className="size-4" aria-hidden />
        {t("addRoom")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addRoom")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-number">{t("roomNumber")}</Label>
              <Input id="r-number" name="room_number" required maxLength={32} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-floor">{t("floor")}</Label>
              <Input id="r-floor" name="floor" maxLength={32} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="r-type">{t("roomType")}</Label>
              <select
                id="r-type"
                name="room_type_id"
                required
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">—</option>
                {types
                  .filter((type) => type.is_active)
                  .map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name} (₹{type.base_price})
                    </option>
                  ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="r-amenities">{t("amenities")}</Label>
              <Input id="r-amenities" name="amenities" placeholder="AC, WiFi, TV" />
            </div>
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              {tc("cancel")}
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function RoomsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.roomsView}>
      <RoomsContent />
    </RequirePermission>
  );
}
