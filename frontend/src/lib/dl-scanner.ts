/**
 * Driving License (DL) Scanner — Deep In-Browser OCR & QR Engine
 * -------------------------------------------------------------
 * 100% client-side processing via Tesseract.js, BarcodeDetector QR & HTML5 Canvas:
 *   1. Instant QR probe (smart card backs like MP Transport QR encode exact DLNO & DOB)
 *   2. 4-way orientation probe + fine projection-profile deskewing (+/- 22 deg)
 *   3. Multi-pass recognition directly on HTMLCanvasElement:
 *        - Full grayscale & adaptiveBinarize (psm 6)
 *        - Smart-card inner-column crop (strips gold EMV chip on left & right signature)
 *        - Upscaled single-line DOB bbox crop (psm 7) for dot-matrix fonts
 *   4. Supports BOTH Indian DL layouts:
 *        - Classic State Smart Cards (Number :MP07N..., 2-line wrapped Name, front Address w/o PIN)
 *        - Modern MoRTH Form-7 Cards (MP07R-2021-0390898, labeled Name/DOB/Address + PIN)
 *   5. Outputs clean <=16-char alphanumeric DL number matching schema validation
 */

import type { IdOcrResult } from "@/lib/id-ocr";
import {
  adaptiveBinarize,
  cleanTrailingOcrNoise,
  cloneCanvas,
  cropCanvas,
  cropPadCanvas,
  drawToCanvas,
  estimateCanvasSkewAngle,
  findIndianState,
  getIndianStatesForPin,
  loadImageSource,
  otsuBinarize,
  runCanvasOcr,
  toGrayContrast,
  toTitleCase,
  type OcrPassOutput,
} from "@/lib/ocr-canvas-utils";

const DL_STATE_CODES = new Set([
  "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DN", "DD", "DL",
  "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL", "LA", "LD",
  "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PY", "PB", "RJ",
  "SK", "TN", "TS", "TR", "UP", "UK", "WB",
]);

const DL_KEYWORDS_RE =
  /DRIVING|LICENCE|LICENSE|UNION|INDIA|TRANSPORT|AUTHORITY|VALIDITY|ISSUE|NAME|DOB|DATE\s*OF\s*BIRTH|BLOOD|ADDRESS|FORM\s*7/gi;

const DL_STOP_WORDS_RE =
  /S\/D\/W|SON\/DAUGHTER|SON\s+OF|DAUGHTER\s+OF|WIFE\s+OF|ADDRESS|ISSUED\s*ON|ISSUE\s*DATE|VALID|DOB|DATE\s*OF\s*BIRTH|BLOOD|ORGAN|LICENCE|LICENSE|VEHICLE|MCWGR|LMV/i;

function fixDigitsOnly(s: string): string {
  return s
    .replace(/[OoQD]/g, "0")
    .replace(/[Il|i]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/B/g, "8");
}

/**
 * Extract & repair Indian MoRTH DL number into schema-safe alphanumeric <=16 chars
 * (e.g. "MP07R-2021-0390898" -> "MP07R20210390898", preserving RTO series letter R/N).
 */
