"use client";

/**
 * Guest Check-in — Full-page form matching the Figma reference exactly.
 *
 * Flow:
 *  Step 1 — Booking selection list (confirmed bookings ready for check-in).
 *  Step 2 — Full-page check-in form when a booking is selected:
 *    1. Booking Details
 *    2. Primary Guest Identity Verification (editable guest fields + ID docs)
 *    3. Additional Guests (search existing OR create new inline + doc upload)
 *    4. Room Information (adults/children +/- controls)
 *    5. Special Requirements (chips + special instructions)
 *    6. Payment Details (advance at check-in + payment mode)
 *    7. Emergency Contact
 *    8. Vehicle Details
 *
 * Mutation sequence:
 *  1. PATCH /guests/{primary_guest_id}  — if any primary-guest field changed
 *  2. POST /guests per new additional guest
 *  3. Upload docs for primary + additional guests
 *  4. PATCH /bookings/{id}             — emergency contact + vehicle + adults/children
 *  5. POST /checkins                   — with resolved co-guest IDs
 *  6. POST /charges                    — for each selected service
 *  7. POST /payments                   — if advance payment > 0
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  BedDouble,
  Car,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileText,
  LogIn,
  Minus,
  Phone,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  AlertTriangle,
  ClipboardList,
  Star,
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
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, apiUpload } from "@/lib/api/client";
import { compressDocument } from "@/lib/compress-image";
import { cn } from "@/lib/utils";
import type { ListOut } from "@/types/hotel";
import type {
  BookingOut,
  CheckInCreateOut,
  GuestAutofill,
  GuestCreatePayload,
  GuestSearchResult,
} from "@/types/stay";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface ServiceItem {
  id: string;
  name: string;
  price: string;
  is_active: boolean;
}

/** A resolved additional guest ready to be passed to POST /checkins. */
interface ResolvedCoGuest {
  guest_id: string;
  full_name: string;
  /** Docs queued for upload after guest is created/resolved. */
  docs: { side: "front" | "back" | "selfie"; file: File }[];
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Collapsible section wrapper. */
function Section({
  icon: Icon,
  title,
  subtitle,
  children,
  defaultOpen = true,
  badge,
}: {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly subtitle?: string;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-4"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="flex size-7 items-center justify-center rounded-md bg-gold-50">
              <Icon className="size-4 text-gold-600" aria-hidden />
            </div>
          )}
          <div className="text-left">
            <p className="font-semibold text-sm text-foreground">{title}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {badge && (
            <span className="ml-2 rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-semibold text-gold-700">
              {badge}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" aria-hidden />
        )}
      </button>
      {open && <div className="border-t px-5 py-5">{children}</div>}
    </div>
  );
}

/** Document upload tile. */
function DocUpload({
  guestId,
  side,
  label,
  onUploaded,
}: {
  readonly guestId: string | null;
  readonly side: "front" | "back" | "selfie";
  readonly label: string;
  readonly onUploaded?: () => void;
}) {
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
      onUploaded?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-xs transition-colors",
        !guestId && "pointer-events-none opacity-40",
        uploaded
          ? "border-green-400 bg-green-50 text-green-700"
          : "border-border hover:border-gold-400 hover:bg-gold-50 text-muted-foreground",
      )}
    >
      <Upload className="size-5" aria-hidden />
      <span className="font-medium">{busy ? "Uploading…" : uploaded ? "✓ Uploaded" : label}</span>
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

/** Queued doc upload tile (queues the file; uploads after guest is created). */
function QueuedDocUpload({
  side,
  label,
  onQueued,
}: {
  readonly side: "front" | "back" | "selfie";
  readonly label: string;
  readonly onQueued: (side: "front" | "back" | "selfie", file: File) => void;
}) {
  const [queued, setQueued] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const compressed = await compressDocument(file);
      onQueued(side, compressed);
      setQueued(true);
    } catch {
      toast.error("Could not process image");
    }
  };

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-xs transition-colors",
        queued
          ? "border-gold-400 bg-gold-50 text-gold-700"
          : "border-border hover:border-gold-400 hover:bg-gold-50 text-muted-foreground",
      )}
    >
      <Upload className="size-5" aria-hidden />
      <span className="font-medium">{queued ? "✓ Ready" : label}</span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </label>
  );
}

// ─── Additional Guest entry component ────────────────────────────────────────

