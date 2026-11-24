/**
 * Voter ID (EPIC) Scanner — Deep In-Browser OCR Engine
 * -------------------------------------------------------------
 * 100% client-side processing using Tesseract.js & HTML5 Canvas.
 * Implements:
 *   1. Aspect ratio & portrait orientation handling (0/90/180/270 deg).
 *   2. 10-char EPIC repair matrix: 3 uppercase letters + 7 digits (e.g. ILN0306795).
 *   3. Targeted Elector's Name extraction, strictly segregating Father/Husband lines.
 *   4. Gender, DOB / Age recognition.
 *   5. Back face address parsing, 6-digit PIN code extraction, district & state resolution.
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

// Digit to Letter mapping for first 3 chars of EPIC
const DIGIT_TO_LETTER: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "5": "S",
  "6": "G",
  "8": "B",
};

// Letter to Digit mapping for last 7 chars of EPIC
const LETTER_TO_DIGIT: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", "|": "1", i: "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  B: "8",
  G: "9", g: "9", q: "9",
  E: "6",
};

export function repairEpicNumber(raw: string): string | null {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Standard 10-char EPIC: 3 letters + 7 digits
  if (clean.length === 10) {
    const chars = clean.split("");
    // Pos 0-2: Letters
    for (let i = 0; i < 3; i++) {
      if (!/[A-Z]/.test(chars[i])) {
        chars[i] = DIGIT_TO_LETTER[chars[i]] || chars[i];
      }
    }
    // Pos 3-9: Digits
    for (let i = 3; i < 10; i++) {
      if (!/[0-9]/.test(chars[i])) {
        chars[i] = LETTER_TO_DIGIT[chars[i]] || chars[i];
      }
    }
    const repaired = chars.join("");
    if (/^[A-Z]{3}[0-9]{7}$/.test(repaired)) {
      return repaired;
    }
  }

  // Legacy state-prefixed format: e.g. WB/01/001/000001 or UP/01/001/000001
  if (/^[A-Z]{2}[/0-9-]{10,16}$/.test(clean)) {
    return clean;
  }

  return null;
}

export function extractVoterFront(text: string): {
  idNumber?: string;
  name?: string;
  fatherName?: string;
  gender?: string;
  dob?: string;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. Find EPIC Number
  let idNumber: string | undefined;
  const tokens = text.split(/[\s,]+/);
  for (const token of tokens) {
    const repaired = repairEpicNumber(token);
    if (repaired) {
      idNumber = repaired;
      break;
    }
  }

  if (!idNumber) {
    const matches = text.match(/[A-Za-z0-9]{10}/g);
    if (matches) {
      for (const m of matches) {
        const repaired = repairEpicNumber(m);
        if (repaired) {
          idNumber = repaired;
          break;
        }
      }
    }
  }

  // 2. Extract Name & Father/Husband Name
  let name: string | undefined;
  let fatherName: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // Check Elector's Name line
    if (
      !name &&
      (upper.includes("ELECTOR") ||
        upper.includes("NAME") ||
        upper.includes("NAAM") ||
        upper.includes("नाम")) &&
      !upper.includes("FATHER") &&
      !upper.includes("HUSBAND") &&
      !upper.includes("MOTHER")
    ) {
      const parts = line.split(/[:\-–]/);
      let val = parts.length > 1 ? parts.slice(1).join(" ").trim() : "";
      if (val.length < 3 && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        const nextUpper = next.toUpperCase();
        if (
          !nextUpper.includes("FATHER") &&
          !nextUpper.includes("HUSBAND") &&
          !nextUpper.includes("SEX") &&
          !nextUpper.includes("GENDER") &&
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

    // Check Father/Husband Name line
    if (
      !fatherName &&
      (upper.includes("FATHER") ||
        upper.includes("HUSBAND") ||
        upper.includes("PITA") ||
        upper.includes("PATI") ||
        upper.includes("पिता") ||
        upper.includes("पति"))
    ) {
      const parts = line.split(/[:\-–]/);
      let val = parts.length > 1 ? parts.slice(1).join(" ").trim() : "";
      if (val.length < 3 && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        const nextUpper = next.toUpperCase();
        if (
          !nextUpper.includes("SEX") &&
          !nextUpper.includes("GENDER") &&
          !nextUpper.includes("DATE") &&
          !nextUpper.includes("AGE") &&
          /^[A-Za-z\s.'-]+$/.test(next)
        ) {
          val = next;
        }
      }
      val = val.replace(/[^A-Za-z\s.'-]/g, "").trim();
      if (val.length >= 3) {
        fatherName = toTitleCase(val);
      }
    }
  }

  // 3. Gender
  let gender: string | undefined;
  if (/\b(?:FEMALE|WOMAN|महिला|स्त्री)\b/i.test(text)) {
    gender = "Female";
  } else if (/\b(?:MALE|MAN|पुरुष)\b/i.test(text)) {
    gender = "Male";
  }

  // 4. DOB or Age
  let dob: string | undefined;
  const dobMatch = text.match(/\b([0-3]?\d)[/.-]([0-1]?\d)[/.-]((?:19|20)\d{2})\b/);
  if (dobMatch) {
    const d = parseInt(dobMatch[1], 10);
    const m = parseInt(dobMatch[2], 10);
    const y = parseInt(dobMatch[3], 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1930) {
      dob = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  } else {
    // Check Age: e.g. "Age: 32 Years" as of 01.01.2024
    const ageMatch = text.match(/\b(?:Age|Ayu|आयु)[:\s]*(\d{2})\b/i);
    if (ageMatch) {
      const age = parseInt(ageMatch[1], 10);
      if (age >= 18 && age <= 100) {
        const birthYear = new Date().getFullYear() - age;
        dob = `${birthYear}-01-01`;
      }
    }
  }

  return { idNumber, name, fatherName, gender, dob };
}

export function extractVoterBack(text: string): {
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

  // Detect state if not found by PIN
  if (!state) {
    const st = findIndianState(text);
    if (st) state = st;
  }

  // Extract address block: look for "Address:" or lines before PIN code
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const addressLines: string[] = [];
  let recordingAddress = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.includes("ADDRESS") || upper.includes("PATA") || upper.includes("पता")) {
      recordingAddress = true;
      const colonIdx = line.indexOf(":");
      if (colonIdx >= 0) {
        const val = line.slice(colonIdx + 1).trim();
        if (val.length > 0) addressLines.push(val);
      }
      continue;
    }

    if (recordingAddress) {
      if (
        upper.includes("ELECTORAL") ||
        upper.includes("REGISTRATION") ||
        upper.includes("OFFICER") ||
        upper.includes("SIGNATURE") ||
        upper.includes("DATE") ||
        upper.includes("PLACE")
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
 * Main Browser-Side Voter ID Scanner
 */
