"use client";
/**
 * InlineCameraCapture — opens a camera inline for document/selfie capture.
 * Features:
 *  - Front/back camera toggle (staff choose per their workflow).
 *  - "Upload Photo" fallback for devices that block camera access or prefer
 *    gallery selection on mobile.
 *  - Mirrors the preview only when facingMode === "user".
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, FlipHorizontal, Upload } from "lucide-react";

interface InlineCameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Starting camera direction. Defaults to "user" (front) for selfies. */
  initialFacing?: "user" | "environment";
}

export function InlineCameraCapture({ onCapture, onClose, initialFacing = "user" }: InlineCameraCaptureProps) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">(initialFacing);

  // Start (or restart) the camera stream whenever `facing` changes.
  useEffect(() => {
    let cancelled = false;
    setReady(false);

    // Stop any existing stream before opening a new one.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("unsupported");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
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
  }, [facing, t]);

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
        onCapture(new File([blob], "photo.jpg", { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  };

  /** Handle gallery/file selection as an alternative to live capture. */
  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onCapture(file);
    onClose();
  };

  return (
    <div className="space-y-2 rounded-lg border border-gold-400 bg-white p-2">
      {/* Camera preview — mirror only when using the front-facing camera */}
      <video
        ref={videoRef}
        muted
        playsInline
        className={`w-full rounded-md bg-black ${facing === "user" ? "-scale-x-100" : ""}`}
      />
      {/* Hidden file input for gallery fallback */}
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />
      <div className="flex gap-2">
        {/* Capture */}
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-navy-900 px-2 text-xs font-semibold text-white hover:bg-navy-900/90 disabled:opacity-50"
        >
          <Camera className="size-3.5" aria-hidden />
          {t("capture")}
        </button>

        {/* Flip camera */}
        <button
          type="button"
          onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          title={t("switchCamera")}
          aria-label={t("switchCamera")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs hover:bg-muted"
        >
          <FlipHorizontal className="size-3.5" aria-hidden />
        </button>

        {/* Upload from gallery */}
        <button
          type="button"
          onClick={() => uploadRef.current?.click()}
          title={t("uploadPhoto")}
          aria-label={t("uploadPhoto")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs hover:bg-muted"
        >
          <Upload className="size-3.5" aria-hidden />
        </button>

        {/* Cancel */}
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
