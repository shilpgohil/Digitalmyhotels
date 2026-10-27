/**
 * Browser-side image compression using the Canvas API.
 *
 * Compresses any PNG/JPEG/WebP to a target max dimension and quality level
 * before uploading, keeping file sizes reasonable without server involvement.
 */

export interface CompressOptions {
  /** Maximum edge length in pixels (default 1200). */
  maxDimension?: number;
  /** JPEG/WebP quality 0–1 (default 0.82). */
  quality?: number;
  /** Output MIME type (default image/jpeg). */
  outputType?: "image/jpeg" | "image/webp" | "image/png";
}

const DEFAULTS: Required<CompressOptions> = {
  maxDimension: 1200,
  quality: 0.82,
  outputType: "image/jpeg",
};

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const opts = { ...DEFAULTS, ...options };

  // Only compress raster images.
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const { width, height } = bitmap;

  // Scale down if larger than maxDimension.
  let outW = width;
  let outH = height;
  if (width > opts.maxDimension || height > opts.maxDimension) {
    const ratio = opts.maxDimension / Math.max(width, height);
    outW = Math.round(width * ratio);
    outH = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, outW, outH);
  bitmap.close();

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Compression produced empty blob"));
          return;
        }
        const ext = opts.outputType.split("/")[1];
        const name = file.name.replace(/\.[^.]+$/, `.${ext}`);
        resolve(new File([blob], name, { type: opts.outputType }));
      },
      opts.outputType,
      opts.quality,
    );
  });
}

/** Compress for hotel logos (medium quality, smaller size). */
export const compressLogo = (file: File) =>
  compressImage(file, { maxDimension: 800, quality: 0.85, outputType: "image/jpeg" });

/** Compress for guest ID documents (high quality for readability). */
export const compressDocument = (file: File) =>
  compressImage(file, { maxDimension: 1600, quality: 0.88, outputType: "image/jpeg" });

/** Compress for expense receipts (medium quality). */
export const compressReceipt = (file: File) =>
  compressImage(file, { maxDimension: 1200, quality: 0.82, outputType: "image/jpeg" });

/** Compress for staff check-in selfies — identity evidence only, so a small
 *  720px JPEG keeps daily uploads light on mobile data. */
export const compressSelfie = (file: File) =>
  compressImage(file, { maxDimension: 720, quality: 0.8, outputType: "image/jpeg" });

/** Compress for staff profile photos (avatar-sized). */
export const compressStaffPhoto = (file: File) =>
  compressImage(file, { maxDimension: 800, quality: 0.85, outputType: "image/jpeg" });

/**
 * Prepares an uncropped, full-field photo for QR / OCR scanning.
 * Preserves 100% of the authentic canvas (zero crop, zero edge clipping)
 * while scaling multi-megapixel phone camera captures down to maxDimension (default 2400px)
 * at high quality (0.94) so network transfer is ultra-fast (~400KB) and dense QR modules remain crisp.
 */
export async function prepareUncroppedScanFile(
  file: File,
  maxDimension: number = 2400,
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }
  try {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    const { width, height } = bitmap;
    const longest = Math.max(width, height);

    // If already reasonably sized and lightweight, return directly without re-compression
    if (longest <= maxDimension && file.size < 4 * 1024 * 1024) {
      bitmap.close();
      return file;
    }

    const ratio = maxDimension / longest;
    const outW = Math.max(1, Math.round(width * ratio));
    const outH = Math.max(1, Math.round(height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close();

    return new Promise<File>((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const name = file.name.replace(/\.[^.]+$/, ".jpg");
          resolve(new File([blob], name, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.94,
      );
    });
  } catch {
    return file;
  }
}
