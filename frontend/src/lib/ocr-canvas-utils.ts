/**
 * Shared Canvas, Deskewing & Persistent Tesseract Worker Utilities for ID OCR.
 *
 * 100% in-browser image preprocessing pipeline modeled after the proven Aadhaar
 * deep scanner architecture:
 *   - EXIF orientation-aware bitmap decoding
 *   - Single persistent Tesseract.js worker (zero startup overhead across passes)
 *   - Direct HTMLCanvasElement recognition (zero JPEG compression blur)
 *   - Edge-transition projection-profile auto-deskewing (+/- 22 degrees)
 *   - 1%-99% grayscale histogram contrast stretch
 *   - Fast integral-image adaptive local-mean binarization
 *   - Blue-channel extraction (suppresses blue ink signatures on paper cards)
 *   - Sub-region / bounding-box padded cropping for targeted psm 6/7/11 reads
 */

export const INDIAN_STATES: readonly string[] = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands",
  "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const STATE_ALIASES: Record<string, string> = {
  orissa: "Odisha",
  pondicherry: "Puducherry",
  uttaranchal: "Uttarakhand",
  "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
  "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "nct of delhi": "Delhi",
  "new delhi": "Delhi",
  "m p": "Madhya Pradesh",
  mp: "Madhya Pradesh",
  "u p": "Uttar Pradesh",
  up: "Uttar Pradesh",
  "h p": "Himachal Pradesh",
  "a p": "Andhra Pradesh",
  "w b": "West Bengal",
  "t n": "Tamil Nadu",
  rj: "Rajasthan",
  mh: "Maharashtra",
  gj: "Gujarat",
  ka: "Karnataka",
  kl: "Kerala",
  pb: "Punjab",
  hr: "Haryana",
  br: "Bihar",
  jh: "Jharkhand",
  cg: "Chhattisgarh",
  uk: "Uttarakhand",
  ts: "Telangana",
};

const PIN_PREFIX_STATE_MAP: [number, number, string[]][] = [
  [11, 11, ["Delhi"]],
  [12, 13, ["Haryana"]],
  [14, 15, ["Punjab"]],
  [16, 16, ["Punjab", "Chandigarh", "Haryana"]],
  [17, 17, ["Himachal Pradesh"]],
  [18, 19, ["Jammu and Kashmir", "Ladakh"]],
  [20, 28, ["Uttar Pradesh", "Uttarakhand"]],
  [30, 34, ["Rajasthan"]],
  [36, 39, ["Gujarat", "Dadra and Nagar Haveli and Daman and Diu"]],
  [40, 44, ["Maharashtra", "Goa"]],
  [45, 48, ["Madhya Pradesh"]],
  [49, 49, ["Chhattisgarh"]],
  [50, 53, ["Telangana", "Andhra Pradesh"]],
  [56, 59, ["Karnataka"]],
  [60, 64, ["Tamil Nadu", "Puducherry"]],
  [67, 69, ["Kerala", "Lakshadweep", "Puducherry"]],
  [70, 74, ["West Bengal", "Sikkim", "Andaman and Nicobar Islands"]],
  [75, 77, ["Odisha"]],
  [78, 78, ["Assam"]],
  [80, 85, ["Bihar", "Jharkhand"]],
];

export function getIndianStatesForPin(pin: string | number): string[] | null {
  const p = +String(pin).replace(/\D/g, "").slice(0, 2);
  const found = PIN_PREFIX_STATE_MAP.find(([lo, hi]) => p >= lo && p <= hi);
  return found ? found[2] : null;
}

export function findIndianState(text: string | undefined | null): string | null {
  if (!text) return null;
  const normalized =
    " " +
    text
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z]+/g, " ")
      .trim() +
    " ";
  for (const st of INDIAN_STATES) {
    if (normalized.includes(" " + st.toLowerCase() + " ")) return st;
  }
  for (const [alias, real] of Object.entries(STATE_ALIASES)) {
    if (normalized.includes(" " + alias + " ")) return real;
  }
  return null;
}

