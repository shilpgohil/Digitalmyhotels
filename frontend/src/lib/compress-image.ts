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

  const bitmap = await createImageBitmap(file);
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
