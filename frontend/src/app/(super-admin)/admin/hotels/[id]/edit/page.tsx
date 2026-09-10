"use client";

/**
 * Super Admin — Full-Page Edit Hotel
 *
 * Mirrors the partner's /edit-hotel page exactly, but:
 *  - Works for ANY hotel (hotel ID from URL params, not auth context)
 *  - Super admins bypass all permission checks server-side (TenantContext)
 *  - Adds an admin-only section: Owner contact + subscription summary
 *  - All partner APIs called with X-Hotel-Id header → hotelId from params
 *
 * Route: /admin/hotels/[id]/edit
 *
 * Key insight: backend deps.py lines 72-78 — if super admin sends
 * X-Hotel-Id, they get full TenantContext with is_super_admin=true and
 * bypass ALL require_permission() checks. So every partner API endpoint
 * (rooms, room types, services, gallery, settings, GST) is accessible.
 */

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ImagePlus,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError, API_BASE, apiUpload } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { compressImage, compressLogo } from "@/lib/compress-image";
import { useImageEditor } from "@/components/media/image-editor";
import { fmtApiDate } from "@/lib/formatting";
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

// ── Types ──────────────────────────────────────────────────────────────────

interface ServiceItem {
  id: string;
  name: string;
  price: string;
  is_active: boolean;
}

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
  base_price: string;
  hourly_rate: string;
  max_occupancy: number;
}

interface ReqEntryState {
  key: string;
  id?: string;
  name: string;
  price: string;
}

interface AdminHotelDetail {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  status: string;
  gstin: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  subscription_plan_name: string | null;
  subscription_status: string | null;
  subscription_expiry: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

function wholeRupees(v: string | null): string {
  if (!v) return "";
  return String(Math.round(Number.parseFloat(v) || 0));
}

function roomTypeCode(name: string): string {
  return (
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) ||
    "type"
  );
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

// ── Section card ───────────────────────────────────────────────────────────

function SectionCard({
  number,
  title,
  children,
}: Readonly<{ number: number; title: string; children: React.ReactNode }>) {
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

// ── Toggle ─────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: Readonly<{ checked: boolean; onChange: (v: boolean) => void; label: string }>) {
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

// ── Authenticated image ────────────────────────────────────────────────────

function AuthedImage({
  path,
  version,
  alt,
  className,
  hotelId,
}: Readonly<{ path: string; version: number; alt: string; className?: string; hotelId: string }>) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    (async () => {
      const headers: Record<string, string> = {};
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      headers["X-Hotel-Id"] = hotelId;
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
  }, [path, version, hotelId]);

  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminEditHotelPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id: hotelId } = use(params);
  const router = useRouter();
  const t = useTranslations("editHotel");
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const { edit } = useImageEditor();

  // apiFetch wrapper that always sends X-Hotel-Id for this specific hotel
  const api = useCallback(
    <T,>(path: string, options?: Parameters<typeof apiFetch>[1]) =>
      apiFetch<T>(path, { hotelId, ...options }),
    [hotelId],
  );

  // ── Queries ──────────────────────────────────────────────────────────────

  const adminDetail = useQuery({
    queryKey: ["admin-hotel-detail", hotelId],
    queryFn: () => apiFetch<AdminHotelDetail>(`/api/v1/super-admin/hotels/${hotelId}`),
    staleTime: 0,
  });

  const hotel = useQuery({
    queryKey: ["admin-edit-hotel", hotelId],
    queryFn: () => api<HotelOut>("/api/v1/hotels/me"),
  });

  const settings = useQuery({
    queryKey: ["admin-edit-hotel-settings", hotelId],
    queryFn: () => api<HotelSettingsOut>("/api/v1/hotels/me/settings"),
  });

  const gst = useQuery({
    queryKey: ["admin-edit-hotel-gst", hotelId],
    queryFn: () => api<GstSettingsOut>("/api/v1/hotels/me/gst"),
  });

