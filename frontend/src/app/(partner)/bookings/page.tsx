"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, MoreVertical, LogIn, XCircle, UserX } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { GuestPicker } from "@/components/guests/guest-picker";
import {
  BookingStatusBadge,
  PaymentStatusBadge,
} from "@/components/stay/booking-badges";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import type { ListOut } from "@/types/hotel";
import { RoomAvailabilityPicker } from "@/components/rooms/room-availability-picker";
import type { BookingOut } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { ConfirmDialog, useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useRouter, useSearchParams } from "next/navigation";

function BookingsContent() {
  const t = useTranslations("bookings");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const ts = useTranslations("stay");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Persist filters in URL search params so refresh/back restores the view.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") ?? "");
  const [toDate, setToDate] = useState(() => searchParams.get("to") ?? "");
  // If navigated with ?new=1 (e.g. from check-in page), auto-open the dialog.
  const [autoOpen, setAutoOpen] = useState(() => searchParams.get("new") === "1");
  const autoOpenHandled = useRef(false);
  const [cancelTarget, setCancelTarget] = useState<BookingOut | null>(null);
  const cancelConfirm = useConfirmDialog();

  // Clean ?new=1 from the URL immediately so a refresh doesn't re-open the dialog.
  useEffect(() => {
    if (searchParams.get("new") === "1" && !autoOpenHandled.current) {
      autoOpenHandled.current = true;
      router.replace("/bookings", { scroll: false });
    }
  }, [searchParams, router]);

  const filterQs =
    (search ? `&q=${encodeURIComponent(search)}` : "") +
    (fromDate ? `&from_date=${fromDate}` : "") +
    (toDate ? `&to_date=${toDate}` : "");

  // Keep URL in sync with filters so refresh/share preserves state.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const qs = params.toString();
    const url = qs ? `/bookings?${qs}` : "/bookings";
    router.replace(url, { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, fromDate, toDate]);

  const bookings = useQuery({
    queryKey: ["bookings", activeHotelId, filterQs],
    queryFn: () => api<ListOut<BookingOut>>(`/api/v1/bookings?limit=50${filterQs}`),
    enabled: !!activeHotelId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
  };

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<BookingOut>(`/api/v1/bookings/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: () => {
      toast.success(t("bookingCancelled"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const noShowMutation = useMutation({
    mutationFn: (id: string) =>
      api<BookingOut>(`/api/v1/bookings/${id}/no-show`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("markedNoShow"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  const checkinMutation = useMutation({
    mutationFn: (bookingId: string) =>
      api("/api/v1/checkins", { method: "POST", body: { booking_id: bookingId } }),
    onSuccess: () => {
      toast.success(ts("checkedInToast"));
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">

          <div className="flex flex-wrap items-end gap-2">
            <Input
              placeholder={t("searchPlaceholder")}
              className="max-w-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Input
              type="date"
              className="w-40"
              aria-label={t("checkinDate")}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <Input
              type="date"
              className="w-40"
              aria-label={t("checkoutDate")}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <NewBookingDialog onCreated={invalidate} defaultOpen={autoOpen} onOpenChange={(o) => { if (!o) setAutoOpen(false); }} />

        <ConfirmDialog
          open={cancelConfirm.open}
          title={t("cancelBooking")}
          message={cancelTarget ? `${cancelTarget.booking_number} — ${cancelTarget.primary_guest_name ?? ""}` : undefined}
          requireText
          textLabel={t("cancelReason")}
          textPlaceholder={t("cancelReason")}
          confirmLabel={t("cancelBooking")}
          confirmVariant="destructive"
          isPending={cancelMutation.isPending}
          onConfirm={(reason) => {
            if (cancelTarget) {
              cancelMutation.mutate({ id: cancelTarget.id, reason });
              cancelConfirm.hide();
              setCancelTarget(null);
            }
          }}
          onCancel={() => {
            cancelConfirm.hide();
            setCancelTarget(null);
          }}
        />
        </div>

        <div className="rounded-lg border bg-card">
          {bookings.isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {bookings.isError && (
            <div className="p-8 text-center text-sm text-danger">
              {tc("error")}{" "}
              <button type="button" className="underline" onClick={() => bookings.refetch()}>
                {tc("retry")}
              </button>
            </div>
          )}
          {bookings.data && bookings.data.items.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {t("noBookings")}
            </p>
          )}
          {bookings.data && bookings.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">{t("bookingNumber")}</TableHead>
                  <TableHead className="text-white">{t("guest")}</TableHead>
                  <TableHead className="text-white">{t("roomsCol")}</TableHead>
                  <TableHead className="text-white">{t("dates")}</TableHead>
                  <TableHead className="text-white">{t("total")}</TableHead>
                  <TableHead className="text-white">{t("statusCol")}</TableHead>
                  <TableHead className="text-white">{t("payment")}</TableHead>
                  <TableHead className="text-right text-white">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.data.items.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">{booking.booking_number}</TableCell>
                    <TableCell>{booking.primary_guest_name ?? "—"}</TableCell>
                    <TableCell>
                      {booking.rooms
                        .filter((r) => r.is_current)
                        .map((r) => r.room_number)
                        .join(", ")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {booking.check_in_date} → {booking.check_out_date}
                    </TableCell>
                    <TableCell className="tabular-nums">₹{booking.total_amount}</TableCell>
                    <TableCell>
                      <BookingStatusBadge status={booking.status} />
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={booking.payment_status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {(booking.status === "pending" || booking.status === "confirmed") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                            aria-label={tc("actions")}
                          >
                            <MoreVertical className="size-4" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {booking.status === "confirmed" && (
                              <DropdownMenuItem
                                onClick={() => checkinMutation.mutate(booking.id)}
                              >
                                <LogIn className="size-4" aria-hidden />
                                {t("checkInAction")}
                              </DropdownMenuItem>
                            )}
                            {booking.status === "confirmed" && (
                              <DropdownMenuItem
                                onClick={() => noShowMutation.mutate(booking.id)}
                              >
                                <UserX className="size-4" aria-hidden />
                                {t("markNoShow")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                setCancelTarget(booking);
                                cancelConfirm.show();
                              }}
                            >
                              <XCircle className="size-4" aria-hidden />
                              {t("cancelBooking")}
                            </DropdownMenuItem>
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
      </main>
    </>
  );
}

function NewBookingDialog({
  onCreated,
  defaultOpen = false,
  onOpenChange,
}: {
  readonly onCreated: () => void;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("bookings");
  const tc = useTranslations("common");
  const api = useApi();
  const [open, setOpen] = useState(defaultOpen);
  const handleOpenChange = (v: boolean) => { setOpen(v); onOpenChange?.(v); };

  const [guest, setGuest] = useState<{ id: string; full_name: string } | null>(null);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Date state — drives the availability picker
  const [checkIn, setCheckIn] = useState(new Date().toISOString().slice(0, 10));
  const [checkOut, setCheckOut] = useState(
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );

  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const fs = (k: string, fb = "") => (form.get(k) as string | null) ?? fb;
      return api<BookingOut>("/api/v1/bookings", {
        method: "POST",
        body: {
          primary_guest_id: guest?.id,
          room_ids: selectedRooms,
          check_in_date: checkIn,
          check_out_date: checkOut,
          adults: Number(fs("adults", "1")),
          children: Number(fs("children", "0")),
          discount_amount: fs("discount_amount", "0"),
          security_deposit: fs("security_deposit", "0"),
          special_requests: fs("special_requests").trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("bookingCreated"));
      setOpen(false);
      setGuest(null);
      setSelectedRooms([]);
      setError(null);
      onCreated();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80">
        <Plus className="size-4" aria-hidden />
        {t("newBooking")}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("newBooking")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!guest?.id || selectedRooms.length === 0) {
              setError(tc("requiredField"));
              return;
            }
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          {/* Guest */}
          <div className="space-y-1.5">
            <Label>{t("guest")}</Label>
            <GuestPicker
              selected={guest?.id ? guest : null}
              onSelected={(g) => setGuest(g.id ? g : null)}
            />
          </div>

          {/* Dates — placed BEFORE room picker so availability reacts to dates */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="b-cin">{t("checkinDate")}</Label>
              <Input
                id="b-cin"
                name="check_in_date"
                type="date"
                required
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-cout">{t("checkoutDate")}</Label>
              <Input
                id="b-cout"
                name="check_out_date"
                type="date"
                required
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-adults">{t("adults")}</Label>
              <Input id="b-adults" name="adults" type="number" min={1} max={40} defaultValue={1} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-children">{t("children")}</Label>
              <Input id="b-children" name="children" type="number" min={0} max={40} defaultValue={0} />
            </div>
          </div>

          {/* Date-aware room availability picker */}
          <div className="space-y-1.5">
            <Label>{t("selectRooms")}</Label>
            <RoomAvailabilityPicker
              checkIn={checkIn}
              checkOut={checkOut}
              selectedRooms={selectedRooms}
              onSelectionChange={setSelectedRooms}
            />
          </div>

          {/* Financial */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-discount">{t("discount")}</Label>
              <Input id="b-discount" name="discount_amount" type="number" min={0} step="0.01" defaultValue={0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-deposit">{t("securityDeposit")}</Label>
              <Input id="b-deposit" name="security_deposit" type="number" min={0} step="0.01" defaultValue={0} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="b-requests">{t("specialRequests")}</Label>
              <Input id="b-requests" name="special_requests" />
            </div>
          </div>

          {error && (
            <p className="text-sm text-danger" role="alert">{error}</p>
          )}
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              {tc("cancel")}
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending || selectedRooms.length === 0}>
              {mutation.isPending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BookingsPage() {
  return (
    <RequirePermission permission={PERMISSIONS.bookingsView}>
      {/* Suspense is required by Next.js App Router for useSearchParams() */}
      <Suspense fallback={<div className="flex-1 p-6"><Skeleton className="h-10 w-full" /></div>}>
        <BookingsContent />
      </Suspense>
    </RequirePermission>
  );
}
