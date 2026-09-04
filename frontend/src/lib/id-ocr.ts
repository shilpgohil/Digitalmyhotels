/**
 * ID Document OCR — browser-side text extraction with confidence scoring.
 *
 * Uses Tesseract.js (dynamically imported) to run OCR on uploaded ID images.
 * Supports: Aadhar Card, PAN Card, Passport, Driving Licence, Voter ID.
 *
 * Returns structured fields + a 0–1 confidence score.
 * Callers decide: ≥ 0.55 → offer autofill, < 0.55 → warn user.
 */

export interface ParsedIdFields {
  name?: string;
  id_number?: string;
  date_of_birth?: string;  // YYYY-MM-DD  (HTML date input format)
  gender?: string;
  address?: string;
  /** 6-digit Indian PIN code extracted from the address block. */
  pincode?: string;
  id_type_detected?: string;
}

export interface IdOcrResult {
  fields: ParsedIdFields;
  /** 0–1 normalised confidence. ≥ 0.55 = can autofill. */
  confidence: number;
  /** Human-readable description for the user. */
  message: string;
  /** If true, show autofill prompt. If false, show "unclear" warning. */
  can_autofill: boolean;
}

// ─── Regex patterns ──────────────────────────────────────────────────────────

const PATTERNS = {
  aadhar:   /\b\d{4}\s?\d{4}\s?\d{4}\b/,
  pan:      /\b[A-Z]{5}\d{4}[A-Z]\b/,
  passport: /\b[A-Z]\d{7}\b/,
  // DL: state code (2 letters) + district/year + serial — flexible match
  dl:       /\b[A-Z]{2}[-\s]?\d{2}[-\s]?\d{4}[-\s]?\d{7}\b|\b[A-Z]{2}\d{2}\s?\d{4}\s?\d{7}\b/,
  // Voter ID (EPIC): 3 uppercase letters + 7 digits (e.g. ABC1234567)
  voter:    /\b[A-Z]{3}\d{7}\b/,

  // Date in common Indian formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  dob: /(?:DOB|Date of Birth|Birth Date|जन्म|जन्मतिथि)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/i,
  // Loose date — anywhere in the text (fallback)
  date: /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,

  gender: /\b(Male|Female|MALE|FEMALE|M|F|पुरुष|महिला)\b/,

  // Capitalised consecutive words that look like a name (2-4 words)
  name: /\b([A-Z][a-z]+(?: [A-Z][a-z]+){1,3})\b/,
};

// ─── Normalisation helpers ────────────────────────────────────────────────────

/** Convert DD/MM/YYYY  or  YYYY-MM-DD  → YYYY-MM-DD  (for <input type="date">). */
function normalizeDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const dmy = /^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/;
  const ymd = /^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/;

  const dMatch = raw.match(dmy);
  if (dMatch) return `${dMatch[3]}-${dMatch[2]}-${dMatch[1]}`;

  const yMatch = raw.match(ymd);
  if (yMatch) return raw.replace(/\//g, "-");

  return undefined;
}

function normalizeGender(raw: string): string {
  const val = raw.toLowerCase();
  if (val === "m" || val.startsWith("male") || val === "पुरुष") return "Male";
  if (val === "f" || val.startsWith("female") || val === "महिला") return "Female";
  return raw;
}