  const rooms = useQuery({
    queryKey: ["admin-edit-hotel-rooms", hotelId],
    queryFn: () => api<ListOut<RoomOut>>("/api/v1/rooms?limit=200"),
  });

  const roomTypes = useQuery({
    queryKey: ["admin-edit-hotel-room-types", hotelId],
    queryFn: () => api<ListOut<RoomTypeOut>>("/api/v1/rooms/types"),
  });

  const services = useQuery({
    queryKey: ["admin-edit-hotel-services", hotelId],
    queryFn: () => api<ServiceItem[]>("/api/v1/hotels/me/services"),
  });

  const gallery = useQuery({
    queryKey: ["admin-edit-hotel-gallery", hotelId],
    queryFn: () => api<HotelImageOut[]>("/api/v1/hotels/me/gallery"),
  });

  // ── Section 1 state ──────────────────────────────────────────────────────

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [mapId, setMapId] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [identityInit, setIdentityInit] = useState(false);
  const [gstInit, setGstInit] = useState(false);

  useEffect(() => {
    if (hotel.data && !identityInit) {
      setName(hotel.data.name);
      setPhone(hotel.data.phone ?? "");
      setAddress(hotel.data.address_line1 ?? "");
      setEmail(hotel.data.email ?? "");
      setMapId((hotel.data as { map_id?: string | null }).map_id ?? "");
      setIdentityInit(true);
    }
  }, [hotel.data, identityInit]);

  useEffect(() => {
    if (adminDetail.data && !identityInit) {
      setOwnerPhone(adminDetail.data.owner_phone ?? "");
    }
  }, [adminDetail.data, identityInit]);

  useEffect(() => {
    if (gst.data && !gstInit) {
      setGstin(gst.data.gstin ?? "");
      setGstInit(true);
    }
  }, [gst.data, gstInit]);

  // ── Section 2 state (Rooms) ───────────────────────────────────────────────

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

  // ── Section 3 state (Requirements) ───────────────────────────────────────

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

  // ── Section 4 state (Settings) ───────────────────────────────────────────

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

  // ── Logo upload ───────────────────────────────────────────────────────────

  const [logoVersion, setLogoVersion] = useState(0);

  const logoMutation = useMutation({
    mutationFn: async (file: File) => {
      const upload = await compressLogo(file).catch(() => file);
      const fd = new FormData();
      fd.append("file", upload);
      return apiUpload("/api/v1/hotels/me/payment-config/logo", fd, {
        method: "PUT",
        hotelId,
      });
    },
    onSuccess: () => {
      toast.success(t("logoUploaded"));
      setLogoVersion((v) => v + 1);
    },
    onError: (e) => toast.error(errMsg(e, tc("error"))),
  });

  // ── Gallery upload/delete ─────────────────────────────────────────────────

  const [slotVersions, setSlotVersions] = useState<Record<number, number>>({});
  const bumpSlot = (pos: number) =>
    setSlotVersions((p) => ({ ...p, [pos]: (p[pos] ?? 0) + 1 }));

  const galleryUpload = useMutation({
    mutationFn: async ({ position, file }: { position: number; file: File }) => {
      const upload = await compressImage(file).catch(() => file);
      const fd = new FormData();
      fd.append("file", upload);
      return apiUpload(`/api/v1/hotels/me/gallery/${position}`, fd, {
        method: "PUT",
        hotelId,
      });
    },
    onSuccess: (_data, { position }) => {
      toast.success(t("imageUploaded"));
      bumpSlot(position);
      queryClient.invalidateQueries({ queryKey: ["admin-edit-hotel-gallery", hotelId] });
    },
    onError: (e) => toast.error(errMsg(e, tc("error"))),
  });

  const galleryDelete = useMutation({
    mutationFn: (position: number) =>
      api(`/api/v1/hotels/me/gallery/${position}`, { method: "DELETE" }),
    onSuccess: (_data, position) => {
      toast.success(t("imageDeleted"));
      bumpSlot(position);
      queryClient.invalidateQueries({ queryKey: ["admin-edit-hotel-gallery", hotelId] });
    },
    onError: (e) => toast.error(errMsg(e, tc("error"))),
  });

