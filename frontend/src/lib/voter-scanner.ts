/**
 * Voter ID (EPIC) Scanner — Deep In-Browser OCR Engine
 * -------------------------------------------------------------
 * 100% client-side processing via Tesseract.js & HTML5 Canvas:
 *   1. Full 4-way orientation check [0, 90, 180, 270] (supports portrait AND horizontal EPICs)
 *   2. Projection-profile fine deskewing (+/- 22 deg)
 *   3. Multi-pass recognition:
 *        - Front: adaptiveBinarize (psm 6 & 11) + grayscale (psm 6) + top-right EPIC whitelist
 *          crop excluding left 1D barcode (solves barcode interference like sudhir-front.png)
 *        - Back: Blue-channel contrast + adaptiveBinarize (fades overlapping blue ink signatures)
 *   4. Multi-pass EPIC voting & 3-letter + 7-digit repair (excluding known stamp numbers like MP0685...)
 */

import type { IdOcrResult } from "@/lib/id-ocr";
import {
  adaptiveBinarize,
  cleanTrailingOcrNoise,
  cloneCanvas,
  cropCanvas,
  drawToCanvas,
  estimateCanvasSkewAngle,
  findIndianState,
  getIndianStatesForPin,
  loadImageSource,
  runCanvasOcr,
  toGrayContrast,
  toTitleCase,
  type OcrPassOutput,
} from "@/lib/ocr-canvas-utils";

const DIGIT_TO_LETTER: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "5": "S",
  "6": "G",
  "8": "B",
};

const LETTER_TO_DIGIT: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", "|": "1", i: "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  B: "8",
  G: "9", g: "9", q: "9",
  E: "6",
};

const VOTER_KEYWORDS_RE =
  /ELECTION|COMMISSION|INDIA|ELECTOR|IDENTITY|CARD|FATHER|MOTHER|HUSBAND|BIRTH|MALE|FEMALE|ADDRESS|TEHSIL|DISTRICT|CONSTITUENCY/gi;

// Reject stamp/hologram serial numbers starting with state MP0685... etc.
const HOLOGRAM_SERIAL_RE = /^MP0?68|^MPO68/;

export function repairEpicNumber(raw: string): { epic: string; exact: boolean } | null {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (HOLOGRAM_SERIAL_RE.test(clean)) return null;

  if (clean.length === 10) {
    if (/^[A-Z]{3}[0-9]{7}$/.test(clean)) {
      return { epic: clean, exact: true };
    }
    const chars = clean.split("");
    let letterRepairs = 0;
    for (let i = 0; i < 3; i++) {
      if (!/[A-Z]/.test(chars[i])) {
        const mapped = DIGIT_TO_LETTER[chars[i]];
        if (!mapped) return null;
        chars[i] = mapped;
        letterRepairs++;
      }
    }
    // Reject if >1 letter had to be guessed from digits (filters out stamps like MP06850035)
    if (letterRepairs > 1) return null;

    for (let i = 3; i < 10; i++) {
      if (!/[0-9]/.test(chars[i])) {
        chars[i] = LETTER_TO_DIGIT[chars[i]] || chars[i];
      }
    }
    const repaired = chars.join("");
    if (/^[A-Z]{3}[0-9]{7}$/.test(repaired)) {
      return { epic: repaired, exact: false };
    }
  }

  return null;
}

