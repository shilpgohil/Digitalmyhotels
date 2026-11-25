/**
 * Passport Scanner — Deep In-Browser MRZ & Visual Zone OCR Engine
 * -------------------------------------------------------------
 * 100% client-side processing via Tesseract.js & HTML5 Canvas:
 *   1. Auto-orientation [0, 90, 180, 270] + edge-transition fine deskewing (+/- 22 deg)
 *   2. Targeted bottom 38% MRZ crop with strict MRZ character whitelist (A-Z 0-9 <)
 *   3. ICAO TD3 2-line 44-character Machine Readable Zone parser + check-digit validation
 *   4. Visual Inspection Zone fallback for Indian Passport numbers [A-Z][0-9]{7}
 */

import type { IdOcrResult } from "@/lib/id-ocr";
import {
  adaptiveBinarize,
  cloneCanvas,
  cropCanvas,
  drawToCanvas,
  estimateCanvasSkewAngle,
  loadImageSource,
  runCanvasOcr,
  toGrayContrast,
  toTitleCase,
  type OcrPassOutput,
} from "@/lib/ocr-canvas-utils";

const PASSPORT_KW_RE = /PASSPORT|REPUBLIC|INDIA|P<|SURNAME|GIVEN|NATIONALITY|DATE\s*OF\s*BIRTH/gi;

function mrzCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const ch = field[i];
    let v = 0;
    if (ch >= "0" && ch <= "9") v = ch.charCodeAt(0) - 48;
    else if (ch >= "A" && ch <= "Z") v = ch.charCodeAt(0) - 55;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

function parseMrzTwoLines(text: string): {
  passportNumber?: string;
  name?: string;
  dob?: string;
  gender?: string;
} | null {
  const lines = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/[^A-Z0-9<]/g, ""))
    .filter((l) => l.length >= 30);

  let line1: string | undefined;
  let line2: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("P<") || /^P[A-Z<][A-Z]{3}/.test(lines[i])) {
      line1 = lines[i];
      if (i + 1 < lines.length) line2 = lines[i + 1];
      break;
    }
  }
  if (!line1) return null;

  let name: string | undefined;
  const nameRaw = line1.slice(5);
  const [surnameRaw, givenRaw] = nameRaw.split("<<");
  const surname = (surnameRaw || "").replace(/</g, " ").trim();
  const given = (givenRaw || "").replace(/</g, " ").trim();
  const joined = [given, surname].filter(Boolean).join(" ").trim();
  if (joined.length >= 3) name = toTitleCase(joined);

  let passportNumber: string | undefined;
  let dob: string | undefined;
  let gender: string | undefined;

  if (line2 && line2.length >= 26) {
    const rawNum = line2.slice(0, 9).replace(/</g, "");
    const chkNum = parseInt(line2[9], 10);
    if (rawNum && (Number.isNaN(chkNum) || mrzCheckDigit(line2.slice(0, 9)) === chkNum)) {
      passportNumber = rawNum.slice(0, 8);
    } else if (/^[A-Z]\d{7}/.test(rawNum)) {
      passportNumber = rawNum.slice(0, 8);
    }

    const dobRaw = line2.slice(13, 19);
    if (/^\d{6}$/.test(dobRaw)) {
      const yy = parseInt(dobRaw.slice(0, 2), 10);
      const mm = dobRaw.slice(2, 4);
      const dd = dobRaw.slice(4, 6);
      const curYy = new Date().getFullYear() % 100;
      const fullY = yy > curYy ? 1900 + yy : 2000 + yy;
      dob = `${fullY}-${mm}-${dd}`;
    }

    const gCh = line2[20];
    if (gCh === "M") gender = "Male";
    else if (gCh === "F") gender = "Female";
  }

  return { passportNumber, name, dob, gender };
}

export async function scanPassport(
  file: File | Blob,
  onProgress?: (pct: number, status: string) => void,
): Promise<IdOcrResult> {
  onProgress?.(10, "Loading Passport image…");
  const imgSource = await loadImageSource(file);

  onProgress?.(25, "Checking Passport orientation…");
  let rot = 0;
  let bestScore = -1;
  for (const r of [0, 90, 180, 270]) {
    const probe = toGrayContrast(drawToCanvas(imgSource, 1000, r));
    const out = await runCanvasOcr(probe, { psm: "6" });
    const sc = (out.text.match(PASSPORT_KW_RE) || []).length;
    if (sc > bestScore) {
      bestScore = sc;
      rot = r;
    }
    if (sc >= 3) break;
  }

  onProgress?.(40, "Deskewing & extracting MRZ zone…");
  const fineSkew = estimateCanvasSkewAngle(imgSource, rot);
  const rawHi = drawToCanvas(imgSource, 2200, rot - fineSkew);
  const deskewed =
    Math.abs(fineSkew) >= 1.0
      ? cropCanvas(rawHi, rawHi.width * 0.02, rawHi.height * 0.02, rawHi.width * 0.96, rawHi.height * 0.96)
      : rawHi;

  const gray = toGrayContrast(cloneCanvas(deskewed));
  const bin = adaptiveBinarize(cloneCanvas(gray), 38, 0.88);
  const mrzCrop = cropCanvas(gray, 0, gray.height * 0.60, gray.width, gray.height * 0.38);
  const mrzCropBin = cropCanvas(bin, 0, bin.height * 0.60, bin.width, bin.height * 0.38);

  onProgress?.(65, "Reading MRZ & visual identity fields…");
  const passes: OcrPassOutput[] = [
    await runCanvasOcr(mrzCrop, { psm: "6", whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<" }),
    await runCanvasOcr(mrzCropBin, { psm: "6", whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<" }),
    await runCanvasOcr(gray, { psm: "6" }),
  ];

  let mrz = parseMrzTwoLines(passes[0].text) || parseMrzTwoLines(passes[1].text) || parseMrzTwoLines(passes[2].text);

  if (!mrz?.passportNumber) {
    const ppMatch = passes[2].text.match(/\b([A-PR-WY-Z][0-9]{7})\b/);
    if (ppMatch) {
      mrz = { ...(mrz || {}), passportNumber: ppMatch[1] };
    }
  }

  onProgress?.(100, "Done");

  const hasNum = Boolean(mrz?.passportNumber);
  const hasName = Boolean(mrz?.name);
  const confidence = hasNum && hasName ? 0.97 : hasNum ? 0.86 : hasName ? 0.72 : 0.4;

  return {
    fields: {
      id_number: mrz?.passportNumber,
      name: mrz?.name,
      date_of_birth: mrz?.dob,
      gender: mrz?.gender,
      id_type_detected: "Passport",
    },
    confidence,
    source: hasNum && hasName ? "mrz" : "tesseract",
    message: hasNum
      ? `Passport MRZ scanned cleanly (${mrz?.passportNumber})`
      : "Passport scanned with partial details",
    can_autofill: Boolean(hasNum || (hasName && mrz?.dob)),
  };
}
