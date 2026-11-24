/**
 * Driving License (DL) Scanner — Deep In-Browser OCR Engine
 * -------------------------------------------------------------
 * 100% client-side processing using Tesseract.js & HTML5 Canvas.
 * Implements:
 *   1. Auto-orientation (0/90/180/270 deg) for smart cards.
 *   2. MoRTH Sarathi DL national format parser with 36 Indian state codes (e.g. MP-07-2021-0390898).
 *   3. Intelligent date disambiguation: strictly separates DOB (age >= 18) from Validity/Expiry dates.
 *   4. Targeted Name & Care-Of (S/W/D of) extraction.
 *   5. Back face / Front face address block and 6-digit PIN code extraction.
 */

import type { IdOcrResult } from "@/lib/id-ocr";
import {
  drawToCanvas,
  loadImageSource,
  toGrayContrast,
  toTitleCase,
  canvasToBlob,
  findIndianState,
  getIndianStatesForPin,
} from "@/lib/ocr-canvas-utils";

// 36 Official Indian State & UT 2-letter codes for Driving Licences
const DL_STATE_CODES = new Set([
  "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DN", "DD", "DL",
  "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL", "LA", "LD",
  "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PY", "PB", "RJ",
  "SK", "TN", "TS", "TR", "UP", "UK", "WB",
]);

export function repairDlNumber(text: string): string | null {
  // 1. Search for standard MoRTH format: SS-RR-YYYY-NNNNNNN or SS-RR-YYYYNNNNNNN
  // Accepts common OCR artifacts (e.g. leading lowercase m, space or hyphen between elements)
  const regex = /\b(?:[a-z]{0,2})?([A-Z]{2})[-/\s]?([0-9OIl]{2})[A-Za-z]?[-/\s]?((?:19|20)\d{2})[-/\s]?([0-9OIl]{4,8})\b/i;
  const match = text.match(regex);
  if (match) {
    const rawState = match[1].toUpperCase();
    if (DL_STATE_CODES.has(rawState)) {
      const rto = match[2].replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
      const year = match[3];
      const serial = match[4].replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
      return `${rawState}-${rto}-${year}-${serial}`;
    }
  }

  // 2. Continuous 15-16 alphanumeric format: SSRRYYYYNNNNNNN
  const contRegex = /\b([A-Z]{2})([0-9]{2})((?:19|20)\d{2})([0-9]{7})\b/;
  const contMatch = text.match(contRegex);
  if (contMatch && DL_STATE_CODES.has(contMatch[1])) {
    return `${contMatch[1]}-${contMatch[2]}-${contMatch[3]}-${contMatch[4]}`;
  }

  // 3. Fallback: Search token-wise for DL-like sequences
  const tokens = text.split(/[\s,]+/);
  for (const t of tokens) {
    const clean = t.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
    if (clean.length >= 13 && clean.length <= 18) {
      const st = clean.slice(0, 2);
      if (DL_STATE_CODES.has(st)) {
        return clean;
      }
    }
  }

  return null;
}

