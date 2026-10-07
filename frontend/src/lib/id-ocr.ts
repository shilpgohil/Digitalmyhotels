/**
 * ID Document OCR — browser-side text extraction with confidence scoring.
 *
 * Uses Tesseract.js (dynamically imported) to run OCR on uploaded ID images.
 * Supports: Aadhar Card, PAN Card, Passport, Driving Licence, Voter ID.
 *
 * Returns structured fields + a 0–1 confidence score.
 * Multi-pass execution, intelligent grayscale histogram normalization,
 * bilingual Hindi/English handling, and robust Indian ID regex matching.
 */

export interface ParsedIdFields {
  name?: string;
  id_number?: string;
  date_of_birth?: string; // YYYY-MM-DD  (HTML date input format)
  gender?: string;
  /** Street/locality address ONLY — pincode/state/district are decomposed
   *  into their own fields and stripped from this text (field purity: no
   *  column receives data that belongs to another column). */
  address?: string;
  /** 6-digit Indian PIN code extracted from the address block. */
  pincode?: string;
  /** District/city when the back face carries a "DIST:" marker or known district. */
  city?: string;
  /** Indian state/UT name recognized at the end of the address block. */
  state?: string;
  id_type_detected?: string;
}

export interface IdOcrResult {
  fields: ParsedIdFields;
  /** 0–1 normalised confidence. */
  confidence: number;
  /** Human-readable description for the user. */
  message: string;
  /** If true, show autofill prompt. If false, show "unclear" warning. */
  can_autofill: boolean;
}

// ─── Regex patterns ──────────────────────────────────────────────────────────

const PATTERNS = {
  // 12 digits (grouped by 4 with spaces/hyphens, contiguous, or masked XXXX XXXX 1234)
  aadhar: /\b(?:\d{4}[\s-]+\d{4}[\s-]+\d{4}|\d{12}|[Xx\d]{4}[\s-]+[Xx\d]{4}[\s-]+\d{4})\b/,
  // PAN: 5 letters, 4 digits, 1 letter. Accepts OCR 'O'/'0' and 'I'/'1' in digit block
  pan: /\b[A-Z]{5}[0-9OIl]{4}[A-Z]\b/i,
  // Passport: 1 uppercase letter + 7 digits
  passport: /\b[A-PR-WY-Z][0-9OIl]{7}\b/i,
  // DL: state code + district/year + serial (flexible separators)
  dl: /\b[A-Z]{2}[-\s/]?\d{2}[-\s/]?\d{4}[-\s/]?\d{7}\b|\b[A-Z]{2}\d{13,15}\b/,
  // Voter ID (EPIC): 3 uppercase letters + 7 digits (with OCR tolerance)
  voter: /\b[A-Z]{3}[-/]?[0-9OIl]{7}\b/i,

  // Date in common Indian formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD
  dob: /(?:D\.?O\.?B\.?|Date of Birth|Birth Date|Year of Birth|YOB|जन्म|जन्मतिथि|जन्म तारीख)[:\s/]*(\d{2}[./\-]\d{2}[./\-]\d{4}|\d{4}[./\-]\d{2}[./\-]\d{2}|\b(?:19|20)\d{2}\b)/i,
  // Loose date anywhere in text
  date: /\b(\d{2}[./\-]\d{2}[./\-]\d{4})\b/,

  gender: /\b(Male|Female|Transgender|MALE|FEMALE|TRANSGENDER|M|F|पुरुष|महिला)\b/,
};

// ─── Normalisation helpers ────────────────────────────────────────────────────

/** Convert DD/MM/YYYY or DD.MM.YYYY or YYYY-MM-DD or YYYY → YYYY-MM-DD. */
function normalizeDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\./g, "/").replace(/-/g, "/").trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const ymd = /^(\d{4})\/(\d{2})\/(\d{2})$/;
  const yearOnly = /^(?:19|20)\d{2}$/;

  const dMatch = cleaned.match(dmy);
  if (dMatch) return `${dMatch[3]}-${dMatch[2]}-${dMatch[1]}`;

  const yMatch = cleaned.match(ymd);
  if (yMatch) return `${yMatch[1]}-${yMatch[2]}-${yMatch[3]}`;

  if (yearOnly.test(cleaned)) {
    return `${cleaned}-01-01`;
  }

  return undefined;
}

