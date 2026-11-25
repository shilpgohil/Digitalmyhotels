/**
 * PAN Card Scanner — Deep In-Browser OCR Engine
 * -------------------------------------------------------------
 * 100% client-side processing via Tesseract.js & HTML5 Canvas:
 *   1. Auto-orientation probe (0/90/180/270 deg) using Income Tax keyword density
 *   2. Projection-profile fine deskewing (+/- 22 deg)
 *   3. Multi-pass recognition directly on HTMLCanvasElement:
 *        - Full adaptiveBinarize (psm 6)
 *        - Full normalized grayscale (psm 6)
 *        - Center-left 72% ROI crop on bin (excludes right-side QR & edge print date)
 *        - Sparse text (psm 11) + targeted single-line PAN & Name bbox crops (psm 7)
 *   4. Multi-pass voting with 10-char PAN repair matrix & joined spaced-token support
 *   5. Word-level Name noise cleaning & Father's Name segregation
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

const PAN_KEYWORDS_RE =
  /INCOME|TAX|DEPARTMENT|GOVT|GOVERNMENT|INDIA|PERMANENT|ACCOUNT|NUMBER|CARD|FATHER|BIRTH|SIGNATURE|[A-Z]{5}\d{4}[A-Z]/gi;

const NOISE_HEADINGS = [
  "INCOME TAX", "INCOMETAX", "DEPARTMENT", "DEPARIMEN", "GOVT OF INDIA", "GOVERNMENT OF INDIA",
  "PERMANENT ACCOUNT", "ACCOUNT NUMBER", "NUMBER CARD", "FATHER", "DATE OF BIRTH",
  "SIGNATURE", "BHARAT SARKAR", "AYAKAR VIBHAG", "STHAYI LEKHA", "PEHCHAN",
  "ATH NOME", "NOME", "NEME", "NAAM", "PITA", "JANM", "TITHI",
];

const VALID_PAN_4TH = new Set(["P", "C", "H", "F", "A", "T", "B", "L", "J", "G"]);

export function repairPanNumber(candidate: string): string | null {
  const clean = candidate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 10) return null;

  const chars = clean.split("");
  for (let i = 0; i < 5; i++) {
    if (!/[A-Z]/.test(chars[i])) chars[i] = DIGIT_TO_LETTER[chars[i]] || chars[i];
  }
  for (let i = 5; i < 9; i++) {
    if (!/[0-9]/.test(chars[i])) chars[i] = LETTER_TO_DIGIT[chars[i]] || chars[i];
  }
  if (!/[A-Z]/.test(chars[9])) chars[9] = DIGIT_TO_LETTER[chars[9]] || chars[9];

  const repaired = chars.join("");
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(repaired)) return repaired;
  return null;
}

export function extractPanCandidatesFromText(text: string): { pan: string; score: number }[] {
  const out: { pan: string; score: number }[] = [];
  const rawUpper = text.toUpperCase();

  // 1. Direct space-joined patterns like "EUTPR1 122 K" or "D P U P K 4 6 4 2 J"
  const lines = rawUpper.split(/\r?\n/);
  for (const line of lines) {
    // Strip known non-PAN headings from line before joining tokens
    const strippedLine = line.replace(/[^A-Z0-9\s]/g, " ");
    const joined = strippedLine.replace(/\s+/g, "");

    // Slide window over 10-char sequences on the whitespace-collapsed line
    for (let i = 0; i <= joined.length - 10; i++) {
      const slice = joined.slice(i, i + 10);
      if (/^[A-Z0-9]{10}$/.test(slice)) {
        const isExact = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(slice);
        const rep = isExact ? slice : repairPanNumber(slice);
        if (rep && VALID_PAN_4TH.has(rep[3])) {
          // Bonus for individual PAN ('P') and exact un-repaired match
          let sc = isExact ? 10 : 5;
          if (rep[3] === "P") sc += 3;
          out.push({ pan: rep, score: sc });
        }
      }
    }

    // Also test individual whitespace-separated tokens (handles 10-char standalone tokens cleanly)
    for (const tok of strippedLine.split(/\s+/)) {
      const c = tok.trim();
      if (c.length === 10) {
        const isExact = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(c);
        const rep = isExact ? c : repairPanNumber(c);
        if (rep && VALID_PAN_4TH.has(rep[3])) {
          let sc = isExact ? 12 : 6;
          if (rep[3] === "P") sc += 3;
          out.push({ pan: rep, score: sc });
        }
      }
    }
  }
  return out;
}

export function pickBestPanNumber(passes: OcrPassOutput[]): string | null {
  const tally = new Map<string, number>();
  for (const p of passes) {
    const mult = p.weight ?? 1;
    const seenInPass = new Set<string>();
    for (const cand of extractPanCandidatesFromText(p.text)) {
      if (seenInPass.has(cand.pan)) continue;
      seenInPass.add(cand.pan);
      tally.set(cand.pan, (tally.get(cand.pan) || 0) + cand.score * mult);
    }
  }
  if (tally.size === 0) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function extractPanDobFromPasses(passes: OcrPassOutput[]): string | null {
  const curYear = new Date().getFullYear();
  const candidates: { iso: string; score: number }[] = [];

  for (const p of passes) {
    const mult = p.weight ?? 1;
    const lines = p.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : "";
      const hasDobLabel = /DATE\s*OF\s*BIRTH|BIRTH|D\.?O\.?B/i.test(line + " " + prevLine);

      // Slashed / hyphenated DD/MM/YYYY
      for (const m of line.matchAll(/\b([0-3]?\d)[/.\-]([0-1]?\d)[/.\-]((?:19|20)\d{2})\b/g)) {
        const d = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        const y = parseInt(m[3], 10);
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1930 && y <= curYear - 15) {
          candidates.push({
            iso: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
            score: (hasDobLabel ? 12 : 8) * mult,
          });
        }
      }

      // 10-digit slash-as-digit OCR (e.g. "1100711999" -> "11/07/1999") on DOB line
      if (hasDobLabel) {
        for (const m of line.matchAll(/\b([0-3]\d)[01]([0-1]\d)[01]((?:19|20)\d{2})\b/g)) {
          const d = parseInt(m[1], 10);
          const mo = parseInt(m[2], 10);
          const y = parseInt(m[3], 10);
          if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1930 && y <= curYear - 15) {
            candidates.push({
              iso: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
              score: 9 * mult,
            });
          }
        }
      }

      // Continuous DDMMYYYY (avoid right-edge issue dates unless labeled DOB or year <= curYear - 18)
      for (const m of line.matchAll(/\b([0-3]\d)([0-1]\d)((?:19|20)\d{2})\b/g)) {
        const d = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        const y = parseInt(m[3], 10);
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1930 && y <= curYear - 18) {
          candidates.push({
            iso: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
            score: (hasDobLabel ? 9 : 3) * mult,
          });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  const tally = new Map<string, number>();
  for (const c of candidates) {
    tally.set(c.iso, (tally.get(c.iso) || 0) + c.score);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function isPanNoiseHeading(upperLine: string, panNumber?: string | null): boolean {
  if (NOISE_HEADINGS.some((h) => upperLine.includes(h))) return true;
  if (/^[A-Z]{5}\d{4}[A-Z]$/.test(upperLine.replace(/[^A-Z0-9]/g, ""))) return true;
  if (/^(?:ATH|NAM|NAAM|NOME)\b/i.test(upperLine)) return true;
  if (panNumber && panNumber.length >= 6) {
    const compact = upperLine.replace(/[^A-Z0-9]/g, "");
    if (compact.length >= 4 && (panNumber.includes(compact) || panNumber.startsWith(compact.slice(0, 4)))) {
      return true;
    }
  }
  return false;
}

export function extractPanNamesFromPasses(
  passes: OcrPassOutput[],
  panNumber: string | null,
): { name?: string; fatherName?: string } {
  const nameTally = new Map<string, number>();
  const fatherTally = new Map<string, number>();

  for (const p of passes) {
    const mult = p.weight ?? 1;
    const rawLines = p.lines.map((l) => l.text.trim()).filter(Boolean);
    const cleanedCandidates: { val: string; idx: number; isAfterName: boolean; isAfterFather: boolean }[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const upper = raw.toUpperCase();
      if (isPanNoiseHeading(upper, panNumber)) continue;

      // Strip trailing punctuation/noise fragments (e.g. "RAJ KUMAR RAWAT “& R347")
      let cand = raw
        .replace(/^[^A-Za-z]+/, "")
        .replace(/\s*[“"'`[\]{}()*~_=+;:"<>!?@#$%^\\].*$/, "");
      cand = cleanTrailingOcrNoise(cand);
      if (!cand || cand.length < 4) continue;
      const lettersOnly = cand.replace(/[^A-Za-z]/g, "");
      if (lettersOnly.length < 4 || (cand.match(/\d/g) || []).length > 1) continue;
      if (!/^[A-Za-z\s.'-]+$/.test(cand)) continue;
      // Reject noisy OCR hallucinations made of fragmented 1-2 char tokens ("Ts Das Ta Oy", "Re Id Teer At")
      const allWords = cand.split(/\s+/).filter(Boolean);
      const words = allWords.filter((w) => w.length >= 2);
      if (words.length === 0 || words.join("").length < 4) continue;
      const shortWords = words.filter((w) => w.length <= 2).length;
      if (shortWords >= 2 && words.length >= 3) continue;
      const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
      if (avgLen < 3.5 && words.length >= 2) continue;

      const prev1 = i > 0 ? rawLines[i - 1].toUpperCase() : "";
      const prev2 = i > 1 ? rawLines[i - 2].toUpperCase() : "";
      const isAfterFather = /FATHER|FATHERS|PITA/i.test(prev1) || /FATHER|FATHERS|PITA/i.test(prev2);
      const isAfterName = !isAfterFather && (/\/?\s*NAME\b/i.test(prev1) || /\/?\s*NAME\b/i.test(prev2));

      cleanedCandidates.push({ val: words.join(" "), idx: i, isAfterName, isAfterFather });
    }

    const labeledName = cleanedCandidates.find((c) => c.isAfterName);
    const labeledFather = cleanedCandidates.find((c) => c.isAfterFather);

    if (labeledName) {
      const n = toTitleCase(labeledName.val);
      nameTally.set(n, (nameTally.get(n) || 0) + 10 * mult);
    }
    if (labeledFather) {
      const fn = toTitleCase(labeledFather.val);
      fatherTally.set(fn, (fatherTally.get(fn) || 0) + 10 * mult);
    }

    if (!labeledName && cleanedCandidates.length > 0) {
      // Check first two non-father candidates, rewarding 5th-char PAN surname/initial match strongly
      for (let ci = 0; ci < Math.min(2, cleanedCandidates.length); ci++) {
        if (cleanedCandidates[ci].isAfterFather) continue;
        const nVal = toTitleCase(cleanedCandidates[ci].val);
        let bonus = (ci === 0 ? 5 : 4) * mult;
        if (panNumber && panNumber.length === 10) {
          const wParts = cleanedCandidates[ci].val.toUpperCase().split(/\s+/);
          if (wParts.some((w) => w[0] === panNumber[4])) bonus += 9 * mult;
        }
        nameTally.set(nVal, (nameTally.get(nVal) || 0) + bonus);
      }

      if (!labeledFather && cleanedCandidates.length > 1 && !cleanedCandidates[1].isAfterName) {
        const fn0 = toTitleCase(cleanedCandidates[1].val);
        fatherTally.set(fn0, (fatherTally.get(fn0) || 0) + 4 * mult);
      }
    }
  }

  const bestFather =
    fatherTally.size > 0
      ? [...fatherTally.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : undefined;
  const sortedNames = [...nameTally.entries()].sort((a, b) => b[1] - a[1]);
  const bestName =
    sortedNames.find(([n]) => !bestFather || n.toLowerCase() !== bestFather.toLowerCase())?.[0] ??
    sortedNames[0]?.[0];

  return { name: bestName, fatherName: bestFather };
}

/**
 * Main Browser-Side PAN Scanner (Deskewed + Multi-Pass + Targeted ROI)
 */
