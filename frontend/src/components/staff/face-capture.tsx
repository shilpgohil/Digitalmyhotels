"use client";

/**
 * FaceCapture — face-attendance style selfie capture for staff check-in
 * (client mockup "Staff Self-Service": "Position your face within the frame
 * to record your arrival time").
 *
 * Full-screen dark stage (same treatment as the image editor), mirrored
 * front-camera preview, an oval face frame cut out of a dimmed overlay,
 * guidance text, and a large gold shutter. The captured frame is centre-
 * cropped to a portrait 3:4 around the face area and compressed to a small
 * JPEG (≤720 px) before it is handed to the caller.
 *
 * Callbacks fire EXACTLY once:
 *   onCapture(file) — a selfie was taken.
 *   onSkip()        — camera unavailable OR the user skipped; the caller
 *                     decides whether check-in proceeds without evidence.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ScanFace, X } from "lucide-react";
import { InlineSpinner } from "@/components/ui/inline-spinner";
import { compressSelfie } from "@/lib/compress-image";
import { cn } from "@/lib/utils";

export function FaceCapture({
  onCapture,
  onSkip,
}: {
  readonly onCapture: (file: File) => void;
  readonly onSkip: () => void;
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // Fire a callback at most once, then stop the camera.
  const finish = (cb: () => void) => {
    if (doneRef.current) return;
    doneRef.current = true;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    cb();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
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
        // No camera / permission denied — the check-in continues without
        // a selfie (GPS + audit trail still apply).
        finish(onSkip);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      // Centre-crop portrait 3:4 — matches the oval frame the user aligned to.
      const cropH = vh;
      const cropW = Math.min(vw, Math.round((cropH * 3) / 4));
      const sx = Math.round((vw - cropW) / 2);

      const canvas = document.createElement("canvas");
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(onSkip);
        return;
      }
      // Mirror horizontally so the stored photo matches the preview.
      ctx.translate(cropW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, 0, cropW, cropH, 0, 0, cropW, cropH);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) {
        finish(onSkip);
        return;
      }
      const raw = new File([blob], "selfie.jpg", { type: "image/jpeg" });
      // Always compressed before upload (≤720 px, q0.8).
      const compressed = await compressSelfie(raw);
      finish(() => onCapture(compressed));
    } catch {
      finish(onSkip);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white select-none"
      role="dialog"
      aria-label={t("faceCheckIn")}
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => finish(onSkip)}
          className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-white/10 active:bg-white/20"
          aria-label={tc("cancel")}
        >
          <X className="size-5" aria-hidden />
        </button>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ScanFace className="size-4 text-gold-400" aria-hidden />
          {t("faceCheckIn")}
        </p>
        <span className="size-10" aria-hidden />
      </header>

      {/* Camera stage with oval face frame */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 size-full -scale-x-100 object-cover"
        />
        {/* Dim everything outside the face oval */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={cn(
              "aspect-[3/4] w-[68%] max-w-[320px] rounded-[50%] border-2 transition-colors duration-300",
              "shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]",
              ready ? "border-gold-400" : "border-white/40",
            )}
          />
        </div>
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <InlineSpinner size={28} />
          </div>
        )}
      </div>

      {/* Guidance + shutter */}
      <footer
        className="shrink-0 space-y-4 px-6 pt-4 text-center"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <p className="mx-auto max-w-xs text-sm text-white/70">{t("positionFace")}</p>
        <div className="flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => finish(onSkip)}
            className="text-sm font-medium text-white/60 transition-colors hover:text-white"
          >
            {t("skipSelfie")}
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => void capture()}
            aria-label={t("captureSelfie")}
            className="flex size-16 items-center justify-center rounded-full bg-gold-500 text-navy-900 shadow-[0_0_24px_rgba(212,175,55,0.4)] transition-all hover:bg-gold-400 active:scale-95 disabled:opacity-50"
          >
            {busy ? <InlineSpinner size={22} /> : <ScanFace className="size-7" aria-hidden />}
          </button>
          {/* Spacer to keep the shutter centred against the skip label */}
          <span className="w-14" aria-hidden />
        </div>
      </footer>
    </div>
  );
}
