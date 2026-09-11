"use client";
/**
 * InlineCameraCapture — opens the front-facing camera inline and captures
 * a JPEG selfie or document photo. Streams the camera feed, captures on
 * button press, returns the File to the parent via onCapture.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera } from "lucide-react";

interface InlineCameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export function InlineCameraCapture({ onCapture, onClose }: InlineCameraCaptureProps) {
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
