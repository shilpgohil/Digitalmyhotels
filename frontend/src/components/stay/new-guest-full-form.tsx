"use client";

/**
 * NewGuestFullForm — the full Aadhaar-upload guest creation experience,
 * shared outside the check-in page (used by Advance Booking).
 *
 * Replicates the check-in page's inline walk-in "new guest" UX:
 *  • Three queued document tiles (ID front / ID back / selfie) with
 *    browser-side compression before upload and OCR on the ORIGINAL image.
 *  • Front face  → full OCR (name, DOB, gender, ID number) surfaced through
 *    a confidence banner with an explicit "Auto-fill" accept step.
 *  • Back face   → dedicated Aadhaar address/pincode parser that silently
 *    autofills the address block (address, pincode, city, state).
 *  • Identity fields (name*, phone*, email, gender, DOB) + address block
 *    (pincode, address, city, state, country).
 *
 * Documents are only QUEUED here — the parent creates the guest first
 * (POST /api/v1/guests), then uploads each queued file to
 * POST /api/v1/guests/{id}/documents (side + document_type=id_proof + file),
 * non-blocking for the surrounding flow.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { docAspectFor, useImageEditor } from "@/components/media/image-editor";
import { Camera, Globe, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { compressDocument } from "@/lib/compress-image";
import { localToday } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { getAccessToken } from "@/lib/auth/session";
import { API_BASE, ApiError, apiUpload } from "@/lib/api/client";
import { liveNameCase, sanitizeGuestPhone } from "@/lib/input-discipline";
import { MaskedIdInput } from "@/components/checkin/masked-id-input";
import { AutofillBanner } from "@/components/checkin/autofill-banner";
import type { IdOcrResult } from "@/lib/id-ocr";
import type { ForeignGuestIn, GuestCreatePayload } from "@/types/stay";

export { MaskedIdInput } from "@/components/checkin/masked-id-input";
export { AutofillBanner } from "@/components/checkin/autofill-banner";

/** Which face of an ID document (or selfie) a tile handles. */
export type DocSide = "front" | "back" | "selfie";

/** A document queued for upload once the guest record exists. */
export interface QueuedDoc {
  side: DocSide;
  file: File;
}

// ─── Inline camera capture (desktop selfie) ──────────────────────────────────

/**
 * Inline camera view for desktop selfie capture — opens the front camera via
 * getUserMedia, captures a frame to canvas and returns it as a File.
 */