/** Clean OCR artefacts from a name string. */
function cleanName(raw: string): string {
  return raw
    .replace(/[^A-Za-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Per-type field parsers ───────────────────────────────────────────────────

function parseAadhar(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Aadhar Card" };
  let score = 0;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // ── Aadhar number ──────────────────────────────────────────────────────────
  // Find the line index of the 12-digit number — this is our positional anchor.
  let aadharLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (PATTERNS.aadhar.test(lines[i])) {
      fields.id_number = lines[i].match(PATTERNS.aadhar)![0];
      aadharLineIdx = i;
      score += 0.30;
      break;
    }
  }

  // ── DOB ────────────────────────────────────────────────────────────────────
  for (const line of lines) {
    const dobMatch = line.match(PATTERNS.dob) ?? line.match(PATTERNS.date);
    if (dobMatch) {
      const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
      if (normalized) { fields.date_of_birth = normalized; score += 0.20; break; }
    }
  }

  // ── Gender ─────────────────────────────────────────────────────────────────
  let genderLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const gm = lines[i].match(PATTERNS.gender);
    if (gm) {
      fields.gender = normalizeGender(gm[1]);
      genderLineIdx = i;
      score += 0.15;
      break;
    }
  }

  // ── Name ───────────────────────────────────────────────────────────────────
  // The name typically appears on the line just before gender, or as the first
  // capitalised 2+ word sequence above the Aadhar number.
  const upperBound = aadharLineIdx > 0 ? aadharLineIdx : lines.length;
  for (let i = 0; i < upperBound; i++) {
    const line = lines[i];
    // Skip lines that are clearly not names
    if (
      PATTERNS.aadhar.test(line) ||
      PATTERNS.dob.test(line) ||
      PATTERNS.gender.test(line) ||
      /GOVERNMENT|INDIA|AADHAAR|आधार|भारत/i.test(line) ||
      line.length < 4
    ) continue;

    const nm = line.match(PATTERNS.name);
    if (nm) {
      const candidate = cleanName(nm[0]);
      if (candidate.split(" ").length >= 2 && candidate.length > 4) {
        fields.name = candidate;
        score += 0.25;
        break;
      }
    }
  }

  // ── Address: NOT extracted from the front face ─────────────────────────────
  // The Aadhaar FRONT has no reliable address (the address lives on the BACK).
  // Earlier versions guessed at lines between gender and the number, which
  // produced garbage autofill (client-reported). Front = name/DOB/gender/number
  // only; the back face goes through parseAadharBack().
  void genderLineIdx;

  return { ...fields, score };
}

// Devanagari (Hindi) block — back faces print the address in Hindi first, then
// English. We keep the English block only.
const DEVANAGARI = /[\u0900-\u097F]/;

/** 6-digit Indian PIN code, not part of a longer digit run. */
const PIN_RE = /\b([1-9]\d{5})\b/;

/**
 * Dedicated Aadhaar BACK-face parser (address + pincode).
 *
 * Strategy: find the English "Address:" label, then collect subsequent
 * English lines until (and including) the line containing the 6-digit
 * pincode. Strict quality gate: a result without a valid pincode or with
 * < 60% word characters is rejected — NEVER autofill garbage.
 */
function parseAadharBack(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Aadhar Card" };
  let score = 0;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Aadhaar number is printed on the back too — grab it as a bonus.
  const numMatch = text.match(PATTERNS.aadhar);
  if (numMatch) {
    fields.id_number = numMatch[0];
    score += 0.15;
  }

  // Locate the ENGLISH address label ("Address:" — skip the Hindi "पता").
  const labelIdx = lines.findIndex(
    (l) => /\bAddress\b\s*[:.]?/i.test(l) && !DEVANAGARI.test(l.replace(/Address/i, "")),
  );
  const startIdx = labelIdx >= 0 ? labelIdx : lines.findIndex((l) => /\bAddress\b/i.test(l));
  if (startIdx < 0) return { ...fields, score };

  const collected: string[] = [];
  // Any text on the label line itself, after the label.
  const onLabel = lines[startIdx].replace(/^.*?\bAddress\b\s*[:.]?\s*/i, "").trim();
  if (onLabel && !DEVANAGARI.test(onLabel)) collected.push(onLabel);

  let pincode: string | undefined;
  for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + 8); i++) {
    const line = lines[i];
    if (DEVANAGARI.test(line)) continue; // Hindi block — skip
    if (PATTERNS.aadhar.test(line)) break; // reached the number strip
    if (/^(www\.|help@|1947|uidai|unique identification)/i.test(line)) break;
    const cleaned = line.replace(/\s+/g, " ").trim();
    if (cleaned.length < 3) continue;
    collected.push(cleaned);
    const pin = cleaned.match(PIN_RE);
    if (pin) {
      pincode = pin[1];
      break; // pincode is the last line of an Indian address
    }
  }

  if (collected.length === 0) return { ...fields, score };

  const joined = collected
    .join(", ")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*,+/g, ",")
    .replace(/^[,\s]+|[,\s]+$/g, "");

  // Quality gate: valid pincode AND ≥ 60% word characters, else reject.
  const wordChars = joined.replace(/[^A-Za-z0-9,./\- ]/g, "").length;
  const quality = joined.length > 0 ? wordChars / joined.length : 0;
  if (pincode && quality >= 0.6 && joined.length >= 10) {
    fields.address = joined;
    fields.pincode = pincode;
    score += 0.55; // address + pincode is the whole point of the back face
  }

  return { ...fields, score };
}