  // ── Room helpers ──────────────────────────────────────────────────────────

  const updateRoom = (key: string, patch: Partial<RoomEntryState>) =>
    setRoomEntries((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRoom = (key: string) =>
    setRoomEntries((p) => p.filter((r) => r.key !== key));
  const addRoom = () =>
    setRoomEntries((p) => [...p, { key: nextKey(), room_number: "", room_type_id: "", bed_type: "", max_adults: 2, max_children: 0 }]);

  const updateType = (key: string, patch: Partial<RoomTypeEntryState>) =>
    setTypeEntries((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addType = () =>
    setTypeEntries((p) => [...p, { key: nextKey(), name: "", base_price: "", hourly_rate: "", max_occupancy: 2 }]);

  const updateReq = (key: string, patch: Partial<ReqEntryState>) =>
    setReqEntries((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeReq = (key: string) =>
    setReqEntries((p) => p.filter((r) => r.key !== key));
  const addReq = () =>
    setReqEntries((p) => [...p, { key: nextKey(), name: "", price: "" }]);

  // ── Save failures state ───────────────────────────────────────────────────

  const [saveFailures, setSaveFailures] = useState<{ section: string; message: string }[]>([]);

  // ── Main save mutation ────────────────────────────────────────────────────

  const update = useMutation({
    mutationFn: async () => {
      const errors: { section: string; message: string }[] = [];
      const attempt =
        (section: string) =>
        async (op: () => Promise<unknown>) => {
          try {
            await op();
          } catch (e) {
            errors.push({ section, message: errMsg(e, tc("error")) });
          }
        };

      // 1. Hotel identity
      await attempt(t("sectionIdentity"))(() =>
        api("/api/v1/hotels/me", {
          method: "PATCH",
          body: {
            name: name.trim(),
            phone: phone.trim() || null,
            address_line1: address.trim() || null,
            email: email.trim() || null,
            map_id: mapId.trim() || null,
          },
        }),
      );

      // 1b. GSTIN
      const attemptGst = attempt(t("sectionGst"));
      if (gstInit && gstin.trim() !== (gst.data?.gstin ?? "")) {
        await attemptGst(() =>
          api("/api/v1/hotels/me/gst", { method: "PATCH", body: { gstin: gstin.trim() || null } }),
        );
      }

      // 1c. Owner phone (admin only — uses super-admin PATCH endpoint)
      if (ownerPhone.trim() !== (adminDetail.data?.owner_phone ?? "")) {
        await attempt("Owner")(() =>
          apiFetch(`/api/v1/super-admin/hotels/${hotelId}`, {
            method: "PATCH",
            body: { owner_phone: ownerPhone.trim() || null },
          }),
        );
      }

      // 2. Settings
      const attemptSettings = attempt(t("sectionSettings"));
      await attemptSettings(() =>
        api("/api/v1/hotels/me/settings", {
          method: "PATCH",
          body: { collect_emergency_contact: collectEmergency, collect_vehicle_details: collectVehicle },
        }),
      );

      // 3. Room types diff
      const attemptTypes = attempt(t("sectionRoomTypes"));
      for (const entry of typeEntries) {
        const entryName = entry.name.trim();
        if (!entryName || !entry.base_price.trim()) continue;
        const basePrice = String(Math.max(0, Math.round(Number.parseFloat(entry.base_price) || 0)));
        const hourlyTrimmed = entry.hourly_rate.trim();
        const hourlyRate = hourlyTrimmed
          ? String(Math.max(0, Math.round(Number.parseFloat(hourlyTrimmed) || 0)))
          : null;
        if (!entry.id) {
          await attemptTypes(() =>
            api("/api/v1/rooms/types", {
              method: "POST",
              body: { code: roomTypeCode(entryName), name: entryName, base_price: basePrice, hourly_rate: hourlyRate, max_occupancy: entry.max_occupancy },
            }),
          );
        } else {
          const orig = originalTypesRef.current.find((o) => o.id === entry.id);
          const changed = !orig || orig.name !== entryName || wholeRupees(orig.base_price) !== basePrice || (wholeRupees(orig.hourly_rate) || null) !== hourlyRate || orig.max_occupancy !== entry.max_occupancy;
          if (changed) {
            await attemptTypes(() =>
              api(`/api/v1/rooms/types/${entry.id}`, { method: "PATCH", body: { name: entryName, base_price: basePrice, hourly_rate: hourlyRate, max_occupancy: entry.max_occupancy } }),
            );
          }
        }
      }

      // 4. Rooms diff
      const attemptRooms = attempt(t("sectionRooms"));
      const keptIds = new Set(roomEntries.filter((r) => r.id).map((r) => r.id));
      for (const orig of originalRoomsRef.current) {
        if (!keptIds.has(orig.id)) {
          await attemptRooms(() => api(`/api/v1/rooms/${orig.id}`, { method: "DELETE" }));
        }
      }
      for (const entry of roomEntries) {
        if (!entry.room_number.trim() || !entry.room_type_id) continue;
        const body = { room_number: entry.room_number.trim(), room_type_id: entry.room_type_id, bed_type: entry.bed_type || null, max_adults: entry.max_adults, max_children: entry.max_children };
        if (!entry.id) {
          await attemptRooms(() => api("/api/v1/rooms", { method: "POST", body }));
        } else {
          const orig = originalRoomsRef.current.find((o) => o.id === entry.id);
          const changed = !orig || orig.room_number !== body.room_number || orig.room_type_id !== body.room_type_id || (orig.bed_type ?? null) !== body.bed_type || (orig.max_adults ?? null) !== body.max_adults || (orig.max_children ?? null) !== body.max_children;
          if (changed) {
            await attemptRooms(() => api(`/api/v1/rooms/${entry.id}`, { method: "PATCH", body }));
          }
        }
      }

      // 5. Requirements diff
      const attemptReqs = attempt(t("sectionRequirements"));
      const keptReqIds = new Set(reqEntries.filter((r) => r.id).map((r) => r.id));
      for (const orig of originalServicesRef.current) {
        if (!keptReqIds.has(orig.id)) {
          await attemptReqs(() => api(`/api/v1/hotels/me/services/${orig.id}`, { method: "PATCH", body: { is_active: false } }));
        }
      }
      for (const entry of reqEntries) {
        const entryName = entry.name.trim();
        const entryPrice = String(Math.max(0, Math.round(Number.parseFloat(entry.price) || 0)));
        if (entryName.length < 2 || !entry.price.trim()) continue;
        if (!entry.id) {
          await attemptReqs(() => api("/api/v1/hotels/me/services", { method: "POST", body: { name: entryName, price: entryPrice } }));
        } else {
          const orig = originalServicesRef.current.find((o) => o.id === entry.id);
          const origPrice = orig ? String(Math.round(Number.parseFloat(orig.price) || 0)) : "";
          if (!orig || orig.name !== entryName || origPrice !== entryPrice) {
            await attemptReqs(() => api(`/api/v1/hotels/me/services/${entry.id}`, { method: "PATCH", body: { name: entryName, price: entryPrice } }));
          }
        }
      }

      return errors;
    },
    onSuccess: async (errors) => {
      setSaveFailures(errors);
      if (errors.length === 0) {
        toast.success(ta("hotelUpdated"));
      } else {
        toast.error(t("partialSaveError"));
      }
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["admin-edit-hotel", hotelId] }),
        queryClient.refetchQueries({ queryKey: ["admin-edit-hotel-settings", hotelId] }),
        queryClient.refetchQueries({ queryKey: ["admin-edit-hotel-gst", hotelId] }),
        queryClient.refetchQueries({ queryKey: ["admin-edit-hotel-rooms", hotelId] }),
        queryClient.refetchQueries({ queryKey: ["admin-edit-hotel-room-types", hotelId] }),
        queryClient.refetchQueries({ queryKey: ["admin-edit-hotel-services", hotelId] }),
        queryClient.refetchQueries({ queryKey: ["admin-hotel-detail", hotelId] }),
      ]);
      setIdentityInit(false);
      setGstInit(false);
      setRoomsInit(false);
      setTypesInit(false);
      setServicesInit(false);
      setSettingsInit(false);
    },
    onError: (e) => toast.error(errMsg(e, tc("error"))),
  });

  // ── Image helpers ─────────────────────────────────────────────────────────

  const onLogoFile = (file: File | undefined) => {
    if (!file) return;
    void edit(file, { aspect: "square", maxDimension: 900 }).then((f) => {
      if (f) logoMutation.mutate(f);
    });
  };

  const onGalleryFile = (position: number, file: File | undefined) => {
    if (!file) return;
    void edit(file, { aspect: "free", maxDimension: 1600 }).then((f) => {
      if (f) galleryUpload.mutate({ position, file: f });
    });
  };

  const filledPositions = new Set(gallery.data?.map((g) => g.position) ?? []);
  const loading = hotel.isLoading || settings.isLoading || rooms.isLoading;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="p-4 pb-20 space-y-6 max-w-4xl mx-auto sm:p-6">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/hotels"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          {ta("activeHotelsNav")}
        </Link>
        {adminDetail.data && (
          <span className="text-muted-foreground">/</span>
        )}
        {adminDetail.data && (
          <span className="text-sm font-semibold text-foreground">{adminDetail.data.name}</span>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">{ta("editHotel")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {ta("dashboardSubtitle")}
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-6">
          {/* 0. Admin Info (read-only overview) */}
          {adminDetail.data && (
            <div className="rounded-xl border bg-muted/30 p-5 space-y-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Hotel Status
                  </p>
                  <span className={cn(
                    "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    {
                      "bg-success-bg text-success": adminDetail.data.status === "active",
                      "bg-danger-bg text-danger": adminDetail.data.status === "expired",
                      "bg-orange-100 text-orange-700": !["active", "expired"].includes(adminDetail.data.status),
                    },
                  )}>
                    {adminDetail.data.status}
                  </span>
                </div>
                {adminDetail.data.subscription_plan_name && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Subscription
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {adminDetail.data.subscription_plan_name}
                      {adminDetail.data.subscription_status ? ` · ${adminDetail.data.subscription_status}` : ""}
                    </p>
                    {adminDetail.data.subscription_expiry && (
                      <p className="text-xs text-muted-foreground">
                        Expires: {fmtApiDate(adminDetail.data.subscription_expiry)}
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Owner
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {adminDetail.data.owner_name ?? "—"}
                  </p>
                  {adminDetail.data.owner_email && (
                    <p className="text-xs text-muted-foreground">{adminDetail.data.owner_email}</p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-owner-phone" className="text-xs">
                  Owner Phone (editable by admin)
                </Label>
                <Input
                  id="admin-owner-phone"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="10-digit mobile"
                  inputMode="tel"
                  className="max-w-xs"
                />
              </div>
            </div>
          )}

          {/* 1. Property Identity */}
          <SectionCard number={1} title={t("propertyIdentity")}>
            <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="aeh-name">{t("hotelLegalName")}</Label>
                  <Input id="aeh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hotel Name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aeh-phone">{t("phoneNumber")}</Label>
                  <Input id="aeh-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="aeh-address">{t("propertyAddress")}</Label>
                  <Textarea id="aeh-address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aeh-gstin">{t("gstin")}</Label>
                  <Input id="aeh-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" maxLength={15} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aeh-email">{t("primaryContactEmail")}</Label>
                  <Input id="aeh-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="gm@hotel.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aeh-mapid">{t("mapId")}</Label>
                  <Input id="aeh-mapid" value={mapId} onChange={(e) => setMapId(e.target.value)} placeholder="Google Maps ID" />
                </div>
              </div>

              {/* Right: logo + gallery */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>{t("hotelLogo")}</Label>
                  <label
                    className={cn(
                      "relative flex h-32 cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border-2 border-dashed border-border text-center transition-colors hover:border-gold-400",
                      logoMutation.isPending && "pointer-events-none opacity-60",
                    )}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); onLogoFile(e.dataTransfer.files?.[0]); }}
                  >
                    <UploadCloud className="size-5 text-muted-foreground" aria-hidden />
                    <span className="text-xs font-medium text-muted-foreground">{t("dragDropLogo")}</span>
                    <AuthedImage path="/api/v1/hotels/me/logo/image" version={logoVersion} alt={t("hotelLogo")} className="absolute inset-0 size-full bg-card object-contain p-2" hotelId={hotelId} />
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={logoMutation.isPending} onChange={(e) => { onLogoFile(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("propertyGallery")}</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2, 3, 4].map((pos) => (
                      <div key={pos} className="relative">
                        <label className={cn("relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border transition-colors hover:border-gold-400", galleryUpload.isPending && "pointer-events-none opacity-60")}>
                          <ImagePlus className="size-4 text-muted-foreground" />
                          {filledPositions.has(pos) && (
                            <AuthedImage path={`/api/v1/hotels/me/gallery/${pos}/image`} version={slotVersions[pos] ?? 0} alt={`Gallery ${pos + 1}`} className="absolute inset-0 size-full object-cover" hotelId={hotelId} />
                          )}
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={galleryUpload.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) onGalleryFile(pos, f); e.target.value = ""; }} />
                        </label>
                        {filledPositions.has(pos) && (
                          <button type="button" disabled={galleryDelete.isPending} onClick={() => galleryDelete.mutate(pos)} className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-danger text-white shadow hover:opacity-90" aria-label={t("removePhoto")}>
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* 2. Room Inventory */}
          <SectionCard number={2} title={t("roomInventory")}>
            <div className="mb-5 space-y-3 border-b border-border pb-5">
              <p className="text-sm font-semibold">{t("roomTypes")}</p>
              {typeEntries.map((entry) => (
                <div key={entry.key} className="rounded-lg border border-border p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("roomTypeName")}</Label>
                      <Input value={entry.name} onChange={(e) => updateType(entry.key, { name: e.target.value })} placeholder="Deluxe" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("baseRate")}</Label>
                      <Input type="number" min={0} step="1" value={entry.base_price} onChange={(e) => updateType(entry.key, { base_price: e.target.value })} placeholder="2500" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("hourlyRate")}</Label>
                      <Input type="number" min={0} step="1" value={entry.hourly_rate} onChange={(e) => updateType(entry.key, { hourly_rate: e.target.value })} placeholder="—" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("maxOccupancy")}</Label>
                      <select value={entry.max_occupancy} onChange={(e) => updateType(entry.key, { max_occupancy: Number.parseInt(e.target.value, 10) })} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addType} className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gold-400 py-3 text-sm font-medium text-gold-600 hover:bg-gold-50 transition-colors">
                <Plus className="size-4" /> {t("addRoomType")}
              </button>
            </div>
            <div className="space-y-3">
              {roomEntries.map((entry, idx) => (
                <div key={entry.key} className="relative space-y-3 rounded-lg border border-border p-4">
                  <button type="button" onClick={() => removeRoom(entry.key)} className="absolute right-3 top-3 text-danger hover:opacity-75" aria-label={t("removeRoom")}>
                    <Trash2 className="size-4" />
                  </button>
                  <p className="text-sm font-semibold">{t("roomEntry")} #{idx + 1}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("roomNumber")}</Label>
                      <Input value={entry.room_number} onChange={(e) => updateRoom(entry.key, { room_number: e.target.value })} placeholder="101" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("roomType")}</Label>
                      <select value={entry.room_type_id} onChange={(e) => updateRoom(entry.key, { room_type_id: e.target.value })} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                        <option value="">{t("selectRoomType")}</option>
                        {roomTypes.data?.items.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("bedType")}</Label>
                      <select value={entry.bed_type} onChange={(e) => updateRoom(entry.key, { bed_type: e.target.value })} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                        <option value="">—</option>
                        {[{v:"king",l:"King Size"},{v:"queen",l:"Queen Size"},{v:"twin",l:"Twin"},{v:"single",l:"Single"},{v:"double",l:"Double"}].map(b => <option key={b.v} value={b.v}>{b.l}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("maxAdults")}</Label>
                        <select value={entry.max_adults} onChange={(e) => updateRoom(entry.key, { max_adults: Number.parseInt(e.target.value, 10) })} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                          {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("maxChildren")}</Label>
                        <select value={entry.max_children} onChange={(e) => updateRoom(entry.key, { max_children: Number.parseInt(e.target.value, 10) })} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                          {[0,1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addRoom} className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gold-400 py-3 text-sm font-medium text-gold-600 hover:bg-gold-50 transition-colors">
                <Plus className="size-4" /> {t("addAnotherRoom")}
              </button>
            </div>
          </SectionCard>

          {/* 3. Special Requirements */}
          <SectionCard number={3} title={t("specialRequirements")}>
            <div className="space-y-3">
              {reqEntries.map((entry, idx) => (
                <div key={entry.key} className="relative space-y-3 rounded-lg border border-border p-4">
                  <button type="button" onClick={() => removeReq(entry.key)} className="absolute right-3 top-3 text-danger hover:opacity-75" aria-label={t("removeRequirement")}>
                    <Trash2 className="size-4" />
                  </button>
                  <p className="text-sm font-semibold">{t("reqEntry")} #{idx + 1}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("reqName")}</Label>
                      <Input value={entry.name} onChange={(e) => updateReq(entry.key, { name: e.target.value })} placeholder="Airport Pickup" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t("reqPrice")}</Label>
                      <Input type="number" min={0} step="1" value={entry.price} onChange={(e) => updateReq(entry.key, { price: e.target.value })} placeholder="600" />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addReq} className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gold-400 py-3 text-sm font-medium text-gold-600 hover:bg-gold-50 transition-colors">
                <Plus className="size-4" /> {t("addRequirement")}
              </button>
            </div>
          </SectionCard>

          {/* 4. Emergency & Vehicle Details */}
          <SectionCard number={4} title={t("emergencyVehicle")}>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">{t("emergencyContact")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("emergencyContactDesc")}</p>
                </div>
                <Toggle checked={collectEmergency} onChange={setCollectEmergency} label={t("emergencyContact")} />
              </div>
              <div className="flex items-center justify-between border-t py-2">
                <div>
                  <p className="text-sm font-medium">{t("vehicleDetails")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("vehicleDetailsDesc")}</p>
                </div>
                <Toggle checked={collectVehicle} onChange={setCollectVehicle} label={t("vehicleDetails")} />
              </div>
            </div>
          </SectionCard>

          {/* Save failures */}
          {saveFailures.length > 0 && (
            <div className="rounded-xl border border-danger/40 bg-danger-bg p-4" role="alert">
              <p className="text-sm font-semibold text-danger">{t("saveFailuresTitle", { count: saveFailures.length })}</p>
              <ul className="mt-2 space-y-1.5">
                {saveFailures.map((f, i) => (
                  <li key={`${f.section}-${i}`} className="text-sm text-danger">
                    <span className="font-semibold">{f.section}:</span> {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-start gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              disabled={update.isPending || name.trim().length < 2}
              onClick={() => { setSaveFailures([]); update.mutate(); }}
              className="bg-navy-900 px-8 text-white hover:bg-navy-900/90"
            >
              {update.isPending ? tc("saving") : t("update")}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