export function InlineCameraCapture({
  onCapture,
  onClose,
}: {
  readonly onCapture: (file: File) => void;
  readonly onClose: () => void;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("unsupported");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch {
        toast.error(t("cameraUnavailable"));
        onCloseRef.current();
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [t]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error(t("captureFailed"));
          return;
        }
        onCapture(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-gold-400 bg-white p-2">
      {/* Mirrored preview like a front camera */}
      <video
        ref={videoRef}
        muted
        playsInline
        className="w-full rounded-md bg-black -scale-x-100"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-navy-900 px-2 text-xs font-semibold text-white hover:bg-navy-900/90 disabled:opacity-50"
        >
          <Camera className="size-3.5" aria-hidden />
          {t("capture")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center justify-center rounded-lg border px-2 text-xs font-medium hover:bg-muted"
        >
          {tc("cancel")}
        </button>
      </div>
    </div>
  );
}

// ─── Queued document upload tile ─────────────────────────────────────────────

/** Queued doc upload tile — shows preview thumbnail; queues file for upload after guest creation. */
export function QueuedDocUpload({
  side,
  label,
  onQueued,
  onOriginal,
  idType,
}: {
  readonly side: DocSide;
  readonly label: string;
  readonly onQueued: (side: DocSide, file: File) => void;
  /** Receives the ORIGINAL (uncompressed) file — use for OCR, which needs
   *  full resolution. The queued/uploaded file is the compressed copy. */
  readonly onOriginal?: (side: DocSide, file: File) => void;
  /** ID proof type — picks the matching crop frame (Aadhaar card vs passport). */
  readonly idType?: string | null;
}) {
  const t = useTranslations("checkin");
  const { edit } = useImageEditor();
  const [queued, setQueued] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const edited = await edit(file, {
      aspect: docAspectFor(idType, side),
      maxDimension: side === "selfie" ? 1000 : 1800,
    });
    if (!edited) return;
    const previewUrl = URL.createObjectURL(edited);
    setPreview(previewUrl);
    onOriginal?.(side, edited);
    try {
      const compressed = await compressDocument(edited);
      onQueued(side, compressed);
      setQueued(true);
    } catch {
      setPreview(null);
      toast.error(t("processImageFailed"));
    }
  };

  return (
    <div className="space-y-1.5">
      <label
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 overflow-hidden text-center text-xs transition-colors",
          preview
            ? "border-gold-400 p-0 h-40"
            : "border-dashed border-border hover:border-gold-400 hover:bg-gold-50 text-muted-foreground p-4",
        )}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={side === "selfie" ? t("selfieAlt") : t("idDocumentAlt")}
              className={side === "selfie" ? "h-full w-full object-cover" : "h-full w-full bg-navy-900/5 object-contain"}
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gold-500/80 px-2 py-1 text-micro font-semibold text-navy-900 text-center">
              {queued ? t("readyToUpload") : t("processing")}
            </div>
          </>
        ) : (
          <>
            <Upload className="size-5" aria-hidden />
            <span className="font-medium">{label}</span>
          </>
        )}
        <input
          type="file"
          // Selfie tile: any image + front camera on mobile.
          accept={side === "selfie" ? "image/*" : "image/png,image/jpeg,image/webp"}
          capture={side === "selfie" ? "user" : undefined}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {side === "selfie" && !cameraOpen && (
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-label font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
        >
          <Camera className="size-3.5" aria-hidden />
          {t("useCamera")}
        </button>
      )}
      {side === "selfie" && cameraOpen && (
        <InlineCameraCapture
          onCapture={(file) => onFile(file)}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Existing document upload tile (for saved guest) ─────────────────────────

/**
 * DocUpload tile for an existing guest — fetches existing document from B2,
 * displays preview with status badge, and allows re-upload/camera capture.
 */
export function DocUpload({
  guestId,
  side,
  label,
  idType,
  existingDocId,
  onUploaded,
  onOcrResult,
}: {
  readonly guestId: string | null;
  readonly side: DocSide;
  readonly label: string;
  readonly idType?: string;
  /** Existing document ID — pre-fills the tile from B2 on mount. */
  readonly existingDocId?: string | null;
  readonly onUploaded?: () => void;
  readonly onOcrResult?: (result: import("@/lib/id-ocr").IdOcrResult) => void;
}) {
  const t = useTranslations("checkin");
  const { activeHotelId } = useAuth();
  const { edit } = useImageEditor();
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    if (!existingDocId || !guestId || preview) return;
    let cancelled = false;
    setBusy(true);
    const url = `${API_BASE}/api/v1/guests/${guestId}/documents/${existingDocId}/file`;
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (activeHotelId) headers["X-Hotel-Id"] = activeHotelId;
    fetch(url, { headers, credentials: "include" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((blob) => {
        if (!cancelled) {
          setPreview(URL.createObjectURL(blob));
          setUploaded(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [existingDocId, guestId]);

  const onFile = async (file: File | undefined) => {
    if (!file || !guestId) return;
    const edited = await edit(file, {
      aspect: docAspectFor(idType, side),
      maxDimension: side === "selfie" ? 1000 : 1800,
    });
    if (!edited) return;
    setBusy(true);
    const previewUrl = URL.createObjectURL(edited);
    setPreview(previewUrl);
    try {
      const compressed = await compressDocument(edited);

      if ((side === "front" || side === "back") && onOcrResult) {
        setOcrRunning(true);
        const { parseIdDocument } = await import("@/lib/id-ocr");
        parseIdDocument(edited, idType ?? "Aadhar Card", side)
          .then((result) => {
            if (side === "back") {
              const addressOnly = {
                ...result,
                fields: {
                  address: result.fields.address,
                  pincode: result.fields.pincode,
                  city: result.fields.city,
                  state: result.fields.state,
                },
              };
              onOcrResult(addressOnly);
            } else {
              onOcrResult(result);
            }
          })
          .catch(() => toast.warning(t("ocrFailed")))
          .finally(() => setOcrRunning(false));
      }

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
      setPreview(null);
      toast.error(e instanceof ApiError ? e.message : t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  let tileStateClass: string;
  if (preview) {
    tileStateClass = "border-green-400 p-0 h-40";
  } else if (ocrRunning) {
    tileStateClass = "border-gold-400 bg-gold-50 text-gold-700 animate-pulse p-4";
  } else {
    tileStateClass = "border-dashed border-border hover:border-gold-400 hover:bg-gold-50 text-muted-foreground p-4";
  }

  let overlayStatusText: string;
  if (ocrRunning) {
    overlayStatusText = t("readingId");
  } else if (busy) {
    overlayStatusText = t("uploading");
  } else {
    overlayStatusText = t("uploaded");
  }

  let tileLabelText: string;
  if (ocrRunning) {
    tileLabelText = t("readingId");
  } else if (busy) {
    tileLabelText = t("uploading");
  } else {
    tileLabelText = label;
  }

  return (
    <div className="space-y-1.5">
      <label
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 overflow-hidden text-center text-xs transition-colors",
          !guestId && "pointer-events-none opacity-40",
          tileStateClass,
        )}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={side === "selfie" ? t("selfieAlt") : t("idDocumentAlt")}
              className={side === "selfie" ? "h-full w-full object-cover" : "h-full w-full bg-navy-900/5 object-contain"}
            />
            <div
              className={cn(
                "absolute bottom-0 left-0 right-0 px-2 py-1 text-micro font-semibold text-center",
                uploaded ? "bg-success/80 text-white" : "bg-gold-500/80 text-navy-900",
              )}
            >
              {overlayStatusText}
            </div>
          </>
        ) : (
          <>
            <Upload className={cn("size-5", ocrRunning && "animate-spin")} aria-hidden />
            <span className="font-medium">{tileLabelText}</span>
            {ocrRunning && (
              <span className="text-micro text-gold-600">{t("extractingDetails")}</span>
            )}
          </>
        )}
        <input
          type="file"
          accept={side === "selfie" ? "image/*" : "image/png,image/jpeg,image/webp"}
          capture={side === "selfie" ? "user" : undefined}
          className="hidden"
          disabled={!guestId || busy}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {side === "selfie" && !cameraOpen && (
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={!guestId || busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-label font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors disabled:opacity-40"
        >
          <Camera className="size-3.5" aria-hidden />
          {t("useCamera")}
        </button>
      )}
      {side === "selfie" && cameraOpen && (
        <InlineCameraCapture
          onCapture={(file) => onFile(file)}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Foreign Guest Details (Form C) ──────────────────────────────────────────

export interface ForeignGuestFormState {
  passport_number: string;
  passport_place_of_issue: string;
  passport_expiry: string;
  visa_number: string;
  visa_type: string;
  visa_place_of_issue: string;
  visa_expiry: string;
  place_of_birth: string;
  country_of_birth: string;
  nationality: string;
  arrived_in_india_on: string;
  arrival_place: string;
  coming_from_city: string;
  coming_from_country: string;
  next_destination: string;
  next_destination_country: string;
  purpose_of_visit: string;
}

export const EMPTY_FOREIGN_GUEST: ForeignGuestFormState = {
  passport_number: "",
  passport_place_of_issue: "",
  passport_expiry: "",
  visa_number: "",
  visa_type: "",
  visa_place_of_issue: "",
  visa_expiry: "",
  place_of_birth: "",
  country_of_birth: "",
  nationality: "",
  arrived_in_india_on: "",
  arrival_place: "",
  coming_from_city: "",
  coming_from_country: "",
  next_destination: "",
  next_destination_country: "",
  purpose_of_visit: "",
};

export function buildForeignGuestPayload(
  enabled: boolean,
  f: ForeignGuestFormState,
): ForeignGuestIn | null {
  if (!enabled) return null;
  const opt = (v: string) => v.trim() || null;
  return {
    passport_number: f.passport_number.trim(),
    passport_place_of_issue: opt(f.passport_place_of_issue),
    passport_expiry: opt(f.passport_expiry),
    visa_number: opt(f.visa_number),
    visa_type: opt(f.visa_type),
    visa_place_of_issue: opt(f.visa_place_of_issue),
    visa_expiry: opt(f.visa_expiry),
    place_of_birth: opt(f.place_of_birth),
    country_of_birth: opt(f.country_of_birth),
    nationality: opt(f.nationality),
    arrived_in_india_on: opt(f.arrived_in_india_on),
    arrival_place: opt(f.arrival_place),
    coming_from_city: opt(f.coming_from_city),
    coming_from_country: opt(f.coming_from_country),
    next_destination: opt(f.next_destination),
    next_destination_country: opt(f.next_destination_country),
    purpose_of_visit: opt(f.purpose_of_visit),
  };
}

export function ForeignGuestSection({
  enabled,
  onEnabledChange,
  value,
  onChange,
}: {
  readonly enabled: boolean;
  readonly onEnabledChange: (v: boolean) => void;
  readonly value: ForeignGuestFormState;
  readonly onChange: (v: ForeignGuestFormState) => void;
}) {
  const t = useTranslations("checkin");
  const ts = useTranslations("stay");
  const set = (k: keyof ForeignGuestFormState, v: string) =>
    onChange({ ...value, [k]: v });

  const lbl = "text-label font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          className="size-4 rounded border-input"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        <span className="font-medium">{t("foreignGuestToggle")}</span>
      </label>

      {enabled && (
        <div className="rounded-xl border bg-muted/10 p-4 space-y-5">
          <div className="flex items-center gap-2">
            <Globe className="size-4 text-gold-600" aria-hidden />
            <p className="text-sm font-semibold">{t("foreignGuestDetails")}</p>
          </div>

          {/* Passport */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("passport")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className={lbl}>{t("passportNumber")} *</Label>
                <Input
                  value={value.passport_number}
                  onChange={(e) => set("passport_number", e.target.value)}
                  placeholder={t("passportNumber")}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("placeOfIssue")}</Label>
                <Input
                  value={value.passport_place_of_issue}
                  onChange={(e) => set("passport_place_of_issue", e.target.value)}
                  placeholder={t("placeOfIssue")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("passportExpiry")}</Label>
                <DatePicker
                  value={value.passport_expiry}
                  onChange={(v) => set("passport_expiry", v)}
                  min={localToday()}
                />
              </div>
            </div>
          </div>

          {/* Visa */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("visa")}</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label className={lbl}>{t("visaNumber")}</Label>
                <Input
                  value={value.visa_number}
                  onChange={(e) => set("visa_number", e.target.value)}
                  placeholder={t("visaNumber")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("visaType")}</Label>
                <select
                  value={value.visa_type}
                  onChange={(e) => set("visa_type", e.target.value)}
                  className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                >
                  <option value="">{t("selectOption")}</option>
                  <option value="Tourist">{t("visa_tourist")}</option>
                  <option value="Business">{t("visa_business")}</option>
                  <option value="Medical">{t("visa_medical")}</option>
                  <option value="Student">{t("visa_student")}</option>
                  <option value="Employment">{t("visa_employment")}</option>
                  <option value="Other">{t("visa_other")}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("placeOfIssue")}</Label>
                <Input
                  value={value.visa_place_of_issue}
                  onChange={(e) => set("visa_place_of_issue", e.target.value)}
                  placeholder={t("placeOfIssue")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("visaExpiry")}</Label>
                <DatePicker
                  value={value.visa_expiry}
                  onChange={(v) => set("visa_expiry", v)}
                  min={localToday()}
                />
              </div>
            </div>
          </div>

          {/* Personal */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("personal")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className={lbl}>{t("placeOfBirth")}</Label>
                <Input
                  value={value.place_of_birth}
                  onChange={(e) => set("place_of_birth", e.target.value)}
                  placeholder={t("placeOfBirth")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("countryOfBirth")}</Label>
                <Input
                  value={value.country_of_birth}
                  onChange={(e) => set("country_of_birth", e.target.value)}
                  placeholder={t("countryOfBirth")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("nationality")}</Label>
                <Input
                  value={value.nationality}
                  onChange={(e) => set("nationality", e.target.value)}
                  placeholder={t("nationality")}
                />
              </div>
            </div>
          </div>

          {/* Journey */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t("journey")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className={lbl}>{t("arrivedInIndiaOn")}</Label>
                <DatePicker
                  value={value.arrived_in_india_on}
                  onChange={(v) => set("arrived_in_india_on", v)}
                  max={localToday()}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("arrivalPlace")}</Label>
                <Input
                  value={value.arrival_place}
                  onChange={(e) => set("arrival_place", e.target.value)}
                  placeholder={t("phArrivalPort")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("comingFromCity")}</Label>
                <Input
                  value={value.coming_from_city}
                  onChange={(e) => set("coming_from_city", e.target.value)}
                  placeholder={t("phCity")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("comingFromCountry")}</Label>
                <Input
                  value={value.coming_from_country}
                  onChange={(e) => set("coming_from_country", e.target.value)}
                  placeholder={t("phCountry")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("nextDestination")}</Label>
                <Input
                  value={value.next_destination}
                  onChange={(e) => set("next_destination", e.target.value)}
                  placeholder={t("phCityPlace")}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={lbl}>{t("nextDestinationCountry")}</Label>
                <Input
                  value={value.next_destination_country}
                  onChange={(e) => set("next_destination_country", e.target.value)}
                  placeholder={t("phCountry")}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label className={lbl}>{ts("purposeOfVisit")}</Label>
                <Input
                  value={value.purpose_of_visit}
                  onChange={(e) => set("purpose_of_visit", e.target.value)}
                  placeholder={ts("purposeOfVisit")}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Guest Full Form ─────────────────────────────────────────────────────

/**
 * Full identity form for creating a NEW guest: ID type/number, three queued
 * doc tiles (front/back/selfie) with OCR autofill, personal details and a
 * confirm button.
 *
 * NOTE: Aadhaar and document uploads are non-compulsory (optional). Only
 * Full Name and Phone Number are required to create the guest.
 */
export function NewGuestFullForm({
  initialPhone = "",
  initial,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
  beforeConfirm,
}: {
  /** Seeds the mobile field (e.g. the phone that was searched with no match). */
  readonly initialPhone?: string;
  /** Pre-fills the whole form. */
  readonly initial?: Partial<GuestCreatePayload>;
  readonly confirmLabel: string;
  /** Disables the confirm button while the parent is creating the guest. */
  readonly pending?: boolean;
  readonly onConfirm: (form: GuestCreatePayload, docs: QueuedDoc[]) => void;
  /** When provided, renders a Cancel button that closes the form. */
  readonly onCancel?: () => void;
  /** Rendered between the form fields and the confirm button (e.g. Foreign Guest Form C). */
  readonly beforeConfirm?: React.ReactNode;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const tg = useTranslations("guestPicker");
  const [docs, setDocs] = useState<QueuedDoc[]>([]);
  const [ocrResult, setOcrResult] = useState<IdOcrResult | null>(null);
  const [form, setForm] = useState<GuestCreatePayload>({
    full_name: "",
    phone: initialPhone,
    email: "",
    address: "",
    city: "",
    state: "",
    country: "India",
    gender: "",
    date_of_birth: "",
    id_proof_type: "Aadhar Card",
    id_number: "",
    postal_code: "",
    ...initial,
  });

  const set = (k: keyof GuestCreatePayload, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleQueueDoc = (side: DocSide, file: File) =>
    setDocs((prev) => prev.filter((d) => d.side !== side).concat({ side, file }));

  return (
    <div className="space-y-4">
      {/* ID verification */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("idType")}</Label>
          <select
            value={form.id_proof_type}
            onChange={(e) => set("id_proof_type", e.target.value)}
            className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="Aadhar Card">{t("idAadhar")}</option>
            <option value="PAN Card">{t("idPan")}</option>
            <option value="Passport">{t("idPassport")}</option>
            <option value="Driving License">{t("idDrivingLicense")}</option>
            <option value="Voter ID">{t("idVoter")}</option>
          </select>
        </div>
        <MaskedIdInput
          label={t("fieldIdNumber")}
          labelClassName="text-xs"
          value={form.id_number ?? ""}
          idType={form.id_proof_type}
          onChange={(v) => set("id_number", v)}
          placeholder={t("last4Min")}
        />
      </div>

      {/* Doc uploads — front triggers OCR */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <QueuedDocUpload
          side="front"
          label={t("uploadFront")}
          onQueued={handleQueueDoc}
          idType={form.id_proof_type}
          onOriginal={(_side, original) => {
            import("@/lib/id-ocr").then(({ parseIdDocument }) =>
              parseIdDocument(original, form.id_proof_type ?? "Aadhar Card").then(setOcrResult),
            );
          }}
        />
        <QueuedDocUpload
          side="back"
          label={t("uploadBack")}
          onQueued={handleQueueDoc}
          idType={form.id_proof_type}
          onOriginal={(_side, original) => {
            import("@/lib/id-ocr").then(({ parseIdDocument }) =>
              parseIdDocument(original, form.id_proof_type ?? "Aadhar Card", "back").then(
                (result) => {
                  if (result.fields.address) {
                    setForm((prev) => ({
                      ...prev,
                      address: prev.address || result.fields.address || "",
                      postal_code: prev.postal_code || result.fields.pincode || "",
                      city: prev.city || result.fields.city || "",
                      state: prev.state || result.fields.state || "",
                    }));
                    toast.success(t("formAutofilled"));
                  } else {
                    toast.warning(result.message);
                  }
                },
              ),
            );
          }}
        />
        <QueuedDocUpload side="selfie" label={t("selfieCapture")} onQueued={handleQueueDoc} />
      </div>

      {/* OCR autofill banner */}
      {ocrResult && (
        <AutofillBanner
          result={ocrResult}
          onAccept={(fields) => {
            if (fields.name) set("full_name", fields.name);
            if (fields.id_number) set("id_number", fields.id_number);
            if (fields.gender) set("gender", fields.gender);
            if (fields.date_of_birth) set("date_of_birth", fields.date_of_birth);
            if (fields.address) set("address", fields.address);
            if (fields.id_type_detected) set("id_proof_type", fields.id_type_detected);
            setOcrResult(null);
            toast.success(t("guestAutofilled"));
          }}
          onDismiss={() => setOcrResult(null)}
        />
      )}

      {/* Guest details */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{tg("fullName")} *</Label>
          <Input
            value={form.full_name}
            onChange={(e) => set("full_name", liveNameCase(e.target.value))}
            placeholder={tg("fullName")}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{tg("phoneNumber")} *</Label>
          <Input
            value={form.phone}
            onChange={(e) => set("phone", sanitizeGuestPhone(e.target.value))}
            maxLength={15}
            placeholder={t("mobile10")}
            inputMode="tel"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("emailOptional")}</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="email@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldGender")}</Label>
          <select
            value={form.gender}
            onChange={(e) => set("gender", e.target.value)}
            className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="">{t("selectOption")}</option>
            <option value="Male">{t("male")}</option>
            <option value="Female">{t("female")}</option>
            <option value="Other">{t("genderOther")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldDob")}</Label>
          <DatePicker
            value={form.date_of_birth ?? ""}
            onChange={(v) => set("date_of_birth", v)}
            max={localToday()}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("pincode")}</Label>
          <Input
            value={form.postal_code}
            onChange={(e) => set("postal_code", e.target.value)}
            placeholder={t("pincode")}
            inputMode="numeric"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">{t("fieldAddress")}</Label>
          <Input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder={t("fieldAddress")}
          />
        </div>
        {/* City / State / Country — client reference layout (Aadhaar-style). */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldCity")}</Label>
          <Input
            value={form.city ?? ""}
            onChange={(e) => set("city", e.target.value)}
            placeholder={t("fieldCity")}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldState")}</Label>
          <Input
            value={form.state ?? ""}
            onChange={(e) => set("state", e.target.value)}
            placeholder={t("fieldState")}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldCountry")}</Label>
          <Input
            value={form.country ?? ""}
            onChange={(e) => set("country", e.target.value)}
            placeholder={t("fieldCountry")}
          />
        </div>
      </div>

      {/* Slot for Foreign Guest (Form C) etc. — keeps confirm button LAST */}
      {beforeConfirm}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="bg-navy-900 text-white hover:bg-navy-900/90"
          disabled={!form.full_name.trim() || !form.phone.trim() || pending}
          onClick={() => onConfirm({ ...form }, docs)}
        >
          {pending ? tc("saving") : confirmLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
            {tc("cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