export function toTitleCase(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/(?:^|\s|-|\.)[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

export const NAME_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .'-";

/**
 * Load image file into an ImageBitmap or HTMLImageElement with EXIF orientation handled.
 */
export async function loadImageSource(
  file: Blob | File,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fallback to FileReader + Image if createImageBitmap fails
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to render image source"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Draw image to Canvas with specified max dimension and arbitrary angle rotation (degrees).
 */
export function drawToCanvas(
  src: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  maxSide = 2200,
  rotationDeg = 0,
  bgFill = "#ffffff",
): HTMLCanvasElement {
  const scale = Math.min(4, maxSide / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const rad = (rotationDeg * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const cw = rotationDeg % 90 === 0
    ? (rotationDeg % 180 ? h : w)
    : Math.round(w * absCos + h * absSin);
  const ch = rotationDeg % 90 === 0
    ? (rotationDeg % 180 ? w : h)
    : Math.round(w * absSin + h * absCos);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, cw, ch);
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(rad);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
  }
  return canvas;
}

export function cloneCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const o = document.createElement("canvas");
  o.width = c.width;
  o.height = c.height;
  o.getContext("2d", { willReadFrequently: true })?.drawImage(c, 0, 0);
  return o;
}

export function cropCanvas(
  c: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  scale = 1,
): HTMLCanvasElement {
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const sw = Math.max(1, Math.min(c.width - sx, Math.round(w)));
  const sh = Math.max(1, Math.min(c.height - sy, Math.round(h)));
  const o = document.createElement("canvas");
  o.width = Math.max(1, Math.round(sw * scale));
  o.height = Math.max(1, Math.round(sh * scale));
  const ctx = o.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c, sx, sy, sw, sh, 0, 0, o.width, o.height);
  }
  return o;
}

export function cropPadCanvas(
  c: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  scale = 1,
  pad = 18,
): HTMLCanvasElement {
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const sw = Math.max(1, Math.min(c.width - sx, Math.round(w)));
  const sh = Math.max(1, Math.min(c.height - sy, Math.round(h)));
  const o = document.createElement("canvas");
  o.width = Math.max(1, Math.round(sw * scale) + pad * 2);
  o.height = Math.max(1, Math.round(sh * scale) + pad * 2);
  const ctx = o.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, o.width, o.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c, sx, sy, sw, sh, pad, pad, Math.round(sw * scale), Math.round(sh * scale));
  }
  return o;
}

/**
 * 1%-99% Grayscale histogram stretch for crisp contrast.
 * Optionally uses the Blue channel (channel = 'b') to fade out blue ink signatures/stamps.
 */
export function toGrayContrast(
  canvas: HTMLCanvasElement,
  channel: "luma" | "b" | "r" = "luma",
): HTMLCanvasElement {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  const totalPixels = canvas.width * canvas.height;
  const gray = new Uint8Array(totalPixels);
  const hist = new Uint32Array(256);

  for (let i = 0; i < totalPixels; i++) {
    let val: number;
    if (channel === "b") {
      val = d[4 * i + 2];
    } else if (channel === "r") {
      val = d[4 * i];
    } else {
      val = ((d[4 * i] * 299 + d[4 * i + 1] * 587 + d[4 * i + 2] * 114) / 1000) | 0;
    }
    gray[i] = val;
    hist[val]++;
  }

  let lo = 0;
  let hi = 255;
  let acc = 0;
  const threshold = totalPixels * 0.01;

  while (lo < 255 && (acc += hist[lo]) < threshold) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < threshold) hi--;

  const scale = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < totalPixels; i++) {
    const stretched = Math.max(0, Math.min(255, ((gray[i] - lo) * scale) | 0));
    d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = stretched;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Adaptive integral-image local-mean binarization for shadows, watermarks & colored cards.
 */
export function adaptiveBinarize(
  canvas: HTMLCanvasElement,
  radiusFrac = 38,
  factor = 0.88,
): HTMLCanvasElement {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const integral = new Float64Array((w + 1) * (h + 1));
  const radius = Math.max(8, (w / radiusFrac) | 0);

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += d[4 * (y * w + x)];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
    }
  }

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const idx = 4 * (y * w + x);
      const mean =
        (integral[y1 * (w + 1) + x1] -
          integral[y0 * (w + 1) + x1] -
          integral[y1 * (w + 1) + x0] +
          integral[y0 * (w + 1) + x0]) /
        ((x1 - x0) * (y1 - y0));
      d[idx] = d[idx + 1] = d[idx + 2] = d[idx] < mean * factor ? 0 : 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Otsu global histogram binarization (ideal for thin dark text on shaded colored banners,
 * such as DL top strips or low-contrast card headers). Negative offset shifts threshold
 * darker to strip medium-tone colored backgrounds to pure white.
 */
