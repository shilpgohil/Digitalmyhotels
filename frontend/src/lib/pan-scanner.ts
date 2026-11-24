/**
 * PAN Card Scanner — Deep In-Browser OCR Engine
 * -------------------------------------------------------------
 * 100% client-side processing using Tesseract.js & HTML5 Canvas.
 * Implements:
 *   1. Auto-orientation probe (0/90/180/270 deg) using Income Tax Department keyword scoring.
 *   2. Grayscale 1%-99% contrast stretching for high legibility.
 *   3. 10-char PAN repair matrix: letters for pos 0-4 & 9, digits for pos 5-8.
 *   4. Dual DOB parser: slashed (DD/MM/YYYY) and continuous 8-digit (DDMMYYYY).
 *   5. Father's Name separation & statutory 5th-character surname cross-validation.
 */

import type { IdOcrResult } from "@/lib/id-ocr";
import {
  drawToCanvas,
  loadImageSource,
  toGrayContrast,
  toTitleCase,
  canvasToBlob,
} from "@/lib/ocr-canvas-utils";

// Digit to Letter mapping for positions 0-4 and 9 of PAN
const DIGIT_TO_LETTER: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "5": "S",
  "6": "G",
  "8": "B",
};

// Letter to Digit mapping for positions 5-8 of PAN
const LETTER_TO_DIGIT: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", "|": "1", i: "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  B: "8",
  G: "9", g: "9", q: "9",
  E: "6",
};

const NOISE_WORDS = [
  "INCOME", "TAX", "DEPARTMENT", "GOVT", "GOVERNMENT", "INDIA",
  "BHARAT", "SARKAR", "PERMANENT", "ACCOUNT", "NUMBER", "CARD",
  "FATHER", "NAME", "DATE", "BIRTH", "SIGNATURE", "PEHCHAN",
  "PATRA", "AYAKAR", "VIBHAG", "INCOMETAX",
];

export function repairPanNumber(candidate: string): string | null {
  const clean = candidate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 10) return null;

  const chars = clean.split("");

  // Positions 0-4: Must be uppercase letters
  for (let i = 0; i < 5; i++) {
    if (!/[A-Z]/.test(chars[i])) {
      chars[i] = DIGIT_TO_LETTER[chars[i]] || chars[i];
    }
  }

  // Positions 5-8: Must be digits
  for (let i = 5; i < 9; i++) {
    if (!/[0-9]/.test(chars[i])) {
      chars[i] = LETTER_TO_DIGIT[chars[i]] || chars[i];
    }
  }

  // Position 9: Must be letter
  if (!/[A-Z]/.test(chars[9])) {
    chars[9] = DIGIT_TO_LETTER[chars[9]] || chars[9];
  }

  const repaired = chars.join("");
  // Validate standard Indian PAN format: 5 letters, 4 digits, 1 letter
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(repaired)) {
    return repaired;
  }
  return null;
}

export function extractPanDob(text: string): string | null {
  // 1. Slashed or hyphenated: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const slashed = text.match(/\b([0-3]?\d)[/.-]([0-1]?\d)[/.-]((?:19|20)\d{2})\b/);
  if (slashed) {
    const d = parseInt(slashed[1], 10);
    const m = parseInt(slashed[2], 10);
    const y = parseInt(slashed[3], 10);
    const curYear = new Date().getFullYear();
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1930 && y <= curYear - 15) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // 2. Continuous 8 digits: DDMMYYYY (common on older or blurred laminations)
  const continuousMatches = text.match(/\b([0-3]\d)([0-1]\d)((?:19|20)\d{2})\b/g);
  if (continuousMatches) {
    for (const match of continuousMatches) {
      const parts = match.match(/^([0-3]\d)([0-1]\d)((?:19|20)\d{2})$/);
      if (parts) {
        const d = parseInt(parts[1], 10);
        const m = parseInt(parts[2], 10);
        const y = parseInt(parts[3], 10);
        const curYear = new Date().getFullYear();
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1930 && y <= curYear - 15) {
          return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
      }
    }
  }

  return null;
}