export async function scanPanCard(
  file: File | Blob,
  onProgress?: (pct: number, status: string) => void,
): Promise<IdOcrResult> {
  onProgress?.(10, "Loading PAN card image…");
  const imgSource = await loadImageSource(file);

  // 1. 4-way orientation probe
  onProgress?.(20, "Detecting card orientation…");
  let rot = 0;
  let bestScore = -1;
  for (const r of [0, 90, 180, 270]) {
    const probe = adaptiveBinarize(toGrayContrast(drawToCanvas(imgSource, 1000, r)), 34, 0.88);
    const out = await runCanvasOcr(probe, { psm: "6" });
    const sc = (out.text.match(PAN_KEYWORDS_RE) || []).length;
    if (sc > bestScore) {
      bestScore = sc;
      rot = r;
    }
    if (sc >= 3) break;
  }

  // 2. Projection-profile fine deskew (+/- 22 deg)
  onProgress?.(35, "Correcting card tilt & enhancing contrast…");
  const fineSkew = estimateCanvasSkewAngle(imgSource, rot);
  const totalRot = rot - fineSkew;

  const side0 = Math.max(imgSource.width, imgSource.height) < 1300 ? 2800 : 2200;
  const rawHi = drawToCanvas(imgSource, side0, totalRot);
  // Trim outer 2% if rotated to eliminate border box artifacts
  const deskewed =
    Math.abs(fineSkew) >= 1.0
      ? cropCanvas(rawHi, rawHi.width * 0.02, rawHi.height * 0.02, rawHi.width * 0.96, rawHi.height * 0.96)
      : rawHi;

  const gray = toGrayContrast(deskewed);
  const bin = adaptiveBinarize(cloneCanvas(gray), 38, 0.88);

  // 3. Multi-pass OCR directly on Canvas — prioritize Left-Column ROI (excludes right QR/photo/hologram)
  onProgress?.(55, "Reading PAN details across multiple passes…");
  const passes: OcrPassOutput[] = [];

  const leftRect = cropCanvas(
    deskewed,
    deskewed.width * 0.02,
    deskewed.height * 0.14,
    deskewed.width * 0.66,
    deskewed.height * 0.82,
  );
  // Blue-channel crop washes out cyan PAN card texture while keeping black ink razor-sharp
  const leftBlueBin = adaptiveBinarize(toGrayContrast(cloneCanvas(leftRect), "b"), 36, 0.90);
  const leftGray = toGrayContrast(cloneCanvas(leftRect));
  const leftBin = adaptiveBinarize(cloneCanvas(leftGray), 38, 0.90);

  passes.push({ ...(await runCanvasOcr(leftBlueBin, { psm: "6" })), weight: 2 });
  passes.push({ ...(await runCanvasOcr(leftGray, { psm: "6" })), weight: 2 });
  passes.push({ ...(await runCanvasOcr(leftBin, { psm: "11" })), weight: 1 });
  passes.push({ ...(await runCanvasOcr(bin, { psm: "6" })), weight: 1 });

  onProgress?.(80, "Validating PAN format, Name & DOB…");
  let panNumber = pickBestPanNumber(passes);

  // Targeted psm 7 single-line retry on max 3 PAN-like bboxes if PAN still missing
  if (!panNumber) {
    let tries = 0;
    for (const p of passes) {
      for (const l of p.lines) {
        if (tries >= 3) break;
        const compact = l.text.replace(/[^A-Z0-9]/gi, "");
        if (l.bbox && compact.length >= 8 && compact.length <= 14 && /\d/.test(compact)) {
          tries++;
          const lh = Math.max(10, l.bbox.y1 - l.bbox.y0);
          const sc = Math.max(1, Math.min(3, 48 / lh));
          const cc = cropPadCanvas(
            gray,
            l.bbox.x0 - lh * 0.6,
            l.bbox.y0 - lh * 0.3,
            l.bbox.x1 - l.bbox.x0 + lh * 1.2,
            lh * 1.6,
            sc,
            18,
          );
          const p7 = await runCanvasOcr(cc, {
            psm: "7",
            whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
          });
          passes.push({ ...p7, weight: 2 });
        }
      }
      if (tries >= 3) break;
    }
    panNumber = pickBestPanNumber(passes);
  }

  // Fallback full-card grayscale pass only if Name or DOB still missing
  let { name, fatherName } = extractPanNamesFromPasses(passes, panNumber);
  if (!name || !extractPanDobFromPasses(passes)) {
    passes.push({ ...(await runCanvasOcr(gray, { psm: "6" })), weight: 1 });
    ({ name, fatherName } = extractPanNamesFromPasses(passes, panNumber));
  }

  const dob = extractPanDobFromPasses(passes);
  onProgress?.(100, "Done");

  const hasPan = Boolean(panNumber);
  const hasName = Boolean(name);
  const hasDob = Boolean(dob);

  const confidence =
    hasPan && hasName && hasDob ? 0.96 : hasPan && (hasName || hasDob) ? 0.90 : hasPan ? 0.78 : 0.45;
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
      ? `PAN Card scanned cleanly (${panNumber})`
      : "PAN Card scanned with partial details",
    can_autofill: canAutofill,
  };
}