function normalizeGender(raw: string): string {
  const val = raw.toLowerCase().trim();
  if (val === "m" || val.startsWith("male") || val === "पुरुष") return "Male";
  if (val === "f" || val.startsWith("female") || val === "महिला") return "Female";
  if (val.startsWith("trans")) return "Other";
  return raw;
}

export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-|\.)[a-z]/g, (m) => m.toUpperCase());
}

// Leading/trailing tokens that are OCR noise or honorifics
const NAME_NOISE_TOKENS = new Set([
  "hi", "ho", "hl", "ii", "ll", "rn", "vi", "yi", "el", "iv",
  "shri", "shree", "smt", "mr", "mrs", "ms", "sri", "dr",
]);

// Non-name vocabulary found in card headers, watermarks, and labels
const NON_NAME_TOKENS = new Set([
  "GOVERNMENT", "GOVT", "INDIA", "BHARAT", "AADHAAR", "UIDAI", "ENROLMENT", "MERA", "PEHCHAN",
  "UNIQUE", "IDENTIFICATION", "AUTHORITY", "OF", "HELP", "WWW", "MY",
  "INCOME", "TAX", "DEPARTMENT", "PERMANENT", "ACCOUNT", "CARD", "NUMBER",
  "ELECTION", "COMMISSION", "VOTER", "IDENTITY", "ELECTORAL", "EPIC",
  "DRIVING", "LICENCE", "LICENSE", "UNION", "TRANSPORT", "MOTOR", "VEHICLES",
  "REPUBLIC", "PASSPORT", "SURNAME", "GIVEN", "NATIONALITY", "SEX", "GENDER",
  "MALE", "FEMALE", "TRANSGENDER", "PURUSH", "MAHILA",
  "FATHER", "FATHERS", "MOTHER", "MOTHERS", "HUSBAND", "WIFE", "GUARDIAN", "SON", "DAUGHTER",
  "DATE", "BIRTH", "YEAR", "JANMA", "TARIKH", "ADDRESS", "PATA", "PIN", "PINCODE",
  "SIGNATURE", "HOLDER", "OFFICER", "ISSUED", "EXPIRY", "VALID", "UPTO", "STATE", "DISTRICT",
  "PO", "PS", "VILL", "TEHSIL", "TALUKA",
]);

function isNonNameLine(line: string): boolean {
  const upper = line.toUpperCase();
  return (
    /GOVERNMENT|INDIA|AADHAAR|आधार|भारत|UIDAI|ENROLMENT|AUTHORITY|IDENTIFICATION/i.test(upper) ||
    /INCOME|TAX|DEPARTMENT|PERMANENT|ACCOUNT/i.test(upper) ||
    /ELECTION|COMMISSION|VOTER|ELECTORAL|EPIC|निर्वाचन/i.test(upper) ||
    /TRANSPORT|MOTOR|VEHICLE|DRIVING|LICEN/i.test(upper) ||
    /PASSPORT|REPUBLIC|NATIONALITY/i.test(upper) ||
    /WWW\.|\.GOV\.IN|\.NIC\.IN|1947|HELP@/i.test(upper)
  );
}

