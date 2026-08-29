"use client";

/**
 * Guest Check-in — full-page form matching the Figma reference.
 *
 * Two-stage layout:
 *  1. Booking selection list (confirmed bookings ready for check-in).
 *  2. Full-page check-in form (shown inline, NOT a popup) when a booking
 *     is selected. Matches the Figma: Booking Details, Primary Guest
 *     Identity Verification, Additional Guests, Room Information,
 *     Special Requirements, Payment Details, Emergency Contact,
 *     Vehicle Details.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogIn,
  Plus,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ClipboardList,
  CreditCard,
  Users,
  Building2,
  Star,
  AlertTriangle,
  Car,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GuestPicker } from "@/components/guests/guest-picker";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, apiUpload } from "@/lib/api/client";
import { compressDocument } from "@/lib/compress-image";
import { cn } from "@/lib/utils";
import type { ListOut } from "@/types/hotel";
import type { BookingOut } from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

interface CoGuest {
  id: string;
  full_name: string;
}

interface ServiceItem {
  id: string;
  name: string;
  price: string;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Collapsible section wrapper matching Figma accordion sections
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
  defaultOpen = true,
}: {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly subtitle?: string;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-4"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="text-left">
            <p className="font-semibold text-sm">{title}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open && <div className="section-open border-t px-5 py-5">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ID document upload tile
// ---------------------------------------------------------------------------

function DocumentUpload({
  guestId,
  side,
  label,
}: {
  readonly guestId: string | null;
  readonly side: "front" | "back" | "selfie";
  readonly label: string;
}) {
  const tc = useTranslations("common");
  const { activeHotelId } = useAuth();
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file || !guestId) return;
    setBusy(true);
    try {
      const compressed = await compressDocument(file);
      const form = new FormData();
      form.append("side", side);
      form.append("document_type", "id_proof");
      form.append("file", compressed);
      await apiUpload(`/api/v1/guests/${guestId}/documents`, form, {
        hotelId: activeHotelId ?? undefined,
      });
      setUploaded(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed p-4 text-center text-xs",
        uploaded
          ? "border-success bg-success-bg text-success"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      <Upload className="size-5" aria-hidden />
      <span>{busy ? tc("saving") : (uploaded ? tc("saved") : label)}</span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={!guestId || busy}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Full check-in form (full page, not a dialog)
// ---------------------------------------------------------------------------

function CheckinForm({
  booking,
  onBack,
  onDone,
}: {
  readonly booking: BookingOut;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tc = useTranslations("common");
  const tm = useTranslations("money");
  const api = useApi();
  const { activeHotelId } = useAuth();
  const [coGuests, setCoGuests] = useState<CoGuest[]>([]);
  const [addingCoGuest, setAddingCoGuest] = useState(false);
  const [isEarly, setIsEarly] = useState(false);
  const [terms, setTerms] = useState(false);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const services = useQuery({
    queryKey: ["hotel-services", activeHotelId],
    queryFn: () => api<ServiceItem[]>("/api/v1/hotels/me/services"),
    enabled: !!activeHotelId,
  });

  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const fs = (k: string, fb = "") => (form.get(k) as string | null) ?? fb;
      const emergencyName = fs("em_name").trim();
      const vehicleNumber = fs("veh_number").trim();
      if (emergencyName || vehicleNumber) {
        await api(`/api/v1/bookings/${booking.id}`, {
          method: "PATCH",
          body: {
            emergency_contact_name: emergencyName || null,
            emergency_contact_relation: fs("em_relation").trim() || null,
            emergency_contact_phone: fs("em_phone").trim() || null,
            vehicle_number: vehicleNumber || null,
            vehicle_type: fs("veh_type").trim() || null,
            parking_slot: fs("veh_slot").trim() || null,
          },
        });
      }
      const out = await api<{ registration_numbers: string[] }>(
        "/api/v1/checkins",
        {
          method: "POST",
          body: {
            booking_id: booking.id,
            co_guests: coGuests.map((g) => ({ guest_id: g.id })),
            purpose_of_visit: fs("purpose").trim() || null,
            company_name: fs("company").trim() || null,
            is_early: form.get("is_early") === "on",
            early_fee: fs("early_fee", "0"),
            notes: fs("notes").trim() || null,
            terms_acknowledged: terms,
          },
        },
      );
      const chosen = (services.data ?? []).filter((s) =>
        selectedServices.includes(s.id),
      );
      for (const service of chosen) {
        await api("/api/v1/charges", {
          method: "POST",
          body: {
            booking_id: booking.id,
            category: "other",
            description: service.name,
            quantity: 1,
            rate: service.price,
          },
        });
      }
      return out;
    },
    onSuccess: (out) => {
      toast.success(
        `${t("checkedInToast")} — ${t("registrationNumbers")}: ${out.registration_numbers.join(", ")}`,
      );
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  const toggleService = (id: string) =>
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  const currentRooms = booking.rooms
    .filter((r) => r.is_current)
    .map((r) => r.room_number)
    .join(", ");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate(new FormData(e.currentTarget));
      }}
    >
      {/* Back button */}
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("backToList")}
      </button>

      {/* 1. Booking Details */}
      <Section icon={ClipboardList} title={t("bookingDetailsTitle")} subtitle={t("bookingDetailsSubtitle")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs text-muted-foreground">{tb("bookingNumber")}</Label>
            <p className="mt-1 font-semibold">{booking.booking_number}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tb("checkinDate")}</Label>
            <p className="mt-1">{booking.check_in_date}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tb("checkoutDate")}</Label>
            <p className="mt-1">{booking.check_out_date}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tb("roomsCol")}</Label>
            <p className="mt-1">{currentRooms}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tb("adults")}</Label>
            <p className="mt-1">{booking.adults}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tb("children")}</Label>
            <p className="mt-1">{booking.children}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tb("total")}</Label>
            <p className="mt-1 tabular-nums">₹{booking.total_amount}</p>
          </div>
          {booking.special_requests && (
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground">{tb("specialRequests")}</Label>
              <p className="mt-1 text-sm">{booking.special_requests}</p>
            </div>
          )}
        </div>
      </Section>

      {/* 2. Primary Guest Identity Verification */}
      <Section
        icon={Users}
        title={t("primaryGuestTitle")}
        subtitle={t("primaryGuestSubtitle")}
      >
        <div className="space-y-4">
          <div>
            <p className="font-medium">{booking.primary_guest_name}</p>
            <p className="text-sm text-muted-foreground">
              {booking.primary_guest_phone}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              {t("idDocuments")}
            </Label>
            <div className="grid grid-cols-3 gap-3">
              <DocumentUpload
                guestId={booking.primary_guest_id ?? null}
                side="front"
                label={t("uploadFront")}
              />
              <DocumentUpload
                guestId={booking.primary_guest_id ?? null}
                side="back"
                label={t("uploadBack")}
              />
              <DocumentUpload
                guestId={booking.primary_guest_id ?? null}
                side="selfie"
                label={t("uploadSelfie")}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* 3. Additional Guests / Co-guests */}
      <Section icon={Users} title={t("coGuests")}>
        <div className="space-y-3">
          {coGuests.map((guest) => (
            <div
              key={guest.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{guest.full_name}</span>
              <button
                type="button"
                className="ml-auto text-danger"
                aria-label={tc("delete")}
                onClick={() =>
                  setCoGuests((prev) => prev.filter((g) => g.id !== guest.id))
                }
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))}
          {addingCoGuest ? (
            <GuestPicker
              onSelected={(g) => {
                if (g.id) {
                  setCoGuests((prev) =>
                    prev.some((x) => x.id === g.id) ? prev : [...prev, g],
                  );
                  setAddingCoGuest(false);
                }
              }}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddingCoGuest(true)}
            >
              <Plus className="size-4" aria-hidden />
              {t("addCoGuest")}
            </Button>
          )}
        </div>
      </Section>

      {/* 4. Purpose of Visit */}
      <Section icon={Building2} title={t("purposeOfVisit")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ci-purpose">{t("purposeOfVisit")}</Label>
            <select
              id="ci-purpose"
              name="purpose"
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="">—</option>
              <option value="Business">Business</option>
              <option value="Leisure">Leisure / Tourism</option>
              <option value="Medical">Medical</option>
              <option value="Wedding">Wedding / Event</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-company">{t("companyName")}</Label>
            <Input id="ci-company" name="company" />
          </div>
        </div>
      </Section>

      {/* 5. Special Requirements */}
      {(services.data?.length ?? 0) > 0 && (
        <Section icon={Star} title={t("specialRequirements")}>
          <div className="flex flex-wrap gap-2">
            {services.data?.map((service) => {
              const active = selectedServices.includes(service.id);
              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => toggleService(service.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "border-gold-500 bg-gold-500/15 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {service.name}
                  <span className="ml-1 text-xs opacity-70">
                    ₹{service.price}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* 6. Payment Details */}
      <Section icon={CreditCard} title={t("paymentDetails")}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <Label className="text-xs text-muted-foreground">{t("roomRent")}</Label>
            <p className="mt-1 tabular-nums font-medium">₹{booking.total_amount}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("advancePaid")}</Label>
            <p className="mt-1 tabular-nums">₹{booking.advance_amount}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("deposit")}</Label>
            <p className="mt-1 tabular-nums">₹{booking.security_deposit}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tb("due")}</Label>
            <p className="mt-1 tabular-nums font-semibold text-gold-600">
              ₹{booking.due_amount}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tm("method")}</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("payAtProperty")}
            </p>
          </div>
        </div>
      </Section>

      {/* 7. Emergency Contact */}
      <Section icon={AlertTriangle} title={t("emergencyContact")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="em-name">{t("contactName")}</Label>
            <Input
              id="em-name"
              name="em_name"
              defaultValue={booking.emergency_contact_name ?? ""}
              placeholder={t("contactName")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-relation">{t("contactRelation")}</Label>
            <Input
              id="em-relation"
              name="em_relation"
              defaultValue={booking.emergency_contact_relation ?? ""}
              placeholder={t("contactRelation")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-phone">{t("contactPhone")}</Label>
            <Input
              id="em-phone"
              name="em_phone"
              defaultValue={booking.emergency_contact_phone ?? ""}
              placeholder={t("contactPhone")}
              inputMode="tel"
            />
          </div>
        </div>
      </Section>

      {/* 8. Vehicle Details */}
      <Section icon={Car} title={t("vehicleDetails")} defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="veh-number">{t("vehicleNumber")}</Label>
            <Input
              id="veh-number"
              name="veh_number"
              defaultValue={booking.vehicle_number ?? ""}
              placeholder={t("vehicleNumber")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="veh-type">{t("vehicleType")}</Label>
            <select
              id="veh-type"
              name="veh_type"
              defaultValue={booking.vehicle_type ?? ""}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="">—</option>
              <option value="Car">Car</option>
              <option value="Bike">Bike</option>
              <option value="Auto">Auto / Rickshaw</option>
              <option value="Taxi">Taxi / Cab</option>
              <option value="Bus">Bus</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="veh-slot">{t("parkingSlot")}</Label>
            <Input
              id="veh-slot"
              name="veh_slot"
              defaultValue={booking.parking_slot ?? ""}
              placeholder={t("parkingSlot")}
            />
          </div>
        </div>
      </Section>

      {/* 9. Early check-in */}
      <Section icon={Clock} title={t("earlyCheckinSection")} defaultOpen={false}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              id="ci-early"
              name="is_early"
              type="checkbox"
              className="size-4 rounded border-input"
              checked={isEarly}
              onChange={(e) => setIsEarly(e.target.checked)}
            />
            <Label htmlFor="ci-early">{t("earlyCheckin")}</Label>
          </div>
          {isEarly && (
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="ci-earlyfee">{t("earlyFee")} (₹)</Label>
              <Input
                id="ci-earlyfee"
                name="early_fee"
                type="number"
                min={0}
                step="0.01"
                defaultValue={0}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ci-notes">{t("notes")}</Label>
            <Input id="ci-notes" name="notes" />
          </div>
        </div>
      </Section>

      {/* Terms & actions */}
      <div className="rounded-lg border bg-card px-5 py-4 space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
          />
          {t("termsAgreement")}
        </label>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" onClick={onBack}>
            {tc("cancel")}
          </Button>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="outline"
              name="save_draft"
              disabled={mutation.isPending}
            >
              {t("saveDraft")}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !terms}
              className="bg-gold-500 text-navy-900 hover:bg-gold-400"
            >
              {mutation.isPending ? tc("saving") : t("checkInNow")}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const CHECKIN_SESSION_KEY = "dmh.checkin.selectedBookingId";

function CheckinContent() {
  const t = useTranslations("stay");
  const tb = useTranslations("bookings");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();
  const [selectedBooking, setSelectedBooking] = useState<BookingOut | null>(null);
  // Restore pending check-in after page refresh.
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(CHECKIN_SESSION_KEY);
    }
    return null;
  });

  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const bookings = useQuery({
    queryKey: ["bookings", activeHotelId, "confirmed", page],
    queryFn: () =>
      api<ListOut<BookingOut>>(
        `/api/v1/bookings?status=confirmed&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      ),
    enabled: !!activeHotelId,
  });

  // When the confirmed bookings load, restore the selected booking from session.
  useEffect(() => {
    if (!pendingBookingId || !bookings.data) return;
    const match = bookings.data.items.find((b) => b.id === pendingBookingId);
    if (match) {
      setSelectedBooking(match);
    }
    setPendingBookingId(null);
    sessionStorage.removeItem(CHECKIN_SESSION_KEY);
  }, [pendingBookingId, bookings.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
    queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
  };

  if (selectedBooking) {
    return (
      <>
        <PartnerHeader title={t("checkinTitle")} subtitle={tn("frontDesk")} />
        <main className="flex-1 overflow-y-auto p-6">
          <CheckinForm
            booking={selectedBooking}
            onBack={() => {
              sessionStorage.removeItem(CHECKIN_SESSION_KEY);
              setSelectedBooking(null);
            }}
            onDone={() => {
              sessionStorage.removeItem(CHECKIN_SESSION_KEY);
              setSelectedBooking(null);
              invalidate();
            }}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <PartnerHeader title={t("checkinTitle")} subtitle={tn("frontDesk")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {t("readyForCheckin")}
          </h2>
          {/* ?new=1 tells the bookings page to auto-open the dialog immediately */}
          <Link
            href="/bookings?new=1"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Plus className="size-4" aria-hidden />
            {tb("newBooking")}
          </Link>
        </div>

        <div className="rounded-lg border bg-card">
          {bookings.isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
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
          {bookings.data && bookings.data.items.length === 0 && page === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {t("noCheckinReady")}
            </p>
          )}
          {bookings.data && bookings.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">{tb("bookingNumber")}</TableHead>
                  <TableHead className="text-white">{tb("guest")}</TableHead>
                  <TableHead className="text-white">{tb("roomsCol")}</TableHead>
                  <TableHead className="text-white">{tb("dates")}</TableHead>
                  <TableHead className="text-white">{tb("total")}</TableHead>
                  <TableHead className="text-white">{tb("due")}</TableHead>
                  <TableHead className="text-right text-white">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.data.items.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">
                      {booking.booking_number}
                    </TableCell>
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
                    <TableCell className="tabular-nums">
                      ₹{booking.total_amount}
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">
                      ₹{booking.due_amount}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => {
                          sessionStorage.setItem(CHECKIN_SESSION_KEY, booking.id);
                          setSelectedBooking(booking);
                        }}
                      >
                        <LogIn className="size-4" aria-hidden />
                        {t("checkInNow")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        {bookings.data && bookings.data.total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, bookings.data.total)} {tc("of")}{" "}
              {bookings.data.total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                {tc("previous")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE_SIZE >= bookings.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                {tc("next")}
              </Button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default function CheckinPage() {
  return (
    <RequirePermission permission={PERMISSIONS.checkin}>
      <CheckinContent />
    </RequirePermission>
  );
}