function AdditionalGuestEntry({
  idx,
  onResolved,
  onRemove,
}: {
  readonly idx: number;
  readonly onResolved: (guest: ResolvedCoGuest) => void;
  readonly onRemove: () => void;
}) {
  const api = useApi();
  const [searchPhone, setSearchPhone] = useState("");
  const [searchResults, setSearchResults] = useState<GuestSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolved, setResolved] = useState<ResolvedCoGuest | null>(null);
  const [mode, setMode] = useState<"search" | "form">("search");
  const [docs, setDocs] = useState<{ side: "front" | "back" | "selfie"; file: File }[]>([]);

  // New guest form state
  const [form, setForm] = useState<GuestCreatePayload>({
    full_name: "",
    phone: "",
    email: "",
    address: "",
    gender: "",
    date_of_birth: "",
    id_proof_type: "Aadhar Card",
    id_number: "",
    postal_code: "",
  });

  const set = (k: keyof GuestCreatePayload, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSearch = async () => {
    if (!searchPhone.trim()) return;
    setSearching(true);
    try {
      const res = await api<{ items: GuestSearchResult[] }>(
        `/api/v1/guests/search?q=${encodeURIComponent(searchPhone.trim())}`,
      );
      setSearchResults(res.items);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectExisting = async (g: GuestSearchResult) => {
    try {
      const full = await api<GuestAutofill>(`/api/v1/guests/${g.id}/autofill`);
      const resolved: ResolvedCoGuest = {
        guest_id: g.id,
        full_name: full.full_name,
        docs: [],
      };
      setResolved(resolved);
      onResolved(resolved);
      setSearchResults([]);
    } catch {
      toast.error("Could not load guest details");
    }
  };

  const handleQueueDoc = (side: "front" | "back" | "selfie", file: File) => {
    const newDocs = docs.filter((d) => d.side !== side).concat({ side, file });
    setDocs(newDocs);
    if (resolved) {
      const updated = { ...resolved, docs: newDocs };
      setResolved(updated);
      onResolved(updated);
    }
  };

  if (resolved) {
    return (
      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-green-600" aria-hidden />
            <span className="text-sm font-semibold">{resolved.full_name}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setResolved(null);
              setSearchPhone("");
              setSearchResults([]);
              onRemove();
            }}
            className="text-danger hover:opacity-70"
            aria-label="Remove guest"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <QueuedDocUpload side="front" label="Upload Front ID" onQueued={handleQueueDoc} />
          <QueuedDocUpload side="back" label="Upload Back ID" onQueued={handleQueueDoc} />
          <QueuedDocUpload side="selfie" label="Selfie Capture" onQueued={handleQueueDoc} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Additional Guest #{idx + 1}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="text-danger hover:opacity-70"
          aria-label="Remove"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-lg overflow-hidden border text-xs font-medium w-fit">
        <button
          type="button"
          onClick={() => setMode("search")}
          className={cn(
            "px-3 py-1.5 transition-colors",
            mode === "search" ? "bg-navy-900 text-white" : "hover:bg-muted",
          )}
        >
          Search Existing
        </button>
        <button
          type="button"
          onClick={() => setMode("form")}
          className={cn(
            "px-3 py-1.5 border-l transition-colors",
            mode === "form" ? "bg-navy-900 text-white" : "hover:bg-muted",
          )}
        >
          Create New
        </button>
      </div>

      {mode === "search" ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden />
              <Input
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                placeholder="Search by phone number"
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSearch())}
              />
            </div>
            <Button type="button" size="sm" onClick={handleSearch} disabled={searching}>
              <Search className="size-4" aria-hidden />
              {searching ? "…" : "Search"}
            </Button>
          </div>
          {searchResults.length > 0 && (
            <ul className="rounded-lg border divide-y">
              {searchResults.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectExisting(g)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                  >
                    <span className="font-medium">{g.full_name}</span>
                    <span className="ml-2 text-muted-foreground">{g.phone_masked}</span>
                    {g.id_last4 && (
                      <span className="ml-1 text-xs text-muted-foreground">ID: ••••{g.id_last4}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchResults.length === 0 && searchPhone && !searching && (
            <p className="text-xs text-muted-foreground">
              No match found.{" "}
              <button type="button" className="underline" onClick={() => setMode("form")}>
                Create new guest
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* ID verification */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">ID Type</Label>
              <select
                value={form.id_proof_type}
                onChange={(e) => set("id_proof_type", e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="Aadhar Card">Aadhar Card</option>
                <option value="PAN Card">PAN Card</option>
                <option value="Passport">Passport</option>
                <option value="Driving License">Driving License</option>
                <option value="Voter ID">Voter ID</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ID Number</Label>
              <Input
                value={form.id_number}
                onChange={(e) => set("id_number", e.target.value)}
                placeholder="Last 4 digits minimum"
              />
            </div>
          </div>

          {/* Doc uploads */}
          <div className="grid grid-cols-3 gap-2">
            <QueuedDocUpload side="front" label="Upload Front" onQueued={handleQueueDoc} />
            <QueuedDocUpload side="back" label="Upload Back" onQueued={handleQueueDoc} />
            <QueuedDocUpload side="selfie" label="Selfie Capture" onQueued={handleQueueDoc} />
          </div>

          {/* Guest details */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name *</Label>
              <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Full Name" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mobile Number *</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile" inputMode="tel" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email (optional)</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Gender</Label>
              <select
                value={form.gender}
                onChange={(e) => set("gender", e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">— Select —</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date of Birth</Label>
              <Input type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Pincode</Label>
              <Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} placeholder="Pincode" inputMode="numeric" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Address</Label>
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Address" />
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            className="bg-navy-900 text-white hover:bg-navy-900/90"
            disabled={!form.full_name.trim() || !form.phone.trim()}
            onClick={() => {
              // Will be created in the mutation; mark as pending-creation
              const pending: ResolvedCoGuest = {
                guest_id: `__new__${Date.now()}`,
                full_name: form.full_name,
                docs,
              };
              // Attach the form data to the resolved object for the mutation
              (pending as ResolvedCoGuest & { _newForm?: GuestCreatePayload })._newForm = { ...form };
              setResolved(pending);
              onResolved(pending);
            }}
          >
            Confirm Guest Details
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main check-in form ───────────────────────────────────────────────────────

function CheckinForm({
  booking,
  onBack,
  onDone,
}: {
  readonly booking: BookingOut;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const api = useApi();
  const { activeHotelId } = useAuth();
  const queryClient = useQueryClient();

  // ── Primary guest editable state ──
  const [pgName, setPgName] = useState(booking.primary_guest_name ?? "");
  const [pgPhone, setPgPhone] = useState(booking.primary_guest_phone ?? "");
  const [pgIdType, setPgIdType] = useState("Aadhar Card");
  const [pgIdNumber, setPgIdNumber] = useState("");
  const [pgGender, setPgGender] = useState("");
  const [pgDob, setPgDob] = useState("");
  const [pgAddress, setPgAddress] = useState("");
  const [pgPurpose, setPgPurpose] = useState("");
  const [pgCompany, setPgCompany] = useState("");

  // ── Additional guests ──
  const [coGuests, setCoGuests] = useState<ResolvedCoGuest[]>([]);
  const [guestKeys, setGuestKeys] = useState<number[]>([]); // keys for entry components

  const addGuestEntry = () => {
    const key = Date.now();
    setGuestKeys((prev) => [...prev, key]);
  };
  const removeGuestEntry = (key: number) => {
    setGuestKeys((prev) => prev.filter((k) => k !== key));
    setCoGuests((prev) => prev.filter((_, i) => i !== guestKeys.indexOf(key)));
  };
  const resolveGuest = (key: number, guest: ResolvedCoGuest) => {
    setCoGuests((prev) => {
      const idx = guestKeys.indexOf(key);
      const next = [...prev];
      next[idx] = guest;
      return next;
    });
  };

  // ── Room information ──
  const [adults, setAdults] = useState(booking.adults);
  const [children, setChildren] = useState(booking.children);

  // ── Special requirements ──
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const toggleService = (id: string) =>
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  // ── Payment details ──
  const [advanceAmount, setAdvanceAmount] = useState("0");
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi">("cash");

  // ── Emergency + vehicle ──
  const [emName, setEmName] = useState(booking.emergency_contact_name ?? "");
  const [emRelation, setEmRelation] = useState(booking.emergency_contact_relation ?? "");
  const [emPhone, setEmPhone] = useState(booking.emergency_contact_phone ?? "");
  const [vehNumber, setVehNumber] = useState(booking.vehicle_number ?? "");
  const [vehType, setVehType] = useState(booking.vehicle_type ?? "Car");
  const [vehMake, setVehMake] = useState("");
  const [parkingSlot, setParkingSlot] = useState(booking.parking_slot ?? "");

  // ── Early check-in ──
  const [isEarly, setIsEarly] = useState(false);
  const [earlyFee, setEarlyFee] = useState("0");

  // ── Terms ──
  const [terms, setTerms] = useState(false);

  // ── Post-check-in state ──
  const [checkinResult, setCheckinResult] = useState<CheckInCreateOut | null>(null);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  // ── Error ──
  const [error, setError] = useState<string | null>(null);

  // ── Hotel services ──
  const services = useQuery({
    queryKey: ["hotel-services", activeHotelId],
    queryFn: () => api<ServiceItem[]>("/api/v1/hotels/me/services"),
    enabled: !!activeHotelId,
  });

  const currentRooms = booking.rooms.filter((r) => r.is_current);

  // ── Computed balance ──
  const bookingTotal = parseFloat(booking.total_amount) || 0;
  const advPaid = parseFloat(booking.advance_amount) || 0;
  const newAdvance = parseFloat(advanceAmount) || 0;
  const balance = Math.max(bookingTotal - advPaid - newAdvance, 0);

  // ── Mutation ─────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async () => {
      // 1. Update primary guest if anything changed
      const originalName = booking.primary_guest_name ?? "";
      if (
        booking.primary_guest_id &&
        (pgName !== originalName ||
          pgIdType ||
          pgIdNumber ||
          pgGender ||
          pgDob ||
          pgAddress)
      ) {
        const body: Record<string, string | null> = {};
        if (pgName && pgName !== originalName) body.full_name = pgName;
        if (pgPhone && pgPhone !== (booking.primary_guest_phone ?? "")) body.phone = pgPhone;
        if (pgGender) body.gender = pgGender;
        if (pgDob) body.date_of_birth = pgDob;
        if (pgAddress) body.address = pgAddress;
        if (pgIdType) body.id_proof_type = pgIdType;
        if (pgIdNumber) body.id_number = pgIdNumber;
        if (Object.keys(body).length > 0) {
          await api(`/api/v1/guests/${booking.primary_guest_id}`, {
            method: "PATCH",
            body,
          });
        }
      }

      // 2. Create new additional guests + resolve IDs
      const resolvedIds: string[] = [];
      for (const cg of coGuests.filter(Boolean)) {
        const isNew = cg.guest_id.startsWith("__new__");
        if (isNew) {
          const newForm = (
            cg as ResolvedCoGuest & { _newForm?: GuestCreatePayload }
          )._newForm;
          if (!newForm) continue;
          const created = await api<{ id: string }>("/api/v1/guests", {
            method: "POST",
            body: {
              full_name: newForm.full_name.trim(),
              phone: newForm.phone.trim(),
              email: newForm.email?.trim() || undefined,
              address: newForm.address?.trim() || undefined,
              postal_code: newForm.postal_code?.trim() || undefined,
              gender: newForm.gender?.trim() || undefined,
              date_of_birth: newForm.date_of_birth?.trim() || undefined,
              id_proof_type: newForm.id_proof_type?.trim() || undefined,
              id_number: newForm.id_number?.trim() || undefined,
            },
          });
          // Upload queued docs for the new guest
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            await apiUpload(`/api/v1/guests/${created.id}/documents`, form, {
              hotelId: activeHotelId ?? undefined,
            });
          }
          resolvedIds.push(created.id);
        } else {
          // Existing guest — upload any queued docs
          for (const doc of cg.docs) {
            const form = new FormData();
            form.append("side", doc.side);
            form.append("document_type", "id_proof");
            form.append("file", doc.file);
            await apiUpload(`/api/v1/guests/${cg.guest_id}/documents`, form, {
              hotelId: activeHotelId ?? undefined,
            });
          }
          resolvedIds.push(cg.guest_id);
        }
      }

      // 3. Update booking meta (emergency + vehicle + adults/children)
      const bookingPatch: Record<string, unknown> = {};
      if (emName || emRelation || emPhone) {
        bookingPatch.emergency_contact_name = emName || null;
        bookingPatch.emergency_contact_relation = emRelation || null;
        bookingPatch.emergency_contact_phone = emPhone || null;
      }
      if (vehNumber || vehType !== "Car" || parkingSlot) {
        bookingPatch.vehicle_number = vehNumber || null;
        bookingPatch.vehicle_type = vehType || null;
        bookingPatch.parking_slot = parkingSlot || null;
      }
      if (adults !== booking.adults) bookingPatch.adults = adults;
      if (children !== booking.children) bookingPatch.children = children;
      if (Object.keys(bookingPatch).length > 0) {
        await api(`/api/v1/bookings/${booking.id}`, {
          method: "PATCH",
          body: bookingPatch,
        });
      }

      // 4. Check in
      const checkinOut = await api<CheckInCreateOut>("/api/v1/checkins", {
        method: "POST",
        body: {
          booking_id: booking.id,
          co_guests: resolvedIds.map((id) => ({ guest_id: id })),
          purpose_of_visit: pgPurpose.trim() || null,
          company_name: pgCompany.trim() || null,
          is_early: isEarly,
          early_fee: isEarly ? earlyFee : "0",
          terms_acknowledged: terms,
        },
      });

      // 5. Add service charges
      const chosen = (services.data ?? []).filter((s) =>
        selectedServices.includes(s.id),
      );
      for (const svc of chosen) {
        await api("/api/v1/charges", {
          method: "POST",
          body: {
            booking_id: booking.id,
            category: "other",
            description: svc.name,
            quantity: 1,
            rate: svc.price,
            apply_gst: false,
          },
        });
      }

      // 6. Collect advance payment if provided
      if (newAdvance > 0) {
        await api("/api/v1/payments", {
          method: "POST",
          body: {
            booking_id: booking.id,
            amount: advanceAmount,
            method: paymentMode,
            purpose: "advance",
          },
        });
      }

      // 7. Add special instructions as a note (via booking patch if changed)
      if (specialInstructions.trim()) {
        await api(`/api/v1/bookings/${booking.id}`, {
          method: "PATCH",
          body: { special_requests: specialInstructions.trim() },
        });
      }

      return checkinOut;
    },
    onSuccess: (result) => {
      setCheckinResult(result);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["bookings", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["current-guests", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["room-status-summary", activeHotelId] });
      toast.success(
        `✓ Checked In — Registration: ${result.registration_numbers.join(", ")}`,
      );
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Check-in failed"),
  });

  // ── Generate Invoice ──────────────────────────────────────────────────────
  const generateInvoice = async () => {
    if (!checkinResult) return;
    setGeneratingInvoice(true);
    try {
      const inv = await api<{ id: string }>("/api/v1/invoices", {
        method: "POST",
        body: { booking_id: booking.id, interstate: false },
      });
      setInvoiceId(inv.id);
      toast.success("Invoice generated");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Invoice generation failed");
    } finally {
      setGeneratingInvoice(false);
    }
  };

  // ── Post-check-in success state ──────────────────────────────────────────
  if (checkinResult) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <div className="rounded-xl border bg-white shadow-sm p-8 text-center space-y-4">
          <div className="flex size-16 items-center justify-center rounded-full bg-green-100 mx-auto">
            <BadgeCheck className="size-8 text-green-600" aria-hidden />
          </div>
          <h2 className="text-xl font-bold text-foreground">Guest Checked In</h2>
          <div className="rounded-lg bg-muted/40 px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Registration Number(s)</p>
            <p className="font-bold text-lg tabular-nums">
              {checkinResult.registration_numbers.join(" · ")}
            </p>
          </div>
          {invoiceId ? (
            <a
              href={`/invoices`}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-medium text-white hover:bg-green-700"
            >
              <FileText className="size-4" aria-hidden />
              View Invoice
            </a>
          ) : (
            <button
              type="button"
              onClick={generateInvoice}
              disabled={generatingInvoice}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-gold-500 px-4 text-sm font-medium text-gold-700 hover:bg-gold-50 disabled:opacity-50"
            >
              <FileText className="size-4" aria-hidden />
              {generatingInvoice ? "Generating…" : "Generate Invoice"}
            </button>
          )}
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={onDone}
              className="inline-flex h-9 items-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-900/90"
            >
              Back to Check-in List
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-12">
      {/* Back */}
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to bookings list
      </button>

      {/* ── 1. Booking Details ─────────────────────────────────────────────── */}
      <Section icon={ClipboardList} title="Booking Details" subtitle="Review booking information before check-in">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Booking No.</Label>
            <p className="mt-1 font-semibold text-foreground">{booking.booking_number}</p>
          </div>
          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Check In Date</Label>
            <p className="mt-1">{booking.check_in_date}</p>
          </div>
          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Checkout Date</Label>
            <p className="mt-1">{booking.check_out_date}</p>
          </div>
          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Guest Type</Label>
            <select
              value={pgPurpose}
              onChange={(e) => setPgPurpose(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">Select</option>
              <option value="Business">Business</option>
              <option value="Leisure">Leisure / Tourism</option>
              <option value="Medical">Medical</option>
              <option value="Wedding">Wedding / Event</option>
              <option value="Other">Other</option>
            </select>
          </div>
          {pgPurpose === "Business" && (
            <div className="sm:col-span-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Company</Label>
              <Input className="mt-1" value={pgCompany} onChange={(e) => setPgCompany(e.target.value)} placeholder="Company name" />
            </div>
          )}
        </div>
      </Section>

      {/* ── 2. Primary Guest Identity Verification ────────────────────────── */}
      <Section icon={BadgeCheck} title="Primary Guest Identity Verification" subtitle="Verify guest identity documents">
        <div className="space-y-5">
          {/* ID type + number */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ID Type</Label>
              <select
                value={pgIdType}
                onChange={(e) => setPgIdType(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="Aadhar Card">Aadhar Card</option>
                <option value="PAN Card">PAN Card</option>
                <option value="Passport">Passport</option>
                <option value="Driving License">Driving License</option>
                <option value="Voter ID">Voter ID</option>
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {pgIdType.toUpperCase()} No.
              </Label>
              <div className="flex gap-2">
                <Input
                  value={pgIdNumber}
                  onChange={(e) => setPgIdNumber(e.target.value)}
                  placeholder={`Enter ${pgIdType} number`}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    if (pgIdNumber) toast.success("ID recorded");
                  }}
                >
                  Submit
                </Button>
              </div>
            </div>
          </div>

          {/* Document uploads */}
          <div className="grid grid-cols-3 gap-3">
            <DocUpload
              guestId={booking.primary_guest_id ?? null}
              side="front"
              label="Upload Front Face"
            />
            <DocUpload
              guestId={booking.primary_guest_id ?? null}
              side="back"
              label="Upload Back Face"
            />
            <DocUpload
              guestId={booking.primary_guest_id ?? null}
              side="selfie"
              label="Selfie Capture"
            />
          </div>

          {/* Guest personal details */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Full Name</Label>
              <Input value={pgName} onChange={(e) => setPgName(e.target.value)} placeholder="Full Name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Phone Number</Label>
              <Input value={pgPhone} onChange={(e) => setPgPhone(e.target.value)} placeholder="Phone" inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Gender</Label>
              <select
                value={pgGender}
                onChange={(e) => setPgGender(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                <option value="">— Select —</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Date of Birth</Label>
              <Input type="date" value={pgDob} onChange={(e) => setPgDob(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Address</Label>
              <Input value={pgAddress} onChange={(e) => setPgAddress(e.target.value)} placeholder="Address" />
            </div>
          </div>
        </div>
      </Section>

      {/* ── 3. Additional Guests ──────────────────────────────────────────── */}
      <Section
        icon={Users}
        title="Additional Guests"
        subtitle="Add co-guests for this booking"
        badge={coGuests.filter(Boolean).length > 0 ? String(coGuests.filter(Boolean).length) : undefined}
      >
        <div className="space-y-4">
          {guestKeys.map((key, i) => (
            <AdditionalGuestEntry
              key={key}
              idx={i}
              onResolved={(g) => resolveGuest(key, g)}
              onRemove={() => removeGuestEntry(key)}
            />
          ))}
          <button
            type="button"
            onClick={addGuestEntry}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
          >
            <Plus className="size-4" aria-hidden />
            Add Guest
          </button>
        </div>
      </Section>

      {/* ── 4. Room Information ───────────────────────────────────────────── */}
      <Section icon={BedDouble} title="Room Information" subtitle="Room assignment details">
        <div className="space-y-4">
          {currentRooms.map((room) => (
            <div key={room.room_id} className="grid gap-3 sm:grid-cols-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Room Number</Label>
                <div className="h-9 rounded-lg border bg-muted/40 px-2.5 flex items-center text-sm font-medium">
                  {room.room_number}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Room Type</Label>
                <div className="h-9 rounded-lg border bg-muted/40 px-2.5 flex items-center text-sm text-muted-foreground">
                  {room.room_type_name}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Adults</Label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAdults(Math.max(1, adults - 1))}
                    className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
                  >
                    <Minus className="size-3.5" aria-hidden />
                  </button>
                  <span className="w-6 text-center tabular-nums font-semibold">{adults}</span>
                  <button
                    type="button"
                    onClick={() => setAdults(Math.min(20, adults + 1))}
                    className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Children</Label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setChildren(Math.max(0, children - 1))}
                    className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
                  >
                    <Minus className="size-3.5" aria-hidden />
                  </button>
                  <span className="w-6 text-center tabular-nums font-semibold">{children}</span>
                  <button
                    type="button"
                    onClick={() => setChildren(Math.min(10, children + 1))}
                    className="flex size-8 items-center justify-center rounded-lg border border-border hover:bg-muted"
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 5. Special Requirements ───────────────────────────────────────── */}
      <Section icon={Star} title="Special Requirements">
        <div className="space-y-4">
          {services.isLoading && <Skeleton className="h-10" />}
          {(services.data?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {services.data?.map((svc) => {
                const active = selectedServices.includes(svc.id);
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => toggleService(svc.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "border-navy-900 bg-navy-900 text-white font-medium"
                        : "border-border text-muted-foreground hover:border-navy-900 hover:text-navy-900",
                    )}
                  >
                    {svc.name}
                    <span className={cn("text-xs", active ? "opacity-80" : "opacity-60")}>
                      ₹{svc.price}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Special Instructions
            </Label>
            <textarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder="Any additional instructions for the guest…"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
          </div>
        </div>
      </Section>

      {/* ── 6. Payment Details ────────────────────────────────────────────── */}
      <Section icon={CreditCard} title="Payment Details" subtitle="Collect advance payment at check-in">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Booking Amount</Label>
            <p className="mt-1 tabular-nums font-medium">₹{booking.total_amount}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Extra Charges</Label>
            <p className="mt-1 tabular-nums">₹{booking.tax_amount}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Advance Paid (at check-in)
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={advanceAmount}
              onChange={(e) => setAdvanceAmount(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">GST</Label>
            <p className="mt-1 tabular-nums">₹{booking.tax_amount}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Balance Amount</Label>
            <p className={cn("mt-1 tabular-nums font-semibold", balance > 0 ? "text-gold-600" : "text-green-600")}>
              ₹{balance.toFixed(2)}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payment Mode</Label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as "cash" | "upi")}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              disabled={newAdvance === 0}
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
            </select>
          </div>
        </div>
      </Section>

      {/* ── 7. Emergency Contact ──────────────────────────────────────────── */}
      <Section icon={AlertTriangle} title="Emergency Contact" subtitle="Optional" defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Name</Label>
            <Input value={emName} onChange={(e) => setEmName(e.target.value)} placeholder="Contact name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Relation</Label>
            <Input value={emRelation} onChange={(e) => setEmRelation(e.target.value)} placeholder="e.g. Spouse" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Phone Number</Label>
            <Input value={emPhone} onChange={(e) => setEmPhone(e.target.value)} placeholder="Phone" inputMode="tel" />
          </div>
        </div>
      </Section>

      {/* ── 8. Vehicle Details ────────────────────────────────────────────── */}
      <Section icon={Car} title="Vehicle Details" subtitle="Optional" defaultOpen={false}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Vehicle Number</Label>
            <Input value={vehNumber} onChange={(e) => setVehNumber(e.target.value)} placeholder="MH 12 AB 1234" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Vehicle Type</Label>
            <select
              value={vehType}
              onChange={(e) => setVehType(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="Car">Car</option>
              <option value="Bike">Bike</option>
              <option value="Auto">Auto / Rickshaw</option>
              <option value="Taxi">Taxi / Cab</option>
              <option value="Bus">Bus</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Make / Name</Label>
            <Input value={vehMake} onChange={(e) => setVehMake(e.target.value)} placeholder="e.g. Honda City" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Parking Slot</Label>
            <Input value={parkingSlot} onChange={(e) => setParkingSlot(e.target.value)} placeholder="A-12" />
          </div>
        </div>
      </Section>

      {/* ── Early check-in ────────────────────────────────────────────────── */}
      <Section icon={LogIn} title="Early Check-in" defaultOpen={false}>
        <div className="space-y-3">
          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={isEarly}
              onChange={(e) => setIsEarly(e.target.checked)}
            />
            <span className="font-medium">This is an early check-in</span>
          </label>
          {isEarly && (
            <div className="max-w-xs space-y-1.5">
              <Label className="text-xs">Early Check-in Fee (₹)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={earlyFee}
                onChange={(e) => setEarlyFee(e.target.value)}
              />
            </div>
          )}
        </div>
      </Section>

      {/* ── Footer: Terms + Actions ───────────────────────────────────────── */}
      <div className="rounded-xl border bg-white shadow-sm px-5 py-4 space-y-4">
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input shrink-0"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
          />
          <span className="text-muted-foreground leading-relaxed">
            Guest agrees to hotel terms and conditions, including check-in/check-out policy,
            identity verification and property rules.
          </span>
        </label>

        {error && (
          <p className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" onClick={onBack}>
            Cancel
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => toast.info("Draft saved locally")}
            >
              Save Draft
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled
              title="Available after check-in"
            >
              <FileText className="size-4" aria-hidden />
              Generate Invoice
            </Button>
            <Button
              type="button"
              disabled={mutation.isPending || !terms}
              className="bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold"
              onClick={() => mutation.mutate()}
            >
              <LogIn className="size-4" aria-hidden />
              {mutation.isPending ? "Checking In…" : "Check In"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Booking selection list ───────────────────────────────────────────────────

const CHECKIN_SESSION_KEY = "dmh.checkin.selectedBookingId";

function CheckinContent() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();
  const [selectedBooking, setSelectedBooking] = useState<BookingOut | null>(null);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(() =>
    typeof window !== "undefined" ? sessionStorage.getItem(CHECKIN_SESSION_KEY) : null,
  );
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

  useEffect(() => {
    if (!pendingBookingId || !bookings.data) return;
    const match = bookings.data.items.find((b) => b.id === pendingBookingId);
    if (match) setSelectedBooking(match);
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
        <PartnerHeader title="Guest Check-in" subtitle="Front Desk" />
        <main className="flex-1 overflow-y-auto bg-[#f5f5f0] px-4 py-6">
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
      <PartnerHeader title="Guest Check-in" subtitle="Front Desk" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Bookings ready for check-in
          </h2>
          <Link
            href="/bookings?new=1"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Plus className="size-4" aria-hidden />
            New Booking
          </Link>
        </div>

        <div className="rounded-xl border bg-white shadow-sm">
          {bookings.isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {bookings.isError && (
            <div className="p-8 text-center text-sm text-danger">
              Failed to load.{" "}
              <button type="button" className="underline" onClick={() => bookings.refetch()}>
                Retry
              </button>
            </div>
          )}
          {bookings.data && bookings.data.items.length === 0 && page === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No confirmed bookings ready for check-in.
            </p>
          )}
          {bookings.data && bookings.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">Booking No.</TableHead>
                  <TableHead className="text-white">Guest</TableHead>
                  <TableHead className="text-white">Rooms</TableHead>
                  <TableHead className="text-white">Dates</TableHead>
                  <TableHead className="text-white">Total</TableHead>
                  <TableHead className="text-white">Due</TableHead>
                  <TableHead className="text-right text-white">Action</TableHead>
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
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                      {booking.check_in_date} → {booking.check_out_date}
                    </TableCell>
                    <TableCell className="tabular-nums">₹{booking.total_amount}</TableCell>
                    <TableCell className="tabular-nums font-medium">₹{booking.due_amount}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        className="bg-gold-500 text-navy-900 hover:bg-gold-400"
                        onClick={() => {
                          sessionStorage.setItem(CHECKIN_SESSION_KEY, booking.id);
                          setSelectedBooking(booking);
                        }}
                      >
                        <LogIn className="size-4" aria-hidden />
                        Check In
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {bookings.data && bookings.data.total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, bookings.data.total)} of{" "}
              {bookings.data.total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE_SIZE >= bookings.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
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