/** Clean OCR artefacts and honorifics from a name string. */
function cleanName(raw: string): string {
  const base = raw
    .replace(/[^A-Za-z. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = base.split(" ");
  while (tokens.length > 2 && NAME_NOISE_TOKENS.has(tokens[0].toLowerCase().replace(/\./g, ""))) {
    tokens.shift();
  }
  while (tokens.length > 2 && NAME_NOISE_TOKENS.has(tokens[tokens.length - 1].toLowerCase().replace(/\./g, ""))) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** Extracts candidate person name from a text line. Handles ALL CAPS, Title Case, and initials. */
function extractNameFromLine(line: string): string | undefined {
  const clean = line
    .replace(/^.*?(?:Name|नाम)\s*[:.\/-]?\s*/i, "")
    .replace(/[\u0900-\u097F]+/g, " ")
    .replace(/[^A-Za-z.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length < 3) return undefined;

  const words = clean.split(" ").filter((w) => w.length > 0);
  if (words.length < 1 || words.length > 5) return undefined;

  const validWords = words.filter((w) => {
    const core = w.replace(/\./g, "").toUpperCase();
    return core.length > 0 && !NON_NAME_TOKENS.has(core);
  });

  if (validWords.length < 1) return undefined;

  const hasSubstantialWord = validWords.some((w) => w.replace(/\./g, "").length >= 3);
  if (!hasSubstantialWord) return undefined;

  const candidate = cleanName(validWords.join(" "));
  if (candidate.length < 3) return undefined;

  // Convert ALL CAPS (standard on Indian cards) or all-lower to clean Title Case
  if (candidate === candidate.toUpperCase() || candidate === candidate.toLowerCase()) {
    return toTitleCase(candidate);
  }
  return candidate;
}

// ─── Per-type field parsers ───────────────────────────────────────────────────

function parseAadhar(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Aadhar Card" };
  let score = 0;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // ── Aadhar number ──────────────────────────────────────────────────────────
  let aadharLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(PATTERNS.aadhar);
    if (match) {
      const rawNum = match[0].replace(/\s+/g, " ").trim();
      fields.id_number = rawNum;
      aadharLineIdx = i;
      score += 0.35;
      break;
    }
  }

  // ── DOB ────────────────────────────────────────────────────────────────────
  for (const line of lines) {
    const dobMatch = line.match(PATTERNS.dob) ?? line.match(PATTERNS.date);
    if (dobMatch) {
      const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
      if (normalized) {
        fields.date_of_birth = normalized;
        score += 0.25;
        break;
      }
    }
  }

  // ── Gender ─────────────────────────────────────────────────────────────────
  for (const line of lines) {
    const gm = line.match(PATTERNS.gender);
    if (gm) {
      fields.gender = normalizeGender(gm[1]);
      score += 0.15;
      break;
    }
  }

  // ── Name ───────────────────────────────────────────────────────────────────
  // Appears above the Aadhaar number line, or in the first few lines of the card
  const upperBound = aadharLineIdx > 0 ? aadharLineIdx : Math.min(lines.length, 6);
  for (let i = 0; i < upperBound; i++) {
    const line = lines[i];
    if (
      PATTERNS.aadhar.test(line) ||
      PATTERNS.dob.test(line) ||
      PATTERNS.gender.test(line) ||
      isNonNameLine(line) ||
      line.length < 3
    ) continue;

    const candidate = extractNameFromLine(line);
    if (candidate) {
      fields.name = candidate;
      score += 0.30;
      break;
    }
  }

  return { ...fields, score };
}

// All 36 Indian states/UTs
const INDIAN_STATES = [
  "Dadra and Nagar Haveli and Daman and Diu",
  "Andaman and Nicobar Islands",
  "Arunachal Pradesh",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Madhya Pradesh",
  "Andhra Pradesh",
  "Uttar Pradesh",
  "West Bengal",
  "Chhattisgarh",
  "Maharashtra",
  "Lakshadweep",
  "Uttarakhand",
  "Puducherry",
  "Chandigarh",
  "Meghalaya",
  "Jharkhand",
  "Karnataka",
  "Rajasthan",
  "Tamil Nadu",
  "Telangana",
  "Nagaland",
  "Manipur",
  "Mizoram",
  "Tripura",
  "Gujarat",
  "Haryana",
  "Kerala",
  "Punjab",
  "Sikkim",
  "Assam",
  "Bihar",
  "Delhi",
  "Odisha",
  "Ladakh",
  "Goa",
] as const;

/**
 * Decompose a raw address block into dedicated columns.
 * Pincode, state, and district (city) are extracted AND removed from the
 * address text so every value lives only in its own field.
 */
function decomposeAddress(raw: string, pincode: string | undefined): {
  address: string;
  city?: string;
  state?: string;
} {
  let address = raw;
  let city: string | undefined;
  let state: string | undefined;

  // 1. Remove the pincode (and spaced variant) from the text.
  if (pincode) {
    const spaced = `${pincode.slice(0, 3)} ${pincode.slice(3)}`;
    address = address
      .replace(new RegExp(`[-\\s,]*\\b${pincode}\\b`, "g"), "")
      .replace(new RegExp(`[-\\s,]*\\b${spaced}\\b`, "g"), "")
      .replace(new RegExp(`(?:PIN|PINCODE|PIN\\s*CODE)[:\\s-]*`, "gi"), "")
      .trim();
  }

  // 2. Lift the state name out.
  for (const name of INDIAN_STATES) {
    const re = new RegExp(`[,\\s]*\\b${name.replace(/ /g, "\\s+")}\\b`, "gi");
    const matches = [...address.matchAll(re)];
    if (matches.length > 0) {
      state = name;
      const last = matches[matches.length - 1];
      address =
        address.slice(0, last.index) +
        address.slice((last.index ?? 0) + last[0].length);
      break;
    }
  }

  // 3. Lift the district out when marked ("DIST: Gwalior" / "District Gwalior").
  const distMatch = address.match(
    /[,\s]*\b(?:DIST(?:RICT)?)[.:\s]+([A-Za-z][A-Za-z ]{1,30}?)(?=,|$)/i,
  );
  if (distMatch) {
    city = distMatch[1].trim();
    address = address.replace(distMatch[0], "");
  }

  // 4. Strip leading "Address:" / "पता:" label remnants if present.
  address = address
    .replace(/^.*?\b(?:Address|Addres|Addr|Residential|पता)\s*[:.,\/-]?\s*/i, "")
    .trim();

  // 5. Tidy leftover separators.
  address = address
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*,+/g, ", ")
    .replace(/[,\s-]+$/g, "")
    .replace(/^[,\s-]+/g, "")
    .trim();

  return { address, city, state };
}

/** 6-digit Indian PIN code, allowing optional space (e.g. 110001, 380 015, PIN: 110001). */
const PIN_RE = /(?:PIN|PINCODE|PIN\s*CODE)?[:\s-]*\b([1-9]\d{2}\s?\d{3})\b/i;

const ADDR_SHORT_ALLOW = new Set([
  "no", "st", "rd", "dr", "ln", "po", "ps", "sy", "op",
  "of", "at", "nr", "opp", "via", "new", "old", "gf", "ff", "sf",
  "a", "b", "c", "d", "e",
]);

const ROAD_WORDS = /^(road|rd|marg|street|st|nagar|chowk|highway|circle|cross|bridge|layout)\b/i;

/** Token-level junk scrubber for OCR'd address text. */
function cleanAddressText(raw: string): string {
  const prepared = raw
    .replace(/\bVID\s*[:.-]?\s*\d[\d\s]*/gi, " ")
    .replace(/\b\d{7,}\b/g, " ") // long digit runs — never house numbers
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/[\u0900-\u097F]+/g, " ") // strip inline Hindi characters
    .replace(/[^\w\s,./():#'-]/g, " ");

  const tokens = prepared.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((tok, i) => {
    const core = tok.replace(/[^A-Za-z0-9/'-]/g, "");
    if (!core) return false;
    // Relation markers
    if (/^[CSWDH]\/O$/i.test(core)) return true;
    // Pure numbers and alphanumerics
    if (/\d/.test(core)) return core.length <= 8;
    // Short tokens
    if (core.length <= 2) {
      if (ADDR_SHORT_ALLOW.has(core.toLowerCase())) return true;
      const next = tokens[i + 1] ?? "";
      if (/^[A-Z]{2}$/.test(core) && ROAD_WORDS.test(next)) return true;
      return false;
    }
    // 3+ letters: drop only if all consonants and not acronym
    if (!/[aeiouy]/i.test(core) && !/^[A-Z]{3,5}$/.test(core)) return false;
    return true;
  });

  return kept
    .join(" ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,\s-]+|[,\s-]+$/g, "")
    .trim();
}

/**
 * Dedicated Aadhaar BACK-face parser (address + pincode).
 * Supports bilingual two-column layouts, single-column vertical layouts,
 * and handles both labeled and loose address streams.
 */
function parseAadharBack(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Aadhar Card" };
  let score = 0;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Aadhaar number is printed on the back too
  const numMatch = text.match(PATTERNS.aadhar);
  if (numMatch) {
    fields.id_number = numMatch[0].replace(/\s+/g, " ").trim();
    score += 0.15;
  }

  // Locate Address label or relation marker
  let startIdx = lines.findIndex((l) =>
    /\b(?:Address|Addres|Addr|Residential)\b/i.test(l) ||
    /^(?:C\/O|S\/O|W\/O|D\/O|H\/O)\b/i.test(l),
  );

  if (startIdx < 0) {
    startIdx = lines.findIndex((l) => /पता\s*[:.]?/i.test(l));
  }

  const collected: string[] = [];

  if (startIdx >= 0) {
    let onLabel = lines[startIdx];
    while (/\b(?:Address|Addres|Addr|Residential|पता)\b/i.test(onLabel)) {
      onLabel = onLabel.replace(/^.*?\b(?:Address|Addres|Addr|Residential|पता)\s*[:.,\/-]?\s*/i, "");
    }
    onLabel = onLabel.replace(/[\u0900-\u097F]+/g, " ").replace(/\s+/g, " ").trim();
    if (onLabel.length >= 3) collected.push(onLabel);

    for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + 9); i++) {
      const line = lines[i];
      if (PATTERNS.aadhar.test(line)) break;
      if (/^(www\.|help@|1947|uidai|unique identification)/i.test(line)) break;

      // DO NOT SKIP LINES CONTAINING HINDI! Strip Hindi, keep English!
      const eng = line.replace(/[\u0900-\u097F]+/g, " ").replace(/\s+/g, " ").trim();
      if (eng.length < 3) continue;

      collected.push(eng);

      if (PIN_RE.test(eng) || /(?:PIN|PINCODE)[:\s-]*\d{6}/i.test(eng)) {
        break;
      }
    }
  } else {
    // Fallback: search for lines containing address markers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isNonNameLine(line) || PATTERNS.aadhar.test(line)) continue;
      const eng = line.replace(/[\u0900-\u097F]+/g, " ").replace(/\s+/g, " ").trim();
      if (eng.length < 4) continue;
      if (
        /\b(?:C\/O|S\/O|W\/O|D\/O|H\/O|House|Flat|Plot|Ward|Road|Street|Marg|Nagar|Colony|Enclave|Apartment|Society|Sector|Village|Dist|District|Near|Opp)\b/i.test(eng) ||
        PIN_RE.test(eng)
      ) {
        collected.push(eng);
      }
    }
  }

  if (collected.length === 0) return { ...fields, score };

  const rawJoined = collected.join(", ");
  const joined = cleanAddressText(rawJoined);

  // Search for PIN code in collected text or whole text
  let pincode: string | undefined;
  const pinMatch = rawJoined.match(PIN_RE) ?? text.match(PIN_RE);
  if (pinMatch) {
    pincode = pinMatch[1].replace(/\s+/g, "");
  }

  if (joined.length >= 8) {
    const parts = decomposeAddress(joined, pincode);
    if (parts.address.length >= 5) {
      fields.address = parts.address;
      if (pincode) fields.pincode = pincode;
      if (parts.city) fields.city = parts.city;
      if (parts.state) fields.state = parts.state;

      score += pincode ? 0.80 : 0.60;
    }
  }

  return { ...fields, score };
}

function parsePAN(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "PAN Card" };
  let score = 0;

  // PAN number: 5 letters, 4 digits, 1 letter. Handle OCR 'O'/'0', 'I'/'1'
  const panMatch = text.match(/\b([A-Z]{5})([0-9OIl]{4})([A-Z])\b/i);
  if (panMatch) {
    const letters = panMatch[1].toUpperCase();
    const midDigits = panMatch[2]
      .replace(/O/gi, "0")
      .replace(/[Il]/g, "1");
    const lastLetter = panMatch[3].toUpperCase();
    fields.id_number = `${letters}${midDigits}${lastLetter}`;
    score += 0.35;
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Name on PAN
  for (const line of lines) {
    if (isNonNameLine(line)) continue;
    if (/INCOME|TAX|DEPARTMENT|INDIA|FATHER|पिता|GOVT|PERMANENT|ACCOUNT/i.test(line)) continue;
    const candidate = extractNameFromLine(line);
    if (candidate) {
      fields.name = candidate;
      score += 0.35;
      break;
    }
  }

  const dobMatch = text.match(PATTERNS.dob) ?? text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) {
      fields.date_of_birth = normalized;
      score += 0.25;
    }
  }

  return { ...fields, score };
}

function parsePassport(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Passport" };
  let score = 0;

  // Passport number: 1 letter + 7 digits
  const ppMatch = text.match(/\b([A-PR-WY-Z][0-9OIl]{7})\b/i);
  if (ppMatch) {
    const corrected = ppMatch[1].charAt(0).toUpperCase() +
      ppMatch[1].slice(1).replace(/O/gi, "0").replace(/[Il]/g, "1");
    fields.id_number = corrected;
    score += 0.35;
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const mrzLine = lines.find((l) => l.includes("<<") && l.length > 25);
  if (mrzLine) {
    const parts = mrzLine.replace(/^[PA-Z0-9<]*<IND/i, "").split("<<");
    if (parts.length >= 2) {
      const surname = parts[0].replace(/<+/g, " ").trim();
      const given = parts[1].replace(/<+/g, " ").trim();
      if (surname && given) {
        fields.name = toTitleCase(`${given} ${surname}`.trim());
        score += 0.30;
      }
    }
  }

  // Fallback name from visual inspection zone
  if (!fields.name) {
    let givenName = "";
    let surname = "";
    for (const line of lines) {
      if (/Given Name/i.test(line)) {
        const val = line.replace(/^.*?Given Name(?:s)?[:\s]*/i, "").trim();
        if (val) givenName = val;
      }
      if (/Surname/i.test(line)) {
        const val = line.replace(/^.*?Surname[:\s]*/i, "").trim();
        if (val) surname = val;
      }
    }
    if (givenName || surname) {
      fields.name = toTitleCase(`${givenName} ${surname}`.trim());
      score += 0.30;
    }
  }

  const dobMatch = text.match(PATTERNS.dob) || text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) {
      fields.date_of_birth = normalized;
      score += 0.20;
    }
  }

  const genderMatch = text.match(PATTERNS.gender);
  if (genderMatch) {
    fields.gender = normalizeGender(genderMatch[1]);
    score += 0.15;
  }

  return { ...fields, score };
}

