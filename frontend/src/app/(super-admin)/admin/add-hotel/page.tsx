"use client";

/**
 * Add New Hotel — full-page wizard.
 *
 * Sections:
 *  1. Access Permissions   (hotel feature mode: full | checkin_only | checkin_expense)
 *  2. Property Identity    (name, city, state, phone, address, GSTIN, email, logo, gallery, map_id)
 *  3. GST & Rooms Limits   (gst type + total room count + max team members)
 *  4. Create Property Users (owner + optional additional staff up to max_team_members)
 *  5. Payment Setup        (merchant name, UPI — QR appears after hotel creation)
 *  6. Room Inventory Setup (optional)
 *  7. Special Requirements (optional)
 *  8. Emergency & Vehicle  (feature toggles)
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  MapPin,
  Plus,
  QrCode,
  Trash2,
  Shield,
  Building2,
  Receipt,
  Users,
  CreditCard,
  BedDouble,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { liveNameCase, sanitizeLandline, sanitizePhone } from "@/lib/input-discipline";
import { apiFetch, ApiError, API_BASE, apiUpload } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { compressImage, compressLogo } from "@/lib/compress-image";
import { useImageEditor } from "@/components/media/image-editor";
import type { HotelOut } from "@/types/hotel";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  children,
  defaultOpen = true,
}: {
  readonly icon: React.ElementType;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gold-50">
            <Icon className="size-4 text-gold-600" aria-hidden />
          </div>
          <span className="font-semibold text-sm text-foreground">{title}</span>
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open && <div className="border-t px-6 py-5">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room entry row
// ---------------------------------------------------------------------------
interface RoomEntry {
  room_number: string;
  room_type: string;
  bed_type: string;
  max_adults: number;
  max_children: number;
}

function RoomRow({
  entry,
  idx,
  onChange,
  onRemove,
}: {
  readonly entry: RoomEntry;
  readonly idx: number;
  readonly onChange: (idx: number, field: keyof RoomEntry, value: string | number) => void;
  readonly onRemove: (idx: number) => void;
}) {
  const t = useTranslations("admin");
  return (
    <div className="rounded-lg border border-border p-4 space-y-3 relative">
      <button
        type="button"
        onClick={() => onRemove(idx)}
        className="absolute right-3 top-3 text-muted-foreground hover:text-danger"
        aria-label="Remove room"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {t("roomEntry")} #{idx + 1}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("roomNumber")}</Label>
          <Input
            value={entry.room_number}
            onChange={(e) => onChange(idx, "room_number", e.target.value)}
            placeholder="101"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("roomType")}</Label>
          {/* Free-text so any room type name can be entered — the dropdown had
              hardcoded options that caused "Room Type Missing" when a hotel uses
              a custom type (client screenshot 63563159). */}
          <Input
            value={entry.room_type}
            onChange={(e) => onChange(idx, "room_type", e.target.value)}
            placeholder="e.g. Deluxe Suite"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("bedType")}</Label>
          <select
            value={entry.bed_type}
            onChange={(e) => onChange(idx, "bed_type", e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="">—</option>
            <option value="king">King Size</option>
            <option value="queen">Queen Size</option>
            <option value="double">Double</option>
            <option value="single">Single</option>
            <option value="twin">Twin</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("maxAdults")}</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={entry.max_adults}
            onChange={(e) => onChange(idx, "max_adults", Number.parseInt(e.target.value, 10) || 1)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("maxChildren")}</Label>
          <Input
            type="number"
            min={0}
            max={10}
            value={entry.max_children}
            onChange={(e) => onChange(idx, "max_children", Number.parseInt(e.target.value, 10) || 0)}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Additional team member row (created after hotel is set up)
// ---------------------------------------------------------------------------
const STAFF_ROLES = [
  { value: "manager",       label: "Manager"       },
  { value: "admin",         label: "Admin"         },
  { value: "receptionist",  label: "Receptionist"  },
  { value: "housekeeping",  label: "Housekeeping"  },
  { value: "general_staff", label: "General Staff" },
] as const;

interface AdditionalMember {
  key: string;
  full_name: string;
  phone: string;
  role_code: string;
  password: string;
}

function AdditionalMemberRow({
  entry,
  idx,
  onChange,
  onRemove,
}: {
  readonly entry: AdditionalMember;
  readonly idx: number;
  readonly onChange: (idx: number, field: keyof AdditionalMember, value: string) => void;
  readonly onRemove: (idx: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3 relative">
      <button
        type="button"
        onClick={() => onRemove(idx)}
        className="absolute right-3 top-3 text-muted-foreground hover:text-danger"
        aria-label="Remove member"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pr-8">
        Account #{idx + 2} {/* idx 0 = second account after the owner */}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Full Name *</Label>
          <Input
            value={entry.full_name}
            onChange={(e) => onChange(idx, "full_name", liveNameCase(e.target.value))}
            placeholder="Full Name"
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Phone *</Label>
          <Input
            value={entry.phone}
            onChange={(e) => onChange(idx, "phone", sanitizePhone(e.target.value))}
            placeholder="+91 XXXXXXXXXX"
            inputMode="tel"
            maxLength={10}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Role *</Label>
          <select
            value={entry.role_code}
            onChange={(e) => onChange(idx, "role_code", e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Temporary Password *</Label>
          <PasswordInput
            value={entry.password}
            onChange={(e) => onChange(idx, "password", e.target.value)}
            placeholder="Min. 8 characters"
            minLength={8}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Special requirement row
// ---------------------------------------------------------------------------
interface ServiceItem {
  name: string;
  price: string;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AddHotelPage() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const { edit } = useImageEditor();

  // --- Section 1: Access Permissions (3-tier: checkin_only | checkin_expense | full) ---
  const [accessMode, setAccessMode] = useState<"checkin_only" | "checkin_expense" | "full">("full");

  // --- Section 2: Property Identity ---
  const [hotelName, setHotelName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [mapId, setMapId] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  // Gallery: up to 5 images (position 0–4)
  const [galleryFiles, setGalleryFiles] = useState<(File | null)[]>([null, null, null, null, null]);
  const [galleryPreviews, setGalleryPreviews] = useState<(string | null)[]>([null, null, null, null, null]);

  // --- Section 3: GST & Rooms Limits ---
  type GstType = "included_by_hotel" | "included_by_customer" | "no_gst";
  const [gstType, setGstType] = useState<GstType>("no_gst");
  const [totalRooms, setTotalRooms] = useState("");
  // Team size cap — default 5 (client 15/09, plan §7.1).
  const [maxTeam, setMaxTeam] = useState("5");

  // --- Section 4: Owner ---
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");

  // --- Section 4b: Additional team members (phone-first, no email required) ---
  const [additionalMembers, setAdditionalMembers] = useState<AdditionalMember[]>([]);

  // --- Section 5: Payment Setup (optional) ---
  const [merchantName, setMerchantName] = useState("");
  const [upiId, setUpiId] = useState("");
  // paymentUrl intentionally removed (not in Figma, client 09/2026)

  // --- QR state: populated after hotel creation + UPI config ---
  // The QR is generated server-side (with hotel logo composited in center)
  // and only available after the hotel has been created and UPI configured.
  const [createdHotelId, setCreatedHotelId] = useState<string | null>(null);
  const [qrPolling, setQrPolling] = useState(false);
  const [qrBlobUrl, setQrBlobUrl] = useState<string | null>(null);
  // Ref for cleanup on unmount to avoid memory leaks with blob URLs.
  const qrBlobUrlRef = useRef<string | null>(null);

  // --- Section 6: Rooms ---
  const [rooms, setRooms] = useState<RoomEntry[]>([
    { room_number: "101", room_type: "", bed_type: "", max_adults: 2, max_children: 1 },
  ]);

  // --- Section 7: Special requirements ---
  const [services, setServices] = useState<ServiceItem[]>([]);

  // --- Section 8: Feature toggles (restored — client 9-10 feedback) ---
  const [emergencyEnabled, setEmergencyEnabled] = useState(true);
  const [vehicleEnabled, setVehicleEnabled] = useState(true);

  const [error, setError] = useState<string | null>(null);

  // Cleanup QR blob URL on unmount.
  useEffect(() => {
    return () => {
      if (qrBlobUrlRef.current) URL.revokeObjectURL(qrBlobUrlRef.current);
    };
  }, []);

  // Restore draft from localStorage on first mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("dmh.addHotelDraft");
      if (!raw) return;
      const d = JSON.parse(raw) as Record<string, string>;
      if (d.hotelName) setHotelName(d.hotelName);
      if (d.city) setCity(d.city);
      if (d.state) setState(d.state);
      if (d.phone) setPhone(d.phone);
      if (d.address) setAddress(d.address);
      if (d.gstin) setGstin(d.gstin);
      if (d.email) setEmail(d.email);
      if (d.mapId) setMapId(d.mapId);
      if (d.gstType) setGstType(d.gstType as GstType);
      if (d.totalRooms) setTotalRooms(d.totalRooms);
      if (d.ownerName) setOwnerName(d.ownerName);
      if (d.ownerEmail) setOwnerEmail(d.ownerEmail);
      if (d.ownerPhone) setOwnerPhone(d.ownerPhone);
      if (d.merchantName) setMerchantName(d.merchantName);
      if (d.upiId) setUpiId(d.upiId);
    } catch {
      // ignore malformed draft
    }
  }, []);

  /**
   * After hotel creation + UPI config, poll for the server-generated QR code.
   * Uses the same pattern as UpiConfigPanel in hotel settings:
   * polls GET /payment-config until qr_version >= 1, then fetches the PNG blob.
   * Logo (uploaded in Property Identity section → payment-config/logo) is
   * composited in the QR center automatically by the backend.
   */
  const pollAndLoadQr = async (hotelId: string) => {
    setQrPolling(true);
    try {
      for (let i = 0; i < 14; i++) {
        await new Promise<void>((r) => setTimeout(r, 500));
        let freshVersion = 0;
        try {
          const cfg = await apiFetch<{ qr_version: number }>(
            "/api/v1/hotels/me/payment-config",
            { hotelId },
          );
          freshVersion = cfg.qr_version;
        } catch {
          // transient error — keep polling
          continue;
        }
        if (freshVersion >= 1) {
          // QR is ready — fetch the blob with explicit auth headers
          const token = getAccessToken();
          const headers: Record<string, string> = {};
          if (token) headers.Authorization = `Bearer ${token}`;
          headers["X-Hotel-Id"] = hotelId;
          const resp = await fetch(
            `${API_BASE}/api/v1/hotels/me/payment-qr/image?v=${freshVersion}`,
            { headers, credentials: "include", cache: "no-store" },
          );
          if (resp.ok) {
            // Revoke the previous blob URL before creating a new one.
            if (qrBlobUrlRef.current) URL.revokeObjectURL(qrBlobUrlRef.current);
            const url = URL.createObjectURL(await resp.blob());
            qrBlobUrlRef.current = url;
            setQrBlobUrl(url);
          }
          return;
        }
      }
      // Timed out — QR not ready after 7 s; user can view it in hotel Settings.
    } finally {
      setQrPolling(false);
    }
  };

  const mutation = useMutation({
    onMutate: () => setError(null),   // clear stale error banner before each attempt
    mutationFn: async () => {
      const failedSteps: string[] = [];

      // Step 1: create hotel + owner (no plan_code → admin assigns plan later)
      const hotel = await apiFetch<HotelOut>("/api/v1/super-admin/hotels", {
        method: "POST",
        body: {
          name: hotelName.trim(),
          city: city.trim() || null,
          state: state.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
          email: email.trim() || null,
          gstin: gstin.trim() || null,
          map_id: mapId.trim() || null,
          total_rooms: totalRooms.trim() ? Number.parseInt(totalRooms.trim(), 10) : null,
          max_team_members: Math.max(1, Math.min(100, Number.parseInt(maxTeam, 10) || 5)),
          gst_type: gstType,
          owner_full_name: ownerName.trim(),
          owner_email: ownerEmail.trim(),
          owner_password: ownerPassword,
          owner_phone: ownerPhone.trim() || null,
          access_mode: accessMode,
          merchant_name: merchantName.trim() || null,
          // plan_code intentionally omitted → hotel created without subscription
          // Admin assigns plan later via RenewDialog
        },
      });

      // Step 2 (optional): upload hotel logo
      if (logoFile) {
        try {
          const compressed = await compressLogo(logoFile).catch(() => logoFile);
          const formData = new FormData();
          formData.append("file", compressed);
          const token = getAccessToken();
          const headers: Record<string, string> = { Accept: "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;
          headers["X-Hotel-Id"] = hotel.id;
          const resp = await fetch(`${API_BASE}/api/v1/hotels/me/payment-config/logo`, {
            method: "PUT",
            headers,
            body: formData,
            credentials: "include",
          });
          if (!resp.ok) failedSteps.push("Logo upload");
        } catch {
          failedSteps.push("Logo upload");
        }
      }

      // Step 3 (optional): set UPI / payment config
      // This also triggers server-side QR generation (with logo if uploaded in step 2).
      if (upiId.trim() || merchantName.trim()) {
        try {
          await apiFetch("/api/v1/hotels/me/payment-config", {
            method: "PUT",
            body: {
              ...(upiId.trim() ? { upi_id: upiId.trim() } : {}),
              ...(merchantName.trim() ? { merchant_name: merchantName.trim() } : {}),
            },
            hotelId: hotel.id,
          });
        } catch {
          failedSteps.push(t("upiSetup"));
        }
      }

      // Step 3b (optional): upload gallery images
      for (let pos = 0; pos < galleryFiles.length; pos++) {
        const gf = galleryFiles[pos];
        if (!gf) continue;
        try {
          const compressed = await compressImage(gf).catch(() => gf);
          const fd = new FormData();
          fd.append("file", compressed);
          await apiUpload(`/api/v1/hotels/me/gallery/${pos}`, fd, {
            method: "PUT",
            hotelId: hotel.id,
          });
        } catch {
          failedSteps.push(`Gallery image ${pos + 1}`);
        }
      }

      // Step 4 (optional): create room types + rooms.
      // Each unique type name gets its own RoomType record so that e.g.
      // "Deluxe Suite" and "Standard Double" don't collapse to one type
      // (old bug: a single hardcoded "STD" code was used for every room).
      const validRooms = rooms.filter((r) => r.room_number.trim() && r.room_type.trim());
      if (validRooms.length > 0) {
        try {
          // Group by type name (preserves insertion order)
          const byType = new Map<string, RoomEntry[]>();
          for (const room of validRooms) {
            const name = room.room_type.trim() || "Standard";
            if (!byType.has(name)) byType.set(name, []);
            byType.get(name)!.push(room);
          }
          let typeIdx = 0;
          for (const [typeName, typeRooms] of byType) {
            // Slugify into a unique code (spaces → underscore, uppercase).
            const code = `T${typeIdx++}_${typeName.slice(0, 8).replace(/\s+/g, "_").toUpperCase()}`;
            const rt = await apiFetch<{ id: string }>("/api/v1/rooms/types", {
              method: "POST",
              body: {
                code,
                name: typeName,
                base_price: "1000.00",
                max_occupancy: Math.max(...typeRooms.map((r) => r.max_adults + r.max_children)),
              },
              hotelId: hotel.id,
            });
            for (const room of typeRooms) {
              await apiFetch("/api/v1/rooms", {
                method: "POST",
                body: {
                  room_number: room.room_number,
                  room_type_id: rt.id,
                  bed_type: room.bed_type || null,
                  max_adults: room.max_adults,
                  max_children: room.max_children,
                },
                hotelId: hotel.id,
              });
            }
          }
        } catch {
          failedSteps.push(t("roomInventorySetup"));
        }
      }

      // Step 5 (optional): create service items
      const validServices = services.filter((s) => s.name.trim() && s.price.trim());
      let serviceFailed = false;
      for (const svc of validServices) {
        try {
          await apiFetch("/api/v1/hotels/me/services", {
            method: "POST",
            body: { name: svc.name.trim(), price: svc.price.trim() },
            hotelId: hotel.id,
          });
        } catch {
          serviceFailed = true;
        }
      }
      if (serviceFailed) failedSteps.push(t("specialRequirements"));

      // Step 6 (optional): create additional team members
      // SA bypasses the hotel's team cap (backend: `if not tenant.is_super_admin`).
      // Phone-first — email is not required for staff accounts.
      const validMembers = additionalMembers.filter(
        (m) => m.full_name.trim().length >= 2 && m.phone.trim().length >= 6 && m.password.length >= 8 && m.role_code,
      );
      for (const m of validMembers) {
        try {
          await apiFetch("/api/v1/team", {
            method: "POST",
            body: {
              full_name: m.full_name.trim(),
              phone: m.phone.trim(),
              role_code: m.role_code,
              password: m.password,
            },
            hotelId: hotel.id,
          });
        } catch {
          failedSteps.push(`Staff: ${m.full_name.trim()}`);
        }
      }

      // Step 7 (optional): save feature toggle settings
      if (!emergencyEnabled || !vehicleEnabled) {
        try {
          await apiFetch("/api/v1/hotels/me/settings", {
            method: "PATCH",
            body: {
              collect_emergency_contact: emergencyEnabled,
              collect_vehicle_details: vehicleEnabled,
            },
            hotelId: hotel.id,
          });
        } catch {
          // Non-critical — ignore if settings PATCH fails
        }
      }

      return { hotel, failedSteps };
    },
    onSuccess: ({ hotel, failedSteps }) => {
      toast.success(t("hotelCreated"));
      if (failedSteps.length > 0) {
        toast.warning(`${t("optionalStepsFailed")}: ${failedSteps.join(", ")}`);
      }
      // Clear draft after successful creation.
      try { localStorage.removeItem("dmh.addHotelDraft"); } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
      // Stay on this page to show the QR (if UPI was configured).
      // The action bar swaps to a "View Hotels" button once hotel is created.
      setCreatedHotelId(hotel.id);
      if (upiId.trim()) {
        void pollAndLoadQr(hotel.id);
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  const canSubmit =
    hotelName.trim().length >= 2 &&
    ownerName.trim().length >= 2 &&
    ownerEmail.trim().includes("@") &&
    ownerPassword.length >= 8;

  // --- Additional member helpers ---
  let memberKeySeq = 0;
  const nextMemberKey = () => `m${++memberKeySeq}`;
  const addMember = () =>
    setAdditionalMembers((prev) => [
      ...prev,
      { key: nextMemberKey(), full_name: "", phone: "", role_code: "receptionist", password: "" },
    ]);
  const removeMember = (idx: number) =>
    setAdditionalMembers((prev) => prev.filter((_, i) => i !== idx));
  const updateMember = (idx: number, field: keyof AdditionalMember, value: string) =>
    setAdditionalMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));

  const updateRoom = (idx: number, field: keyof RoomEntry, value: string | number) => {
    setRooms((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };
  const removeRoom = (idx: number) =>
    setRooms((prev) => prev.filter((_, i) => i !== idx));
  const addRoom = () =>
    setRooms((prev) => [
      ...prev,
      { room_number: `10${prev.length + 1}`, room_type: "", bed_type: "", max_adults: 2, max_children: 1 },
    ]);

  const updateService = (idx: number, field: keyof ServiceItem, value: string) => {
    setServices((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };
  const removeService = (idx: number) =>
    setServices((prev) => prev.filter((_, i) => i !== idx));
  const addService = () => setServices((prev) => [...prev, { name: "", price: "" }]);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const edited = await edit(file, { aspect: "square", maxDimension: 900 });
    if (!edited) return;
    setLogoFile(edited);
    const url = URL.createObjectURL(edited);
    setLogoPreview(url);
  };

  const handleGalleryChange = async (pos: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const edited = await edit(file, { aspect: "free", maxDimension: 1600 });
    if (!edited) return;
    const url = URL.createObjectURL(edited);
    setGalleryFiles((prev) => {
      const next = [...prev];
      next[pos] = edited;
      return next;
    });
    setGalleryPreviews((prev) => {
      const next = [...prev];
      next[pos] = url;
      return next;
    });
  };

  const removeGallerySlot = (pos: number) => {
    setGalleryFiles((prev) => { const next = [...prev]; next[pos] = null; return next; });
    setGalleryPreviews((prev) => { const next = [...prev]; next[pos] = null; return next; });
  };

  return (
    // pb-24 (96px): enough clearance for the 66px fixed action bar + safe area.
    // Was !pb-44 (176px) which created a large visible blank white space between
    // the last section and the footer (client screenshot 63563463 "Remove spacing").
    <main className="p-4 space-y-4 max-w-3xl mx-auto !pb-24 sm:p-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t("addNewHotel")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
      </div>

      {/* 1. Access Permissions — 3-tier matching Figma (plan §feature-modes) */}
      <Section icon={Shield} title={t("accessPermissions")} defaultOpen>
        <p className="text-xs text-muted-foreground mb-4">{t("accessPermissionsHint")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              { mode: "checkin_only",    labelKey: "checkinOnlyLabel",    descKey: "checkinOnlyDesc"    },
              { mode: "checkin_expense", labelKey: "checkinExpenseLabel",  descKey: "checkinExpenseDesc" },
              { mode: "full",            labelKey: "fullAccessLabel",      descKey: "fullAccessDesc"     },
            ] as const
          ).map(({ mode, labelKey, descKey }) => {
            const isSelected = accessMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setAccessMode(mode)}
                className={cn(
                  "rounded-xl border-2 p-4 text-left transition-colors",
                  isSelected
                    ? "border-gold-500 bg-gold-50"
                    : "border-border hover:border-gold-300",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                      isSelected ? "border-gold-500 bg-gold-500" : "border-muted-foreground",
                    )}
                  >
                    {isSelected && <div className="size-1.5 rounded-full bg-white" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{t(labelKey)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t(descKey)}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      {/* 2. Property Identity */}
      <Section icon={Building2} title={t("propertyIdentity")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ah-name">{t("hotelName")} *</Label>
            <Input
              id="ah-name"
              value={hotelName}
              onChange={(e) => { setHotelName(e.target.value); setError(null); }}
              placeholder="e.g. Grand Horizon Enterprises"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ah-city">City</Label>
            <Input
              id="ah-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Mumbai"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ah-state">State</Label>
            <Input
              id="ah-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="Maharashtra"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ah-phone">Phone Number</Label>
            <Input
              id="ah-phone"
              value={phone}
              maxLength={12}
              inputMode="tel"
              onChange={(e) => setPhone(sanitizeLandline(e.target.value))}
              placeholder="+91 XXXXXXXXXX"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ah-email">{t("primaryContactEmail")}</Label>
            <Input
              id="ah-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="gm@hotel.com"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ah-address">{t("propertyAddress")}</Label>
            <Input
              id="ah-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, City, State"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ah-gstin">{t("gstin")}</Label>
            <Input
              id="ah-gstin"
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
              placeholder="22AAAAA0000A1Z5"
              maxLength={15}
            />
          </div>
          {/* Map ID */}
          <div className="space-y-1.5">
            <Label htmlFor="ah-mapid" className="flex items-center gap-1">
              <MapPin className="size-3.5 text-muted-foreground" />
              {t("mapId")}
            </Label>
            <Input
              id="ah-mapid"
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              placeholder="Google Maps place/embed ID"
            />
          </div>
        </div>

        {/* Hotel Logo */}
        <div className="mt-4 space-y-1.5">
          <Label>{t("hotelLogo")}</Label>
          <div className="flex items-center gap-3">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview}
                alt="Logo preview"
                className="h-14 w-14 rounded-lg object-cover border border-border"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
                <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
              </div>
            )}
            <div>
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-white px-3 text-xs font-medium hover:bg-muted transition-colors"
              >
                {logoPreview ? t("changeLogo") : t("uploadLogo")}
              </button>
              {logoPreview && (
                <button
                  type="button"
                  onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                  className="ml-2 text-xs text-muted-foreground hover:text-danger"
                >
                  {tc("delete")}
                </button>
              )}
              <p className="mt-1 text-label text-muted-foreground">PNG, JPG, WebP • Max 5 MB</p>
            </div>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={handleLogoChange}
          />
        </div>

        {/* Property Gallery */}
        <div className="mt-4 space-y-1.5">
          <Label>{t("propertyGallery")}</Label>
          <p className="text-label text-muted-foreground">{t("galleryHint")}</p>
          {/* 3 columns on mobile (each ~75px at 375px) → 5 on tablet+ */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {[0, 1, 2, 3, 4].map((pos) => (
              <div key={pos} className="relative">
                <label
                  className="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border transition-colors hover:border-gold-400"
                >
                  {galleryPreviews[pos] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={galleryPreviews[pos]!}
                      alt={`Gallery ${pos + 1}`}
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : (
                    <ImagePlus className="size-4 text-muted-foreground" aria-hidden />
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => handleGalleryChange(pos, e)}
                  />
                </label>
                {galleryPreviews[pos] && (
                  <button
                    type="button"
                    onClick={() => removeGallerySlot(pos)}
                    className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-danger text-white shadow hover:opacity-90"
                    aria-label="Remove"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 3. GST & Rooms Limits */}
      <Section icon={Receipt} title={t("gstRoomsLimits")}>
        <div className="grid gap-6 sm:grid-cols-2">
          {/* GST Types */}
          <div className="space-y-3">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("gstTypes")}
            </Label>
              {(["included_by_hotel", "included_by_customer", "no_gst"] as const).map((opt) => {
              const labels: Record<string, string> = {
                included_by_hotel: t("gstIncludedByHotel"),
                included_by_customer: t("gstIncludedByCustomer"),
                no_gst: t("noGstApplicable"),
              };
              const isSelected = gstType === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setGstType(opt)}
                  className="flex cursor-pointer items-center gap-3 text-left"
                >
                  <div
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                      isSelected ? "border-gold-500 bg-gold-500" : "border-muted-foreground",
                    )}
                  >
                    {isSelected && <div className="size-1.5 rounded-full bg-white" />}
                  </div>
                  <span className="text-sm font-medium">{labels[opt]}</span>
                </button>
              );
            })}
          </div>
          {/* Rooms List */}
          <div className="space-y-1.5">
            <Label htmlFor="ah-total-rooms">{t("totalRooms")}</Label>
            <Input
              id="ah-total-rooms"
              type="number"
              min={0}
              max={9999}
              value={totalRooms}
              onChange={(e) => setTotalRooms(e.target.value)}
              placeholder="25"
            />
            <p className="text-label text-muted-foreground">{t("totalRoomsHint")}</p>
          </div>
          {/* Team size cap (client 15/09, plan §7.1) */}
          <div className="space-y-1.5">
            <Label htmlFor="ah-max-team">{t("maxTeamMembers")}</Label>
            <Input
              id="ah-max-team"
              type="number"
              min={1}
              max={100}
              value={maxTeam}
              onChange={(e) => setMaxTeam(e.target.value)}
              placeholder="5"
            />
            <p className="text-label text-muted-foreground">{t("maxTeamMembersHint")}</p>
          </div>
        </div>
      </Section>

      {/* 3. Create Property Users */}
      <Section icon={Users} title={t("createPropertyUsers")}>
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-full bg-gold-100 text-gold-700">
              <Users className="size-3.5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold">{t("primaryContact")}</p>
              <p className="text-xs text-muted-foreground">{t("primaryContactRequired")}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ah-role">{t("accountRole")}</Label>
              <select
                id="ah-role"
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                defaultValue="owner"
              >
                <option value="owner">Owner</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ah-owner-name">{t("fullName")} *</Label>
              <Input
                id="ah-owner-name"
                value={ownerName}
                onChange={(e) => setOwnerName(liveNameCase(e.target.value))}
                placeholder="Full Name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ah-owner-phone">{t("phoneNumber")}</Label>
              <Input
                id="ah-owner-phone"
                value={ownerPhone}
                maxLength={10}
                inputMode="tel"
                onChange={(e) => setOwnerPhone(sanitizePhone(e.target.value))}
                placeholder="+91 XXXXXXXXXX"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ah-owner-email">{t("ownerEmail")} *</Label>
              <Input
                id="ah-owner-email"
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="owner@hotel.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ah-owner-pw">{t("ownerPassword")} *</Label>
              <PasswordInput
                id="ah-owner-pw"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="Min. 8 characters"
                minLength={8}
                required
              />
            </div>
          </div>
        </div>

        {/* Additional staff accounts (optional) — created after hotel is set up.
            SA bypasses team cap; up to max_team_members are enforceable later. */}
        <div className="mt-4 border-t pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Additional Staff</p>
              <p className="text-xs text-muted-foreground">
                Optional — create staff accounts now. Owner is excluded from the count.
              </p>
            </div>
            {additionalMembers.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground rounded-full border border-border px-2.5 py-1">
                {additionalMembers.length} of {Math.max(1, Number.parseInt(maxTeam, 10) || 5)} added
              </span>
            )}
          </div>
          {additionalMembers.map((m, idx) => (
            <AdditionalMemberRow
              key={m.key}
              entry={m}
              idx={idx}
              onChange={updateMember}
              onRemove={removeMember}
            />
          ))}
          <button
            type="button"
            onClick={addMember}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
          >
            <Plus className="size-4" aria-hidden />
            Create New Account
          </button>
        </div>
      </Section>

      {/* 5. UPI Payment Setup (optional) */}
      <Section icon={CreditCard} title={t("upiSetup")} defaultOpen={false}>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Optional — the owner can configure payment details later in hotel settings.
            The hotel logo (uploaded above) will be composited into the QR center automatically.
          </p>
          {/* Merchant Information card — matches Figma layout */}
          <div className="rounded-lg border border-border p-4">
            <p className="mb-4 text-xs font-semibold text-foreground uppercase tracking-wide">
              {t("merchantInformation")}
            </p>
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              {/* Left: input fields */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ah-merchant-name">{t("merchantName")}</Label>
                  <Input
                    id="ah-merchant-name"
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    placeholder="e.g. Grand Horizon Hotel"
                  />
                  <p className="text-xs text-muted-foreground">
                    This name appears on the guest&apos;s payment app.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ah-upi">{t("gpayUpi")}</Label>
                  <Input
                    id="ah-upi"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="e.g. merchant@okhdfc"
                  />
                </div>
                {/* Note: paymentUrl removed — not required per Figma (client 09/2026) */}
                {!createdHotelId && (
                  <p className="text-xs text-muted-foreground">
                    {t("qrAfterCreation")}
                  </p>
                )}
              </div>

              {/* Right: QR area
                  Before creation → static dot-pattern placeholder
                  After creation + UPI set → live server-generated QR (same as hotel settings) */}
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/20 p-4 text-center min-w-[140px]">
                {createdHotelId && upiId.trim() ? (
                  // Live QR — same display as hotel Settings > Payments (UPI)
                  qrBlobUrl ? (
                    <>
                      <img
                        src={qrBlobUrl}
                        alt="UPI Payment QR"
                        className="size-36 rounded-md border object-contain"
                      />
                      <p className="text-micro font-semibold text-success flex items-center gap-1">
                        <CheckCircle className="size-3.5" aria-hidden />
                        QR Ready
                      </p>
                    </>
                  ) : qrPolling ? (
                    <>
                      <Skeleton className="size-36 rounded-md" />
                      <p className="text-micro text-muted-foreground animate-pulse">
                        <QrCode className="size-3.5 inline mr-1" aria-hidden />
                        Generating QR…
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      QR not ready — check Settings after creation.
                    </p>
                  )
                ) : upiId.trim() ? (
                  // UPI ID is typed but hotel not created yet →
                  // show a "configured" green indicator so staff knows the UPI is set.
                  // The real QR (with hotel logo) will appear here after clicking Add Hotel.
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex size-14 items-center justify-center rounded-full bg-success-bg border border-success/30">
                      <CheckCircle className="size-7 text-success" aria-hidden />
                    </div>
                    <p className="text-xs font-semibold text-success">UPI Configured</p>
                    <p className="text-micro text-muted-foreground leading-tight max-w-[120px]">
                      QR with hotel logo will appear here after clicking Add Hotel
                    </p>
                  </div>
                ) : (
                  // Static placeholder before UPI is entered
                  <>
                    <div className="grid grid-cols-5 gap-0.5 opacity-20 p-1">
                      {[1,1,1,1,1, 1,0,0,0,1, 1,0,1,0,1, 1,0,0,0,1, 1,1,1,1,1].map((fill, i) => (
                        <div
                          key={i}
                          className="size-2.5 rounded-[1px]"
                          style={{ background: fill ? "var(--foreground)" : "transparent" }}
                        />
                      ))}
                    </div>
                    <p className="text-micro text-muted-foreground leading-tight">
                      {t("qrPreviewHint")}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* 5. Room Inventory Setup (optional) */}
      <Section icon={BedDouble} title={t("roomInventorySetup")} defaultOpen={false}>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Optional — add more rooms and room types in the partner portal after creation.
          </p>
          {rooms.map((room, idx) => (
            <RoomRow
              key={idx}
              entry={room}
              idx={idx}
              onChange={updateRoom}
              onRemove={removeRoom}
            />
          ))}
          <button
            type="button"
            onClick={addRoom}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
          >
            <Plus className="size-4" aria-hidden />
            {t("addAnotherRoom")}
          </button>
        </div>
      </Section>

      {/* 6. Special Requirements (optional) */}
      <Section icon={Star} title={t("specialRequirements")} defaultOpen={false}>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Optional — configurable service items (e.g. Airport Pickup, Extra Mattress).
          </p>
          {services.map((svc, idx) => (
            <div key={idx} className="relative grid grid-cols-2 gap-3 rounded-lg border border-border p-4">
              <button
                type="button"
                onClick={() => removeService(idx)}
                className="absolute right-3 top-3 text-muted-foreground hover:text-danger"
                aria-label="Remove"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
              <p className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t("specialReqEntry")} #{idx + 1}
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("reqName")}</Label>
                <select
                  value={svc.name}
                  onChange={(e) => updateService(idx, "name", e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                >
                  <option value="">—</option>
                  <option value="Airport Pickup">Airport Pickup</option>
                  <option value="Extra Mattress">Extra Mattress</option>
                  <option value="Early Check-in">Early Check-in</option>
                  <option value="Late Check-out">Late Check-out</option>
                  <option value="Breakfast">Breakfast</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("reqPrice")} (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={svc.price}
                  onChange={(e) => updateService(idx, "price", e.target.value)}
                  placeholder="500"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addService}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
          >
            <Plus className="size-4" aria-hidden />
            {t("addSpecialReq")}
          </button>
        </div>
      </Section>

      {/* 7. Emergency & Vehicle toggles (restored per client 9-10 feedback) */}
      <Section icon={AlertTriangle} title={t("emergencyVehicle")} defaultOpen={false}>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">{t("emergencyContact")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("emergencyContactDesc")}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={emergencyEnabled}
              onClick={() => setEmergencyEnabled(!emergencyEnabled)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors",
                emergencyEnabled ? "bg-gold-500" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block size-5 rounded-full bg-white shadow ring-0 transition-transform",
                  emergencyEnabled ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>
          <div className="flex items-center justify-between py-2 border-t">
            <div>
              <p className="text-sm font-medium">{t("vehicleDetails")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("vehicleDetailsDesc")}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={vehicleEnabled}
              onClick={() => setVehicleEnabled(!vehicleEnabled)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors",
                vehicleEnabled ? "bg-gold-500" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block size-5 rounded-full bg-white shadow ring-0 transition-transform",
                  vehicleEnabled ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </div>
      </Section>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </div>
      )}

      {/* Sticky bottom action bar
          ─ Before creation: Save Draft + Add Hotel
          ─ After creation : green success banner + View Hotels button
          lg:left-64 keeps the bar inside the content area on desktop. */}
      <div
        className="fixed bottom-0 left-0 right-0 lg:left-64 z-10 border-t border-border bg-white px-4 py-3 shadow-md sm:px-8"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {createdHotelId ? (
          /* ── Post-creation state ── */
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle className="size-4.5 shrink-0" aria-hidden />
              Hotel created successfully!
              {upiId.trim() && (
                <span className="text-xs text-muted-foreground ml-1">
                  {qrPolling ? "— Generating QR…" : qrBlobUrl ? "— QR ready in Payment Setup section above" : ""}
                </span>
              )}
            </div>
            <Button
              type="button"
              onClick={() => router.push("/admin/hotels")}
              className="h-[42px] px-6 bg-navy-900 hover:bg-navy-800 text-white"
            >
              View Hotels
            </Button>
          </div>
        ) : (
          /* ── Pre-creation state ── */
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-[42px] flex-1 px-4 sm:flex-none"
              onClick={() => {
                // Save draft to localStorage for resume later. Image FILES cannot
                // be serialized — warn so the admin knows to re-attach them.
                try {
                  localStorage.setItem("dmh.addHotelDraft", JSON.stringify({
                    hotelName, city, state, phone, address, gstin, email, mapId,
                    gstType, totalRooms, ownerName, ownerEmail, ownerPhone,
                    merchantName, upiId,
                  }));
                  toast.success(t("draftSaved"));
                  if (logoFile || galleryFiles.some(Boolean)) {
                    toast.info(t("draftPhotosNotIncluded"));
                  }
                } catch {
                  router.push("/admin/hotels");
                }
              }}
              disabled={mutation.isPending}
            >
              {t("saveDraft")}
            </Button>
            <Button
              type="button"
              disabled={mutation.isPending || !canSubmit}
              onClick={() => mutation.mutate()}
              className="h-[42px] flex-1 px-4 sm:flex-none bg-navy-900 hover:bg-navy-800 text-white"
            >
              {mutation.isPending ? tc("saving") : t("addHotelBtn")}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