export async function scanVoterCard(
  file: File | Blob,
  side: "front" | "back" = "front",
  onProgress?: (pct: number, status: string) => void,
): Promise<IdOcrResult> {
  onProgress?.(15, "Loading image & normalizing contrast…");
  const imgSource = await loadImageSource(file);

  // Voter cards are frequently portrait. Probe 0 and 90
  const initialRot = imgSource.width > imgSource.height ? 90 : 0;

  const baseCanvas = toGrayContrast(drawToCanvas(imgSource, 2200, initialRot));

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

    const scoreVoterText = (t: string): number => {
      let s = 0;
      const u = t.toUpperCase();
      if (u.includes("ELECTION")) s += 3;
      if (u.includes("COMMISSION")) s += 3;
      if (u.includes("INDIA")) s += 2;
      if (u.includes("ELECTOR")) s += 3;
      if (u.includes("EPIC") || u.includes("IDENTITY")) s += 2;
      if (u.includes("ADDRESS") || u.includes("PIN")) s += 2;
      if (/[A-Z0-9]{10}/.test(u)) s += 3;
      return s;
    };

    let bestScore = scoreVoterText(bestText);

    if (bestScore < 4) {
      // Try 90, 180, 270 degrees
      for (const rot of [90, 270, 180]) {
        onProgress?.(55, `Checking orientation (${rot}°)…`);
        const rotCanvas = toGrayContrast(drawToCanvas(imgSource, 2200, rot));
        const rotBlob = await canvasToBlob(rotCanvas);
        const rotRes = await worker.recognize(rotBlob);
        const sc = scoreVoterText(rotRes.data.text);
        if (sc > bestScore) {
          bestScore = sc;
          bestText = rotRes.data.text;
          if (sc >= 5) break;
        }
      }
    }

    onProgress?.(80, "Extracting voter ID fields…");

    if (side === "back") {
      const { address, pincode, city, state } = extractVoterBack(bestText);
      const hasAddress = Boolean(address || pincode || state);
      onProgress?.(100, "Done");

      return {
        fields: {
          address,
          pincode,
          city,
          state,
          id_type_detected: "Voter ID",
        },
        confidence: hasAddress ? 0.92 : 0.45,
        source: "tesseract",
        message: hasAddress
          ? "Voter ID back face scanned successfully"
          : "Voter ID back face scanned with partial details",
        can_autofill: hasAddress,
      };
    }

    // Front face
    const { idNumber, name, fatherName, gender, dob } = extractVoterFront(bestText);
    const hasId = Boolean(idNumber);
    const hasName = Boolean(name);

    onProgress?.(100, "Done");

    const confidence =
      hasId && hasName ? 0.95 : hasId ? 0.85 : hasName ? 0.75 : 0.4;
    const canAutofill = hasId || (hasName && Boolean(dob || gender));

    return {
      fields: {
        id_number: idNumber,
        name,
        date_of_birth: dob,
        gender,
        care_of: fatherName ? `S/O ${fatherName}` : undefined,
        id_type_detected: "Voter ID",
      },
      confidence,
      source: "tesseract",
      message: hasId
        ? `Voter ID scanned successfully (${idNumber})`
        : "Voter ID scanned with partial details",
      can_autofill: canAutofill,
    };
  } finally {
    await worker.terminate();
  }
}
