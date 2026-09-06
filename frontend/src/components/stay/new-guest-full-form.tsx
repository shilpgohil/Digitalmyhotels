"use client";

/**
 * NewGuestFullForm — the full Aadhaar-upload guest creation experience,
 * shared outside the check-in page (first consumer: Advance Booking).
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
 *
 * NOTE: the check-in page keeps its own inline copy of this form; it could
 * not be extracted at the time this file was created (concurrent edits).
 * OCR + compression logic is NOT duplicated — both use @/lib/id-ocr and
 * @/lib/compress-image; only the form wiring is replicated.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useImageEditor } from "@/components/media/image-editor";
import { AlertTriangle, BadgeCheck, Camera, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { compressDocument } from "@/lib/compress-image";
import { cn } from "@/lib/utils";
import type { IdOcrResult, ParsedIdFields } from "@/lib/id-ocr";
import type { GuestCreatePayload } from "@/types/stay";

/** Which face of an ID document (or selfie) a tile handles. */
export type DocSide = "front" | "back" | "selfie";

/** A document queued for upload once the guest record exists. */
export interface QueuedDoc {
  side: DocSide;
  file: File;
}

// ─── Masked ID input ─────────────────────────────────────────────────────────

/** Mask an ID number, keeping only the last 4 characters visible. */
function maskIdValue(v: string): string {
  if (!v) return "";
  const visible = v.slice(-4);
  return "•".repeat(Math.max(v.length - visible.length, 0)) + visible;
}

/**
 * ID-number field that renders masked (••••••••1234) with a "Show" checkbox
 * beside the label. Raw value stays in parent state — only display toggles.
 * Focusing the input reveals the raw value so it stays editable.
 */
function MaskedIdInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
}) {
  const t = useTranslations("checkin");
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  const masked = !show && !focused;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <label className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            className="size-3 rounded border-input"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
          />
          {t("show")}
        </label>
      </div>
      <Input
        value={masked ? maskIdValue(value) : value}
        onChange={(e) => {
          if (!masked) onChange(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  );
}

// ─── Inline camera capture (desktop selfie) ──────────────────────────────────

/**
 * Inline camera view for desktop selfie capture — opens the front camera via
 * getUserMedia, captures a frame to canvas and returns it as a File.
 */
function InlineCameraCapture({
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
function QueuedDocUpload({
  side,
  label,
  onQueued,
  onOriginal,
}: {
  readonly side: DocSide;
  readonly label: string;
  readonly onQueued: (side: DocSide, file: File) => void;
  /** Receives the ORIGINAL (uncompressed) file — use for OCR, which needs
   *  full resolution. The queued/uploaded file is the compressed copy. */
  readonly onOriginal?: (side: DocSide, file: File) => void;
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
    const edited = await edit(file, { aspect: side === "selfie" ? "square" : "free" });
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
            ? "border-gold-400 p-0 h-28"
            : "border-dashed border-border hover:border-gold-400 hover:bg-gold-50 text-muted-foreground p-4",
        )}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={side === "selfie" ? t("selfieAlt") : t("idDocumentAlt")}
              className="h-full w-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gold-500/80 px-2 py-1 text-[10px] font-semibold text-navy-900 text-center">
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
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium text-muted-foreground hover:border-gold-400 hover:text-gold-600 transition-colors"
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

// ─── OCR autofill banner ─────────────────────────────────────────────────────

/**
 * Shown after front-face OCR completes.
 *  - High confidence → shows extracted fields + "Auto-fill" button.
 *  - Low confidence  → shows warning message only.
 */
function AutofillBanner({
  result,
  onAccept,
  onDismiss,
}: {
  readonly result: IdOcrResult;
  readonly onAccept: (fields: ParsedIdFields) => void;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations("checkin");
  if (!result.can_autofill) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-orange-500 mt-0.5" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold text-orange-700">{t("unableAutofill")}</p>
          <p className="mt-0.5 text-orange-600 text-xs">{result.message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-orange-400 hover:text-orange-600 text-base leading-none"
          aria-label={t("dismiss")}
        >
          ×
        </button>
      </div>
    );
  }

  const { fields } = result;
  const detectedItems = [
    fields.name && { label: t("fieldName"), value: fields.name },
    fields.id_number && { label: t("fieldIdNumber"), value: fields.id_number },
    fields.date_of_birth && { label: t("fieldDob"), value: fields.date_of_birth },
    fields.gender && { label: t("fieldGender"), value: fields.gender },
    fields.address && {
      label: t("fieldAddress"),
      value: fields.address.slice(0, 60) + (fields.address.length > 60 ? "…" : ""),
    },
    fields.pincode && { label: t("pincode"), value: fields.pincode },
    fields.city && { label: t("fieldCity"), value: fields.city },
    fields.state && { label: t("fieldState"), value: fields.state },
  ].filter(Boolean) as { label: string; value: string }[];

  const pct = Math.round(result.confidence * 100);

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-green-200">
        <div className="flex items-center gap-2">
          <BadgeCheck className="size-4 text-green-600" aria-hidden />
          <span className="text-sm font-semibold text-green-800">{t("idDetected")}</span>
          <span className="rounded-full bg-green-200 px-2 py-0.5 text-[10px] font-bold text-green-700">
            {t("confidencePct", { pct })}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-green-400 hover:text-green-600 text-base leading-none"
          aria-label={t("dismiss")}
        >
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {detectedItems.map((item) => (
          <div key={item.label} className="flex gap-2 text-xs">
            <span className="w-24 shrink-0 font-semibold text-green-700">{item.label}</span>
            <span className="text-green-800 truncate">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-green-200 bg-green-50/50">
        <button
          type="button"
          onClick={() => onAccept(fields)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-green-600 px-3 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
        >
          <BadgeCheck className="size-3.5" aria-hidden />
          {t("autofillForm")}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-8 items-center px-3 text-xs font-medium text-green-700 hover:underline"
        >
          {t("skipManual")}
        </button>
      </div>
    </div>
  );
}

// ─── Full new-guest form ─────────────────────────────────────────────────────

/**
 * Full identity form for creating a NEW guest: ID type/number, three queued
 * doc tiles (front/back/selfie) with OCR autofill, personal details and a
 * confirm button. Docs are only QUEUED here — the parent uploads them after
 * the guest record is created.
 */
export function NewGuestFullForm({
  initialPhone = "",
  initial,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
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
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
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
          value={form.id_number ?? ""}
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
          onOriginal={(_side, original) => {
            // OCR runs on the ORIGINAL (full-resolution) image.
            import("@/lib/id-ocr").then(({ parseIdDocument }) =>
              parseIdDocument(original, form.id_proof_type ?? "Aadhar Card").then(setOcrResult),
            );
          }}
        />
        <QueuedDocUpload
          side="back"
          label={t("uploadBack")}
          onQueued={handleQueueDoc}
          onOriginal={(_side, original) => {
            // Back face → dedicated Aadhaar address/pincode parser.
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
            onChange={(e) => set("full_name", e.target.value)}
            placeholder={tg("fullName")}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{tg("phoneNumber")} *</Label>
          <Input
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
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
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="">{t("selectOption")}</option>
            <option value="Male">{t("male")}</option>
            <option value="Female">{t("female")}</option>
            <option value="Other">{t("genderOther")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldDob")}</Label>
          <DatePicker value={form.date_of_birth ?? ""} onChange={(v) => set("date_of_birth", v)} />
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