function parseVoterID(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Voter ID" };
  let score = 0;

  // EPIC number: 3 letters + 7 digits (with OCR digit correction)
  const voterMatch = text.match(/\b([A-Z]{3})[-/]?([0-9OIl]{7})\b/i);
  if (voterMatch) {
    const letters = voterMatch[1].toUpperCase();
    const digits = voterMatch[2].replace(/O/gi, "0").replace(/[Il]/g, "1");
    fields.id_number = `${letters}${digits}`;
    score += 0.35;
  }

  const dobMatch = text.match(PATTERNS.dob) ?? text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) {
      fields.date_of_birth = normalized;
      score += 0.20;
    }
  }

  const genderMatch = text.match(PATTERNS.gender);
  if (genderMatch) {
    fields.gender = normalizeGender(genderMatch[1]);
    score += 0.15;
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (isNonNameLine(line)) continue;
    if (/\b(S\/O|D\/O|W\/O|H\/O|Father|Mother|Husband|पिता|पति|माता)\b/i.test(line)) continue;
    const candidate = extractNameFromLine(line);
    if (candidate) {
      fields.name = candidate;
      score += 0.30;
      break;
    }
  }

  const addrLineIdx = lines.findIndex((l) => /^(Address|Residential|पता)/i.test(l));
  if (addrLineIdx >= 0) {
    const addrLines = lines
      .slice(addrLineIdx, addrLineIdx + 4)
      .map((l) => l.replace(/^(Address|Residential|पता)[:\s]*/i, "").replace(/[\u0900-\u097F]+/g, " ").trim())
      .filter((l) => l.length > 3);
    const cleaned = cleanAddressText(addrLines.join(", "));
    if (cleaned.length >= 8) {
      fields.address = cleaned;
      score += 0.15;
    }
  }

  return { ...fields, score };
}