function pickBestEpic(passes: OcrPassOutput[]): string | null {
  const tally = new Map<string, number>();

  for (const p of passes) {
    const seen = new Set<string>();
    const lines = p.text.toUpperCase().split(/\r?\n/);
    for (const line of lines) {
      const alphaNum = line.replace(/[^A-Z0-9\s]/g, " ");
      // 1. Check direct tokens
      for (const tok of alphaNum.split(/\s+/)) {
        const res = repairEpicNumber(tok);
        if (res && !seen.has(res.epic)) {
          seen.add(res.epic);
          tally.set(res.epic, (tally.get(res.epic) || 0) + (res.exact ? 12 : 6));
        }
      }
      // 2. Check space-collapsed line slice (handles "ILN0306 795" -> "ILN0306795")
      // Strip label keywords first so "BIRTH 21-01-1992" never collides with "RTH2101199".
      const noLabelLine = alphaNum.replace(
        /\b(?:BIRTH|DATE|YEAR|AGE|SEX|MALE|FEMALE|INDIA|FATHER|MOTHER|HUSBAND|ELECTOR|CARD|NUMBER|PHOTO|COMMISSION)\b/g,
        " ",
      );
      const collapsed = noLabelLine.replace(/\s+/g, "");
      for (let i = 0; i <= collapsed.length - 10; i++) {
        const slice = collapsed.slice(i, i + 10);
        if (/^(?:RTH|SEX|DOB|AGE|PIN|NUM|DAT)/.test(slice)) continue;
        const res = repairEpicNumber(slice);
        if (res && !seen.has(res.epic)) {
          seen.add(res.epic);
          tally.set(res.epic, (tally.get(res.epic) || 0) + (res.exact ? 8 : 4));
        }
      }
    }
  }

  if (tally.size === 0) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function extractVoterFrontFromPasses(passes: OcrPassOutput[]): {
  idNumber?: string;
  name?: string;
  fatherName?: string;
  gender?: string;
  dob?: string;
} {
  const idNumber = pickBestEpic(passes) || undefined;
  const nameTally = new Map<string, number>();
  const fatherTally = new Map<string, number>();
  const genderTally = new Map<string, number>();
  const dobTally = new Map<string, number>();

  for (const p of passes) {
    const mult = p.weight ?? 1;
    const lines = p.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upper = line.toUpperCase();

      // Elector's Name (strictly skip Father/Mother/Husband lines)
      if (
        (upper.includes("ELECTOR") || upper.includes("ELECTORSNAME")) &&
        !upper.includes("PHOTO IDENTITY") &&
        !upper.includes("FATHER") &&
        !upper.includes("MOTHER") &&
        !upper.includes("HUSBAND")
      ) {
        const afterColon = line.split(/[:\-~–]+/).slice(1).join(" ").trim();
        let val = afterColon || (i + 1 < lines.length ? lines[i + 1] : "");
        if (val) {
          val = cleanTrailingOcrNoise(
            val
              .replace(/^[^A-Za-z]+/, "")
              .replace(/\s*[=[\]{}()|*;:"<>!@#$%^`\\].*$/, ""),
          );
          if (/^[A-Za-z\s.'-]{3,}$/.test(val) && !/COMMISSION|IDENTITY|FATHER|MOTHER/i.test(val)) {
            const cleanN = toTitleCase(val);
            nameTally.set(cleanN, (nameTally.get(cleanN) || 0) + 10 * mult);
          }
        }
      } else if (/\bNAME\b/i.test(upper) && !upper.includes("FATHER") && !upper.includes("MOTHER") && !upper.includes("HUSBAND")) {
        const m = line.match(/\bNAME\b\s*[:\-~–]?\s*([A-Za-z\s.'-]+)/i);
        if (m) {
          const val = cleanTrailingOcrNoise(m[1].replace(/\s*[=[\]{}()|*;:"<>!@#$%^`\\].*$/, ""));
          if (val.length >= 3 && /^[A-Za-z\s.'-]+$/.test(val) && !/IDENTITY|COMMISSION/i.test(val)) {
            const cleanN = toTitleCase(val);
            nameTally.set(cleanN, (nameTally.get(cleanN) || 0) + 8 * mult);
          }
        }
      }

      // Father / Mother / Husband Name
      if (/FATHER|MOTHER|HUSBAND/i.test(upper)) {
        const m = line.match(/(?:FATHER'?S?|MOTHER'?S?|HUSBAND'?S?)\s*NAME\s*[:\-~–]?\s*(.+)/i);
        let val = m ? m[1] : line.split(/[:\-~–]+/).slice(1).join(" ").trim();
        if (!val && i + 1 < lines.length) val = lines[i + 1];
        val = cleanTrailingOcrNoise((val || "").replace(/^[^A-Za-z]+/, ""));
        if (val.length >= 3 && /^[A-Za-z\s.'-]+$/.test(val) && !/SEX|GENDER|DATE|BIRTH/i.test(val)) {
          const cleanF = toTitleCase(val);
          fatherTally.set(cleanF, (fatherTally.get(cleanF) || 0) + 8);
        }
      }

      // Gender
      if (/\b(?:FEMALE|WOMAN)\b/i.test(upper)) {
        genderTally.set("Female", (genderTally.get("Female") || 0) + 6);
      } else if (/\b(?:MALE|MAN)\b/i.test(upper)) {
        genderTally.set("Male", (genderTally.get("Male") || 0) + 6);
      }

      // DOB (slashed or continuous DDMMYYYY)
      const isDobLine = /BIRTH|DOB/i.test(upper);
      const dm = line.match(/\b([0-3]?\d)[/.\-]([0-1]?\d)[/.\-]((?:19|20)\d{2})\b/);
      if (dm) {
        const d = parseInt(dm[1], 10);
        const mo = parseInt(dm[2], 10);
        const y = parseInt(dm[3], 10);
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1920 && y <= new Date().getFullYear() - 16) {
          const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          dobTally.set(iso, (dobTally.get(iso) || 0) + (isDobLine ? 10 : 5));
        }
      } else {
        const cm = line.match(/\b([0-3]\d)([0-1]\d)((?:19|20)\d{2})\b/);
        if (cm && isDobLine) {
          const d = parseInt(cm[1], 10);
          const mo = parseInt(cm[2], 10);
          const y = parseInt(cm[3], 10);
          if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1920 && y <= new Date().getFullYear() - 16) {
            const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            dobTally.set(iso, (dobTally.get(iso) || 0) + 7);
          }
        }
      }
    }
  }

  return {
    idNumber,
    name: nameTally.size ? [...nameTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined,
    fatherName: fatherTally.size ? [...fatherTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined,
    gender: genderTally.size ? [...genderTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined,
    dob: dobTally.size ? [...dobTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined,
  };
}

const VOTER_BACK_DISCLAIMER_RE =
  /DATE\s*[:\d]|FACSIMILE|ELECTORAL|CONSTITUENCY|SIGNATURE|IN\s*CASE|CHANGES?\s+IN\s+ADDRESS|CHANGED\s+ADDRESS|MEN[TLI]{1,2}ON|SLOVEST|RELEVANT|SEVEN\w*\s+FORM|INCLUDING\s+YOUR|OB[TSI]{1,2}AIN\s+(?:THE|BE)\s+CARD|CARD\s+[MNW]O/i;

function extractVoterBackFromPasses(passes: OcrPassOutput[]): {
  address?: string;
  pincode?: string;
  city?: string;
  state?: string;
} {
  let bestAddress = "";
  const pinTally = new Map<string, number>();
  const stateTally = new Map<string, number>();
  let detectedCity: string | undefined;

  for (const p of passes) {
    const mult = p.weight ?? 1;
    for (const pm of p.text.matchAll(/\b([1-9]\d{5})\b/g)) {
      pinTally.set(pm[1], (pinTally.get(pm[1]) || 0) + 5 * mult);
    }

    const lines = p.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const addrLines: string[] = [];
    let capturing = false;

    for (const line of lines) {
      const upper = line.toUpperCase();
      if (VOTER_BACK_DISCLAIMER_RE.test(upper)) {
        if (capturing) break;
        continue;
      }
      if (/ADDRESS|AADD?ESS/i.test(upper)) {
        capturing = true;
        const afterColon = line.replace(/^.*?(?:ADDRESS|AADD?ESS)[:\s\-]*/i, "").trim();
        if (afterColon.length >= 3 && !VOTER_BACK_DISCLAIMER_RE.test(afterColon)) {
          addrLines.push(afterColon);
        }
        continue;
      }
      if (capturing) {
        const cleanedLine = line.replace(/^[.|[\]_*~]+\s*/, "").trim();
        if (cleanedLine.length >= 2) addrLines.push(cleanedLine);
        if (/\b[1-9]\d{5}\b/.test(cleanedLine)) break;
      }
    }

    if (addrLines.length > 0) {
      const joined = addrLines.join(", ").replace(/,\s*,+/g, ",").trim();
      if (joined.length > bestAddress.length) {
        bestAddress = joined;
      }
    }

    const st = findIndianState(p.text);
    if (st) stateTally.set(st, (stateTally.get(st) || 0) + 5 * mult);

    const distMatch = p.text.match(/(?:DISTRICT|DIST)\s*[:\-]?\s*([A-Za-z]{3,20})/i);
    if (distMatch && !detectedCity) {
      detectedCity = toTitleCase(distMatch[1]);
    }
  }

  const pincode = pinTally.size ? [...pinTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined;
  let state = stateTally.size ? [...stateTally.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined;
  if (!state && pincode) {
    const s = getIndianStatesForPin(pincode);
    if (s && s.length === 1) state = s[0];
  }

  // Strip PIN & trailing state artifacts cleanly from address string
  let cleanAddress = bestAddress;
  if (cleanAddress && pincode) {
    cleanAddress = cleanAddress.replace(pincode, "").replace(/[,-\s]+$/, "").trim();
  }

  return {
    address: cleanAddress ? toTitleCase(cleanAddress) : undefined,
    pincode,
    city: detectedCity,
    state,
  };
}

/**
 * Main Browser-Side Voter ID Scanner (Deskewed + Barcode Isolation + Blue-Channel Back)
 */
export async function scanVoterCard(
  file: File | Blob,
  side: "front" | "back" = "front",
  onProgress?: (pct: number, status: string) => void,
): Promise<IdOcrResult> {
  onProgress?.(10, "Loading Voter ID image…");
  const imgSource = await loadImageSource(file);

  // 1. 4-way orientation probe — ALWAYS tests 0° first for both portrait & landscape cards
  onProgress?.(20, "Checking card orientation…");
  let rot = 0;
  let bestScore = -1;
  for (const r of [0, 90, 180, 270]) {
    const probe = adaptiveBinarize(toGrayContrast(drawToCanvas(imgSource, 1000, r)), 34, 0.88);
    const out = await runCanvasOcr(probe, { psm: "6" });
    const sc = (out.text.match(VOTER_KEYWORDS_RE) || []).length;
    if (sc > bestScore) {
      bestScore = sc;
      rot = r;
    }
    if (sc >= 3) break;
  }

  // 2. Projection-profile fine deskew (+/- 22 deg)
  onProgress?.(35, "Correcting tilt & suppressing background patterns…");
  const fineSkew = estimateCanvasSkewAngle(imgSource, rot);
  const totalRot = rot - fineSkew;

  const side0 = Math.max(imgSource.width, imgSource.height) < 1300 ? 2600 : 2200;
  const rawHi = drawToCanvas(imgSource, side0, totalRot);
  const deskewed =
    Math.abs(fineSkew) >= 1.0
      ? cropCanvas(rawHi, rawHi.width * 0.02, rawHi.height * 0.02, rawHi.width * 0.96, rawHi.height * 0.96)
      : rawHi;

  const gray = toGrayContrast(cloneCanvas(deskewed));
  const bin = adaptiveBinarize(cloneCanvas(gray), 38, 0.88);

  const passes: OcrPassOutput[] = [];
  onProgress?.(55, "Running multi-pass Voter ID OCR…");

  if (side === "back") {
    // Blue channel dramatically fades blue ink signatures crossing paper back addresses
    const topAddrBlue = adaptiveBinarize(
      toGrayContrast(
        cropCanvas(deskewed, 0, 0, deskewed.width, deskewed.height * 0.55),
        "b",
      ),
      34,
      0.90,
    );
    const topAddrGray = toGrayContrast(
      cropCanvas(deskewed, 0, 0, deskewed.width, deskewed.height * 0.55),
      "b",
    );
    const blueBin = adaptiveBinarize(toGrayContrast(cloneCanvas(deskewed), "b"), 36, 0.88);
    passes.push({ ...(await runCanvasOcr(topAddrBlue, { psm: "6" })), weight: 2 });
    passes.push({ ...(await runCanvasOcr(topAddrGray, { psm: "6" })), weight: 2 });
    passes.push(await runCanvasOcr(blueBin, { psm: "6" }));
    passes.push(await runCanvasOcr(gray, { psm: "6" }));

    onProgress?.(85, "Extracting back-side address & PIN code…");
    const { address, pincode, city, state } = extractVoterBackFromPasses(passes);
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
        ? "Voter ID back face scanned cleanly"
        : "Voter ID back face scanned with partial details",
      can_autofill: hasAddress,
    };
  }

  // Front face multi-pass + bottom-half text block isolation (skips top photo/barcode/emblem clutter)
  passes.push(await runCanvasOcr(gray, { psm: "6" }));
  passes.push(await runCanvasOcr(bin, { psm: "6" }));
  const bottomGray = toGrayContrast(
    cropCanvas(deskewed, 0, deskewed.height * 0.50, deskewed.width, deskewed.height * 0.48),
  );
  const bottomBin = adaptiveBinarize(cloneCanvas(bottomGray), 34, 0.90);
  passes.push({ ...(await runCanvasOcr(bottomBin, { psm: "6" })), weight: 2 });
  passes.push({ ...(await runCanvasOcr(bottomGray, { psm: "6" })), weight: 2 });
  passes.push(await runCanvasOcr(bin, { psm: "11" }));

  // If no exact EPIC found yet, crop top-right band (excludes left 1D barcode like sudhir-front.png)
  if (!pickBestEpic(passes)) {
    const topRightGray = cropCanvas(
      gray,
      gray.width * 0.50,
      gray.height * 0.08,
      gray.width * 0.49,
      gray.height * 0.34,
    );
    passes.push(
      await runCanvasOcr(topRightGray, {
        psm: "6",
        whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      }),
    );
    const topLeftBand = cropCanvas(
      bin,
      0,
      bin.height * 0.14,
      bin.width,
      bin.height * 0.30,
    );
    passes.push(
      await runCanvasOcr(topLeftBand, {
        psm: "11",
        whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      }),
    );
  }

  onProgress?.(85, "Validating EPIC number & Elector details…");
  const { idNumber, name, fatherName, gender, dob } = extractVoterFrontFromPasses(passes);
  onProgress?.(100, "Done");

  const hasId = Boolean(idNumber);
  const hasName = Boolean(name);
  const confidence =
    hasId && hasName ? 0.95 : hasId ? 0.88 : hasName ? 0.75 : 0.4;
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
      ? `Voter ID scanned cleanly (${idNumber})`
      : "Voter ID scanned with partial details",
    can_autofill: canAutofill,
  };
}