export function otsuBinarize(canvas: HTMLCanvasElement, offset = 0): HTMLCanvasElement {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const hist = new Uint32Array(256);
  const N = w * h;

  for (let i = 0; i < N; i++) hist[d[4 * i]]++;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let thr = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = N - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      thr = t;
    }
  }

  const finalThr = Math.max(40, Math.min(220, thr + offset));
  for (let i = 0; i < N; i++) {
    const idx = 4 * i;
    d[idx] = d[idx + 1] = d[idx + 2] = d[idx] < finalThr ? 0 : 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Edge-Transition Projection-Profile Skew Estimator (+/- 18 deg).
 * Samples clean horizontal text-stroke edges inside the card center while
 * rejecting noisy background guilloche textures (> 48 transitions/row).
 */
export function estimateCanvasSkewAngle(
  src: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  coarseRotDeg = 0,
): number {
  const small = adaptiveBinarize(
    toGrayContrast(drawToCanvas(src, 520, coarseRotDeg)),
    30,
    0.88,
  );
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;

  const w = small.width;
  const h = small.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  const cx = w / 2;
  const cy = h / 2;

  const pts: number[] = [];
  const yStart = Math.floor(h * 0.12);
  const yEnd = Math.floor(h * 0.88);
  const xStart = Math.floor(w * 0.08);
  const xEnd = Math.floor(w * 0.72) - 1;

  for (let y = yStart; y < yEnd; y++) {
    let transitions = 0;
    const rowX: number[] = [];
    for (let x = xStart; x < xEnd; x++) {
      const a = d[4 * (y * w + x)] < 128 ? 0 : 255;
      const b = d[4 * (y * w + x + 1)] < 128 ? 0 : 255;
      if (a !== b) {
        transitions++;
        rowX.push(x);
      }
    }
    if (transitions >= 6 && transitions <= 48) {
      for (let k = 0; k < rowX.length; k++) {
        pts.push(rowX[k] - cx, y - cy);
      }
    }
  }

  if (pts.length < 40) return 0;

  const padH = Math.ceil(Math.hypot(w, h));
  const halfPad = padH / 2;

  const scoreAngle = (deg: number): number => {
    const rad = (-deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hist = new Uint32Array(padH);
    for (let i = 0; i < pts.length; i += 2) {
      const ry = Math.round(pts[i] * sin + pts[i + 1] * cos + halfPad);
      if (ry >= 0 && ry < padH) hist[ry]++;
    }
    let energy = 0;
    for (let y = 0; y < padH; y++) {
      const s = hist[y];
      energy += s * s;
    }
    return energy;
  };

  const zeroE = scoreAngle(0);
  let bestDeg = 0;
  let bestE = zeroE;
  for (let dDeg = -18; dDeg <= 18; dDeg += 1.0) {
    const e = scoreAngle(dDeg);
    if (e > bestE) {
      bestE = e;
      bestDeg = dDeg;
    }
  }
  const coarse = bestDeg;
  for (let dDeg = coarse - 1.0; dDeg <= coarse + 1.0; dDeg += 0.25) {
    const e = scoreAngle(dDeg);
    if (e > bestE) {
      bestE = e;
      bestDeg = dDeg;
    }
  }

  // Only deskew when tilt is meaningful (>= 2.2 deg) AND genuinely sharpens
  // horizontal line projection (>= 5% over 0 deg).
  if (Math.abs(bestDeg) < 2.2 || bestE <= zeroE * 1.05) return 0;
  return Math.round(bestDeg * 100) / 100;
}

// ─── PERSISTENT TESSERACT WORKER & STRUCTURED PASS RUNNER ────────────────────

export interface OcrLineBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
}

export interface OcrLine {
  text: string;
  raw: string;
  confidence: number;
  bbox?: OcrLineBBox;
  words: OcrWord[];
}

export interface OcrPassOutput {
  text: string;
  conf: number;
  lines: OcrLine[];
  weight?: number;
}

let sharedWorkerPromise: Promise<import("tesseract.js").Worker> | null = null;

export async function getSharedOcrWorker(): Promise<import("tesseract.js").Worker> {
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: () => undefined,
      });
      try {
        await worker.setParameters({
          user_defined_dpi: "300",
          preserve_interword_spaces: "1",
        });
      } catch {
        // Non-fatal
      }
      return worker;
    })();
  }
  return sharedWorkerPromise;
}

