"use client";

/**
 * iPhone-style crop / rotate editor used before every image upload.
 *
 * Features:
 * - Drag to pan, pinch/wheel to zoom
 * - 90° rotation buttons (CCW / CW)
 * - Continuous angle ruler (-45° to +45°) — same feel as iPhone Photos
 * - High-resolution output: crops the image at source resolution (not CSS px),
 *   capped at `maxDimension` so downstream compress functions have full-quality
 *   material to work with
 * - Quality 0.94 JPEG (intentionally high so compressDocument / compressLogo
 *   etc. do the final quality pass, avoiding double degradation)
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

// Maximum output dimension when the caller does not specify.
// Docs/ID cards: 2000px to preserve OCR accuracy.
// Logos: caller passes 900.
const DEFAULT_MAX_DIMENSION = 2000;

type EditorRequest = {
  file: File;
  aspect: EditorAspect;
  maxDimension: number;
  resolve: (file: File | null) => void;
};

type EditorApi = {
  edit: (
    file: File,
    opts?: { aspect?: EditorAspect; maxDimension?: number },
  ) => Promise<File | null>;
};

const EditorContext = createContext<EditorApi | null>(null);

export function useImageEditor(): EditorApi {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    // Outside provider — return file unchanged (fallback for tests / SSR).
    return { edit: async (file) => file };
  }
  return ctx;
}

export function ImageEditorProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [request, setRequest] = useState<EditorRequest | null>(null);

  const edit = useCallback(
    (file: File, opts?: { aspect?: EditorAspect; maxDimension?: number }) => {
      if (!file.type.startsWith("image/") || file.type === "image/gif") {
        return Promise.resolve(file);
      }
      return new Promise<File | null>((resolve) => {
        setRequest({
          file,
          aspect: opts?.aspect ?? "free",
          maxDimension: opts?.maxDimension ?? DEFAULT_MAX_DIMENSION,
          resolve,
        });
      });
    },
    [],
  );

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
          maxDimension={request.maxDimension}
          onCancel={() => close(null)}
          onConfirm={(file) => close(file)}
        />
      )}
    </EditorContext.Provider>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal dialog
// ──────────────────────────────────────────────────────────────────────────────

function ImageEditorDialog({
  file,
  aspect,
  maxDimension,
  onCancel,
  onConfirm,
}: {
  readonly file: File;
  readonly aspect: EditorAspect;
  readonly maxDimension: number;
  readonly onCancel: () => void;
  readonly onConfirm: (file: File) => void;
}) {
  const t = useTranslations("imageEditor");
  const tc = useTranslations("common");

  // ── Crop / stage dimensions ──────────────────────────────────────────────
  const cropBox = useMemo(() => {
    if (aspect === "square") return { w: 260, h: 260 };
    return { w: 290, h: 210 };
  }, [aspect]);

  // ── Image state ──────────────────────────────────────────────────────────
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 1, h: 1 });

  // ── Transform state ──────────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** Coarse 90° steps (0 / 1 / 2 / 3 → 0° / 90° / 180° / 270°). */
  const [coarseSteps, setCoarseSteps] = useState(0);
  /** Fine ± angle in degrees, range [-45, 45]. */
  const [fineAngle, setFineAngle] = useState(0);

  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Total rotation in degrees (for CSS transform)
  const totalAngleDeg = coarseSteps * 90 + fineAngle;
  const totalAngleRad = (totalAngleDeg * Math.PI) / 180;

  // ── Load image ───────────────────────────────────────────────────────────
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // ── Compute minScale for a given total angle + natural dimensions ─────────
  // When the image is rotated by a non-cardinal angle, it must be large enough
  // to cover all four corners of the crop box.
  function computeMinScale(w: number, h: number, steps: number, fine: number): number {
    const totalRad = (steps * 90 + fine) * (Math.PI / 180);
    const sinA = Math.abs(Math.sin(totalRad));
    const cosA = Math.abs(Math.cos(totalRad));
    // After 90° steps, effective width/height of the image flips.
    const rw = steps % 2 === 0 ? w : h;
    const rh = steps % 2 === 0 ? h : w;
    return Math.max(
      (cropBox.w * cosA + cropBox.h * sinA) / rw,
      (cropBox.h * cosA + cropBox.w * sinA) / rh,
    );
  }

  // ── On image load: set initial scale ────────────────────────────────────
  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    setNatural({ w, h });
    const fit = computeMinScale(w, h, 0, 0);
    setMinScale(fit);
    setScale(fit);
    setOffset({ x: 0, y: 0 });
    setCoarseSteps(0);
    setFineAngle(0);
  };

  // ── Clamp offset so the image always covers the crop box ─────────────────
  function clampOffset(x: number, y: number, s: number, steps: number): { x: number; y: number } {
    const rw = steps % 2 === 0 ? natural.w : natural.h;
    const rh = steps % 2 === 0 ? natural.h : natural.w;
    const dw = rw * s;
    const dh = rh * s;
    const maxX = Math.max(0, (dw - cropBox.w) / 2);
    const maxY = Math.max(0, (dh - cropBox.h) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }

  // ── Pointer drag ─────────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const nx = drag.current.ox + (e.clientX - drag.current.x);
    const ny = drag.current.oy + (e.clientY - drag.current.y);
    setOffset(clampOffset(nx, ny, scale, coarseSteps));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // ── Wheel zoom ───────────────────────────────────────────────────────────
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.min(
      minScale * 5,
      Math.max(minScale, scale * (e.deltaY < 0 ? 1.1 : 0.9)),
    );
    setScale(next);
    setOffset((o) => clampOffset(o.x, o.y, next, coarseSteps));
  };

  // ── 90° rotate ───────────────────────────────────────────────────────────
  const rotate90 = (dir: -1 | 1) => {
    const next = (coarseSteps + dir + 4) % 4;
    setCoarseSteps(next);
    setFineAngle(0); // reset fine angle on coarse rotation
    const newMin = computeMinScale(natural.w, natural.h, next, 0);
    setMinScale(newMin);
    const newScale = Math.max(scale, newMin);
    setScale(newScale);
    setOffset({ x: 0, y: 0 });
  };

  // ── Fine angle change ─────────────────────────────────────────────────────
  const onFineAngle = (deg: number) => {
    setFineAngle(deg);
    const newMin = computeMinScale(natural.w, natural.h, coarseSteps, deg);
    setMinScale(newMin);
    const newScale = Math.max(scale, newMin);
    if (newScale !== scale) setScale(newScale);
    setOffset((o) => clampOffset(o.x, o.y, newScale, coarseSteps));
  };

  // ── Reset ────────────────────────────────────────────────────────────────
  const reset = () => {
    const fit = computeMinScale(natural.w, natural.h, 0, 0);
    setCoarseSteps(0);
    setFineAngle(0);
    setMinScale(fit);
    setScale(fit);
    setOffset({ x: 0, y: 0 });
  };

  // ── Confirm: crop at source resolution ──────────────────────────────────
  const confirm = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);

      // Compute the output resolution in image pixels:
      //   cropBox_w / scale = how many image pixels span the crop width.
      // Cap at maxDimension to avoid huge files.
      const cropWInImage = cropBox.w / scale;
      const cropHInImage = cropBox.h / scale;
      const longestSide = Math.max(cropWInImage, cropHInImage);
      const pixelScale = Math.min(maxDimension / longestSide, 1 / scale);
      const outW = Math.max(1, Math.round(cropBox.w * pixelScale));
      const outH = Math.max(1, Math.round(cropBox.h * pixelScale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onConfirm(file);
        return;
      }

      // White background (handles transparent PNG edges and rotation).
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, outW, outH);

      // Draw the image with all transforms scaled up by pixelScale.
      ctx.save();
      ctx.translate(outW / 2, outH / 2);
      ctx.translate(offset.x * pixelScale, offset.y * pixelScale);
      ctx.rotate(totalAngleRad);
      ctx.scale(scale * pixelScale, scale * pixelScale);
      ctx.drawImage(bitmap, -natural.w / 2, -natural.h / 2);
      ctx.restore();
      bitmap.close();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.94),
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

  const hasTransform = coarseSteps !== 0 || Math.abs(fineAngle) > 0.4;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white select-none">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="flex size-10 items-center justify-center rounded-full hover:bg-white/10"
          aria-label={tc("cancel")}
        >
          <X className="size-5" />
        </button>
        {hasTransform && (
          <button
            type="button"
            onClick={reset}
            className="text-sm font-semibold text-amber-400 hover:text-amber-300 transition-colors"
          >
            {t("reset")}
          </button>
        )}
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

      {/* ── Crop stage ── */}
      <div
        className="relative min-h-0 flex-1 flex items-center justify-center overflow-hidden touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* Dark overlay with crop window */}
        <div
          className="absolute rounded-[4px] border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] pointer-events-none z-10"
          style={{ width: cropBox.w, height: cropBox.h }}
        />

        {/* Image */}
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={onImgLoad}
            className="pointer-events-none select-none max-w-none max-h-none absolute"
            style={{
              width: natural.w,
              height: natural.h,
              transform: `translate(${offset.x}px, ${offset.y}px) rotate(${totalAngleDeg}deg) scale(${scale})`,
              transformOrigin: "center center",
              willChange: "transform",
            }}
          />
        )}
      </div>

      {/* ── Footer: angle ruler + 90° rotate ── */}
      <footer className="shrink-0 px-4 pb-6 pt-3 space-y-4">
        {/* Angle ruler — iPhone-style tick ruler */}
        <AngleRuler value={fineAngle} onChange={onFineAngle} />

        {/* 90° rotation + hint */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => rotate90(-1)}
            className="flex flex-col items-center gap-1 text-[11px] text-white/70 hover:text-white transition-colors"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors">
              <RotateCcw className="size-4" />
            </span>
            {t("rotateLeft")}
          </button>

          <p className="text-[11px] text-white/40 text-center max-w-[140px]">
            {t("dragZoomHint")}
          </p>

          <button
            type="button"
            onClick={() => rotate90(1)}
            className="flex flex-col items-center gap-1 text-[11px] text-white/70 hover:text-white transition-colors"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors">
              <RotateCw className="size-4" />
            </span>
            {t("rotateRight")}
          </button>
        </div>
      </footer>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Angle Ruler component (iPhone-style tick-mark slider)
