"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MoreVertical,
  ArrowLeftRight,
  LogOut,
  Eye,
  Pencil,
  Printer,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { PaymentStatusBadge } from "@/components/stay/booking-badges";
import { StatusBadge } from "@/components/feedback/status-badge";
import { fmtDateTime, fmtDate, fmtApiDate, fmtINR } from "@/lib/formatting";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { ApiError } from "@/lib/api/client";
import type { ListOut, RoomOut } from "@/types/hotel";
import type { BookingOut, CurrentGuestOut } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";

/** `DD/MM/YYYY` plus `, HH:MM` when a time is present (no dangling comma). */
function fmtApiDateTime(date: string, time?: string | null): string {
  return time ? `${fmtApiDate(date)}, ${time}` : fmtApiDate(date);
}

/**
 * Whether the expected checkout moment (local time) is already past.
 * Missing time falls back to 23:59 so guests aren't flagged early.
 */
function isCheckoutOverdue(date: string, time?: string | null): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "23:59").split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime() < Date.now();
}

/** Day use (same check-in/out date) with both times known. */
function isDayUseWithTimes(b: BookingOut): boolean {
  return (
    b.check_in_date === b.check_out_date && !!b.check_in_time && !!b.check_out_time
  );
}

function CurrentGuestsContent() {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  const [search, setSearch] = useState("");
  const router = useRouter();
  const [transferTarget, setTransferTarget] = useState<CurrentGuestOut | null>(null);
  const [viewTarget, setViewTarget] = useState<CurrentGuestOut | null>(null);
  const [editTarget, setEditTarget] = useState<CurrentGuestOut | null>(null);

  const guests = useQuery({
    queryKey: ["current-guests", activeHotelId, search],
    queryFn: () =>
      api<ListOut<CurrentGuestOut>>(
        `/api/v1/current-guests?limit=50${search ? `&q=${encodeURIComponent(search)}` : ""}`,
      ),
    enabled: !!activeHotelId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

  return (
    <>
      <PartnerHeader title={t("currentGuestsTitle")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4">
          <Input
            placeholder={tb("searchPlaceholder")}
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="rounded-lg border bg-card">
          {guests.isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {guests.isError && (
            <div className="p-8 text-center text-sm text-danger">
              {tc("error")}{" "}
              <button className="underline" onClick={() => guests.refetch()}>
                {tc("retry")}
              </button>
            </div>
          )}
          {guests.data && guests.data.items.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {t("noCurrentGuests")}
            </p>
          )}
          {guests.data && guests.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">{tb("bookingNumber")}</TableHead>
                  <TableHead className="text-white">{tb("guest")}</TableHead>
                  <TableHead className="text-white">{tb("roomsCol")}</TableHead>
                  <TableHead className="text-white">{t("checkedInAt")}</TableHead>
                  <TableHead className="text-white">{t("expectedCheckout")}</TableHead>
                  <TableHead className="text-white">{tb("payment")}</TableHead>
                  <TableHead className="text-white">{tb("due")}</TableHead>
                  <TableHead className="text-right text-white">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guests.data.items.map((entry) => (
                  <TableRow key={entry.booking_id}>
                    <TableCell className="font-medium">{entry.booking_number}</TableCell>
                    <TableCell>
                      <span className="font-medium">{entry.primary_guest_name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {entry.primary_guest_phone_masked}
                      </span>
                      {entry.guest_count > 1 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          +{entry.guest_count - 1}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {entry.rooms.map((room) => (
                        <span
                          key={room}
                          className="mr-1 inline-flex rounded-full bg-info-bg px-2 py-0.5 text-xs font-medium text-info"
                        >
                          {room}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                      {fmtDateTime(entry.checked_in_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                      {fmtDate(entry.check_out_date)}
                      {entry.check_out_time ? `, ${entry.check_out_time}` : ""}
                      {isCheckoutOverdue(entry.check_out_date, entry.check_out_time) && (
                        <StatusBadge tone="danger" className="ml-2">
                          {t("overdue")}
                        </StatusBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={entry.payment_status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{fmtINR(entry.due_amount)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                          aria-label={tc("actions")}
                        >
                          <MoreVertical className="size-4" aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewTarget(entry)}>
                            <Eye className="size-4" aria-hidden />
                            {tc("view")}
                          </DropdownMenuItem>
                          {can(PERMISSIONS.bookingsManage) && (
                            <DropdownMenuItem onClick={() => setEditTarget(entry)}>
                              <Pencil className="size-4" aria-hidden />
                              {t("editStay")}
                            </DropdownMenuItem>
                          )}
                          {can(PERMISSIONS.roomTransfer) && (
                            <DropdownMenuItem onClick={() => setTransferTarget(entry)}>
                              <ArrowLeftRight className="size-4" aria-hidden />
                              {t("roomTransfer")}
                            </DropdownMenuItem>
                          )}
                          {can(PERMISSIONS.checkout) && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                router.push(`/checkout?booking=${entry.booking_id}`)
                              }
                            >
                              <LogOut className="size-4" aria-hidden />
                              {t("checkOutAction")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <StayDetailDialog entry={viewTarget} onClose={() => setViewTarget(null)} />
        <EditStayDialog
          entry={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={invalidate}
        />
        <TransferDialog
          entry={transferTarget}
          onClose={() => setTransferTarget(null)}
          onDone={invalidate}
        />
      </main>
    </>
  );
}

function StayDetailDialog({
  entry,
  onClose,
}: {
  entry: CurrentGuestOut | null;
  onClose: () => void;
}) {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tc = useTranslations("common");
  const api = useApi();

  const booking = useQuery({
    queryKey: ["booking", entry?.booking_id, "detail"],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${entry?.booking_id}`),
    enabled: !!entry,
  });

  const printRegistration = () => {
    const b = booking.data;
    if (!b || !entry) return;
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    const rooms = b.rooms
      .filter((r) => r.is_current)
      .map((r) => `${r.room_number} (${r.room_type_name})`)
      .join(", ");
    win.document.write(`<!doctype html><html><head><title>${b.booking_number}</title>
      <style>
        body{font-family:Georgia,serif;margin:40px;color:#111}
        h1{font-size:20px;border-bottom:2px solid #0a1128;padding-bottom:8px}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        td{padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px}
        td:first-child{color:#666;width:220px}
        .sign{margin-top:60px;display:flex;justify-content:space-between}
        .sign div{border-top:1px solid #333;padding-top:6px;width:200px;text-align:center;font-size:12px}
      </style></head><body>
      <h1>${t("registrationCard")} — ${b.booking_number}</h1>
      <table>
        <tr><td>${tb("guest")}</td><td>${b.primary_guest_name ?? ""}</td></tr>
        <tr><td>${tb("roomsCol")}</td><td>${rooms}</td></tr>
        ${
          isDayUseWithTimes(b)
            ? `<tr><td>${tb("dates")}</td><td>${fmtApiDate(b.check_in_date)}, ${b.check_in_time} – ${b.check_out_time}</td></tr>`
            : `<tr><td>${tb("checkinDate")}</td><td>${fmtApiDateTime(b.check_in_date, b.check_in_time)}</td></tr>
        <tr><td>${tb("checkoutDate")}</td><td>${fmtApiDateTime(b.check_out_date, b.check_out_time)}</td></tr>`
        }
        <tr><td>${tb("adults")} / ${tb("children")}</td><td>${b.adults} / ${b.children}</td></tr>
        <tr><td>${tb("total")}</td><td>${fmtINR(b.total_amount)}</td></tr>
        <tr><td>${tb("due")}</td><td>${fmtINR(b.due_amount)}</td></tr>
        ${b.emergency_contact_name ? `<tr><td>${t("emergencyContact")}</td><td>${b.emergency_contact_name} (${b.emergency_contact_relation ?? ""}) ${b.emergency_contact_phone ?? ""}</td></tr>` : ""}
        ${b.vehicle_number ? `<tr><td>${t("vehicleDetails")}</td><td>${b.vehicle_number} · ${b.vehicle_type ?? ""} · ${b.parking_slot ?? ""}</td></tr>` : ""}
        ${b.special_requests ? `<tr><td>${tb("specialRequests")}</td><td>${b.special_requests}</td></tr>` : ""}
      </table>
      <div class="sign"><div>${t("guestSignature")}</div><div>${t("frontDeskSignature")}</div></div>
      <script>window.print()</script></body></html>`);
    win.document.close();
  };

  const b = booking.data;

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("stayDetails")} — {entry?.booking_number}
          </DialogTitle>
        </DialogHeader>
        {booking.isLoading && <Skeleton className="h-48" />}
        {b && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Detail label={tb("guest")} value={b.primary_guest_name ?? "—"} />
            <Detail
              label={tb("roomsCol")}
              value={b.rooms
                .filter((r) => r.is_current)
                .map((r) => r.room_number)
                .join(", ")}
            />
            {isDayUseWithTimes(b) ? (
              <Detail
                label={tb("dates")}
                value={`${fmtApiDate(b.check_in_date)}, ${b.check_in_time} – ${b.check_out_time}`}
                badge={
                  isCheckoutOverdue(b.check_out_date, b.check_out_time) ? (
                    <StatusBadge tone="danger">{t("overdue")}</StatusBadge>
                  ) : null
                }
              />
            ) : (
              <>
                <Detail
                  label={tb("checkinDate")}
                  value={fmtApiDateTime(b.check_in_date, b.check_in_time)}
                />
                <Detail
                  label={tb("checkoutDate")}
                  value={fmtApiDateTime(b.check_out_date, b.check_out_time)}
                  badge={
                    isCheckoutOverdue(b.check_out_date, b.check_out_time) ? (
                      <StatusBadge tone="danger">{t("overdue")}</StatusBadge>
                    ) : null
                  }
                />
              </>
            )}
            <Detail label={`${tb("adults")} / ${tb("children")}`} value={`${b.adults} / ${b.children}`} />
            <Detail label={tb("payment")} value={b.payment_status} />
            <Detail label={tb("total")} value={fmtINR(b.total_amount)} />
            <Detail label={tb("due")} value={fmtINR(b.due_amount)} />
            {b.security_deposit !== "0.00" && (
              <Detail label={tb("securityDeposit")} value={fmtINR(b.security_deposit)} />
            )}
            {b.emergency_contact_name && (
              <Detail
                label={t("emergencyContact")}
                value={`${b.emergency_contact_name} · ${b.emergency_contact_phone ?? ""}`}
              />
            )}
            {b.vehicle_number && (
              <Detail
                label={t("vehicleDetails")}
                value={`${b.vehicle_number} · ${b.parking_slot ?? ""}`}
              />
            )}
            {b.special_requests && (
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {tb("specialRequests")}
                </dt>
                <dd className="mt-0.5">{b.special_requests}</dd>
              </div>
            )}
          </dl>
        )}
        <DialogFooter>
          <DialogClose className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {tc("cancel")}
          </DialogClose>
          <Button onClick={printRegistration} disabled={!b}>
            <Printer className="size-4" aria-hidden />
            {t("printRegistration")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">
        {value}
        {badge && <span className="ml-2 inline-flex align-middle">{badge}</span>}
      </dd>
    </div>
  );
}

function EditStayDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: CurrentGuestOut | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("stay");
  const api = useApi();

  const booking = useQuery({
    queryKey: ["booking", entry?.booking_id, "detail"],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${entry?.booking_id}`),
    enabled: !!entry,
  });

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("editStayTitle")} — {entry?.booking_number}
          </DialogTitle>
        </DialogHeader>
        {booking.isLoading && <Skeleton className="h-64" />}
        {booking.data && entry && (
          <EditStayForm
            key={entry.booking_id}
            bookingId={entry.booking_id}
            booking={booking.data}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditStayForm({
  bookingId,
  booking,
  onClose,
  onDone,
}: {
  bookingId: string;
  booking: BookingOut;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tc = useTranslations("common");
  const api = useApi();

  const [checkOutDate, setCheckOutDate] = useState(booking.check_out_date);
  const [checkOutTime, setCheckOutTime] = useState(booking.check_out_time ?? "");
  const [adults, setAdults] = useState(String(booking.adults));
  const [children, setChildren] = useState(String(booking.children));
  const [specialRequests, setSpecialRequests] = useState(
    booking.special_requests ?? "",
  );

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api(`/api/v1/bookings/${bookingId}`, { method: "PATCH", body: patch }),
    onSuccess: () => {
      toast.success(t("stayUpdatedToast"));
      onClose();
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    if (checkOutDate !== booking.check_out_date) {
      patch.check_out_date = checkOutDate;
    }
    if (checkOutTime && checkOutTime !== (booking.check_out_time ?? "")) {
      patch.check_out_time = checkOutTime;
    }
    const nAdults = Number(adults);
    const nChildren = Number(children);
    if (Number.isInteger(nAdults) && nAdults >= 1 && nAdults !== booking.adults) {
      patch.adults = nAdults;
    }
    if (
      Number.isInteger(nChildren) &&
      nChildren >= 0 &&
      nChildren !== booking.children
    ) {
      patch.children = nChildren;
    }
    const requests = specialRequests.trim();
    if (requests !== (booking.special_requests ?? "")) {
      patch.special_requests = requests || null;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    mutation.mutate(patch);
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Check-in is read-only: the guest is already in-house. */}
        <div className="space-y-1.5">
          <Label>{tb("checkinDate")}</Label>
          <p className="flex h-9 items-center rounded-lg border border-input bg-muted px-2.5 text-sm text-muted-foreground">
            {fmtApiDateTime(booking.check_in_date, booking.check_in_time)}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-checkout">{tb("checkoutDate")}</Label>
          <DateTimePicker
            id="es-checkout"
            dateValue={checkOutDate}
            timeValue={checkOutTime}
            onDateChange={setCheckOutDate}
            onTimeChange={setCheckOutTime}
            min={booking.check_in_date}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-adults">{tb("adults")}</Label>
          <Input
            id="es-adults"
            type="number"
            min={1}
            required
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-children">{tb("children")}</Label>
          <Input
            id="es-children"
            type="number"
            min={0}
            required
            value={children}
            onChange={(e) => setChildren(e.target.value)}
          />
        </div>
        <div className="col-span-full space-y-1.5">
          <Label htmlFor="es-requests">{tb("specialRequests")}</Label>
          <Textarea
            id="es-requests"
            maxLength={2000}
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
          {tc("cancel")}
        </DialogClose>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? tc("saving") : tc("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TransferDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: CurrentGuestOut | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("stay");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const booking = useQuery({
    queryKey: ["booking", entry?.booking_id],
    queryFn: () => api<BookingOut>(`/api/v1/bookings/${entry?.booking_id}`),
    enabled: !!entry,
  });
  const rooms = useQuery({
    queryKey: ["rooms", activeHotelId, "for-transfer"],
    queryFn: () => api<ListOut<RoomOut>>("/api/v1/rooms?limit=200"),
    enabled: !!entry,
  });

  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      api("/api/v1/room-transfers", {
        method: "POST",
        body: {
          booking_id: entry?.booking_id,
          from_room_id: String(form.get("from_room_id")),
          to_room_id: String(form.get("to_room_id")),
          reason: String(form.get("reason") || "").trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("transferredToast"));
      setError(null);
      onClose();
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  const currentRooms = (booking.data?.rooms ?? []).filter((r) => r.is_current);
  const targetRooms = (rooms.data?.items ?? []).filter((room) =>
    ["available", "clean_ready"].includes(room.status),
  );

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("roomTransfer")} — {entry?.booking_number}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tr-from">{t("fromRoom")}</Label>
              <select
                id="tr-from"
                name="from_room_id"
                required
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                {currentRooms.map((room) => (
                  <option key={room.room_id} value={room.room_id}>
                    {room.room_number} — {room.room_type_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-to">{t("toRoom")}</Label>
              <select
                id="tr-to"
                name="to_room_id"
                required
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">—</option>
                {targetRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.room_number} — {room.room_type_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-full space-y-1.5">
              <Label htmlFor="tr-reason">{t("transferReason")}</Label>
              <Input id="tr-reason" name="reason" />
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
              {mutation.isPending ? tc("saving") : tc("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CurrentGuestsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.guestsView}>
      <CurrentGuestsContent />
    </RequirePermission>
  );
}