function parsePAN(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "PAN Card" };
  let score = 0;

  const panMatch = text.match(PATTERNS.pan);
  if (panMatch) { fields.id_number = panMatch[0]; score += 0.35; }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Name on PAN: first proper name that isn't "INCOME TAX", "INDIA", or
  // a father's name line. PAN usually shows "Name:" label on the same line.
  for (const line of lines) {
    if (/INCOME|TAX|DEPARTMENT|INDIA|FATHER|पिता/i.test(line)) continue;
    const nm = line.replace(/^Name[:\s]*/i, "").match(PATTERNS.name);
    if (nm) {
      const candidate = cleanName(nm[0]);
      if (candidate.split(" ").length >= 2 && candidate.length > 4) {
        fields.name = candidate;
        score += 0.30;
        break;
      }
    }
  }

  const dobMatch = text.match(PATTERNS.dob) ?? text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) { fields.date_of_birth = normalized; score += 0.25; }
  }

  return { ...fields, score };
}

function parsePassport(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Passport" };
  let score = 0;

  const ppMatch = text.match(PATTERNS.passport);
  if (ppMatch) { fields.id_number = ppMatch[0]; score += 0.30; }

  // MRZ line typically: P<INDLASTNAME<<FIRSTNAME
  const mrzLine = text.split("\n").find((l) => l.includes("<<") && l.length > 30);
  if (mrzLine) {
    const parts = mrzLine.replace(/P<IND/i, "").split("<<");
    if (parts.length >= 2) {
      const surname = parts[0].replace(/<+/g, " ").trim();
      const given = parts[1].replace(/<+/g, " ").trim();
      if (surname && given) {
        fields.name = `${given} ${surname}`.trim();
        score += 0.30;
      }
    }
  }

  const dobMatch = text.match(PATTERNS.dob) || text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) { fields.date_of_birth = normalized; score += 0.20; }
  }

  const genderMatch = text.match(PATTERNS.gender);
  if (genderMatch) { fields.gender = normalizeGender(genderMatch[1]); score += 0.10; }

  return { ...fields, score };
}

function parseVoterID(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Voter ID" };
  let score = 0;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Voter ID (EPIC) number
  const voterMatch = text.match(PATTERNS.voter);
  if (voterMatch) { fields.id_number = voterMatch[0]; score += 0.30; }

  // DOB
  const dobMatch = text.match(PATTERNS.dob) ?? text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) { fields.date_of_birth = normalized; score += 0.20; }
  }

  // Gender
  const genderMatch = text.match(PATTERNS.gender);
  if (genderMatch) { fields.gender = normalizeGender(genderMatch[1]); score += 0.15; }

  // Name: voter cards show "Name:" or the name directly after header
  // Skip father's name line ("S/O", "D/O", "W/O")
  for (const line of lines) {
    if (/\b(S\/O|D\/O|W\/O|H\/O|Father|Mother|Husband|पिता|पति|माता)/i.test(line)) continue;
    if (/ELECTION|VOTER|INDIA|भारत|निर्वाचन/i.test(line)) continue;
    const cleaned = line.replace(/^(Name|नाम)[:\s]*/i, "");
    const nm = cleaned.match(PATTERNS.name);
    if (nm) {
      const candidate = cleanName(nm[0]);
      if (candidate.split(" ").length >= 2 && candidate.length > 4) {
        fields.name = candidate;
        score += 0.25;
        break;
      }
    }
  }

  // Address: voter cards have a distinct "Address:" section
  const addrLineIdx = lines.findIndex((l) => /^(Address|Residential|पता)/i.test(l));
  if (addrLineIdx >= 0) {
    const addrLines = lines
      .slice(addrLineIdx + 1, addrLineIdx + 4)
      .filter((l) => l.length > 3 && !PATTERNS.voter.test(l));
    if (addrLines.length > 0) {
      // Also include text on the Address: line itself (after the label)
      const labelLine = lines[addrLineIdx].replace(/^(Address|Residential|पता)[:\s]*/i, "").trim();
      const allAddr = [labelLine, ...addrLines].filter(Boolean);
      fields.address = allAddr.join(", ");
      score += 0.10;
    }
  }

  return { ...fields, score };
}

