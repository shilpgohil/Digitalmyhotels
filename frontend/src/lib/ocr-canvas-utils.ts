/**
 * Shared Canvas & Image Preprocessing Utilities for Client-Side ID OCR.
 *
 * Provides ultra-fast, 100% in-browser image scaling, EXIF orientation handling,
 * 1%-99% grayscale contrast stretching, adaptive binarization, and Indian geographic dictionaries.
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
  const normalized = " " + text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z]+/g, " ").trim() + " ";
  for (const [alias, real] of Object.entries(STATE_ALIASES)) {
    if (normalized.includes(" " + alias + " ")) return real;
  }
  for (const st of INDIAN_STATES) {
    if (normalized.includes(" " + st.toLowerCase() + " ")) return st;
  }
  return null;
}

export function toTitleCase(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/(?:^|\s|-|\.)[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

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
 * Draw image to Canvas with specified max dimension and rotation (0, 90, 180, 270 degrees).
 */
export function drawToCanvas(
  src: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  maxSide = 2200,
  rotation = 0,
): HTMLCanvasElement {
  const scale = Math.min(4, maxSide / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const cw = rotation % 180 ? h : w;
  const ch = rotation % 180 ? w : h;

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
  }
  return canvas;
}

/**
 * 1%-99% Grayscale histogram stretch for maximum character contrast.
 */
export function toGrayContrast(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  const totalPixels = canvas.width * canvas.height;
  const gray = new Uint8Array(totalPixels);
  const hist = new Uint32Array(256);

  for (let i = 0; i < totalPixels; i++) {
    const val = ((d[4 * i] * 299 + d[4 * i + 1] * 587 + d[4 * i + 2] * 114) / 1000) | 0;
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
    const stretched = Math.max(0, Math.min(255, (gray[i] - lo) * scale));
    d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = stretched;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Adaptive integral-image local-mean binarization for tough shadows.
 */
export function adaptiveBinarize(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const integral = new Float64Array((w + 1) * (h + 1));
  const radius = Math.max(8, (w / 40) | 0);

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += d[4 * (y * w + x)];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h, y + radius + 1);
      const idx = 4 * (y * w + x);
      const mean =
        (integral[y1 * (w + 1) + x1] -
          integral[y0 * (w + 1) + x1] -
          integral[y1 * (w + 1) + x0] +
          integral[y0 * (w + 1) + x0]) /
        ((x1 - x0) * (y1 - y0));
      d[idx] = d[idx + 1] = d[idx + 2] = d[idx] < mean * 0.88 ? 0 : 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Convert Canvas to Blob.
 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas to blob conversion failed"));
      },
      type,
      quality,
    );
  });
}