export function repairDlNumber(text: string): string | null {
  const candidates: { dl: string; score: number }[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.toUpperCase();
    // Pattern 1: SS-RR[A]?[-/:\s]YYYY[-/:\s]NNNNNNN (e.g. MP07R-2021-0390898, EMPO7N-2018:0177745)
    for (const m of line.matchAll(
      /(?:[A-Z]{0,2})?([A-Z]{2})([0-9OIl]{2})([A-Z0-9])?[-/:\s]{0,2}((?:19|20)[0-9OIl]{2})[-/:\s]{0,2}([0-9OIl]{6,8})\b/g,
    )) {
      const state = m[1];
      if (!DL_STATE_CODES.has(state)) continue;
      const rto = fixDigitsOnly(m[2]);
      const series = m[3] && /[A-Z]/.test(m[3]) ? m[3] : "";
      const year = fixDigitsOnly(m[4]);
      const serial = fixDigitsOnly(m[5]);
      if (!/^\d{2}$/.test(rto) || !/^(?:19|20)\d{2}$/.test(year) || !/^\d{6,8}$/.test(serial)) {
        continue;
      }
      const dl = `${state}${rto}${series}${year}${serial}`.slice(0, 16);
      candidates.push({ dl, score: 12 });
    }

    // Pattern 2: Handle rare 0O doubling inside RTO on shaded headers (e.g. "MP0O7N-2019-0115460")
    for (const m of line.matchAll(
      /\b([A-Z]{2})([0-9OIl]{3})([A-Z])[-/:\s]{0,2}((?:19|20)[0-9OIl]{2})[-/:\s]{0,2}([0-9OIl]{6,8})\b/g,
    )) {
      const state = m[1];
      if (!DL_STATE_CODES.has(state)) continue;
      const rtoRaw = fixDigitsOnly(m[2]).replace(/00/g, "0");
      if (rtoRaw.length !== 2) continue;
      const year = fixDigitsOnly(m[4]);
      const serial = fixDigitsOnly(m[5]);
      if (/^(?:19|20)\d{2}$/.test(year) && /^\d{6,8}$/.test(serial)) {
        const dl = `${state}${rtoRaw}${m[3]}${year}${serial}`.slice(0, 16);
        candidates.push({ dl, score: 10 });
      }
    }
  }

  if (candidates.length === 0) return null;
  const tally = new Map<string, number>();
  for (const c of candidates) {
    tally.set(c.dl, (tally.get(c.dl) || 0) + c.score);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function normalizeDateParts(dStr: string, mStr: string, yStr: string): string | null {
  const d = parseInt(fixDigitsOnly(dStr), 10);
  const mo = parseInt(fixDigitsOnly(mStr), 10);
  let y = parseInt(fixDigitsOnly(yStr), 10);
  // Common dot-matrix OCR fix for DOB year: 18xx or 98xx -> 19xx only if clearly impossible (<1925)
  if (y >= 1880 && y <= 1899) y += 100;
  if (y >= 9000 && y <= 9999) y = 1900 + (y % 100);
  if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1925 && y <= 2099) {
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function extractDlDobFromPasses(passes: OcrPassOutput[]): string | undefined {
  const curYear = new Date().getFullYear();
  const tally = new Map<string, number>();

  for (const p of passes) {
    const lines = p.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasDobLabel = /D\.?O\.?B|DATE\s*OF\s*BIRTH|BIRTH/i.test(line) ||
        (i > 0 && /D\.?O\.?B|DATE\s*OF\s*BIRTH/i.test(lines[i - 1]));

      for (const m of line.matchAll(
        /\b([0-3OIl]?\d|[OIl]{2})[/.\-]([0-1OIl]?\d)[/.\-]((?:18|19|20|98)\d{2}|[1920][89]\d{2})\b/g,
      )) {
        const iso = normalizeDateParts(m[1], m[2], m[3]);
        if (!iso) continue;
        const yr = parseInt(iso.slice(0, 4), 10);
        // Cardholder DOB must make holder at least 18 years old, NOT an Issue Date
        if (yr <= curYear - 18 && !/ISSUED\s*ON|ISSUE\s*DATE/i.test(line)) {
          tally.set(iso, (tally.get(iso) || 0) + (hasDobLabel ? 12 : 4));
        }
      }
    }
  }

  if (tally.size === 0) return undefined;
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function extractDlFieldsFromPasses(passes: OcrPassOutput[]): {
  dlNumber?: string;
  name?: string;
  careOf?: string;
  dob?: string;
  address?: string;
  pincode?: string;
  city?: string;
  state?: string;
} {
  const dlTally = new Map<string, number>();
  const nameTally = new Map<string, number>();
  const careOfTally = new Map<string, number>();
  let bestAddress = "";

  for (const p of passes) {
    const mult = p.weight ?? 1;
    const dl = repairDlNumber(p.text);
    if (dl) dlTally.set(dl, (dlTally.get(dl) || 0) + 10 * mult);

    const lines = p.lines.map((l) => l.text.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upper = line.toUpperCase();

      // Name extraction (handles "Name :MUKESH" + next line "RAWAT", or "Name: PRADEEP RAWAT")
      if (/\bNAME\b/i.test(upper) && !/HOLDER/i.test(upper)) {
        let after = line
          .replace(/^.*?\bNAME\b\s*[:\-~]?\s*/i, "")
          .replace(/\s*[=[\]{}()|*;:"<>!@#$%^`\\].*$/, "")
          .trim();
        after = cleanTrailingOcrNoise(after.replace(/^[:"'`\s‘“]+/, ""));
        const parts: string[] = [];
        if (after.length >= 2 && /^[A-Za-z\s.'-]+$/.test(after) && !DL_STOP_WORDS_RE.test(after)) {
          parts.push(after);
        }
        // Check immediate next line if it's a continuation of wrapped name (like MUKESH \n RAWAT)
        if (i + 1 < lines.length) {
          const nextRaw = lines[i + 1].trim();
          const nextClean = cleanTrailingOcrNoise(
            nextRaw
              .replace(/^[\\\/:|\s“"'`]+/, "")
              .replace(/\s*[=[\]{}()|*;:"<>!@#$%^`\\].*$/, ""),
          );
          if (
            nextClean.length >= 2 &&
            nextClean.length <= 22 &&
            /^[A-Za-z\s.'-]+$/.test(nextClean) &&
            !DL_STOP_WORDS_RE.test(nextClean) &&
            !nextClean.includes(":")
          ) {
            parts.push(nextClean);
          }
        }
        const combined = parts.join(" ").trim();
        if (combined.length >= 3) {
          const formatted = toTitleCase(combined);
          nameTally.set(formatted, (nameTally.get(formatted) || 0) + (parts.length > 1 ? 12 : 8) * mult);
        }
      }

      // S/D/W of / Care-Of extraction
      if (/S\/D\/W|SON\/DAUGHTER|SON\s+OF|DAUGHTER\s+OF|WIFE\s+OF|SIW\s*OF|IW\s*OF/i.test(upper)) {
        let val = line.replace(/^.*?(?:OF|of)\s*[:\-~]?\s*/i, "").trim();
        val = cleanTrailingOcrNoise(val.replace(/^[\\\/:"'`\s]+/, ""));
        if (val.length < 3 && i + 1 < lines.length) {
          val = cleanTrailingOcrNoise(lines[i + 1].replace(/^[\\\/:"'`\s]+/, ""));
        }
        if (val.length >= 3 && /^[A-Za-z\s.'-]+$/.test(val) && !DL_STOP_WORDS_RE.test(val)) {
          const f = `S/O ${toTitleCase(val)}`;
          careOfTally.set(f, (careOfTally.get(f) || 0) + 8);
        }
      }

      // Address extraction (works BOTH WITH and WITHOUT PIN codes!)
      if (/\b(?:ADDRESS|DDRESS)\b/i.test(upper)) {
        const collected: string[] = [];
        const sameLine = line
          .replace(/^.*?(?:ADDRESS|DDRESS)\s*[:\-~]?\s*/i, "")
          .replace(/^[\\\/:"'`\s]+/, "")
          .trim();
        if (sameLine.length >= 2) collected.push(sameLine);

        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          const nl = lines[j].trim();
          const nUpper = nl.toUpperCase();
          if (
            /ORG\.?\s*DL|ISSUED\s*ON|ISSUE\s*DATE|D\.?O\.?B|DATE\s*OF\s*BIRTH|BLOOD|VEHICLE|VALID|BADGE|LICENSING/i.test(
              nUpper,
            )
          ) {
            break;
          }
          // Stop before standalone card serial fragments like "No."
          if (/^NO\.?$/i.test(nl)) continue;
          const cleanNl = nl.replace(/[|[\]{}_*~]+/g, " ").trim();
          if (cleanNl.length >= 3) collected.push(cleanNl);
          if (/\b[1-9]\d{5}\b/.test(cleanNl)) break;
        }

        if (collected.length > 0) {
          const joined = collected.join(", ").replace(/,\s*,+/g, ",").trim();
          if (joined.length > bestAddress.length) {
            bestAddress = joined;
          }
        }
      }
    }
  }

  const dob = extractDlDobFromPasses(passes);
  const allText = passes.map((p) => p.text).join("\n");
  // Extract PIN strictly from address block (never match validity dates like 04-112038)
  const pinMatch = bestAddress.match(/\b([1-9]\d{5})\b/);
  const pincode = pinMatch ? pinMatch[1] : undefined;

  let state = findIndianState(bestAddress) || findIndianState(allText) || undefined;
  if (!state && pincode) {
    const s = getIndianStatesForPin(pincode);
    if (s && s.length === 1) state = s[0];
  }

  // Extract city before ", MP" or state alias
  let city: string | undefined;
  const cityMatch = bestAddress.match(/([A-Za-z]{3,20}),\s*(?:MP|MH|RJ|GJ|UP|KA|TN|DL|PB|HR|BR|WB)/i);
  if (cityMatch) {
    city = toTitleCase(cityMatch[1]);
  }

  let cleanAddr = bestAddress;
  if (cleanAddr && pincode) {
    cleanAddr = cleanAddr.replace(pincode, "").replace(/[,-\s]+$/, "").trim();
  }

  return {
    dlNumber: dlTally.size ? [...dlTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined,
    name: nameTally.size ? [...nameTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined,
    careOf: careOfTally.size ? [...careOfTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined,
    dob,
    address: cleanAddr ? toTitleCase(cleanAddr) : undefined,
    pincode,
    city,
    state,
  };
}

/**
 * Parse digital MP / Parivahan DL QR payload (e.g. "...?DLNO=MP07R-2021-0390898&DOB=11/01/1992").
 */
function parseDlQrText(raw: string): { dlNumber?: string; dob?: string } | null {
  const dlMatch = raw.match(/DLNO\s*=\s*([A-Z0-9\-/]+)/i);
  const dobMatch = raw.match(/DOB\s*=\s*([0-3]?\d)[/.-]([0-1]?\d)[/.-]((?:19|20)\d{2})/i);
  const dlNumber = dlMatch ? repairDlNumber(dlMatch[1]) || dlMatch[1].replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 16) : undefined;
  const dob = dobMatch
    ? `${dobMatch[3]}-${dobMatch[2].padStart(2, "0")}-${dobMatch[1].padStart(2, "0")}`
    : undefined;
  if (!dlNumber && !dob) return null;
  return { dlNumber, dob };
}

/**
 * Main Browser-Side Driving License Scanner
 */
export async function scanDrivingLicense(
  file: File | Blob,
  side: "front" | "back" = "front",
  onProgress?: (pct: number, status: string) => void,
): Promise<IdOcrResult> {
  onProgress?.(10, "Loading Driving License image…");
  const imgSource = await loadImageSource(file);

  // 1. Silent QR probe via native BarcodeDetector (if available in Chrome/Android/Edge)
  try {
    type BarcodeDetectorCtor = new (opt?: { formats?: string[] }) => {
      detect: (src: ImageBitmap | HTMLImageElement) => Promise<Array<{ rawValue?: string }>>;
    };
    const BD = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (typeof BD !== "undefined") {
      const det = new BD({ formats: ["qr_code"] });
      const hits = await det.detect(imgSource);
      for (const h of hits) {
        if (h.rawValue) {
          const qr = parseDlQrText(h.rawValue);
          if (qr && (qr.dlNumber || qr.dob)) {
            onProgress?.(100, "Done");
            return {
              fields: {
                id_number: qr.dlNumber,
                date_of_birth: qr.dob,
                id_type_detected: "Driving License",
              },
              confidence: 1.0,
              source: "qr",
              message: `Extracted digitally from Driving License QR (${qr.dlNumber ?? "DOB verified"})`,
              can_autofill: true,
            };
          }
        }
      }
    }
  } catch {
    // Continue to OCR passes
  }

  // 2. 4-way orientation probe
  onProgress?.(20, "Checking license orientation…");
  let rot = 0;
  let bestScore = -1;
  for (const r of [0, 90, 180, 270]) {
    const probe = adaptiveBinarize(toGrayContrast(drawToCanvas(imgSource, 1000, r)), 34, 0.88);
    const out = await runCanvasOcr(probe, { psm: "6" });
    const sc = (out.text.match(DL_KEYWORDS_RE) || []).length;
    if (sc > bestScore) {
      bestScore = sc;
      rot = r;
    }
    if (sc >= 3) break;
  }

  // 3. Projection-profile fine deskew (+/- 22 deg)
  onProgress?.(35, "Correcting tilt & enhancing smart card…");
  const fineSkew = estimateCanvasSkewAngle(imgSource, rot);
  const totalRot = rot - fineSkew;

  const side0 = Math.max(imgSource.width, imgSource.height) < 1300 ? 2800 : 2200;
  const rawHi = drawToCanvas(imgSource, side0, totalRot);
  const deskewed =
    Math.abs(fineSkew) >= 1.0
      ? cropCanvas(rawHi, rawHi.width * 0.02, rawHi.height * 0.02, rawHi.width * 0.96, rawHi.height * 0.96)
      : rawHi;

  const gray = toGrayContrast(cloneCanvas(deskewed));
  const bin = adaptiveBinarize(cloneCanvas(gray), 38, 0.88);

  onProgress?.(55, "Running multi-pass Driving License OCR…");
  const passes: OcrPassOutput[] = [];
  passes.push(await runCanvasOcr(gray, { psm: "6" }));
  passes.push(await runCanvasOcr(bin, { psm: "6" }));

  // Inner column crop avoids EMV chip / right portrait & stamps
  const innerGray = cropCanvas(
    gray,
    gray.width * 0.14,
    gray.height * 0.14,
    gray.width * 0.68,
    gray.height * 0.80,
  );
  passes.push(await runCanvasOcr(innerGray, { psm: "6" }));

  // Upper-inner data band crop isolates DL Number + Name away from dark header banner.
  // Otsu global threshold with -42 offset cleans shaded pale-blue header ribbons to crisp white.
  const topBand = cropCanvas(
    deskewed,
    deskewed.width * 0.16,
    deskewed.height * 0.11,
    deskewed.width * 0.66,
    deskewed.height * 0.36,
  );
  const topGray = toGrayContrast(cloneCanvas(topBand));
  const topOtsu = otsuBinarize(cloneCanvas(topGray), -42);
  passes.push({ ...(await runCanvasOcr(topOtsu, { psm: "6" })), weight: 3 });
  passes.push({ ...(await runCanvasOcr(topGray, { psm: "6" })), weight: 2 });

  // Targeted DOB line crop at 2.5x upscale for dot-matrix fonts
  let extracted = extractDlFieldsFromPasses(passes);
  if (!extracted.dob) {
    for (const p of passes) {
      for (const l of p.lines) {
        if (l.bbox && /D\.?O\.?B|BIRTH/i.test(l.text)) {
          const lh = Math.max(10, l.bbox.y1 - l.bbox.y0);
          const cc = cropPadCanvas(
            gray,
            l.bbox.x0,
            l.bbox.y0 - lh * 0.2,
            l.bbox.x1 - l.bbox.x0 + lh * 2,
            lh * 1.5,
            2.5,
            16,
          );
          passes.push(await runCanvasOcr(cc, { psm: "7", whitelist: "0123456789-/:DOBirthaeof " }));
        }
      }
    }
    extracted = extractDlFieldsFromPasses(passes);
  }

  onProgress?.(100, "Done");

  const hasDl = Boolean(extracted.dlNumber);
  const hasName = Boolean(extracted.name);
  const hasAddr = Boolean(extracted.address || extracted.pincode || extracted.state);

  if (side === "back" && !hasDl && hasAddr) {
    return {
      fields: {
        address: extracted.address,
        pincode: extracted.pincode,
        city: extracted.city,
        state: extracted.state,
        id_type_detected: "Driving License",
      },
      confidence: 0.90,
      source: "tesseract",
      message: "Driving License back face scanned cleanly",
      can_autofill: true,
    };
  }

  const confidence =
    hasDl && hasName ? 0.95 : hasDl ? 0.88 : hasName ? 0.78 : 0.42;
  const canAutofill = hasDl || (hasName && Boolean(extracted.dob));

  return {
    fields: {
      id_number: extracted.dlNumber,
      name: extracted.name,
      date_of_birth: extracted.dob,
      care_of: extracted.careOf,
      address: extracted.address,
      pincode: extracted.pincode,
      city: extracted.city,
      state: extracted.state,
      id_type_detected: "Driving License",
    },
    confidence,
    source: "tesseract",
    message: hasDl
      ? `Driving License scanned cleanly (${extracted.dlNumber})`
      : "Driving License scanned with partial details",
    can_autofill: canAutofill,
  };
}