function parseDrivingLicence(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Driving License" };
  let score = 0;

  const dlMatch = text.match(PATTERNS.dl) || text.match(/[A-Z]{2}\d{2}\s?\d{2,}/);
  if (dlMatch) { fields.id_number = dlMatch[0].trim(); score += 0.30; }

  const dobMatch = text.match(PATTERNS.dob) || text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) { fields.date_of_birth = normalized; score += 0.20; }
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const nm = line.match(PATTERNS.name);
    if (nm && !line.match(/\d{4}/)) {
      const candidate = cleanName(nm[0]);
      if (candidate.split(" ").length >= 2) {
        fields.name = candidate;
        score += 0.25;
        break;
      }
    }
  }

  const genderMatch = text.match(PATTERNS.gender);
  if (genderMatch) { fields.gender = normalizeGender(genderMatch[1]); score += 0.15; }

  return { ...fields, score };
}

/** Auto-detect ID type from raw OCR text and dispatch to the right parser. */
function detectAndParse(text: string): Partial<ParsedIdFields> & { score: number } {
  const upper = text.toUpperCase();

  // PAN: explicit number pattern or header text
  if (PATTERNS.pan.test(text) || upper.includes("INCOME TAX") || upper.includes("PERMANENT ACCOUNT")) {
    return parsePAN(text);
  }
  // Passport: explicit header or document number format
  if (upper.includes("PASSPORT") || PATTERNS.passport.test(text)) {
    return parsePassport(text);
  }
  // Driving Licence: keyword or pattern
  if (
    upper.includes("DRIVING") ||
    upper.includes("LICENCE") ||
    upper.includes("LICENSE") ||
    upper.includes("MOTOR VEHICLE") ||
    PATTERNS.dl.test(text)
  ) {
    return parseDrivingLicence(text);
  }
  // Voter ID: EPIC keyword or pattern
  if (
    upper.includes("ELECTION") ||
    upper.includes("VOTER") ||
    upper.includes("EPIC") ||
    upper.includes("ELECTORAL") ||
    upper.includes("निर्वाचन") ||
    PATTERNS.voter.test(text)
  ) {
    return parseVoterID(text);
  }
  // Default: Aadhar (most common)
  return parseAadhar(text);
}

// ─── Image preprocessing ──────────────────────────────────────────────────────

/**
 * Upscale small images (2×) and boost contrast in grayscale before OCR.
 * Tesseract accuracy on Aadhaar back-face address text improves markedly
 * with this; falls back to the original file on any failure.
 */
