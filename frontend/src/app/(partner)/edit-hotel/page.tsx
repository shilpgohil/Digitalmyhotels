"use client";

/**
 * Edit Hotel — partner-facing full-page form (client Figma: "Edit Hotel Detail").
 *
 * Sections:
 *  1. Property Identity  — hotel profile + logo + property gallery (max 5)
 *  2. Room Inventory     — editable room entries, diffed against existing rooms
 *  3. Special Requirements — check-in service chips (name + whole-rupee price)
 *  4. Emergency & Vehicle — per-hotel flags hiding those check-in sections
 *
 * The footer "Update" button persists sections 1–4 in one pass: hotel PATCH,
 * GST PATCH (GSTIN, permission-gated), settings PATCH (flags), then rooms and
 * services diffs (create / update / delete). Images upload immediately on pick.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { RequirePermission } from "@/components/auth/require-permission";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { ApiError, API_BASE, apiUpload } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { compressImage, compressLogo } from "@/lib/compress-image";
import { useImageEditor } from "@/components/media/image-editor";
import { cn } from "@/lib/utils";
import type {
  GstSettingsOut,
  HotelImageOut,
  HotelOut,
  HotelSettingsOut,
  ListOut,
  RoomOut,
  RoomTypeOut,
} from "@/types/hotel";

const GALLERY_SLOTS = [0, 1, 2, 3, 4] as const;

const BED_TYPES = [
  { value: "king", labelKey: "bedKing" },
  { value: "queen", labelKey: "bedQueen" },
  { value: "twin", labelKey: "bedTwin" },
  { value: "single", labelKey: "bedSingle" },
  { value: "double", labelKey: "bedDouble" },
] as const;

interface RoomEntryState {
  key: string;
  id?: string;
  room_number: string;
  room_type_id: string;
  bed_type: string;
  max_adults: number;
  max_children: number;
}

interface RoomTypeEntryState {
  key: string;
  id?: string;
  name: string;
  /** Whole rupees per night. */
  base_price: string;
  /** Whole rupees per hour; empty = no hourly (day-use falls back to base). */
  hourly_rate: string;
  max_occupancy: number;
}

interface ReqEntryState {
  key: string;
  id?: string;
  name: string;
  price: string;
}

interface ServiceItem {
  id: string;
  name: string;
  price: string;
  is_active: boolean;
}

let entryKeySeq = 0;
const nextKey = () => `e${++entryKeySeq}`;

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** Whole-rupee string from a backend decimal string (e.g. "1500.00" → "1500"). */
function wholeRupees(value: string | null): string {
  if (value === null || value.trim() === "") return "";
  return String(Math.round(Number.parseFloat(value) || 0));
}

/** Derive a room-type code from its name (unique per hotel, enforced server-side). */
function roomTypeCode(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || "type";
}

// ---------------------------------------------------------------------------
// Numbered gold section card (Figma styling)
// ---------------------------------------------------------------------------

