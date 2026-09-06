"use client";

/**
 * Add New Hotel — full-page wizard.
 *
 * Sections:
 *  1. Access Permissions   (hotel feature mode: full | checkin_only)
 *  2. Property Identity    (name, city, state, phone, address, GSTIN, email, logo)
 *  3. Create Property User (owner name, phone, email, temp password)
 *  4. UPI Payment Setup    (optional)
 *  5. Room Inventory Setup (optional)
 *  6. Special Requirements (optional)
 *  7. Emergency & Vehicle  (feature toggles)
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Plus,
  Trash2,
  Shield,
  Building2,
  Users,
  CreditCard,
  BedDouble,
  Star,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError, API_BASE } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { compressLogo } from "@/lib/compress-image";
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
          <select
            value={entry.room_type}
            onChange={(e) => onChange(idx, "room_type", e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="">—</option>
            <option value="Deluxe Suite">Deluxe Suite</option>
            <option value="Standard Double">Standard Double</option>
            <option value="Standard Single">Standard Single</option>
            <option value="Premium Suite">Premium Suite</option>
          </select>
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
            onChange={(e) => onChange(idx, "max_adults", parseInt(e.target.value, 10) || 1)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("maxChildren")}</Label>
          <Input
            type="number"
            min={0}
            max={10}
            value={entry.max_children}
            onChange={(e) => onChange(idx, "max_children", parseInt(e.target.value, 10) || 0)}
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

  // --- Section 1: Access Permissions ---
  const [accessMode, setAccessMode] = useState<"full" | "checkin_only">("full");

  // --- Section 2: Property Identity ---
  const [hotelName, setHotelName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // --- Section 3: Owner ---
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");

  // --- Section 4: UPI (optional) ---
  const [upiId, setUpiId] = useState("");

  // --- Section 5: Rooms ---
  const [rooms, setRooms] = useState<RoomEntry[]>([
    { room_number: "101", room_type: "", bed_type: "", max_adults: 2, max_children: 1 },
  ]);

  // --- Section 6: Special requirements ---
  const [services, setServices] = useState<ServiceItem[]>([]);

  // --- Section 7: Feature toggles ---
  const [emergencyEnabled, setEmergencyEnabled] = useState(true);
  const [vehicleEnabled, setVehicleEnabled] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
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
          owner_full_name: ownerName.trim(),
          owner_email: ownerEmail.trim(),
          owner_password: ownerPassword,
          owner_phone: ownerPhone.trim() || null,
          access_mode: accessMode,
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

      // Step 3 (optional): set UPI
      if (upiId.trim()) {
        try {
          await apiFetch("/api/v1/hotels/me/payment-config", {
            method: "PUT",
            body: { upi_id: upiId.trim() },
            hotelId: hotel.id,
          });
        } catch {
          failedSteps.push(t("upiSetup"));
        }
      }

      // Step 4 (optional): create room type + rooms
      const validRooms = rooms.filter((r) => r.room_number.trim() && r.room_type.trim());
      if (validRooms.length > 0) {
        try {
          const rt = await apiFetch<{ id: string }>("/api/v1/rooms/types", {
            method: "POST",
            body: {
              code: "STD",
              name: validRooms[0].room_type || "Standard",
              base_price: "1000.00",
              max_occupancy: Math.max(...validRooms.map((r) => r.max_adults + r.max_children)),
            },
            hotelId: hotel.id,
          });
          for (const room of validRooms) {
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

      // Step 6 (optional): save feature toggle settings
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
          // Non-critical
        }
      }

      return { hotel, failedSteps };
    },
    onSuccess: ({ failedSteps }) => {
      toast.success(t("hotelCreated"));
      if (failedSteps.length > 0) {
        toast.warning(`${t("optionalStepsFailed")}: ${failedSteps.join(", ")}`);
      }
      queryClient.invalidateQueries({ queryKey: ["admin-hotels-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-hotels"] });
      queryClient.invalidateQueries({ queryKey: ["platform-dashboard"] });
      router.push("/admin/hotels");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  const canSubmit =
    hotelName.trim().length >= 2 &&
    ownerName.trim().length >= 2 &&
    ownerEmail.trim().includes("@") &&
    ownerPassword.length >= 8;

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

  return (
    <main className="p-6 space-y-4 max-w-3xl mx-auto pb-20">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("addNewHotel")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
      </div>

      {/* 1. Access Permissions */}
      <Section icon={Shield} title={t("accessPermissions")} defaultOpen>
        <p className="text-xs text-muted-foreground mb-4">{t("accessPermissionsHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["checkin_only", "full"] as const).map((mode) => {
            const isSelected = accessMode === mode;
            const label = mode === "checkin_only" ? t("checkinOnlyLabel") : t("checkinExpenseLabel");
            const desc = mode === "checkin_only" ? t("checkinOnlyDesc") : t("checkinExpenseDesc");
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
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
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
              onChange={(e) => setHotelName(e.target.value)}
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
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 XXXXXXXXXX"
              inputMode="tel"
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
          {/* Hotel Logo */}
          <div className="space-y-1.5">
            <Label>{t("hotelLogo")}</Label>
            <div className="flex items-center gap-3">
              {logoPreview ? (
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
                <p className="mt-1 text-[11px] text-muted-foreground">PNG, JPG, WebP • max 5 MB</p>
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
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Full Name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ah-owner-phone">{t("phoneNumber")}</Label>
              <Input
                id="ah-owner-phone"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                placeholder="+91 XXXXXXXXXX"
                inputMode="tel"
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
              <Input
                id="ah-owner-pw"
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="Min. 8 characters"
                minLength={8}
                required
              />
            </div>
          </div>
        </div>
      </Section>

      {/* 4. UPI Payment Setup (optional) */}
      <Section icon={CreditCard} title={t("upiSetup")} defaultOpen={false}>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Optional — the owner can configure UPI later in hotel settings.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ah-upi">{t("gpayUpi")}</Label>
              <Input
                id="ah-upi"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="e.g. merchant@okhdfc"
              />
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

      {/* 7. Emergency & Vehicle toggles */}
      <Section icon={AlertTriangle} title={t("emergencyVehicle")} defaultOpen={false}>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">{t("emergencyContact")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("emergencyContactDesc")}</p>
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
              <p className="text-xs text-muted-foreground mt-0.5">{t("vehicleDetailsDesc")}</p>
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

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 inset-x-0 z-10 flex items-center justify-end gap-3 border-t border-border bg-white px-8 py-3 shadow-md">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/hotels")}
          disabled={mutation.isPending}
        >
          {tc("cancel")}
        </Button>
        <Button
          type="button"
          disabled={mutation.isPending || !canSubmit}
          onClick={() => mutation.mutate()}
          className="bg-navy-900 hover:bg-navy-800 text-white"
        >
          {mutation.isPending ? tc("saving") : t("addHotelBtn")}
        </Button>
      </div>
    </main>
  );
}