async function preprocessForOcr(imageFile: File): Promise<Blob | File> {
  try {
    const bitmap = await createImageBitmap(imageFile);
    const scale = Math.max(bitmap.width, bitmap.height) < 1200 ? 2 : 1;
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width * scale;
    canvas.height = bitmap.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return imageFile;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    const CONTRAST = 1.35; // gentle boost — aggressive values destroy thin glyphs
    for (let i = 0; i < px.length; i += 4) {
      const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const boosted = Math.min(255, Math.max(0, (gray - 128) * CONTRAST + 128));
      px[i] = px[i + 1] = px[i + 2] = boosted;
    }
    ctx.putImageData(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    return blob ?? imageFile;
  } catch {
    return imageFile;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Normalised confidence threshold above which autofill is offered. */
const AUTOFILL_THRESHOLD = 0.55;

export type DocumentSide = "front" | "back";

/**
 * Run OCR on an ID document image and return parsed fields + confidence.
 *
 * @param imageFile  The image File object (PNG / JPEG / WebP).
 * @param idType     Expected ID type (from the form dropdown). Used as a hint.
 * @param side       Which face was uploaded. "back" routes Aadhaar to the
 *                   dedicated address/pincode parser with preprocessing.
 */
export async function parseIdDocument(
  imageFile: File,
  idType: string,
  side: DocumentSide = "front",
): Promise<IdOcrResult> {
  try {
    // Dynamically import Tesseract.js so it doesn't affect initial bundle size.
    const { createWorker } = await import("tesseract.js");

    const worker = await createWorker("eng", 1, {
      logger: () => undefined, // suppress verbose logs
    });

    // Back faces get grayscale/contrast/upscale preprocessing — the address
    // block is small print and benefits the most.
    const input = side === "back" ? await preprocessForOcr(imageFile) : imageFile;
    const { data } = await worker.recognize(input);
    await worker.terminate();

    const rawText = data.text ?? "";
    // Tesseract gives a 0–100 confidence on each character; we take the mean.
    const tesseractConfidence = (data.confidence ?? 0) / 100;

    if (!rawText.trim() || tesseractConfidence < 0.2) {
      return {
        fields: {},
        confidence: 0,
        message: "Image is too blurry or unclear to read. Please upload a clearer photo.",
        can_autofill: false,
      };
    }

    // Dispatch to the appropriate parser (with expected idType as a hint).
    let parsed: Partial<ParsedIdFields> & { score: number };
    if (side === "back" && (!idType || idType === "Aadhar Card")) {
      // Aadhaar back face: dedicated address/pincode parser with strict gate.
      parsed = parseAadharBack(rawText);
    } else {
      parsed = detectAndParse(rawText);
      // If the user explicitly chose a type, trust that over our detection.
      if (idType && idType !== "Aadhar Card") {
        if (idType === "PAN Card") parsed = parsePAN(rawText);
        else if (idType === "Passport") parsed = parsePassport(rawText);
        else if (idType === "Driving License") parsed = parseDrivingLicence(rawText);
        else if (idType === "Voter ID") parsed = parseVoterID(rawText);
      }
    }

    // Blend Tesseract's character-level confidence with our field-match score.
    const finalConfidence = Math.min(
      1,
      (parsed.score * 0.7) + (tesseractConfidence * 0.3),
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { score: _score, ...fields } = parsed;

    if (finalConfidence >= AUTOFILL_THRESHOLD) {
      const detected = fields.id_type_detected ?? idType;
      return {
        fields,
        confidence: finalConfidence,
        message: `${detected} details detected (${Math.round(finalConfidence * 100)}% confidence)`,
        can_autofill: true,
      };
    }

    if (side === "back" && !fields.address) {
      return {
        fields,
        confidence: finalConfidence,
        message:
          "Couldn't read the address clearly from the back face — please enter it manually.",
        can_autofill: false,
      };
    }

    return {
      fields,
      confidence: finalConfidence,
      message:
        finalConfidence > 0.25
          ? "Some details detected but confidence is low — image may not be clear enough. Please try a clearer photo or fill in manually."
          : "Unable to read ID details. The image may be blurry, too dark, or at an angle. Please upload a clearer photo.",
      can_autofill: false,
    };
  } catch (err) {
    console.error("[id-ocr] OCR failed:", err);
    return {
      fields: {},
      confidence: 0,
      message: "Could not process image. Please fill in details manually.",
      can_autofill: false,
    };
  }
}