function SectionCard({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-t-2 border-t-gold-500 bg-card p-6 shadow-sm">
      <h2 className="mb-5 flex items-center gap-2.5 font-display text-base font-bold text-foreground">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold-100 text-xs font-bold text-gold-700">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Authenticated image — fetches protected image bytes as a blob URL.
// Renders nothing while loading / on 404 so the slot placeholder shows through.
// ---------------------------------------------------------------------------

function AuthedImage({
  path,
  version,
  alt,
  className,
}: {
  readonly path: string;
  readonly version: number;
  readonly alt: string;
  readonly className?: string;
}) {
  const { activeHotelId } = useAuth();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    (async () => {
      const headers: Record<string, string> = {};
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
      const resp = await fetch(`${API_BASE}${path}?v=${version}`, {
        headers,
        credentials: "include",
        cache: "no-store",
      });
      if (!resp.ok || cancelled) return;
      objectUrl = URL.createObjectURL(await resp.blob());
      if (!cancelled) setSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, version, activeHotelId]);

  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

// ---------------------------------------------------------------------------
// Toggle switch (gold, matching the add-hotel wizard)
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors",
        checked ? "bg-gold-500" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-5 rounded-full bg-white shadow ring-0 transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function EditHotelContent() {
  const t = useTranslations("editHotel");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId, can } = useAuth();
  const { edit } = useImageEditor();
  const canGst = can(PERMISSIONS.gstManage);

  // ── Queries ────────────────────────────────────────────────────────────
  const hotel = useQuery({
    queryKey: ["hotel", activeHotelId],
    queryFn: () => api<HotelOut>("/api/v1/hotels/me"),
    enabled: !!activeHotelId,
  });
  const settings = useQuery({
    queryKey: ["hotel-settings", activeHotelId],
    queryFn: () => api<HotelSettingsOut>("/api/v1/hotels/me/settings"),
    enabled: !!activeHotelId,
  });
  const gst = useQuery({
    queryKey: ["gst-settings", activeHotelId],
    queryFn: () => api<GstSettingsOut>("/api/v1/hotels/me/gst"),
    enabled: !!activeHotelId && canGst,
  });
  const rooms = useQuery({
    queryKey: ["rooms", activeHotelId, "edit-hotel"],
    queryFn: () => api<ListOut<RoomOut>>("/api/v1/rooms?limit=200"),
    enabled: !!activeHotelId,
  });
  const roomTypes = useQuery({
    queryKey: ["room-types", activeHotelId],
    queryFn: () => api<ListOut<RoomTypeOut>>("/api/v1/rooms/types"),
    enabled: !!activeHotelId,
  });
  const services = useQuery({
    queryKey: ["hotel-services", activeHotelId],
    queryFn: () => api<ServiceItem[]>("/api/v1/hotels/me/services"),
    enabled: !!activeHotelId,
  });
  const gallery = useQuery({
    queryKey: ["hotel-gallery", activeHotelId],
    queryFn: () => api<HotelImageOut[]>("/api/v1/hotels/me/gallery"),
    enabled: !!activeHotelId,
  });

  // ── Section 1 state ────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [identityInit, setIdentityInit] = useState(false);
  const [gstInit, setGstInit] = useState(false);

  useEffect(() => {
    if (hotel.data && !identityInit) {
      setName(hotel.data.name);
      setPhone(hotel.data.phone ?? "");
      setAddress(hotel.data.address_line1 ?? "");
      setEmail(hotel.data.email ?? "");
      setIdentityInit(true);
    }
  }, [hotel.data, identityInit]);

  useEffect(() => {
    if (gst.data && !gstInit) {
      setGstin(gst.data.gstin ?? "");
      setGstInit(true);
    }
  }, [gst.data, gstInit]);

  // ── Section 2 state ────────────────────────────────────────────────────
  const [roomEntries, setRoomEntries] = useState<RoomEntryState[]>([]);
  const originalRoomsRef = useRef<RoomOut[]>([]);
  const [roomsInit, setRoomsInit] = useState(false);

  useEffect(() => {
    if (rooms.data && !roomsInit) {
      originalRoomsRef.current = rooms.data.items;
      setRoomEntries(
        rooms.data.items.map((r) => ({
          key: nextKey(),
          id: r.id,
          room_number: r.room_number,
          room_type_id: r.room_type_id,
          bed_type: r.bed_type ?? "",
          max_adults: r.max_adults ?? 2,
          max_children: r.max_children ?? 0,
        })),
      );
      setRoomsInit(true);
    }
  }, [rooms.data, roomsInit]);

  // Room types (editable inside Section 2; no DELETE endpoint — types may be
  // referenced by rooms, so removal is intentionally not offered).
  const [typeEntries, setTypeEntries] = useState<RoomTypeEntryState[]>([]);
  const originalTypesRef = useRef<RoomTypeOut[]>([]);
  const [typesInit, setTypesInit] = useState(false);

  useEffect(() => {
    if (roomTypes.data && !typesInit) {
      originalTypesRef.current = roomTypes.data.items;
      setTypeEntries(
        roomTypes.data.items.map((rt) => ({
          key: nextKey(),
          id: rt.id,
          name: rt.name,
          base_price: wholeRupees(rt.base_price),
          hourly_rate: wholeRupees(rt.hourly_rate),
          max_occupancy: rt.max_occupancy,
        })),
      );
      setTypesInit(true);
    }
  }, [roomTypes.data, typesInit]);

  // ── Section 3 state ────────────────────────────────────────────────────
  const [reqEntries, setReqEntries] = useState<ReqEntryState[]>([]);
  const originalServicesRef = useRef<ServiceItem[]>([]);
  const [servicesInit, setServicesInit] = useState(false);

  useEffect(() => {
    if (services.data && !servicesInit) {
      originalServicesRef.current = services.data;
      setReqEntries(
        services.data.map((s) => ({
          key: nextKey(),
          id: s.id,
          name: s.name,
          price: String(Math.round(Number.parseFloat(s.price) || 0)),
        })),
      );
      setServicesInit(true);
    }
  }, [services.data, servicesInit]);

  // ── Section 4 state ────────────────────────────────────────────────────
  const [collectEmergency, setCollectEmergency] = useState(true);
  const [collectVehicle, setCollectVehicle] = useState(true);
  const [settingsInit, setSettingsInit] = useState(false);

  useEffect(() => {
    if (settings.data && !settingsInit) {
      setCollectEmergency(settings.data.collect_emergency_contact);
      setCollectVehicle(settings.data.collect_vehicle_details);
      setSettingsInit(true);
    }
  }, [settings.data, settingsInit]);

  // ── Logo upload (same endpoint + compression as Settings) ─────────────
  const [logoVersion, setLogoVersion] = useState(0);
  const logoMutation = useMutation({
    mutationFn: async (file: File) => {
      const upload = await compressLogo(file).catch(() => file);
      const fd = new FormData();
      fd.append("file", upload);
      return apiUpload("/api/v1/hotels/me/payment-config/logo", fd, {
        method: "PUT",
        hotelId: activeHotelId ?? undefined,
      });
    },
    onSuccess: () => {
      toast.success(t("logoUploaded"));
      setLogoVersion((v) => v + 1);
      queryClient.invalidateQueries({ queryKey: ["payment-config", activeHotelId] });
      // Refresh the sidebar brand logo (PartnerBrand caches the blob URL).
      queryClient.invalidateQueries({ queryKey: ["hotel-logo", activeHotelId] });
    },
    onError: (e) => toast.error(errMessage(e, tc("error"))),
  });

  // ── Gallery upload / delete ────────────────────────────────────────────
  const [slotVersions, setSlotVersions] = useState<Record<number, number>>({});
  const bumpSlot = (pos: number) =>
    setSlotVersions((prev) => ({ ...prev, [pos]: (prev[pos] ?? 0) + 1 }));

  const galleryUpload = useMutation({
    mutationFn: async ({ position, file }: { position: number; file: File }) => {
      const upload = await compressImage(file).catch(() => file);
      const fd = new FormData();
      fd.append("file", upload);
      return apiUpload(`/api/v1/hotels/me/gallery/${position}`, fd, {
        method: "PUT",
        hotelId: activeHotelId ?? undefined,
      });
    },
    onSuccess: (_data, { position }) => {
      toast.success(t("imageUploaded"));
      bumpSlot(position);
      queryClient.invalidateQueries({ queryKey: ["hotel-gallery", activeHotelId] });
    },
    onError: (e) => toast.error(errMessage(e, tc("error"))),
  });

  const galleryDelete = useMutation({
    mutationFn: (position: number) =>
      api(`/api/v1/hotels/me/gallery/${position}`, { method: "DELETE" }),
    onSuccess: (_data, position) => {
      toast.success(t("imageDeleted"));
      bumpSlot(position);
      queryClient.invalidateQueries({ queryKey: ["hotel-gallery", activeHotelId] });
    },
    onError: (e) => toast.error(errMessage(e, tc("error"))),
  });

  // ── Room entry helpers ─────────────────────────────────────────────────
  const updateRoomEntry = (key: string, patch: Partial<RoomEntryState>) =>
    setRoomEntries((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRoomEntry = (key: string) =>
    setRoomEntries((prev) => prev.filter((r) => r.key !== key));
  const addRoomEntry = () =>
    setRoomEntries((prev) => [
      ...prev,
      {
        key: nextKey(),
        room_number: "",
        room_type_id: "",
        bed_type: "",
        max_adults: 2,
        max_children: 0,
      },
    ]);

  // ── Room type entry helpers ────────────────────────────────────────────
  const updateTypeEntry = (key: string, patch: Partial<RoomTypeEntryState>) =>
    setTypeEntries((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addTypeEntry = () =>
    setTypeEntries((prev) => [
      ...prev,
      { key: nextKey(), name: "", base_price: "", hourly_rate: "", max_occupancy: 2 },
    ]);

  // ── Requirement entry helpers ──────────────────────────────────────────
  const updateReqEntry = (key: string, patch: Partial<ReqEntryState>) =>
    setReqEntries((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeReqEntry = (key: string) =>
    setReqEntries((prev) => prev.filter((r) => r.key !== key));
  const addReqEntry = () =>
    setReqEntries((prev) => [...prev, { key: nextKey(), name: "", price: "" }]);

  // ── Save everything (footer Update) ────────────────────────────────────
  // Section-level results (client 9-08 item 15): every failed operation is
  // recorded with the section it belongs to and the REAL API message, then
  // shown in a persistent panel — never just "Some changes could not be
  // saved". Successful sections still commit.
  const [saveFailures, setSaveFailures] = useState<
    { section: string; message: string }[]
  >([]);

  const update = useMutation({
    mutationFn: async () => {
      const errors: { section: string; message: string }[] = [];
      const attemptIn =
        (section: string) => async (op: () => Promise<unknown>) => {
          try {
            await op();
          } catch (e) {
            errors.push({ section, message: errMessage(e, tc("error")) });
          }
        };

      const attempt = attemptIn(t("sectionIdentity"));

      // 1. Hotel identity
      await attempt(() =>
        api("/api/v1/hotels/me", {
          method: "PATCH",
          body: {
            name: name.trim(),
            phone: phone.trim() || null,
            address_line1: address.trim() || null,
            email: email.trim() || null,
          },
        }),
      );

      // 1b. GSTIN (separate settings object, permission-gated)
      const attemptGst = attemptIn(t("sectionGst"));
      if (canGst && gstInit && gstin.trim() !== (gst.data?.gstin ?? "")) {
        await attemptGst(() =>
          api("/api/v1/hotels/me/gst", {
            method: "PATCH",
            body: { gstin: gstin.trim() || null },
          }),
        );
      }

      // 4. Check-in form flags
      const attemptSettings = attemptIn(t("sectionSettings"));
      await attemptSettings(() =>
        api("/api/v1/hotels/me/settings", {
          method: "PATCH",
          body: {
            collect_emergency_contact: collectEmergency,
            collect_vehicle_details: collectVehicle,
          },
        }),
      );

      // 2a. Room types diff — create new, patch changed (no DELETE endpoint:
      // types may be referenced by rooms, so removal is not supported).
      const attemptTypes = attemptIn(t("sectionRoomTypes"));
      for (const entry of typeEntries) {
        const entryName = entry.name.trim();
        if (!entryName || !entry.base_price.trim()) continue;
        const basePrice = String(
          Math.max(0, Math.round(Number.parseFloat(entry.base_price) || 0)),
        );
        const hourlyTrimmed = entry.hourly_rate.trim();
        const hourlyRate = hourlyTrimmed
          ? String(Math.max(0, Math.round(Number.parseFloat(hourlyTrimmed) || 0)))
          : null;
        if (!entry.id) {
          await attemptTypes(() =>
            api("/api/v1/rooms/types", {
              method: "POST",
              body: {
                code: roomTypeCode(entryName),
                name: entryName,
                base_price: basePrice,
                hourly_rate: hourlyRate,
                max_occupancy: entry.max_occupancy,
              },
            }),
          );
        } else {
          const orig = originalTypesRef.current.find((o) => o.id === entry.id);
          const changed =
            !orig ||
            orig.name !== entryName ||
            wholeRupees(orig.base_price) !== basePrice ||
            (wholeRupees(orig.hourly_rate) || null) !== hourlyRate ||
            orig.max_occupancy !== entry.max_occupancy;
          if (changed) {
            await attemptTypes(() =>
              api(`/api/v1/rooms/types/${entry.id}`, {
                method: "PATCH",
                body: {
                  name: entryName,
                  base_price: basePrice,
                  hourly_rate: hourlyRate,
                  max_occupancy: entry.max_occupancy,
                },
              }),
            );
          }
        }
      }

      // 2. Rooms diff — delete removed, create new, patch changed
      const attemptRooms = attemptIn(t("sectionRooms"));
      const keptIds = new Set(roomEntries.filter((r) => r.id).map((r) => r.id));
      for (const orig of originalRoomsRef.current) {
        if (!keptIds.has(orig.id)) {
          await attemptRooms(() => api(`/api/v1/rooms/${orig.id}`, { method: "DELETE" }));
        }
      }
      for (const entry of roomEntries) {
        if (!entry.room_number.trim() || !entry.room_type_id) continue;
        const body = {
          room_number: entry.room_number.trim(),
          room_type_id: entry.room_type_id,
          bed_type: entry.bed_type || null,
          max_adults: entry.max_adults,
          max_children: entry.max_children,
        };
        if (!entry.id) {
          await attemptRooms(() => api("/api/v1/rooms", { method: "POST", body }));
        } else {
          const orig = originalRoomsRef.current.find((o) => o.id === entry.id);
          const changed =
            !orig ||
            orig.room_number !== body.room_number ||
            orig.room_type_id !== body.room_type_id ||
            (orig.bed_type ?? null) !== body.bed_type ||
            (orig.max_adults ?? null) !== body.max_adults ||
            (orig.max_children ?? null) !== body.max_children;
          if (changed) {
            await attemptRooms(() =>
              api(`/api/v1/rooms/${entry.id}`, { method: "PATCH", body }),
            );
          }
        }
      }

      // 3. Special requirements diff — deactivate removed, create new, patch changed
      const attemptReqs = attemptIn(t("sectionRequirements"));
      const keptReqIds = new Set(reqEntries.filter((r) => r.id).map((r) => r.id));
      for (const orig of originalServicesRef.current) {
        if (!keptReqIds.has(orig.id)) {
          await attemptReqs(() =>
            api(`/api/v1/hotels/me/services/${orig.id}`, {
              method: "PATCH",
              body: { is_active: false },
            }),
          );
        }
      }
      for (const entry of reqEntries) {
        const entryName = entry.name.trim();
        const entryPrice = String(Math.max(0, Math.round(Number.parseFloat(entry.price) || 0)));
        if (entryName.length < 2 || !entry.price.trim()) continue;
        if (!entry.id) {
          await attemptReqs(() =>
            api("/api/v1/hotels/me/services", {
              method: "POST",
              body: { name: entryName, price: entryPrice },
            }),
          );
        } else {
          const orig = originalServicesRef.current.find((o) => o.id === entry.id);
          const origPrice = orig ? String(Math.round(Number.parseFloat(orig.price) || 0)) : "";
          if (!orig || orig.name !== entryName || origPrice !== entryPrice) {
            await attemptReqs(() =>
              api(`/api/v1/hotels/me/services/${entry.id}`, {
                method: "PATCH",
                body: { name: entryName, price: entryPrice },
              }),
            );
          }
        }
      }

      return errors;
    },
    onSuccess: (errors) => {
      setSaveFailures(errors);
      if (errors.length === 0) {
        toast.success(t("updated"));
      } else {
        // The persistent panel below the form carries the section-by-section
        // detail; the toast just points at it.
        toast.error(t("partialSaveError"));
      }
      // Refetch + reinitialize every section from fresh server state.
      queryClient.invalidateQueries({ queryKey: ["hotel", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["hotel-settings", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["gst-settings", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["rooms", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["room-types", activeHotelId] });
      queryClient.invalidateQueries({ queryKey: ["hotel-services", activeHotelId] });
      setIdentityInit(false);
      setGstInit(false);
      setRoomsInit(false);
      setTypesInit(false);
      setServicesInit(false);
      setSettingsInit(false);
    },
    onError: (e) => toast.error(errMessage(e, tc("error"))),
  });

  const loading = hotel.isLoading || settings.isLoading || rooms.isLoading;

  const onLogoFile = (file: File | undefined) => {
    if (!file) return;
    void edit(file, { aspect: "square", maxDimension: 900 }).then((framed) => {
      if (framed) logoMutation.mutate(framed);
    });
  };

  const onGalleryFile = (position: number, file: File | undefined) => {
    if (!file) return;
    void edit(file, { aspect: "free", maxDimension: 1600 }).then((framed) => {
      if (framed) galleryUpload.mutate({ position, file: framed });
    });
  };

  const filledPositions = new Set(gallery.data?.map((g) => g.position) ?? []);

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("property")} />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="mx-auto max-w-4xl space-y-4">
            {GALLERY_SLOTS.map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-6 pb-12">
            {/* ── 1. Property Identity ─────────────────────────────────── */}
            <SectionCard number={1} title={t("propertyIdentity")}>
              <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="eh-name">{t("hotelLegalName")}</Label>
                    <Input
                      id="eh-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Grand Horizon Enterprises"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="eh-phone">{t("phoneNumber")}</Label>
                    <Input
                      id="eh-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="9898582678"
                      inputMode="tel"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="eh-address">{t("propertyAddress")}</Label>
                    <Textarea
                      id="eh-address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="eh-gstin">{t("gstin")}</Label>
                    <Input
                      id="eh-gstin"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      placeholder="22AAAAA0000A1Z5"
                      maxLength={15}
                      disabled={!canGst}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="eh-email">{t("primaryContactEmail")}</Label>
                    <Input
                      id="eh-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="gm@hotel.com"
                    />
                  </div>
                </div>

                {/* Right column: logo + gallery */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>{t("hotelLogo")}</Label>
                    <label
                      className={cn(
                        "relative flex h-32 cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border-2 border-dashed border-border text-center transition-colors hover:border-gold-400",
                        logoMutation.isPending && "pointer-events-none opacity-60",
                      )}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        onLogoFile(e.dataTransfer.files?.[0]);
                      }}
                    >
                      <UploadCloud className="size-5 text-muted-foreground" aria-hidden />
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("dragDropLogo")}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {t("clickToUpload")}
                      </span>
                      <AuthedImage
                        path="/api/v1/hotels/me/logo/image"
                        version={logoVersion}
                        alt={t("hotelLogo")}
                        className="absolute inset-0 size-full bg-card object-contain p-2"
                      />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        disabled={logoMutation.isPending}
                        onChange={(e) => {
                          onLogoFile(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t("propertyGallery")}</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {GALLERY_SLOTS.map((pos) => {
                        const filled = filledPositions.has(pos);
                        return (
                          <div key={pos} className="relative">
                            <label
                              className={cn(
                                "relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border transition-colors hover:border-gold-400",
                                galleryUpload.isPending && "pointer-events-none opacity-60",
                              )}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                const file = e.dataTransfer.files?.[0];
                                if (file) onGalleryFile(pos, file);
                              }}
                            >
                              <ImagePlus
                                className="size-4 text-muted-foreground"
                                aria-hidden
                              />
                              {filled && (
                                <AuthedImage
                                  path={`/api/v1/hotels/me/gallery/${pos}/image`}
                                  version={slotVersions[pos] ?? 0}
                                  alt={`${t("propertyGallery")} ${pos + 1}`}
                                  className="absolute inset-0 size-full object-cover"
                                />
                              )}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="sr-only"
                                aria-label={t("uploadPhoto")}
                                disabled={galleryUpload.isPending}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) onGalleryFile(pos, file);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {filled && (
                              <button
                                type="button"
                                aria-label={t("removePhoto")}
                                disabled={galleryDelete.isPending}
                                onClick={() => galleryDelete.mutate(pos)}
                                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-danger text-white shadow hover:opacity-90"
                              >
                                <X className="size-3" aria-hidden />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* ── 2. Room Inventory Setup ──────────────────────────────── */}
            <SectionCard number={2} title={t("roomInventory")}>
              {/* Room Types — compact editable rows (create / edit only; the
                  API has no room-type DELETE since rooms may reference them) */}
              <div className="mb-5 space-y-3 border-b border-border pb-5">
                <p className="text-sm font-semibold text-foreground">{t("roomTypes")}</p>
                {typeEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("roomTypeName")}</Label>
                        <Input
                          value={entry.name}
                          onChange={(e) =>
                            updateTypeEntry(entry.key, { name: e.target.value })
                          }
                          placeholder="Deluxe"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("baseRate")}</Label>
                        <Input
                          type="number"
                          min={0}
                          step="1"
                          value={entry.base_price}
                          onChange={(e) =>
                            updateTypeEntry(entry.key, { base_price: e.target.value })
                          }
                          placeholder="2500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("hourlyRate")}</Label>
                        <Input
                          type="number"
                          min={0}
                          step="1"
                          value={entry.hourly_rate}
                          onChange={(e) =>
                            updateTypeEntry(entry.key, { hourly_rate: e.target.value })
                          }
                          placeholder="—"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("maxOccupancy")}</Label>
                        <select
                          value={entry.max_occupancy}
                          onChange={(e) =>
                            updateTypeEntry(entry.key, {
                              max_occupancy: Number.parseInt(e.target.value, 10),
                            })
                          }
                          className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addTypeEntry}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gold-400 py-3 text-sm font-medium text-gold-600 transition-colors hover:bg-gold-50"
                >
                  <Plus className="size-4" aria-hidden />
                  {t("addRoomType")}
                </button>
              </div>
              <div className="space-y-3">
                {roomEntries.map((entry, idx) => (
                  <div
                    key={entry.key}
                    className="relative space-y-3 rounded-lg border border-border p-4"
                  >
                    <button
                      type="button"
                      onClick={() => removeRoomEntry(entry.key)}
                      className="absolute right-3 top-3 text-danger hover:opacity-75"
                      aria-label={t("removeRoom")}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                    <p className="text-sm font-semibold text-foreground">
                      {t("roomEntry")} #{idx + 1}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("roomNumber")}</Label>
                        <Input
                          value={entry.room_number}
                          onChange={(e) =>
                            updateRoomEntry(entry.key, { room_number: e.target.value })
                          }
                          placeholder="101"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("roomType")}</Label>
                        <select
                          value={entry.room_type_id}
                          onChange={(e) =>
                            updateRoomEntry(entry.key, { room_type_id: e.target.value })
                          }
                          className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                        >
                          <option value="">{t("selectRoomType")}</option>
                          {roomTypes.data?.items.map((rt) => (
                            <option key={rt.id} value={rt.id}>
                              {rt.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("bedType")}</Label>
                        <select
                          value={entry.bed_type}
                          onChange={(e) =>
                            updateRoomEntry(entry.key, { bed_type: e.target.value })
                          }
                          className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                        >
                          <option value="">—</option>
                          {BED_TYPES.map((bt) => (
                            <option key={bt.value} value={bt.value}>
                              {t(bt.labelKey)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">{t("maxAdults")}</Label>
                          <select
                            value={entry.max_adults}
                            onChange={(e) =>
                              updateRoomEntry(entry.key, {
                                max_adults: Number.parseInt(e.target.value, 10),
                              })
                            }
                            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                          >
                            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">{t("maxChildren")}</Label>
                          <select
                            value={entry.max_children}
                            onChange={(e) =>
                              updateRoomEntry(entry.key, {
                                max_children: Number.parseInt(e.target.value, 10),
                              })
                            }
                            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                          >
                            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addRoomEntry}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gold-400 py-3 text-sm font-medium text-gold-600 transition-colors hover:bg-gold-50"
                >
                  <Plus className="size-4" aria-hidden />
                  {t("addAnotherRoom")}
                </button>
              </div>
            </SectionCard>

            {/* ── 3. Special Requirements ──────────────────────────────── */}
            <SectionCard number={3} title={t("specialRequirements")}>
              <div className="space-y-3">
                {reqEntries.map((entry, idx) => (
                  <div
                    key={entry.key}
                    className="relative space-y-3 rounded-lg border border-border p-4"
                  >
                    <button
                      type="button"
                      onClick={() => removeReqEntry(entry.key)}
                      className="absolute right-3 top-3 text-danger hover:opacity-75"
                      aria-label={t("removeRequirement")}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                    <p className="text-sm font-semibold text-foreground">
                      {t("reqEntry")} #{idx + 1}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("reqName")}</Label>
                        <Input
                          value={entry.name}
                          onChange={(e) =>
                            updateReqEntry(entry.key, { name: e.target.value })
                          }
                          placeholder="Airport Pickup"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("reqPrice")}</Label>
                        <Input
                          type="number"
                          min={0}
                          step="1"
                          value={entry.price}
                          onChange={(e) =>
                            updateReqEntry(entry.key, { price: e.target.value })
                          }
                          placeholder="600"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addReqEntry}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gold-400 py-3 text-sm font-medium text-gold-600 transition-colors hover:bg-gold-50"
                >
                  <Plus className="size-4" aria-hidden />
                  {t("addRequirement")}
                </button>
              </div>
            </SectionCard>

            {/* ── 4. Emergency & Vehicle Details ───────────────────────── */}
            <SectionCard number={4} title={t("emergencyVehicle")}>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">{t("emergencyContact")}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("emergencyContactDesc")}
                    </p>
                  </div>
                  <Toggle
                    checked={collectEmergency}
                    onChange={setCollectEmergency}
                    label={t("emergencyContact")}
                  />
                </div>
                <div className="flex items-center justify-between border-t py-2">
                  <div>
                    <p className="text-sm font-medium">{t("vehicleDetails")}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("vehicleDetailsDesc")}
                    </p>
                  </div>
                  <Toggle
                    checked={collectVehicle}
                    onChange={setCollectVehicle}
                    label={t("vehicleDetails")}
                  />
                </div>
              </div>
            </SectionCard>

            {/* ── Section-level save failures (client 9-08 item 15) ────── */}
            {saveFailures.length > 0 && (
              <div
                className="rounded-xl border border-danger/40 bg-danger-bg p-4"
                role="alert"
              >
                <p className="text-sm font-semibold text-danger">
                  {t("saveFailuresTitle", { count: saveFailures.length })}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {saveFailures.map((f, i) => (
                    <li key={`${f.section}-${i}`} className="text-sm text-danger">
                      <span className="font-semibold">{f.section}:</span> {f.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-danger/80">{t("saveFailuresHint")}</p>
              </div>
            )}

            {/* ── Footer ───────────────────────────────────────────────── */}
            <div className="flex justify-start">
              <Button
                type="button"
                disabled={update.isPending || name.trim().length < 2}
                onClick={() => {
                  setSaveFailures([]);
                  update.mutate();
                }}
                className="bg-navy-900 px-8 text-white hover:bg-navy-900/90"
              >
                {update.isPending ? tc("saving") : t("update")}
              </Button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default function EditHotelPage() {
  return (
    <RequirePermission permission={PERMISSIONS.hotelManageSettings}>
      <EditHotelContent />
    </RequirePermission>
  );
}
