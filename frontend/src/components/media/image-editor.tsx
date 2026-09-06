"use client";

/**
 * iPhone-style crop / rotate editor used before every image upload.
 * The photo moves under a fixed crop window (drag + wheel zoom), with
 * 90° rotate. Confirm returns a JPEG File; cancel returns null.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { RotateCcw, RotateCw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EditorAspect = "free" | "square";

type EditorRequest = {
  file: File;
  aspect: EditorAspect;
  resolve: (file: File | null) => void;
};

type EditorApi = {
  edit: (file: File, opts?: { aspect?: EditorAspect }) => Promise<File | null>;
};

const EditorContext = createContext<EditorApi | null>(null);

export function useImageEditor(): EditorApi {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    return {
      edit: async (file) => file,
    };
  }
  return ctx;
}

export function ImageEditorProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [request, setRequest] = useState<EditorRequest | null>(null);

  const edit = useCallback((file: File, opts?: { aspect?: EditorAspect }) => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") {
      return Promise.resolve(file);
    }
    return new Promise<File | null>((resolve) => {
      setRequest({ file, aspect: opts?.aspect ?? "free", resolve });
    });
  }, []);

  const close = useCallback(
    (result: File | null) => {
      request?.resolve(result);
      setRequest(null);
    },
    [request],
  );

  const api = useMemo(() => ({ edit }), [edit]);

  return (
    <EditorContext.Provider value={api}>
      {children}
      {request && (
        <ImageEditorDialog
          file={request.file}
          aspect={request.aspect}
          onCancel={() => close(null)}
          onConfirm={(file) => close(file)}
        />
      )}
    </EditorContext.Provider>
  );
}

function ImageEditorDialog({
  file,
  aspect,
  onCancel,
  onConfirm,
}: {
  readonly file: File;
  readonly aspect: EditorAspect;
  readonly onCancel: () => void;
  readonly onConfirm: (file: File) => void;
}) {
  const t = useTranslations("imageEditor");
  const tc = useTranslations("common");
  const viewportRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const cropBox = useMemo(() => {
    // Viewport is 100% of the dark stage; crop is a centered rounded rect.
    const stage = 320;
    if (aspect === "square") return { w: 260, h: 260, stage };
    return { w: 280, h: 200, stage };
  }, [aspect]);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    setNatural({ w, h });
    const fit = Math.max(cropBox.w / w, cropBox.h / h);
    setMinScale(fit);
    setScale(fit);
    setOffset({ x: 0, y: 0 });
    setRotation(0);
  };

  const clampOffset = (x: number, y: number, nextScale: number) => {
    const rw = rotation % 180 === 0 ? natural.w : natural.h;
    const rh = rotation % 180 === 0 ? natural.h : natural.w;
    const dw = rw * nextScale;
    const dh = rh * nextScale;
    const maxX = Math.max(0, (dw - cropBox.w) / 2);
    const maxY = Math.max(0, (dh - cropBox.h) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const nx = drag.current.ox + (e.clientX - drag.current.x);
    const ny = drag.current.oy + (e.clientY - drag.current.y);
    setOffset(clampOffset(nx, ny, scale));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.min(minScale * 4, Math.max(minScale, scale * (e.deltaY < 0 ? 1.08 : 0.92)));
    setScale(next);
    setOffset((o) => clampOffset(o.x, o.y, next));
  };

  const rotate = (dir: -1 | 1) => {
    setRotation((r) => (r + dir * 90 + 360) % 360);
    setOffset({ x: 0, y: 0 });
  };

  const confirm = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(cropBox.w);
      canvas.height = Math.round(cropBox.h);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onConfirm(file);
        return;
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.translate(offset.x, offset.y);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(bitmap, -natural.w / 2, -natural.h / 2);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) {
        onConfirm(file);
        return;
      }
      const name = file.name.replace(/\.[^.]+$/, ".jpg");
      onConfirm(new File([blob], name, { type: "image/jpeg" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white">
      <header className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex size-10 items-center justify-center rounded-full hover:bg-white/10"
          aria-label={tc("cancel")}
        >
          <X className="size-5" />
        </button>
        <p className="text-sm font-medium">{t("title")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
          className="flex size-10 items-center justify-center rounded-full bg-gold-500 text-navy-900 hover:bg-gold-400 disabled:opacity-60"
          aria-label={t("usePhoto")}
        >
          <Check className="size-5" />
        </button>
      </header>

      <div
        ref={viewportRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div
          className="absolute rounded-2xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
          style={{ width: cropBox.w, height: cropBox.h }}
        />
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={onImgLoad}
            className="pointer-events-none select-none"
            style={{
              width: natural.w,
              height: natural.h,
              transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})`,
              transformOrigin: "center center",
            }}
          />
        )}
      </div>

      <footer className="flex items-center justify-center gap-6 px-4 py-5">
        <button
          type="button"
          onClick={() => rotate(-1)}
          className="flex flex-col items-center gap-1 text-xs text-white/80"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-white/10">
            <RotateCcw className="size-5" />
          </span>
          {t("rotateLeft")}
        </button>
        <button
          type="button"
          onClick={() => rotate(1)}
          className="flex flex-col items-center gap-1 text-xs text-white/80"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-white/10">
            <RotateCw className="size-5" />
          </span>
          {t("rotateRight")}
        </button>
        <Button
          type="button"
          variant="outline"
          className={cn("border-white/20 bg-transparent text-white hover:bg-white/10")}
          onClick={() => {
            const fit = Math.max(cropBox.w / natural.w, cropBox.h / natural.h);
            setMinScale(fit);
            setScale(fit);
            setOffset({ x: 0, y: 0 });
            setRotation(0);
          }}
        >
          {t("reset")}
        </Button>
      </footer>
    </div>
  );
}