/**
 * Execute an OCR pass directly on an HTMLCanvasElement (zero JPEG loss).
 */
export async function runCanvasOcr(
  canvas: HTMLCanvasElement,
  opt: { psm?: string; whitelist?: string } = {},
): Promise<OcrPassOutput> {
  const wk = await getSharedOcrWorker();
  try {
    await wk.setParameters({
      user_defined_dpi: "300",
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: (opt.psm || "6") as unknown as import("tesseract.js").PSM,
      tessedit_char_whitelist: opt.whitelist ?? "",
    });
  } catch {
    // Ignore unsupported param warnings
  }

  const { data } = await wk.recognize(canvas);
  const pageData = data as unknown as {
    lines?: Array<{
      text?: string;
      confidence?: number;
      bbox?: OcrLineBBox;
      words?: Array<{ text: string; confidence: number }>;
    }>;
  };

  const rawLines = (pageData.lines || [])
    .map((l) => {
      const words = l.words || [];
      const ok = words.filter(
        (w) => w.confidence >= 12 || /^[A-Za-z0-9./'-]{2,}$/.test(w.text),
      );
      return {
        text: (ok.length ? ok.map((w) => w.text).join(" ") : l.text || "").trim(),
        raw: String(l.text || "").trim(),
        confidence: l.confidence || 0,
        bbox: l.bbox,
        words: words.map((w) => ({ text: w.text, confidence: w.confidence })),
      };
    })
    .filter((l) => l.text);

  const fallbackLines: OcrLine[] = rawLines.length
    ? rawLines
    : (data.text || "")
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({
          text: t,
          raw: t,
          confidence: data.confidence || 0,
          words: [],
        }));

  return {
    text: data.text || "",
    conf: Math.round(data.confidence || 0),
    lines: fallbackLines,
  };
}

/**
 * Strip trailing low-confidence/noisy short tokens (e.g. "SANJANA RAWAT Sr Ge &" -> "SANJANA RAWAT").
 */
export function cleanTrailingOcrNoise(raw: string): string {
  const tokens = raw
    .replace(/[|[\]{}()*~_=+;:"<>!?@#$%^`\\]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (
      /^\d+$/.test(last) ||
      last === "&" ||
      (last.length === 1 && !/^[A-Z]$/i.test(last)) ||
      (tokens.length >= 2 &&
        /^(?:or|i|ii|sr|ge|se|re|ae|le|py|ee|pe|po|oc|io|so|to|tm|tr|bo|ab|va|is|ja|ca|wa|ra|na|da|sa|oo|in)$/i.test(
          last,
        ))
    ) {
      tokens.pop();
    } else {
      break;
    }
  }
  return tokens.join(" ").trim();
}
