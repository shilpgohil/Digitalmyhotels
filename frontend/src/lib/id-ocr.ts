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

  // ── Address ────────────────────────────────────────────────────────────────
  // Aadhar card layout: ... [gender line] [address line(s)] [Aadhar number]
  // So address = lines strictly between the gender line and the Aadhar number.
  if (genderLineIdx >= 0 && aadharLineIdx > genderLineIdx + 1) {
    const addrCandidates = lines
      .slice(genderLineIdx + 1, aadharLineIdx)
      .filter((l) => {
        if (l.length < 3) return false;
        // Reject lines that are mostly non-printable / OCR noise
        const wordChars = l.replace(/[^A-Za-z0-9,. ]/g, "").length;
        const ratio = wordChars / l.length;
        if (ratio < 0.5) return false;
        // Reject ONLY full header/footer labels — not addresses that contain these words
        // e.g. "GOVERNMENT OF INDIA" → reject; "Patna, Bihar, India" → keep
        if (/^(GOVERNMENT\s+OF\s+INDIA|YOUR\s+AADHAAR|AADHAAR|आपका\s+आधार)$/i.test(l)) return false;
        return true;
      });

    if (addrCandidates.length > 0) {
      fields.address = addrCandidates.join(", ");
      score += 0.10;
    }
  } else if (genderLineIdx < 0 && aadharLineIdx > 0) {
    // Fallback: lines immediately above the Aadhar number
    const addrCandidates = lines
      .slice(Math.max(0, aadharLineIdx - 3), aadharLineIdx)
      .filter((l) => {
        const wordChars = l.replace(/[^A-Za-z0-9,. ]/g, "").length;
        return l.length > 3 && wordChars / l.length > 0.5
          && !/^(GOVERNMENT\s+OF\s+INDIA|AADHAAR)$/i.test(l);
      });
    if (addrCandidates.length > 0) {
      fields.address = addrCandidates.join(", ");
      score += 0.05;
    }
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
      else if (idType === "Voter ID") parsed = parseVoterID(rawText);
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