// ──────────────────────────────────────────────────────────────────────────────

const RULER_MIN = -45;
const RULER_MAX = 45;
const RULER_STEP = 0.5;
const TICK_EVERY = 5; // major ticks every 5°

function AngleRuler({
  value,
  onChange,
}: {
  readonly value: number;
  readonly onChange: (deg: number) => void;
}) {
  const clamp = (v: number) => Math.min(RULER_MAX, Math.max(RULER_MIN, v));
  const percent = ((value - RULER_MIN) / (RULER_MAX - RULER_MIN)) * 100;

  // Ticks: -45 to +45 every 1°, major every 5°
  const ticks: number[] = [];
  for (let i = RULER_MIN; i <= RULER_MAX; i++) ticks.push(i);

  return (
    <div className="relative px-4">
      {/* Center pointer */}
      <div className="absolute left-1/2 top-0 -translate-x-px w-0.5 h-8 bg-amber-400 z-10 pointer-events-none rounded-full" />

      {/* Current angle label */}
      <div className="mb-1 text-center">
        {Math.abs(value) > 0.3 ? (
          <span className="text-xs font-semibold text-amber-400 tabular-nums">
            {value > 0 ? "+" : ""}
            {value.toFixed(1)}°
          </span>
        ) : (
          <span className="text-xs text-white/30">0°</span>
        )}
      </div>

      {/* Tick ruler (visual only) */}
      <div
        className="relative flex items-end justify-center gap-px overflow-hidden h-8 rounded"
        aria-hidden
      >
        {ticks.map((tick) => {
          const isMajor = tick % TICK_EVERY === 0;
          const dist = Math.abs(tick - value);
          // Fade out distant ticks
          const opacity = Math.max(0.15, 1 - dist / 30);
          return (
            <div
              key={tick}
              className={cn(
                "w-px flex-shrink-0 rounded-full",
                isMajor ? "bg-white/90" : "bg-white/40",
              )}
              style={{
                height: isMajor ? 20 : 10,
                opacity,
                transform: `translateX(${(tick - value) * 6}px)`,
              }}
            />
          );
        })}
      </div>

      {/* The actual range input (invisible but functional) */}
      <input
        type="range"
        min={RULER_MIN}
        max={RULER_MAX}
        step={RULER_STEP}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="absolute inset-x-4 bottom-0 h-full opacity-0 cursor-ew-resize"
        aria-label="Rotation angle"
      />
    </div>
  );
}
