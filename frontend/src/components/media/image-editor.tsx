"use client";

/**
 * iPhone-style crop / rotate editor.
 *
 * Mobile (touch):
 *   - Single-finger drag  → pan
 *   - Two-finger pinch    → zoom
 *   - Angle ruler         → PointerEvents drag (replaces range input for reliable iOS support)
 *   - 90° rotate buttons  → tap
 *
 * Desktop (mouse / trackpad):
 *   - Drag  → pan
 *   - Wheel → zoom
 *   - Angle ruler → drag
 *
 * Output: JPEG at source-image resolution (up to `maxDimension`), quality 0.94.
 * This gives the downstream compressors (compressDocument / compressLogo etc.)
 * high-quality material to work with — avoiding double-compression degradation.
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
import { cn } from "@/lib/utils";

/**
 * Crop-frame presets (client 9-08 item 10 — one generic narrow frame does not
 * fit every document):
 *  - "id_card"  → ISO ID-1 ratio (85.6 × 54 mm ≈ 1.586) — Aadhaar, PAN,
 *                 driving licence, voter ID.
 *  - "passport" → passport photo-page ratio (125 × 88 mm ≈ 1.42).
 *  - "square"   → selfies / logos.
 *  - "receipt"  → portrait 3:4 for bills and receipts.
 *  - "free"     → generic landscape frame.
 * The frame sets the INITIAL crop shape; pan/zoom/rotate stay fully free.
 */
export type EditorAspect = "free" | "square" | "id_card" | "passport" | "receipt";

/** Pick the right crop preset for a guest-document upload. */
export function docAspectFor(idType: string | null | undefined, side: string): EditorAspect {
  if (side === "selfie") return "square";
  const t = (idType ?? "").toLowerCase();
  if (t.includes("passport")) return "passport";
  // Aadhaar, PAN, driving licence, voter ID — all ISO ID-1 cards.
  return "id_card";
}

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
  if (!ctx) return { edit: async (file) => file };
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