export function extractPanNames(
  lines: string[],
  panNumber: string | null,
): { name?: string; fatherName?: string } {
  const cleanLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 3) continue;

    const upper = line.toUpperCase();
    const isHeading = NOISE_WORDS.some((w) => upper.includes(w));
    const hasManyDigits = (line.match(/\d/g) || []).length >= 3;
    const isOnlyAlpha = /^[A-Za-z\s.'-]+$/.test(line);

    // Keep candidate name lines that are primarily alphabetical and not headings
    if (!isHeading && !hasManyDigits && isOnlyAlpha && line.length >= 3) {
      cleanLines.push(line);
    }
  }

  if (cleanLines.length === 0) return {};

  let name = cleanLines[0];
  let fatherName: string | undefined = cleanLines[1];

  // If PAN number is known, cross-validate with 5th character (surname initial)
  if (panNumber && panNumber.length === 10) {
    const surnameChar = panNumber[4];

    // Helper: gets first char of the last word in name (surname)
    const getSurnameInitial = (fullName: string): string => {
      const parts = fullName.trim().split(/\s+/);
      const last = parts[parts.length - 1];
      return last ? last[0].toUpperCase() : "";
    };

    const firstLineSurname = getSurnameInitial(cleanLines[0]);
    if (firstLineSurname !== surnameChar && cleanLines.length > 1) {
      const secondLineSurname = getSurnameInitial(cleanLines[1]);
      if (secondLineSurname === surnameChar) {
        // First line was likely noise or an unflagged header; swap
        name = cleanLines[1];
        fatherName = cleanLines[2];
      }
    }
  }

  return {
    name: name ? toTitleCase(name) : undefined,
    fatherName: fatherName ? toTitleCase(fatherName) : undefined,
  };
}

/**
 * Main Browser-Side PAN Scanner
 */
export async function scanPanCard(
  file: File | Blob,
  onProgress?: (pct: number, status: string) => void,
): Promise<IdOcrResult> {
  onProgress?.(15, "Loading image & normalizing contrast…");
  const imgSource = await loadImageSource(file);

  // 1. Prepare base canvas with contrast stretch
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

    // Check if 0 deg has PAN keywords
    const scoreText = (t: string): number => {
      let s = 0;
      const u = t.toUpperCase();
      if (u.includes("INCOME")) s += 2;
      if (u.includes("TAX")) s += 2;
      if (u.includes("DEPARTMENT")) s += 2;
      if (u.includes("INDIA")) s += 2;
      if (u.includes("PERMANENT")) s += 2;
      if (u.includes("ACCOUNT")) s += 2;
      if (/[A-Z0-9]{10}/.test(u)) s += 3;
      return s;
    };

    let bestScore = scoreText(bestText);

    // If orientation score is low, try 90, 180, 270 deg
    if (bestScore < 4) {
      for (const rot of [180, 90, 270]) {
        onProgress?.(55, `Checking orientation (${rot}°)…`);
        const rotCanvas = toGrayContrast(drawToCanvas(imgSource, 2200, rot));
        const rotBlob = await canvasToBlob(rotCanvas);
        const rotRes = await worker.recognize(rotBlob);
        const sc = scoreText(rotRes.data.text);
        if (sc > bestScore) {
          bestScore = sc;
          bestText = rotRes.data.text;
          if (sc >= 5) break;
        }
      }
    }

    onProgress?.(80, "Extracting PAN number, name & DOB…");
    const rawLines = bestText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Find PAN Number
    let panNumber: string | null = null;
    const tokens = bestText.split(/[\s,]+/);
    for (const token of tokens) {
      const clean = token.replace(/[^A-Za-z0-9]/g, "");
      if (clean.length === 10) {
        const repaired = repairPanNumber(clean);
        if (repaired) {
          panNumber = repaired;
          break;
        }
      }
    }

    // Secondary scan for PAN if token split missed it
    if (!panNumber) {
      const panMatches = bestText.match(/[A-Za-z0-9]{10}/g);
      if (panMatches) {
        for (const m of panMatches) {
          const repaired = repairPanNumber(m);
          if (repaired) {
            panNumber = repaired;
            break;
          }
        }
      }
    }

    // Extract DOB
    const dob = extractPanDob(bestText);

    // Extract Name and Father's Name
    const { name, fatherName } = extractPanNames(rawLines, panNumber);

    onProgress?.(100, "Done");

    const hasPan = Boolean(panNumber);
    const hasName = Boolean(name);
    const hasDob = Boolean(dob);

    const confidence =
      hasPan && hasName && hasDob ? 0.96 : hasPan && (hasName || hasDob) ? 0.88 : hasPan ? 0.75 : 0.4;

    const canAutofill = hasPan || (hasName && hasDob);

    return {
      fields: {
        id_number: panNumber || undefined,
        name: name || undefined,
        date_of_birth: dob || undefined,
        care_of: fatherName ? `S/O ${fatherName}` : undefined,
        id_type_detected: "PAN Card",
      },
      confidence,
      source: "tesseract",
      message: hasPan
        ? `PAN Card scanned successfully (${panNumber})`
        : "PAN Card scanned with partial details",
      can_autofill: canAutofill,
    };
  } finally {
    await worker.terminate();
  }
}