export function extractDlDates(text: string): { dob?: string; validity?: string } {
  const curYear = new Date().getFullYear();
  let dob: string | undefined;
  let validity: string | undefined;

  // Find all dates in DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const dateRegex = /\b([0-3]?\d)[/.-]([0-1]?\d)[/.-]((?:19|20)\d{2})\b/g;
  const allMatches = [...text.matchAll(dateRegex)];

  // Look for labeled DOB
  const dobLineMatch = text.match(
    /(?:D\.?O\.?B\.?|Date of Birth|Birth Date|DOB)[:\s]*([0-3]?\d)[/.-]([0-1]?\d)[/.-]((?:19|20)\d{2})/i,
  );
  if (dobLineMatch) {
    const d = parseInt(dobLineMatch[1], 10);
    const m = parseInt(dobLineMatch[2], 10);
    const y = parseInt(dobLineMatch[3], 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1930 && y <= curYear - 18) {
      dob = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // Process all dates found
  for (const m of allMatches) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;

    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    if (!dob && y >= 1930 && y <= curYear - 18) {
      dob = iso;
    } else if (y >= curYear) {
      validity = iso;
    }
  }

  return { dob, validity };
}

export function extractDlNameAndCareOf(
  lines: string[],
): { name?: string; careOf?: string } {
  let name: string | undefined;
  let careOf: string | undefined;

  const noisePatterns = [
    "UNION OF INDIA", "INDIAN UNION", "TRANSPORT", "DEPARTMENT", "DRIVING",
    "LICENCE", "LICENSE", "FORM 7", "MOTOR VEHICLES", "COMMISSIONER", "GOVERNMENT",
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // Check if line is header noise
    if (noisePatterns.some((np) => upper.includes(np))) continue;

    // Check Name line: "Name: John Doe" or "Name\nJohn Doe"
    if (!name && (upper.startsWith("NAME") || upper.includes("NAME:"))) {
      const parts = line.split(/[:\-–]/);
      let val = parts.length > 1 ? parts.slice(1).join(" ").trim() : "";
      if (val.length < 3 && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (
          !next.toUpperCase().includes("S/W/D") &&
          !next.toUpperCase().includes("SON OF") &&
          !next.toUpperCase().includes("DOB") &&
          /^[A-Za-z\s.'-]+$/.test(next)
        ) {
          val = next;
        }
      }
      val = val.replace(/[^A-Za-z\s.'-]/g, "").trim();
      if (val.length >= 3) {
        name = toTitleCase(val);
      }
    }

    // Check S/W/D of (Care Of): "S/W/D of: Jane Doe" or "Son of: Jane Doe"
    if (
      !careOf &&
      (upper.includes("S/W/D") ||
        upper.includes("S/O") ||
        upper.includes("W/O") ||
        upper.includes("D/O") ||
        upper.includes("SON OF") ||
        upper.includes("DAUGHTER OF") ||
        upper.includes("WIFE OF"))
    ) {
      const parts = line.split(/[:\-–]/);
      let val = parts.length > 1 ? parts.slice(1).join(" ").trim() : "";
      if (val.length < 3 && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (
          !next.toUpperCase().includes("DOB") &&
          !next.toUpperCase().includes("ADDRESS") &&
          /^[A-Za-z\s.'-]+$/.test(next)
        ) {
          val = next;
        }
      }
      val = val.replace(/[^A-Za-z\s.'-]/g, "").trim();
      if (val.length >= 3) {
        careOf = `S/O ${toTitleCase(val)}`;
      }
    }
  }

  return { name, careOf };
}

export function extractDlAddress(text: string): {
  address?: string;
  pincode?: string;
  city?: string;
  state?: string;
} {
  let address: string | undefined;
  let pincode: string | undefined;
  let city: string | undefined;
  let state: string | undefined;

  // Extract 6-digit PIN code
  const pinMatch = text.match(/\b([1-9]\d{5})\b/);
  if (pinMatch) {
    pincode = pinMatch[1];
    const states = getIndianStatesForPin(pincode);
    if (states && states.length > 0) {
      state = states[0];
    }
  }

  if (!state) {
    const st = findIndianState(text);
    if (st) state = st;
  }

  // Address lines
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const addressLines: string[] = [];
  let inAddress = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.includes("ADDRESS") || upper.includes("PATA") || upper.includes("RESIDENCE")) {
      inAddress = true;
      const colonIdx = line.indexOf(":");
      if (colonIdx >= 0) {
        const val = line.slice(colonIdx + 1).trim();
        if (val.length > 0) addressLines.push(val);
      }
      continue;
    }

    if (inAddress) {
      if (
        upper.includes("BADGE") ||
        upper.includes("AUTHORITY") ||
        upper.includes("SIGNATURE") ||
        upper.includes("CARD NO") ||
        upper.includes("CLASS OF VEHICLE")
      ) {
        break;
      }
      addressLines.push(line);
      if (pinMatch && line.includes(pinMatch[1])) {
        break;
      }
    }
  }

  if (addressLines.length > 0) {
    address = addressLines.join(", ").replace(/,\s*,/g, ",").trim();
  }

  return { address, pincode, city, state };
}

/**
 * Main Browser-Side Driving License Scanner
 */
export async function scanDrivingLicense(
  file: File | Blob,
  side: "front" | "back" = "front",
  onProgress?: (pct: number, status: string) => void,
): Promise<IdOcrResult> {
  onProgress?.(15, "Loading image & normalizing contrast…");
  const imgSource = await loadImageSource(file);

  const baseCanvas = toGrayContrast(drawToCanvas(imgSource, 2200, 0));

  onProgress?.(30, "Initializing OCR engine…");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: () => undefined,
  });

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
    });
  } catch {
    // Ignore parameter warning
  }

  try {
    onProgress?.(45, "Scanning card orientation…");
    const blob0 = await canvasToBlob(baseCanvas);
    const res0 = await worker.recognize(blob0);
    let bestText = res0.data.text;

    const scoreDlText = (t: string): number => {
      let s = 0;
      const u = t.toUpperCase();
      if (u.includes("DRIVING")) s += 3;
      if (u.includes("LICENCE") || u.includes("LICENSE")) s += 3;
      if (u.includes("TRANSPORT")) s += 2;
      if (u.includes("UNION OF INDIA")) s += 2;
      if (u.includes("NAME")) s += 2;
      if (u.includes("DOB") || u.includes("VALIDITY")) s += 2;
      if (/[A-Z]{2}[-/\s]?[0-9]{2}/.test(u)) s += 3;
      return s;
    };

    let bestScore = scoreDlText(bestText);

    if (bestScore < 4) {
      for (const rot of [180, 90, 270]) {
        onProgress?.(55, `Checking orientation (${rot}°)…`);
        const rotCanvas = toGrayContrast(drawToCanvas(imgSource, 2200, rot));
        const rotBlob = await canvasToBlob(rotCanvas);
        const rotRes = await worker.recognize(rotBlob);
        const sc = scoreDlText(rotRes.data.text);
        if (sc > bestScore) {
          bestScore = sc;
          bestText = rotRes.data.text;
          if (sc >= 5) break;
        }
      }
    }

    onProgress?.(80, "Extracting DL number, name, DOB & address…");

    const lines = bestText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const dlNumber = repairDlNumber(bestText);
    const { dob } = extractDlDates(bestText);
    const { name, careOf } = extractDlNameAndCareOf(lines);
    const { address, pincode, city, state } = extractDlAddress(bestText);

    onProgress?.(100, "Done");

    const hasDl = Boolean(dlNumber);
    const hasName = Boolean(name);
    const hasAddress = Boolean(address || pincode || state);

    if (side === "back" && !hasDl && hasAddress) {
      return {
        fields: {
          address,
          pincode,
          city,
          state,
          id_type_detected: "Driving License",
        },
        confidence: 0.92,
        source: "tesseract",
        message: "Driving License back face scanned successfully",
        can_autofill: true,
      };
    }

    const confidence =
      hasDl && hasName ? 0.95 : hasDl ? 0.85 : hasName ? 0.75 : 0.4;
    const canAutofill = hasDl || (hasName && Boolean(dob));

    return {
      fields: {
        id_number: dlNumber || undefined,
        name,
        date_of_birth: dob,
        care_of: careOf,
        address,
        pincode,
        city,
        state,
        id_type_detected: "Driving License",
      },
      confidence,
      source: "tesseract",
      message: hasDl
        ? `Driving License scanned successfully (${dlNumber})`
        : "Driving License scanned with partial details",
      can_autofill: canAutofill,
    };
  } finally {
    await worker.terminate();
  }
}