// ─── Internal dialog ──────────────────────────────────────────────────────────

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

  const initialBox = useMemo(() => {
    switch (aspect) {
      case "square":
        return { w: 260, h: 260 };
      case "id_card":
        // ISO ID-1 card ratio 1.586 — wider frame so Aadhaar/DL text is legible
        // (client 9-08 item 10: "increase width as per the Aadharcard and DL").
        return { w: 380, h: 240 };
      case "passport":
        // Passport photo-page ratio ≈ 1.42.
        return { w: 312, h: 220 };
      case "receipt":
        return { w: 240, h: 320 };
      default:
        return { w: 290, h: 210 };
    }
  }, [aspect]);

  // FREE crop (client 09/2026): the preset only sets the INITIAL frame — the
  // user can drag any corner handle to resize the frame to ANY ratio.
  const [cropBox, setCropBox] = useState(initialBox);
  useEffect(() => setCropBox(initialBox), [initialBox]);

  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [coarseSteps, setCoarseSteps] = useState(0); // 0–3 → 0/90/180/270 °
  const [fineAngle, setFineAngle] = useState(0);     // −45 … +45 °
  const [busy, setBusy] = useState(false);

  const totalAngleDeg = coarseSteps * 90 + fineAngle;
  const totalAngleRad = (totalAngleDeg * Math.PI) / 180;

  // Pointer drag state (handles both mouse and single-touch via PointerEvents).
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // Pinch-to-zoom state (two active touch points).
  const pinch = useRef<{ dist: number; scale0: number } | null>(null);
  // Crop-frame corner resize state (free crop — any ratio).
  const frameResize = useRef<{
    x: number;
    y: number;
    w0: number;
    h0: number;
    sx: -1 | 1; // horizontal sign of the dragged corner
    sy: -1 | 1; // vertical sign of the dragged corner
  } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function computeMinScaleFor(
    box: { w: number; h: number },
    w: number,
    h: number,
    steps: number,
    fine: number,
  ): number {
    const totalRad = (steps * 90 + fine) * (Math.PI / 180);
    const sinA = Math.abs(Math.sin(totalRad));
    const cosA = Math.abs(Math.cos(totalRad));
    const rw = steps % 2 === 0 ? w : h;
    const rh = steps % 2 === 0 ? h : w;
    return Math.max(
      (box.w * cosA + box.h * sinA) / rw,
      (box.h * cosA + box.w * sinA) / rh,
    );
  }

  function computeMinScale(w: number, h: number, steps: number, fine: number): number {
    return computeMinScaleFor(cropBox, w, h, steps, fine);
  }

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

  function clampOffset(x: number, y: number, s: number, steps: number) {
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

  // ── Pointer events (mouse + single-touch pan) ──────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    // Only handle single touch / mouse left button — two-touch is handled by Touch events.
    if (e.pointerType === "touch") {
      // Let touchstart count active pointers before deciding whether to pan.
      // We still need to capture to receive pointermove events.
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    // Skip pan when pinching.
    if (pinch.current) return;
    if (!drag.current) return;
    const nx = drag.current.ox + (e.clientX - drag.current.x);
    const ny = drag.current.oy + (e.clientY - drag.current.y);
    setOffset(clampOffset(nx, ny, scale, coarseSteps));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // ── Touch events (pinch-to-zoom) ────────────────────────────────────────────
  function touchDist(t: React.TouchList): number {
    if (t.length < 2) return 0;
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Two fingers → enter pinch mode, disable pan.
      drag.current = null;
      pinch.current = { dist: touchDist(e.touches), scale0: scale };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinch.current) {
      e.preventDefault(); // stop page scroll while pinching
      const dist = touchDist(e.touches);
      if (pinch.current.dist === 0) return;
      const ratio = dist / pinch.current.dist;
      const next = Math.min(
        minScale * 5,
        Math.max(minScale, pinch.current.scale0 * ratio),
      );
      setScale(next);
      setOffset((o) => clampOffset(o.x, o.y, next, coarseSteps));
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinch.current = null;
  };

  // ── Crop-frame corner resize (free crop, any ratio) ────────────────────────
  const MIN_FRAME = 90;

  const onHandleDown = (sx: -1 | 1, sy: -1 | 1) => (e: React.PointerEvent) => {
    e.stopPropagation(); // don't start a pan
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    frameResize.current = {
      x: e.clientX,
      y: e.clientY,
      w0: cropBox.w,
      h0: cropBox.h,
      sx,
      sy,
    };
  };

  const onHandleMove = (e: React.PointerEvent) => {
    const fr = frameResize.current;
    if (!fr) return;
    e.stopPropagation();
    // The frame stays centred in the stage, so dragging a corner outward by
    // d grows the box by 2d on that axis.
    const stage = stageRef.current?.getBoundingClientRect();
    const maxW = stage ? stage.width - 24 : 600;
    const maxH = stage ? stage.height - 24 : 600;
    const nw = Math.min(maxW, Math.max(MIN_FRAME, fr.w0 + 2 * fr.sx * (e.clientX - fr.x)));
    const nh = Math.min(maxH, Math.max(MIN_FRAME, fr.h0 + 2 * fr.sy * (e.clientY - fr.y)));
    const box = { w: Math.round(nw), h: Math.round(nh) };
    setCropBox(box);
    // Keep the image covering the (possibly larger) frame.
    const newMin = computeMinScaleFor(box, natural.w, natural.h, coarseSteps, fineAngle);
    setMinScale(newMin);
    setScale((s) => {
      const ns = Math.max(s, newMin);
      setOffset((o) => {
        const rw = coarseSteps % 2 === 0 ? natural.w : natural.h;
        const rh = coarseSteps % 2 === 0 ? natural.h : natural.w;
        const maxX = Math.max(0, (rw * ns - box.w) / 2);
        const maxY = Math.max(0, (rh * ns - box.h) / 2);
        return {
          x: Math.min(maxX, Math.max(-maxX, o.x)),
          y: Math.min(maxY, Math.max(-maxY, o.y)),
        };
      });
      return ns;
    });
  };

  const onHandleUp = () => {
    frameResize.current = null;
  };

  // ── Wheel zoom (desktop) ────────────────────────────────────────────────────
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.min(
      minScale * 5,
      Math.max(minScale, scale * (e.deltaY < 0 ? 1.1 : 0.9)),
    );
    setScale(next);
    setOffset((o) => clampOffset(o.x, o.y, next, coarseSteps));
  };

  // ── 90° rotation ─────────────────────────────────────────────────────────────
  const rotate90 = (dir: -1 | 1) => {
    const next = (coarseSteps + dir + 4) % 4;
    setCoarseSteps(next);
    setFineAngle(0);
    const newMin = computeMinScale(natural.w, natural.h, next, 0);
    setMinScale(newMin);
    setScale((s) => Math.max(s, newMin));
    setOffset({ x: 0, y: 0 });
  };

  // ── Fine angle ────────────────────────────────────────────────────────────────
  const onFineAngle = (deg: number) => {
    setFineAngle(deg);
    const newMin = computeMinScale(natural.w, natural.h, coarseSteps, deg);
    setMinScale(newMin);
    setScale((s) => {
      const ns = Math.max(s, newMin);
      setOffset((o) => clampOffset(o.x, o.y, ns, coarseSteps));
      return ns;
    });
  };

  const reset = () => {
    const fit = computeMinScale(natural.w, natural.h, 0, 0);
    setCoarseSteps(0);
    setFineAngle(0);
    setMinScale(fit);
    setScale(fit);
    setOffset({ x: 0, y: 0 });
  };

  // ── Confirm: crop at source resolution ────────────────────────────────────────
  const confirm = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
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
      if (!ctx) { onConfirm(file); return; }

      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, outW, outH);
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
      if (!blob) { onConfirm(file); return; }
      const name = file.name.replace(/\.[^.]+$/, ".jpg");
      onConfirm(new File([blob], name, { type: "image/jpeg" }));
    } finally {
      setBusy(false);
    }
  };

  const hasTransform = coarseSteps !== 0 || Math.abs(fineAngle) > 0.4;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="flex size-10 items-center justify-center rounded-full hover:bg-white/10 active:bg-white/20"
          aria-label={tc("cancel")}
        >
          <X className="size-5" />
        </button>
        {hasTransform && (
          <button
            type="button"
            onClick={reset}
            className="text-sm font-semibold text-warning hover:text-warning active:text-warning"
          >
            {t("reset")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
          className="flex size-10 items-center justify-center rounded-full bg-gold-500 text-navy-900 hover:bg-gold-400 active:bg-gold-300 disabled:opacity-60"
          aria-label={t("usePhoto")}
        >
          <Check className="size-5" />
        </button>
      </header>

      {/* Crop stage — handles both mouse and touch */}
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 flex items-center justify-center overflow-hidden touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* Crop overlay + free-resize corner handles (any ratio) */}
        <div
          className="absolute rounded-[4px] border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] pointer-events-none z-10"
          style={{ width: cropBox.w, height: cropBox.h }}
        >
          {(
            [
              { sx: -1, sy: -1, pos: "left-0 top-0", cursor: "nwse-resize", corner: "border-l-[3px] border-t-[3px] rounded-tl" },
              { sx: 1, sy: -1, pos: "right-0 top-0", cursor: "nesw-resize", corner: "border-r-[3px] border-t-[3px] rounded-tr" },
              { sx: -1, sy: 1, pos: "left-0 bottom-0", cursor: "nesw-resize", corner: "border-l-[3px] border-b-[3px] rounded-bl" },
              { sx: 1, sy: 1, pos: "right-0 bottom-0", cursor: "nwse-resize", corner: "border-r-[3px] border-b-[3px] rounded-br" },
            ] as const
          ).map((h) => (
            <div
              key={h.pos}
              className={cn(
                "pointer-events-auto absolute z-20 flex size-9 items-center justify-center touch-none",
                h.pos,
                // Pull the hit target outward so the visible corner sits ON the frame edge.
                h.sx === -1 ? "-translate-x-1/3" : "translate-x-1/3",
                h.sy === -1 ? "-translate-y-1/3" : "translate-y-1/3",
              )}
              style={{ cursor: h.cursor }}
              onPointerDown={onHandleDown(h.sx, h.sy)}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
            >
              <span className={cn("block size-[18px] border-white", h.corner)} />
            </div>
          ))}
        </div>

        {/* Image */}
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={onImgLoad}
            className="pointer-events-none select-none absolute max-w-none max-h-none"
            style={{
              width: natural.w,
              height: natural.h,
              transform: `translate(${offset.x}px,${offset.y}px) rotate(${totalAngleDeg}deg) scale(${scale})`,
              transformOrigin: "center center",
              willChange: "transform",
            }}
          />
        )}

        {/* Pinch-zoom hint shown while two-fingers active */}
        {pinch.current && (
          <div className="absolute bottom-3 left-0 right-0 text-center text-label text-white/50 pointer-events-none">
            {t("pinchToZoom")}
          </div>
        )}
      </div>

      {/* Footer: angle ruler + 90° buttons */}
      <footer className="shrink-0 px-4 pb-safe-6 pt-3 space-y-4" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
        <AngleRuler value={fineAngle} onChange={onFineAngle} />

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => rotate90(-1)}
            className="flex flex-col items-center gap-1 text-label text-white/70 active:text-white"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-white/10 active:bg-white/20">
              <RotateCcw className="size-4" />
            </span>
            {t("rotateLeft")}
          </button>

          <p className="text-label text-white/40 text-center max-w-[160px]">
            {t("dragZoomHint")}
          </p>

          <button
            type="button"
            onClick={() => rotate90(1)}
            className="flex flex-col items-center gap-1 text-label text-white/70 active:text-white"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-white/10 active:bg-white/20">
              <RotateCw className="size-4" />
            </span>
            {t("rotateRight")}
          </button>
        </div>
      </footer>
    </div>
  );
}