function parseDrivingLicence(text: string): Partial<ParsedIdFields> & { score: number } {
  const fields: Partial<ParsedIdFields> = { id_type_detected: "Driving License" };
  let score = 0;

  const dlMatch = text.match(PATTERNS.dl) || text.match(/[A-Z]{2}\d{2}\s?\d{2,}/);
  if (dlMatch) {
    fields.id_number = dlMatch[0].replace(/\s+/g, " ").trim();
    score += 0.35;
  }

  const dobMatch = text.match(PATTERNS.dob) || text.match(PATTERNS.date);
  if (dobMatch) {
    const normalized = normalizeDate(dobMatch[1] ?? dobMatch[0]);
    if (normalized) {
      fields.date_of_birth = normalized;
      score += 0.20;
    }
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (isNonNameLine(line) || line.match(/\d{4}/)) continue;
    const candidate = extractNameFromLine(line);
    if (candidate) {
      fields.name = candidate;
      score += 0.30;
      break;
    }
  }

  const genderMatch = text.match(PATTERNS.gender);
  if (genderMatch) {
    fields.gender = normalizeGender(genderMatch[1]);
    score += 0.15;
  }

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
 * Intelligent image preprocessor for ID documents:
 * 1. Rescales to optimal OCR range (1200–2000px).
 * 2. Grayscale luminance conversion.
 * 3. Dynamic contrast normalization (2nd to 98th percentile histogram stretching).
 * 4. Preserves 8-bit anti-aliased font strokes (never destructive 1-bit thresholding).
 */
async function preprocessForOcr(imageFile: File): Promise<Blob | File> {
  try {
    const bitmap = await createImageBitmap(imageFile);
    const origW = bitmap.width;
    const origH = bitmap.height;
    if (origW < 10 || origH < 10) {
      bitmap.close();
      return imageFile;
    }

    const maxDim = Math.max(origW, origH);
    const minDim = Math.min(origW, origH);

    let targetW = origW;
    let targetH = origH;

    if (maxDim > 2200) {
      const scale = 2000 / maxDim;
      targetW = Math.round(origW * scale);
      targetH = Math.round(origH * scale);
    } else if (minDim < 1000) {
      const scale = Math.min(1200 / minDim, 2.5);
      targetW = Math.round(origW * scale);
      targetH = Math.round(origH * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bitmap.close();
      return imageFile;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const img = ctx.getImageData(0, 0, targetW, targetH);
    const px = img.data;
    const totalPixels = px.length / 4;

    const hist = new Int32Array(256);
    const grays = new Uint8Array(totalPixels);

    for (let i = 0, g = 0; i < px.length; i += 4, g++) {
      const gray = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      grays[g] = gray;
      hist[gray]++;
    }

    // Percentile contrast stretching (2% to 98%)
    const p2Target = Math.round(totalPixels * 0.02);
    const p98Target = Math.round(totalPixels * 0.98);

    let accum = 0;
    let pLow = 0;
    let pHigh = 255;

    for (let t = 0; t < 256; t++) {
      accum += hist[t];
      if (pLow === 0 && accum >= p2Target) pLow = t;
      if (accum >= p98Target) {
        pHigh = t;
        break;
      }
    }

    const range = pHigh - pLow;
    if (range > 20) {
      const mult = 255 / range;
      for (let i = 0, g = 0; i < px.length; i += 4, g++) {
        let val = Math.round((grays[g] - pLow) * mult);
        if (val < 0) val = 0;
        else if (val > 255) val = 255;
        px[i] = val;
        px[i + 1] = val;
        px[i + 2] = val;
      }
      ctx.putImageData(img, 0, 0);
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    return blob ?? imageFile;
  } catch {
    return imageFile;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type DocumentSide = "front" | "back";

/**
 * Run OCR on an ID document image and return parsed fields + confidence.
 *
 * @param imageFile  The image File object (PNG / JPEG / WebP).
 * @param idType     Expected ID type (from the form dropdown). Used as a hint.
 * @param side       Which face was uploaded ("front" or "back").
 */
export async function parseIdDocument(
  imageFile: File,
  idType: string,
  side: DocumentSide = "front",
): Promise<IdOcrResult> {
  try {
    const { createWorker } = await import("tesseract.js");

    const worker = await createWorker("eng", 1, {
      logger: () => undefined,
    });

    try {
      await worker.setParameters({
        preserve_interword_spaces: "1",
      });
    } catch {
      // Ignore if parameter setup is not supported
    }

    const isAadhaarBack = side === "back" && (!idType || idType === "Aadhar Card");
    const preprocessed = await preprocessForOcr(imageFile);

    let rawText = "";
    let tesseractConfidence = 0;
    let parsed: Partial<ParsedIdFields> & { score: number } = { score: 0 };

    if (isAadhaarBack) {
      // Multi-pass for Back face: Try preprocessed first, original fallback
      const passes: (Blob | File)[] = [preprocessed, imageFile];
      let bestResult: {
        parsed: Partial<ParsedIdFields> & { score: number };
        text: string;
        conf: number;
      } | null = null;

      for (const input of passes) {
        const { data } = await worker.recognize(input);
        const text = data.text ?? "";
        const conf = (data.confidence ?? 0) / 100;
        const attempt = parseAadharBack(text);

        if (!bestResult || attempt.score > bestResult.parsed.score) {
          bestResult = { parsed: attempt, text, conf };
        }
        if (attempt.address && attempt.pincode && attempt.score >= 0.7) {
          break;
        }
      }

      parsed = bestResult?.parsed ?? { score: 0 };
      rawText = bestResult?.text ?? "";
      tesseractConfidence = bestResult?.conf ?? 0;
    } else {
      // Front face: Try preprocessed first
      const { data: data1 } = await worker.recognize(preprocessed);
      rawText = data1.text ?? "";
      tesseractConfidence = (data1.confidence ?? 0) / 100;
      parsed = detectAndParse(rawText);

      if (idType && idType !== "Aadhar Card") {
        if (idType === "PAN Card") parsed = parsePAN(rawText);
        else if (idType === "Passport") parsed = parsePassport(rawText);
        else if (idType === "Driving License") parsed = parseDrivingLicence(rawText);
        else if (idType === "Voter ID") parsed = parseVoterID(rawText);
      }

      // If key fields are missing, try raw original image as fallback
      if ((!parsed.name || !parsed.id_number) && preprocessed !== imageFile) {
        const { data: data2 } = await worker.recognize(imageFile);
        const rawText2 = data2.text ?? "";
        let attempt2 = detectAndParse(rawText2);
        if (idType && idType !== "Aadhar Card") {
          if (idType === "PAN Card") attempt2 = parsePAN(rawText2);
          else if (idType === "Passport") attempt2 = parsePassport(rawText2);
          else if (idType === "Driving License") attempt2 = parseDrivingLicence(rawText2);
          else if (idType === "Voter ID") attempt2 = parseVoterID(rawText2);
        }

        if (attempt2.score > parsed.score) {
          parsed = attempt2;
          rawText = rawText2;
          tesseractConfidence = (data2.confidence ?? 0) / 100;
        }
      }
    }

    await worker.terminate();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { score: _score, ...finalFields } = parsed;

    const hasName = !!finalFields.name;
    const hasId = !!finalFields.id_number;
    const hasDob = !!finalFields.date_of_birth;
    const hasAddr = !!finalFields.address;

    const fieldScore = parsed.score;
    const blendedConfidence = Math.min(
      1,
      (fieldScore * 0.75) + (tesseractConfidence * 0.25),
    );

    // Can autofill if:
    // 1. Both Name and ID Number are detected (front face gold standard)
    // 2. ID Number AND DOB detected
    // 3. Name AND DOB detected
    // 4. Back face: Address detected
    // 5. Blended confidence >= 0.45
    const canAutofill =
      (hasName && hasId) ||
      (hasId && hasDob) ||
      (hasName && hasDob) ||
      (side === "back" && hasAddr) ||
      fieldScore >= 0.45 ||
      blendedConfidence >= 0.45;

    const finalConfidence = canAutofill
      ? Math.max(blendedConfidence, 0.70)
      : blendedConfidence;

    if (canAutofill) {
      const detected = finalFields.id_type_detected ?? idType;
      return {
        fields: finalFields,
        confidence: finalConfidence,
        message: `${detected} details detected (${Math.round(finalConfidence * 100)}% confidence)`,
        can_autofill: true,
      };
    }

    if (side === "back" && !finalFields.address) {
      return {
        fields: finalFields,
        confidence: finalConfidence,
        message:
          "Couldn't read the address clearly from the back face — please enter it manually.",
        can_autofill: false,
      };
    }

    return {
      fields: finalFields,
      confidence: finalConfidence,
      message:
        finalConfidence > 0.20
          ? "Some details detected but confidence is low. Please verify and fill in manually."
          : "Unable to read ID details. Please ensure the card is well-lit, fully in frame, and not blurry.",
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

/**
 * Merges front and back OCR results into a single unified result.
 * Front face provides name, id_number, date_of_birth, gender, id_type.
 * Back face provides address, pincode, city, state.
 */
export function mergeOcrResults(
  front: IdOcrResult | null | undefined,
  back: IdOcrResult | null | undefined,
): IdOcrResult | null {
  if (!front && !back) return null;
  if (!front) return back ?? null;
  if (!back) return front ?? null;

  const mergedFields: ParsedIdFields = {
    ...front.fields,
    ...back.fields,
    name: front.fields.name || back.fields.name,
    id_number: front.fields.id_number || back.fields.id_number,
    date_of_birth: front.fields.date_of_birth || back.fields.date_of_birth,
    gender: front.fields.gender || back.fields.gender,
    id_type_detected: front.fields.id_type_detected || back.fields.id_type_detected,
    address: back.fields.address || front.fields.address,
    pincode: back.fields.pincode || front.fields.pincode,
    city: back.fields.city || front.fields.city,
    state: back.fields.state || front.fields.state,
  };

  const confidence = Math.max(front.confidence, back.confidence);
  const canAutofill = front.can_autofill || back.can_autofill;
  const detected = mergedFields.id_type_detected ?? "ID Document";

  return {
    fields: mergedFields,
    confidence,
    message: `${detected} details detected (${Math.round(confidence * 100)}% confidence)`,
    can_autofill: canAutofill,
  };
}
