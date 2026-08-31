/**
 * ID Document OCR — browser-side text extraction with confidence scoring.
 *
 * Uses Tesseract.js (dynamically imported) to run OCR on uploaded ID images.
 * Supports Aadhar Card, PAN Card, Passport, and Driving Licence.
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
  dl:       /\b[A-Z]{2}\d{2}\s?\d{11}\b/,

  // Date in common Indian formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  dob: /(?:DOB|Date of Birth|Birth|जन्म)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/i,
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

  const aadharMatch = text.match(PATTERNS.aadhar);
  if (aadharMatch) {
    fields.id_number = aadharMatch[0].replace(/\s/g, " ");
    score += 0.30;
  }

  const dobMatch = text.match(PATTERNS.dob) || text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) { fields.date_of_birth = normalized; score += 0.20; }
  }

  const genderMatch = text.match(PATTERNS.gender);
  if (genderMatch) {
    fields.gender = normalizeGender(genderMatch[1]);
    score += 0.15;
  }

  // Name: lines before the Aadhar number that look like a proper name
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const nm = line.match(PATTERNS.name);
    if (nm && !line.match(PATTERNS.aadhar) && !line.match(PATTERNS.dob)) {
      const candidate = cleanName(nm[0]);
      if (candidate.split(" ").length >= 2 && candidate.length > 4) {
        fields.name = candidate;
        score += 0.25;
        break;
      }
    }
  }

  // Address: lines after DOB / gender block
  const textAfterDob = text.replace(/[\s\S]*(DOB|Date of Birth)[^\n]+/i, "").trim();
  const addrLines = textAfterDob
    .split("\n")
    .filter((l) => l.trim().length > 5 && !/\d{4}/.test(l))
    .slice(0, 3)
    .join(", ")
    .trim();
  if (addrLines) { fields.address = addrLines; score += 0.10; }

  return { ...fields, score };
}

function parsePAN(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "PAN Card" };
  let score = 0;

  const panMatch = text.match(PATTERNS.pan);
  if (panMatch) { fields.id_number = panMatch[0]; score += 0.35; }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const nm = line.match(PATTERNS.name);
    if (nm && !line.toUpperCase().includes("FATHER") && !line.toUpperCase().includes("INDIA")) {
      const candidate = cleanName(nm[0]);
      if (candidate.split(" ").length >= 2) {
        fields.name = candidate;
        score += 0.30;
        break;
      }
    }
  }

  const dobMatch = text.match(PATTERNS.dob) || text.match(PATTERNS.date);
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

  if (PATTERNS.pan.test(text) || upper.includes("INCOME TAX") || upper.includes("PERMANENT ACCOUNT")) {
    return parsePAN(text);
  }
  if (upper.includes("PASSPORT") || PATTERNS.passport.test(text)) {
    return parsePassport(text);
  }
  if (upper.includes("DRIVING") || upper.includes("LICENCE") || upper.includes("LICENSE") || PATTERNS.dl.test(text)) {
    return parseDrivingLicence(text);
  }
  // Default: Aadhar (most common in India)
  return parseAadhar(text);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Normalised confidence threshold above which autofill is offered. */
const AUTOFILL_THRESHOLD = 0.55;

/**
 * Run OCR on an ID document image and return parsed fields + confidence.
 *
 * @param imageFile  The image File object (PNG / JPEG / WebP).
 * @param idType     Expected ID type (from the form dropdown). Used as a hint.
 */
export async function parseIdDocument(
  imageFile: File,
  idType: string,
): Promise<IdOcrResult> {
  try {
    // Dynamically import Tesseract.js so it doesn't affect initial bundle size.
    const { createWorker } = await import("tesseract.js");

    const worker = await createWorker("eng", 1, {
      logger: () => undefined, // suppress verbose logs
    });

    const { data } = await worker.recognize(imageFile);
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
    let parsed = detectAndParse(rawText);

    // If the user explicitly chose a type, trust that over our detection.
    if (idType && idType !== "Aadhar Card") {
      if (idType === "PAN Card") parsed = parsePAN(rawText);
      else if (idType === "Passport") parsed = parsePassport(rawText);
      else if (idType === "Driving License") parsed = parseDrivingLicence(rawText);
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