// ─── Angle ruler ──────────────────────────────────────────────────────────────

const RULER_MIN = -45;
const RULER_MAX = 45;
const RULER_STEP = 0.5;
const TICK_EVERY = 5; // major ticks every 5°

/**
 * AngleRuler — custom pointer-based slider for the image rotation angle.
 *
 * Uses PointerEvents (unified mouse + touch + stylus) instead of a native
 * <input type="range"> because iOS Safari range inputs don't respond
 * reliably to drag gestures (swipe doesn't fire onChange on mobile).
 * touchAction:"none" on the container tells the browser this element owns
 * horizontal gestures so the OS doesn't intercept the swipe as scroll.
 */
function AngleRuler({
  value,
  onChange,
}: {
  readonly value: number;
  readonly onChange: (deg: number) => void;
}) {
  const clamp = (v: number) => Math.min(RULER_MAX, Math.max(RULER_MIN, v));
  // 6 CSS pixels per degree — coarser than 1° steps so it's comfortable.
  const PX_PER_DEG = 6;

  // Drag tracking — stored in a ref so state updates don't interrupt drag.
  const drag = useRef<{ startX: number; startValue: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startValue: value };
    // Pointer capture ensures we receive move/up even when cursor leaves element.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    // Negative because dragging right should increase the angle (counter-
    // intuitive if you think of the ruler sliding under a fixed needle, but
    // "drag image clockwise" matches user expectation on a touch screen).
    const newRaw = drag.current.startValue - dx / PX_PER_DEG;
    // Snap to nearest step for crisp feel.
    const snapped = Math.round(newRaw / RULER_STEP) * RULER_STEP;
    onChange(clamp(snapped));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  // Ticks: -45 to +45 every 1°
  const ticks: number[] = [];
  for (let i = RULER_MIN; i <= RULER_MAX; i++) ticks.push(i);

  return (
    <div
      className="relative select-none px-4 cursor-ew-resize"
      // touch-action: none prevents the browser from treating horizontal
      // pointer movement as a page scroll before our handler fires.
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="slider"
      tabIndex={0}
      aria-label="Rotation angle"
      aria-valuemin={RULER_MIN}
      aria-valuemax={RULER_MAX}
      aria-valuenow={value}
      aria-valuetext={`${value.toFixed(1)} degrees`}
      onKeyDown={(e) => {
        // Keyboard support: arrow keys for fine control.
        if (e.key === "ArrowLeft")  onChange(clamp(Math.round((value - RULER_STEP) / RULER_STEP) * RULER_STEP));
        if (e.key === "ArrowRight") onChange(clamp(Math.round((value + RULER_STEP) / RULER_STEP) * RULER_STEP));
        if (e.key === "Home") onChange(0);
      }}
    >
      {/* Center marker */}
      <div className="absolute left-1/2 top-0 -translate-x-px w-0.5 h-9 bg-amber-400 z-10 pointer-events-none rounded-full" />

      {/* Angle label */}
      <div className="mb-1 text-center h-4">
        {Math.abs(value) > 0.3 ? (
          <span className="text-xs font-semibold text-warning tabular-nums">
            {value > 0 ? "+" : ""}
            {value.toFixed(1)}°
          </span>
        ) : (
          <span className="text-xs text-white/30">0°</span>
        )}
      </div>

      {/* Visual tick ruler */}
      <div className="relative flex items-end justify-center h-9 overflow-hidden pointer-events-none">
        {ticks.map((tick) => {
          const isMajor = tick % TICK_EVERY === 0;
          const dist = Math.abs(tick - value);
          const opacity = Math.max(0.12, 1 - dist / 28);
          const translateX = (tick - value) * PX_PER_DEG;
          return (
            <div
              key={tick}
              className={cn("absolute bottom-0 w-px rounded-full", isMajor ? "bg-white/90" : "bg-white/40")}
              style={{
                height: isMajor ? 22 : 11,
                opacity,
                transform: `translateX(${translateX}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
