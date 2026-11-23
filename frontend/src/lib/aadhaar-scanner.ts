/**
 * Aadhaar Card Scanner — Deep Scan Engine (TypeScript Port of main documents/aadhaar/aadhaar.js)
 * -------------------------------------------------------------------------------------------------
 * 100% in-browser processing via Tesseract.js and HTML5 Canvas.
 * Exact algorithm from the manager's verified implementation:
 *   1. Quality check       : warns if photo is small / blurry (Laplacian variance).
 *   2. Auto-rotate         : tries 0/90/180/270 degrees, keeps orientation with most Aadhaar keywords.
 *   3. Multi-pass OCR      : toGray (1%-99% contrast stretch), adaptive local-mean binarize,
 *                            targeted single-line crops above DOB for Name (psm: 7, NAME_CHARS whitelist),
 *                            targeted bottom-half crops for Aadhaar Number (psm: 6/11, digits whitelist).
 *   4. Targeted Address    : crops left 64% from "Address:" line down (excluding QR noise).
 *   5. Voting & Checks     : multi-pass majority vote, Verhoeff checksum & single-digit repair via CONFUSE matrix.
 *   6. Silent QR Decode    : browser DecompressionStream('gzip') / XML parsing with byte 255 splitting.
 */

import type { IdOcrResult, ParsedIdFields } from "@/lib/id-ocr";

// ─── 0. CONFIGURATION ────────────────────────────────────────────────────────
const CFG = {
  MAX_MB: 10,
  MIN_BYTES: 15000,
  TYPES: ["image/jpeg", "image/png", "image/webp"],
  LANG: "eng",
  DEEP: true,
  FULL_SIDE: 2400,
};

// ─── 1. VERHOEFF CHECKSUM & NUMBER REPAIR ────────────────────────────────────
const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export const verhoeffValid = (n: string | number): boolean => {
  let c = 0;
  [...String(n)].reverse().forEach((d, i) => {
    c = VD[c][VP[i % 8][+d]];
  });
  return c === 0;
};

export const validAadhaar = (n: string | number): boolean =>
  /^[2-9]\d{11}$/.test(String(n)) && verhoeffValid(n);

const lev = (a: string, b: string): number => {
  const m = [...Array(a.length + 1)].map((_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return m[a.length][b.length];
};

const title = (s: string): string =>
  String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const digits = (s: string | undefined | null): string => String(s || "").replace(/\D/g, "");
const mask = (v: string | undefined | null): string => "XXXX XXXX " + digits(v).slice(-4);
const fmt12 = (v: string): string => String(v).replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
const pad2 = (n: number): string => String(n).padStart(2, "0");

// Digit fix mapping for letter-digit confusions
const DIGFIX: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", "|": "1", i: "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  B: "8",
  g: "9", q: "9",
};
const fixDigits = (s: string): string =>
  String(s).replace(/[OoQDIl|iZzSsBgq]/g, (c) => DIGFIX[c] || c);

// Digits that OCR commonly confuses with each other
const CONFUSE: Record<number, number[]> = {
  0: [8, 6, 9],
  1: [7, 4],
  2: [7, 3],
  3: [8, 5, 9],
  4: [9, 1],
  5: [6, 3, 8],
  6: [5, 8, 0],
  7: [1, 2],
  8: [0, 3, 6, 9, 5],
  9: [4, 8, 3, 0],
};

interface Candidate {
  v: string;
  c?: number;
  row?: boolean;
  rank?: number;
  n?: number;
  cs?: number;
  flag?: string;
  soft?: boolean;
}

interface VoteResult extends Candidate {
  k: string;
  n: number;
  cs: number;
}

function vote(
  cands: (Candidate | undefined | null)[],
  keyFn?: (x: Candidate) => string,
): VoteResult | null {
  const key = keyFn || ((x: Candidate) => String(x.v).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const g = new Map<string, VoteResult & { hist: Map<string, number> }>();
  for (const x of cands) {
    if (!x || !x.v) continue;
    const k = key(x);
    let e = g.get(k);
    if (!e) {
      e = { ...x, k, n: 0, cs: 0, hist: new Map<string, number>() };
      g.set(k, e);
    }
    e.n++;
    e.cs += x.c || 0;
    e.hist.set(x.v, (e.hist.get(x.v) || 0) + 1);
  }
  const arr = [...g.values()].sort((a, b) => b.n - a.n || b.cs - a.cs);
  if (!arr.length) return null;
  const top = arr[0];
  for (const e of arr.slice(1)) {
    if (e.k.length >= 6 && lev(top.k, e.k) <= 1) {
      top.n += e.n;
      top.cs += e.cs;
    }
  }
  top.v = [...top.hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
  top.c = Math.round(top.cs / Math.max(1, top.n));
  return top;
}

// ─── 2. INDIAN STATES & PIN DICTIONARY ───────────────────────────────────────
const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands",
  "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const ALIAS: Record<string, string> = {
  orissa: "Odisha",
  pondicherry: "Puducherry",
  uttaranchal: "Uttarakhand",
  "daman and diu": STATES[30],
  "dadra and nagar haveli": STATES[30],
  "nct of delhi": "Delhi",
  "new delhi": "Delhi",
};

const PIN2: [number, number, string[]][] = [
  [11, 11, ["Delhi"]],
  [12, 13, ["Haryana"]],
  [14, 15, ["Punjab"]],
  [16, 16, ["Punjab", "Chandigarh", "Haryana"]],
  [17, 17, ["Himachal Pradesh"]],
  [18, 19, ["Jammu and Kashmir", "Ladakh"]],
  [20, 28, ["Uttar Pradesh", "Uttarakhand"]],
  [30, 34, ["Rajasthan"]],
  [36, 39, ["Gujarat", STATES[30]]],
  [40, 44, ["Maharashtra", "Goa"]],
  [45, 48, ["Madhya Pradesh"]],
  [49, 49, ["Chhattisgarh"]],
  [50, 53, ["Telangana", "Andhra Pradesh"]],
  [56, 59, ["Karnataka"]],
  [60, 64, ["Tamil Nadu", "Puducherry"]],
  [67, 69, ["Kerala", "Lakshadweep", "Puducherry"]],
  [70, 74, ["West Bengal", "Sikkim", "Andaman and Nicobar Islands"]],
  [75, 77, ["Odisha"]],
  [78, 78, ["Assam"]],
  [80, 85, ["Bihar", "Jharkhand"]],
];

export const statesForPin = (pin: string | number): string[] | null => {
  const p = +String(pin).slice(0, 2);
  const r = PIN2.find(([a, b]) => p >= a && p <= b);
  return r ? r[2] : null;
};

export function findState(t: string | undefined | null): string | null {
  const b = " " + String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z]+/g, " ").trim() + " ";
  let best: { s: string; end: number; len: number } | null = null;
  for (const [n, s] of [
    ...STATES.map((x) => [x.toLowerCase(), x] as [string, string]),
    ...Object.entries(ALIAS),
  ]) {
    let i = b.lastIndexOf(" " + n + " ");
    if (i < 0 && n.length > 7) {
      for (
        let k = Math.max(0, b.length - n.length * 2 - 40);
        k + n.length <= b.length + 1 && i < 0;
        k++
      ) {
        for (const w of [n.length - 1, n.length, n.length + 1]) {
          if (lev(b.substring(k, k + w).trim(), n) <= Math.max(1, n.length >> 3)) {
            i = k;
            break;
          }
        }
      }
    }
    if (
      i >= 0 &&
      (!best || i + n.length > best.end || (i + n.length === best.end && n.length > best.len))
    ) {
      best = { s, end: i + n.length, len: n.length };
    }
  }
  return best ? best.s : null;
}

// ─── 3. AADHAAR NUMBER EXTRACTION & REPAIR ──────────────────────────────────
function repairAadhaar(s: string, hint4?: string | null): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const digit = +s[i];
    const alternates = CONFUSE[digit] || [];
    for (const alt of alternates) {
      const t = s.slice(0, i) + alt + s.slice(i + 1);
      if (validAadhaar(t) && (!hint4 || t.endsWith(hint4))) out.push(t);
    }
  }
  return [...new Set(out)];
}

interface LineWord {
  t: string;
  c: number;
}

interface LineBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OcrLine {
  t: string;
  c?: number;
  b?: LineBBox;
  raw?: string;
  w?: LineWord[];
}

function numCands(lines: OcrLine[]): { v: string; c: number }[] {
  const out: { v: string; c: number }[] = [];
  const C = "[0-9OoIl|SBZ]";
  const re = new RegExp("(" + C + "{4})[ -]?(" + C + "{4})[ -]?(" + C + "{4})", "g");
  for (const l of lines) {
    const t = l.t;
    if (/vid|mobile|phone|mob\b|enrol/i.test(t)) continue;
    for (const m of t.matchAll(re)) {
      const idx = m.index ?? 0;
      const before = t.slice(0, idx);
      const after = t.slice(idx + m[0].length);
      if (/\d[ -]?$/.test(before) || /^[ -]?\d/.test(after)) continue;
      const raw = m[1] + m[2] + m[3];
      if ((raw.match(/\d/g) || []).length < 8) continue;
      out.push({ v: fixDigits(raw), c: Math.round(l.c || 0) });
    }
  }
  return out;
}

interface PickedNumber {
  v: string;
  c: number;
  full: boolean;
  votes?: number;
  flag?: string;
}

function pickAadhaarNumber(
  cands: { v: string; c: number }[],
  text: string,
  hint4?: string | null,
): PickedNumber | null {
  const groups = new Map<string, { v: string; n: number; c: number }>();
  for (const x of cands) {
    if (!/^\d{12}$/.test(x.v)) continue;
    const g = groups.get(x.v) || { v: x.v, n: 0, c: 0 };
    g.n++;
    g.c = Math.max(g.c, x.c || 0);
    groups.set(x.v, g);
  }
  const score = (g: { v: string; n: number; c: number }) =>
    (validAadhaar(g.v) ? 10000 : 0) +
    (hint4 && g.v.endsWith(hint4) ? 5000 : 0) +
    g.n * 100 +
    g.c;
  const list = [...groups.values()].sort((a, b) => score(b) - score(a));
  const top = list[0];
  if (top && validAadhaar(top.v)) return { v: top.v, c: top.c, full: true, votes: top.n };

  // Mixes across candidate reads
  const mixes = new Set<string>();
  const reads = list.slice(0, 6).map((g) => g.v);
  for (let i = 0; i < reads.length; i++) {
    for (let j = i + 1; j < reads.length; j++) {
      const pos = [...Array(12).keys()].filter((k) => reads[i][k] !== reads[j][k]);
      if (!pos.length || pos.length > 3) continue;
      for (let mk = 0; mk < 1 << pos.length; mk++) {
        const t = [...reads[i]];
        pos.forEach((k, b) => {
          if ((mk >> b) & 1) t[k] = reads[j][k];
        });
        const v = t.join("");
        if (validAadhaar(v) && (!hint4 || v.endsWith(hint4))) mixes.add(v);
      }
    }
  }
  if (mixes.size === 1) {
    const v = [...mixes][0];
    return {
      v,
      c: 70,
      full: true,
      votes: 2,
      flag: "Number rebuilt from OCR passes and confirmed by Aadhaar checksum.",
    };
  }
  for (const g of list) {
    const fx = repairAadhaar(g.v, hint4);
    if (fx.length === 1) {
      return {
        v: fx[0],
        c: Math.min(g.c, 60),
        full: true,
        votes: g.n,
        flag: "One digit corrected using the Aadhaar checksum.",
      };
    }
  }
  if (top) {
    return {
      v: top.v,
      c: top.c,
      full: true,
      votes: top.n,
      flag: "Number fails the Aadhaar checksum. Please verify.",
    };
  }
  const m = String(text || "").match(/[Xx*•]{4}[ -]?[Xx*•]{4}[ -]?(\d{4})/);
  return m ? { v: "XXXX XXXX " + m[1], c: 80, full: false } : null;
}

// ─── 4. FRONT SIDE PARSERS (DOB, GENDER, NAME) ──────────────────────────────
const DD = "[0-9OoIlSBZ]";
const DATE_STRICT = new RegExp(
  "(" + DD + "{2})\\s*[\\/\\-.]\\s*(" + DD + "{2})\\s*[\\/\\-.]\\s*(" + DD + "{4})",
);
const DATE_LOOSE = new RegExp(
  "(" + DD + "{2})\\s*[\\/\\-.\\s]\\s*(" + DD + "{2})\\s*[\\/\\-.\\s]\\s*(" + DD + "{4})",
);
const DOB_LABEL = /D\s*[O0]\s*B\b|Date\s*of\s*Birth/i;
const NOT_DOB_DATE = /download|issued|generated|printed|enrol|\bvid\b/i;
const rawOf = (l: OcrLine): string => l.raw || l.t || "";
const wordConf = (l: OcrLine, re: RegExp): number => {
  const w = (l.w || []).filter((x) => re.test(x.t));
  return Math.round(w.length ? w.reduce((a, x) => a + x.c, 0) / w.length : l.c || 0);
};

function toDate(a: string, b: string, c: string): string | null {
  const d = +fixDigits(a);
  const m = +fixDigits(b);
  const y = +fixDigits(c);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d &&
    y >= 1900 &&
    dt <= new Date()
    ? `${pad2(d)}/${pad2(m)}/${y}`
    : null;
}

function parseDOB(L: OcrLine[], conf: number): Candidate | null {
  const find = (l: OcrLine, loose: boolean): Candidate | null => {
    const m = rawOf(l).match(loose ? DATE_LOOSE : DATE_STRICT);
    const v = m && toDate(m[1], m[2], m[3]);
    return v ? { v, c: wordConf(l, /\d/) || conf } : null;
  };
  for (let i = 0; i < L.length; i++) {
    if (DOB_LABEL.test(rawOf(L[i]))) {
      for (const l of [L[i], L[i + 1]]) {
        const r = l && find(l, true);
        if (r) return r;
      }
    }
  }
  for (const l of L) {
    if (NOT_DOB_DATE.test(rawOf(l))) continue;
    const r = find(l, false);
    if (r) return { ...r, flag: 'Date found without its "DOB" label.', soft: true };
  }
  const text = L.map(rawOf).join("\n");
  const ym = text.match(/(?:Year\s*of\s*Birth|YOB)\s*[:\-]?\s*([0-9OoIl]{4})/i);
  if (ym) {
    const y = +fixDigits(ym[1]);
    if (y >= 1900 && y <= new Date().getFullYear()) {
      return {
        v: String(y),
        c: conf,
        flag: "Only birth year is printed on this card.",
        soft: true,
      };
    }
  }
  return null;
}

function parseGender(L: OcrLine[], conf: number): Candidate | null {
  const text = L.map(rawOf).join("\n");
  const m = text.match(/\b(FEMALE|MALE|TRANSGENDER)\b/i);
  if (m) {
    const l = L.find((x) => new RegExp("\\b" + m[1] + "\\b", "i").test(rawOf(x)));
    return { v: title(m[1]), c: l ? wordConf(l, new RegExp(m[1], "i")) : conf };
  }
  const di = L.findIndex(
    (l) => DATE_STRICT.test(rawOf(l)) || /D\s*[O0]\s*B\s*[:;]/i.test(rawOf(l)),
  );
  for (const l of L.slice(Math.max(0, di - 1), di + 3)) {
    for (const w of rawOf(l).split(/[^A-Za-z]+/)) {
      if (w.length === 4 && lev(w.toLowerCase(), "male") <= 1 && /^m/i.test(w)) {
        return { v: "Male", c: 50, flag: "Gender was unclear, please verify." };
      }
      if (w.length >= 5 && w.length <= 7 && lev(w.toLowerCase(), "female") <= 1 && /^f/i.test(w)) {
        return { v: "Female", c: 50, flag: "Gender was unclear, please verify." };
      }
    }
  }
  return null;
}

const NOT_NAME =
  /\b(government|india|male|female|transgender|birth|dob|aadhaar|aadhar|unique|identification|authority|help|vid|download|issue|issued|mobile|date|address|enrolment|enrollment|year|uidai|virtual|id|proof|identity|citizenship|should|used|verification|authentication|scanning|code|offline|xml|online|not|of|or|is|it)\b/i;
export const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .'-";

function cleanName(raw: string): string {
  const t = String(raw)
    .replace(/[^A-Za-z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const w = t.split(" ");
  if (t.length < 4 || t.length > 45 || w.length > 5 || NOT_NAME.test(t)) return "";
  if (
    !w.every((x) => /^[A-Za-z][A-Za-z.'-]*$/.test(x)) ||
    !w.some((x) => x.replace(/[^A-Za-z]/g, "").length >= 3)
  )
    return "";
  if (t.replace(/ /g, "").length / String(raw).replace(/\s/g, "").length < 0.8) return "";
  return title(t);
}

function nameScore(v: string, c?: number): number {
  const w = String(v).split(" ").filter(Boolean);
  const letters = String(v).replace(/[^A-Za-z]/g, "").length;
  if (!w.length || w.length > 5 || letters < 4) return 0;
  let s = 1;
  for (const x of w) {
    const L = x.replace(/[^A-Za-z]/g, "");
    if (L.length >= 3) {
      const vr = (L.match(/[aeiouy]/gi) || []).length / L.length;
      if (vr < 0.2 || vr > 0.7) s -= 0.35;
      if (/(.)\1\1/i.test(L)) s -= 0.35;
    } else if (L.length === 1) {
      s -= 0.1;
    } else if (!/[aeiouy]/i.test(L) && !/^(Md|Ch|Sk|Mr|Dr)$/i.test(L)) {
      s -= 0.15;
    }
  }
  if (w.length === 1) s -= 0.1;
  return Math.max(0, s) * (0.4 + 0.6 * Math.min(1, (c || 0) / 70));
}

function parseName(L: OcrLine[], conf: number): Candidate | null {
  let di = L.findIndex((l) => DATE_STRICT.test(rawOf(l)) && !NOT_DOB_DATE.test(rawOf(l)));
  if (di < 0) di = L.findIndex((l) => /D\s*[O0]\s*B\s*[:;]/i.test(rawOf(l)));
  if (di < 1) return null;
  const cand: Candidate[] = [];
  L.forEach((l, i) => {
    if (i < di && di - i <= 3) {
      const v = cleanName(l.t);
      if (v) cand.push({ v, c: Math.round(l.c || conf) });
    }
  });
  return cand.pop() || null;
}

function nameRowsAbove(lines: OcrLine[]): OcrLine[] {
  const a =
    lines
      .filter((l) => l.b && DATE_STRICT.test(rawOf(l)) && !NOT_DOB_DATE.test(rawOf(l)))
      .sort((x, y) => (x.b?.y0 ?? 0) - (y.b?.y0 ?? 0))[0] ||
    lines.find((l) => l.b && /D\s*[O0]\s*B\s*[:;]/i.test(rawOf(l)));
  if (!a || !a.b) return [];
  const lh = Math.max(12, a.b.y1 - a.b.y0);
  const ab = a.b;
  return lines
    .filter(
      (l) =>
        l.b &&
        l !== a &&
        l.b.y1 <= ab.y0 + lh * 0.35 &&
        l.b.y0 >= ab.y0 - lh * 5 &&
        l.b.x0 >= ab.x0 - lh * 8 &&
        l.b.x1 - l.b.x0 >= lh * 2.5 &&
        l.b.y1 - l.b.y0 <= lh * 2.6,
    )
    .sort((x, y) => (y.b?.y1 ?? 0) - (x.b?.y1 ?? 0))
    .slice(0, 2);
}

// ─── 5. BACK SIDE PARSERS (ADDRESS, PIN, STATE, CITY) ────────────────────────
const KEYW =
  /^(S\/O|D\/O|W\/O|C\/O|PO|P\.O\.?|DIST|DISTRICT|VTC|PIN|CODE|STATE|SUB|B\/H|NR|OPP|NO|RD|ST|TA|TAL|AT|DT)[:.]?$/i;
const plaus = (t: string): boolean =>
  KEYW.test(t) ||
  /^[A-Z][a-z]{2,}[.:]?$/.test(t) ||
  /^[A-Z]{3,}[.:]?$/.test(t) ||
  /^[A-Z]\.?$/.test(t) ||
  /^\(?[A-Za-z]{0,3}[-\/]?\d+[A-Za-z]?([\/-][A-Za-z0-9]{1,4})*\)?$/.test(t) ||
  /^[A-Z][a-z]+-[A-Z][a-z]+$/.test(t);
const plausLoose = (t: string): boolean =>
  KEYW.test(t) ||
  (/^[A-Za-z]$/.test(t) && t === t.toUpperCase()) ||
  (/\d/.test(t) && /^[\w\/.:()-]+$/.test(t)) ||
  (/^[A-Za-z][A-Za-z.'-]+[.:]?$/.test(t) && /[aeiouy]/i.test(t) && !/(.)\1\1/i.test(t));

function cleanSeg(s: string, loose: boolean): string {
  const t = s
    .split(/\s+/)
    .map((x) =>
      x
        .replace(
          /^([SDWC$5])[\/\\|]([O0Q])(:?)$/i,
          (_m, a, _b, c) => ({ $: "S", 5: "S" }[a as "$" | "5"] || a.toUpperCase()) + "/O" + c,
        )
        .replace(/^[^\w(]+|[^\w.):]+$/g, ""),
    )
    .filter(Boolean);
  const ok = t.filter(loose ? plausLoose : plaus);
  if (!ok.length || ok.length / t.length < 0.5 || !ok.some((x) => /[A-Za-z]{2,}|\d/.test(x)))
    return "";
  const r = ok.join(" ");
  return loose && r === r.toLowerCase() ? title(r) : r;
}

interface ParsedBackResult {
  d: {
    address?: Candidate;
    pincode?: Candidate;
    state?: Candidate;
    city?: Candidate;
  };
  sc: number;
}

function parseBack(res: { lines: OcrLine[]; conf: number }): ParsedBackResult {
  const L = res.lines.filter((l) => l.t);
  const text = L.map((l) => l.t).join("\n");
  const d: ParsedBackResult["d"] = {};
  const conf = res.conf;
  const loose = /Address|Addr|Addres|Adres|C\/O|S\/O|W\/O|D\/O|\b[1-9]\d{5}\b/i.test(text);

  // Match Address block starting from Address / Addr / पता OR starting directly from C/O / S/O / W/O / D/O
  let b = "";
  const addrMatch = text.match(/(?:Address|Addres|Addrs|Adres|Addr|पता)\s*[:\-\/]?\s*([\s\S]*)/i);
  if (addrMatch && addrMatch[1]) {
    b = addrMatch[1];
  } else {
    const coMatch = text.match(/(?:[CSDW]\/O|Care of|Son of|Wife of|Daughter of)\b[\s\S]*/i);
    if (coMatch) {
      b = coMatch[0];
    } else {
      b = text;
    }
  }

  // Strip UIDAI help/website footers and numbers
  b = b.split(/help@|www\.|uidai\.gov|\b1947\b|Unique Identification|\bUIDAI\b/i)[0];
  b = b.replace(/\b\d{4}\s?\d{4}\s?\d{4}(?:\s?\d{4})?\b/g, " ").replace(/\bVID\b\s*:?/gi, " ");

  let a = b
    .split(/\n|,/)
    .map((x) => cleanSeg(x, loose))
    .filter(Boolean)
    .join(", ");

  // Strip leading noise before C/O, S/O, etc.
  a = a.replace(/^.{1,10}?(?=\b[SDWC]\/O\b)/i, "");

  // Match 6-digit PIN code
  const pm = [...a.matchAll(/\b[1-9]\d{5}\b/g)];
  const last = pm[pm.length - 1];
  if (last && typeof last.index === "number") a = a.slice(0, last.index + 6);
  a = a
    .replace(/\s{2,}/g, " ")
    .replace(/(,\s*)+/g, ", ")
    .replace(/^[,\s-]+|[,\s-]+$/g, "");
  if (!/:\s*\d{6}$/.test(a)) a = a.replace(/[\s,-]*\b([1-9]\d{5})$/, " - $1");

  if (a) d.address = { v: a, c: conf };
  if (last) d.pincode = { v: last[0], c: conf };

  // Resolve State: from text or inferred from PIN code
  let st = findState(a);
  if (!st && last) {
    const inferred = statesForPin(last[0]);
    if (inferred && inferred.length === 1) {
      st = inferred[0];
    }
  }
  if (st) d.state = { v: st, c: conf };

  // Resolve City / District:
  const parts = a
    .replace(/[\s,-]*\b[1-9]\d{5}\b$/, "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const cm = a.match(/\b(?:VTC|City|Town|Village|Taluka|Taluk|Tehsil|Ta)\.?\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]*?)(?=,|$)/i);
  const dm = a.match(/\b(?:District|Dist|Dt)\.?\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]*?)(?=,|$)/i);
  let city: string | null = null;
  if (dm && dm[1]) {
    city = dm[1].trim();
  } else if (cm && cm[1]) {
    city = cm[1].trim();
  } else {
    const ci = parts.findIndex((x) => /\b(?:city|town|district|dist|taluka)\b/i.test(x));
    if (ci >= 0) {
      city = parts[ci].replace(/\b(?:city|town|district|dist|dt|taluka|ta)\b[:\.]?/i, "").trim() || (ci > 0 ? parts[ci - 1] : null);
    } else if (st) {
      let si = -1;
      for (let pIdx = parts.length - 1; pIdx >= 0; pIdx--) {
        if (findState(parts[pIdx]) === st) {
          si = pIdx;
          break;
        }
      }
      if (si > 0) {
        city = parts[si - 1];
      } else if (si === 0 && parts.length > 1) {
        city = parts[1];
      }
    } else if (parts.length > 0) {
      city = parts[parts.length - 1];
    }
  }

  if (city) {
    city = title(
      city
        .replace(/^(?:dist(?:rict)?|dt|taluka|ta|vtc|city|town)\.?\s*[:\-]?\s*/i, "")
        .replace(/[^A-Za-z .'-]/g, "")
        .trim(),
    );
    if (city && (!st || city.toLowerCase() !== st.toLowerCase()) && city.length >= 2) {
      d.city = { v: city, c: conf };
    }
  }

  return {
    d,
    sc:
      (d.pincode ? 2 : 0) +
      (d.state ? 2 : 0) +
      (d.address ? 1 : 0) +
      (d.city ? 0.5 : 0) +
      conf / 200,
  };
}

// ─── 6. SILENT IN-BROWSER AADHAAR QR DECODER ────────────────────────────────
const QNAMES = [
  "ver", "ind", "ref", "name", "dob", "gender", "co", "dist",
  "lm", "house", "loc", "pin", "po", "state", "street", "sub", "vtc",
];
const QGEN: Record<string, string> = { M: "Male", F: "Female", T: "Transgender" };

function qrAddress(o: Record<string, string>): string {
  const v = (x: string | undefined) => String(x || "").trim();
  const same = (x: string, y: string) => v(x).toLowerCase() === v(y).toLowerCase();
  const parts = [
    v(o.co),
    v(o.house),
    v(o.street),
    v(o.lm),
    v(o.loc),
    v(o.vtc),
    v(o.po) && "PO: " + v(o.po),
    v(o.sub) && !same(o.sub, o.dist) && !same(o.sub, o.vtc) ? v(o.sub) : "",
    v(o.dist) && "DIST: " + v(o.dist),
    v(o.state),
  ].filter(Boolean);
  return parts.join(", ") + (o.pin ? " - " + o.pin : "");
}

const qDob = (s: string): string => (/^\d{4}$/.test(s) ? s : s.replace(/-/g, "/"));

export interface DecodedQRData {
  name?: string;
  dob?: string;
  gender?: string;
  address?: string;
  pincode?: string;
  state?: string;
  city?: string;
  last4?: string;
  uid?: string;
}

export async function decodeAadhaarQR(raw: string): Promise<DecodedQRData | null> {
  const t = String(raw).trim();
  // 1. Secure QR (big decimal number -> bytes -> gzip -> fields separated by byte 255)
  if (/^\d{100,}$/.test(t)) {
    try {
      let hex = BigInt(t).toString(16);
      if (hex.length % 2) hex = "0" + hex;
      const bytes = Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
      if (typeof DecompressionStream !== "undefined") {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        const buf = new Uint8Array(await new Response(stream).arrayBuffer());
        if (buf.length >= 300) {
          const body = buf.subarray(0, buf.length - 256);
          const seg: string[] = [];
          const td = new TextDecoder();
          let s = 0;
          for (let i = 0; i < body.length && seg.length < 17; i++) {
            if (body[i] === 255) {
              seg.push(td.decode(body.subarray(s, i)));
              s = i + 1;
            }
          }
          const names = seg[0] === "V2" ? QNAMES : /^[0-3]$/.test(seg[0]) ? QNAMES.slice(1) : null;
          if (names && seg.length >= names.length) {
            const o: Record<string, string> = {};
            names.forEach((n, i) => {
              o[n] = seg[i]?.trim() || "";
            });
            return {
              name: o.name,
              dob: qDob(o.dob || ""),
              gender: QGEN[o.gender] || "",
              address: qrAddress(o),
              pincode: o.pin,
              state: findState(o.state) || o.state,
              city: o.dist || o.vtc,
              last4: (o.ref || "").slice(0, 4),
            };
          }
        }
      }
    } catch {
      // Non-fatal if secure QR decoding encounters unexpected payload
    }
  }

  // 2. Older XML QR (<PrintLetterBarcodeData ...>)
  if (/<PrintLetterBarcodeData/i.test(t)) {
    try {
      const a: Record<string, string> = {};
      for (const m of t.matchAll(/(\w+)="([^"]*)"/g)) {
        a[m[1].toLowerCase()] = m[2].trim();
      }
      const o = {
        co: a.co,
        house: a.house,
        street: a.street,
        lm: a.lm,
        loc: a.loc,
        vtc: a.vtc,
        po: a.po,
        sub: a.subdist,
        dist: a.dist,
        state: a.state,
        pin: a.pc,
      };
      return {
        name: a.name,
        dob: qDob(a.dob || a.yob || ""),
        gender: QGEN[a.gender] || "",
        address: qrAddress(o),
        pincode: a.pc,
        state: findState(a.state) || a.state,
        city: a.dist || a.vtc,
        uid: digits(a.uid),
        last4: digits(a.uid).slice(-4),
      };
    } catch {
      // Non-fatal
    }
  }

  return null;
}

// ─── 7. CANVAS IMAGE PREPROCESSING & QUALITY CHECK ───────────────────────────
function draw(
  src: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  maxSide: number,
  rot = 0,
): HTMLCanvasElement {
  const s = Math.min(4, maxSide / Math.max(src.width, src.height));
  const w = Math.round(src.width * s);
  const h = Math.round(src.height * s);
  const cw = rot % 180 ? h : w;
  const ch = rot % 180 ? w : h;
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (x) {
    x.translate(cw / 2, ch / 2);
    x.rotate((rot * Math.PI) / 180);
    x.imageSmoothingQuality = "high";
    x.drawImage(src, -w / 2, -h / 2, w, h);
  }
  return c;
}

function toGray(c: HTMLCanvasElement): HTMLCanvasElement {
  const x = c.getContext("2d");
  if (!x) return c;
  const im = x.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  const n = c.width * c.height;
  const g = new Uint8Array(n);
  const h = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const v = ((d[4 * i] * 299 + d[4 * i + 1] * 587 + d[4 * i + 2] * 114) / 1000) | 0;
    g[i] = v;
    h[v]++;
  }
  let lo = 0;
  let hi = 255;
  let a = 0;
  const t = n * 0.01;
  while (lo < 255 && (a += h[lo]) < t) lo++;
  a = 0;
  while (hi > 0 && (a += h[hi]) < t) hi--;
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) {
    d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = Math.max(0, Math.min(255, (g[i] - lo) * k));
  }
  x.putImageData(im, 0, 0);
  return c;
}

function clone(c: HTMLCanvasElement): HTMLCanvasElement {
  const o = document.createElement("canvas");
  o.width = c.width;
  o.height = c.height;
  o.getContext("2d", { willReadFrequently: true })?.drawImage(c, 0, 0);
  return o;
}

function binarize(c: HTMLCanvasElement): HTMLCanvasElement {
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return c;
  const w = c.width;
  const h = c.height;
  const im = x.getImageData(0, 0, w, h);
  const d = im.data;
  const I = new Float64Array((w + 1) * (h + 1));
  const R = Math.max(8, (w / 40) | 0);
  for (let y = 0; y < h; y++) {
    let r = 0;
    for (let i = 0; i < w; i++) {
      r += d[4 * (y * w + i)];
      I[(y + 1) * (w + 1) + i + 1] = I[y * (w + 1) + i + 1] + r;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w; i++) {
      const x0 = Math.max(0, i - R);
      const x1 = Math.min(w, i + R + 1);
      const y0 = Math.max(0, y - R);
      const y1 = Math.min(h, y + R + 1);
      const k = 4 * (y * w + i);
      const m =
        (I[y1 * (w + 1) + x1] -
          I[y0 * (w + 1) + x1] -
          I[y1 * (w + 1) + x0] +
          I[y0 * (w + 1) + x0]) /
        ((x1 - x0) * (y1 - y0));
      d[k] = d[k + 1] = d[k + 2] = d[k] < m * 0.88 ? 0 : 255;
    }
  }
  x.putImageData(im, 0, 0);
  return c;
}

function crop(
  c: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): HTMLCanvasElement {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.min(c.width - x, Math.round(w)));
  h = Math.max(1, Math.min(c.height - y, Math.round(h)));
  const o = document.createElement("canvas");
  o.width = Math.round(w * scale);
  o.height = Math.round(h * scale);
  const g = o.getContext("2d", { willReadFrequently: true });
  if (g) {
    g.imageSmoothingQuality = "high";
    g.drawImage(c, x, y, w, h, 0, 0, o.width, o.height);
  }
  return o;
}

function cropPad(
  c: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  pad: number,
): HTMLCanvasElement {
  const o = crop(c, x, y, w, h, scale);
  const r = document.createElement("canvas");
  r.width = o.width + pad * 2;
  r.height = o.height + pad * 2;
  const g = r.getContext("2d", { willReadFrequently: true });
  if (g) {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, r.width, r.height);
    g.drawImage(o, pad, pad);
  }
  return r;
}

export function checkQuality(bmp: ImageBitmap | HTMLCanvasElement): {
  w: number;
  h: number;
  blur: number;
} {
  const s = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const w = Math.max(8, Math.round(bmp.width * s));
  const h = Math.max(8, Math.round(bmp.height * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return { w: bmp.width, h: bmp.height, blur: 100 };
  g.drawImage(bmp, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const gy = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gy[i] = (d[4 * i] * 299 + d[4 * i + 1] * 587 + d[4 * i + 2] * 114) / 1000;
  }
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gy[i] - gy[i - 1] - gy[i + 1] - gy[i - w] - gy[i + w];
      sum += v;
      sq += v * v;
      n++;
    }
  }
  return { w: bmp.width, h: bmp.height, blur: sq / n - (sum / n) ** 2 };
}

// ─── 8. TESSERACT WORKER & MULTI-PASS DEEP SCAN ──────────────────────────────
let globalWorkerPromise: Promise<import("tesseract.js").Worker> | null = null;

async function getWorker(): Promise<import("tesseract.js").Worker> {
  if (!globalWorkerPromise) {
    globalWorkerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(CFG.LANG, 1, {
        logger: () => undefined,
      });
      try {
        await worker.setParameters({
          user_defined_dpi: "300",
          preserve_interword_spaces: "1",
        });
      } catch {
        // Non-fatal
      }
      return worker;
    })();
  }
  return globalWorkerPromise;
}

interface OcrPassResult {
  lines: OcrLine[];
  conf: number;
  text: string;
}

async function runOcr(
  canvas: HTMLCanvasElement,
  opt: { psm?: string; whitelist?: string } = {},
): Promise<OcrPassResult> {
  const wk = await getWorker();
  try {
    await wk.setParameters({
      tessedit_pageseg_mode: (opt.psm || "3") as unknown as import("tesseract.js").PSM,
      tessedit_char_whitelist: opt.whitelist || "",
    });
  } catch {
    // Non-fatal
  }
  const { data } = await wk.recognize(canvas);
  const pageData = data as unknown as {
    lines?: Array<{
      text?: string;
      confidence?: number;
      bbox?: LineBBox;
      words?: Array<{ text: string; confidence: number }>;
    }>;
  };
  const lines: OcrLine[] = (pageData.lines || [])
    .map((l) => {
      const words = l.words || [];
      const ok = words.filter((x) => x.confidence >= 35 || /\d/.test(x.text));
      return {
        t: (ok.length ? ok.map((x) => x.text).join(" ") : l.text || "").trim(),
        c: l.confidence,
        b: l.bbox,
        raw: String(l.text || "").trim(),
        w: words.map((x) => ({ t: x.text, c: x.confidence })),
      };
    })
    .filter((l: OcrLine) => l.t);

  return {
    lines: lines.length
      ? lines
      : (data.text || "")
          .split("\n")
          .filter((t: string) => t.trim())
          .map((t: string) => ({ t: t.trim(), c: data.confidence })),
    conf: Math.round(data.confidence || 0),
    text: data.text || "",
  };
}

const KW =
  /government|india|aadhaar|dob|birth|male|female|address|uidai|unique|identification|vid|\d{4}\s\d{4}\s\d{4}/gi;

interface DeepReadPass {
  name: string;
  res: OcrPassResult;
  nameRow?: boolean;
  rank?: number;
  digitsOnly?: boolean;
}

async function deepRead(
  bmp: ImageBitmap,
  side: "front" | "back",
  onP?: (pct: number) => void,
): Promise<{ rot: number; score: number; passes: DeepReadPass[] }> {
  const P = (f: number) => onP && onP(Math.min(1, f));

  // (1) Auto-rotate: test 0/90/180/270 degrees against Aadhaar keyword density
  let rot = 0;
  let bestScore = -1;
  for (const r of [0, 90, 180, 270]) {
    const testCanvas = toGray(draw(bmp, 1000, r));
    const res = await runOcr(testCanvas);
    const sc = (res.text.match(KW) || []).length;
    if (sc > bestScore) {
      bestScore = sc;
      rot = r;
    }
    if (sc >= 3) break;
    P(0.05 + r / 1500);
  }

  // (2) Full-size reads
  const side0 = Math.max(bmp.width, bmp.height) < 1300 ? 3200 : CFG.FULL_SIDE;
  const gray = toGray(draw(bmp, side0, rot));
  const passes: DeepReadPass[] = [{ name: "gray", res: await runOcr(gray) }];
  P(0.35);

  let bin: HTMLCanvasElement | null = null;
  if (CFG.DEEP || passes[0].res.conf < 70) {
    bin = binarize(clone(gray));
    passes.push({ name: "binarized", res: await runOcr(bin) });
  }
  P(0.55);

  // (3) Targeted reads
  if (side === "front") {
    const hasValid = () =>
      numCands(passes.flatMap((p) => p.res.lines)).some((x) => validAadhaar(x.v));

    // Name: cut text rows above the date line and read alone with letters only
    const done: { i: number; b: LineBBox }[] = [];
    for (const p of passes.filter((x) => x.name === "gray" || x.name === "binarized")) {
      for (const [i, l] of nameRowsAbove(p.res.lines).entries()) {
        if (!l.b) continue;
        if (
          done.some(
            (d) =>
              d.i === i &&
              Math.abs(d.b.x0 - l.b!.x0) < 14 &&
              Math.abs(d.b.y0 - l.b!.y0) < 14,
          )
        )
          continue;
        done.push({ i, b: l.b });

        for (const [cn, cv] of [
          ["g", gray],
          ["b", bin],
        ] as const) {
          if (!cv) continue;
          const lh = Math.max(10, l.b.y1 - l.b.y0);
          const sc = Math.max(1, Math.min(4, 48 / lh));
          const cc = cropPad(
            cv,
            l.b.x0 - lh * 0.6,
            l.b.y0 - lh * 0.3,
            l.b.x1 - l.b.x0 + lh * 1.2,
            lh * 1.6,
            sc,
            18,
          );
          passes.push({
            name: `name-row${i + 1}-${cn}`,
            nameRow: true,
            rank: i + 1,
            res: await runOcr(cc, { psm: "7", whitelist: NAME_CHARS }),
          });
        }
      }
    }
    P(0.7);

    // Number: digits-only reads of the lower part
    if (!hasValid()) {
      for (const [nm, src, psm, y0] of [
        ["digits-gray", gray, "6", 0.5],
        ["digits-sparse", gray, "11", 0.5],
        ["digits-bin", bin, "6", 0.5],
        ["digits-full", gray, "11", 0],
      ] as const) {
        if (!src) continue;
        const cc = crop(src, 0, src.height * y0, src.width, src.height * (1 - y0), 1.5);
        passes.push({
          name: nm,
          digitsOnly: true,
          res: await runOcr(cc, { psm, whitelist: "0123456789 " }),
        });
        if (hasValid()) break;
      }
    }
    P(0.95);
  } else {
    // Back face targeted read: crop address from "Address" line down, isolate left 64%
    const al = passes[0].res.lines.find((l) => /address/i.test(l.t) && l.b);
    const y0 = Math.max(0, (al && al.b ? al.b.y0 : gray.height * 0.15) - 10);
    const jobs: [string, HTMLCanvasElement, number][] = [["address-left", gray, 0.64]];
    if (CFG.DEEP) {
      if (bin) jobs.push(["address-left-bin", bin, 0.64]);
      jobs.push(["address-wide", gray, 0.97]);
    }
    for (const [nm, src, wf] of jobs) {
      passes.push({
        name: nm,
        res: await runOcr(crop(src, 0, y0, src.width * wf, src.height - y0, 1.5), { psm: "6" }),
      });
      P(0.7 + passes.length * 0.05);
    }
    P(0.95);
  }

  return { rot, score: bestScore, passes };
}

// ─── 9. RESULT EXTRACTION & MULTI-PASS MERGING ──────────────────────────────
interface ExtractedFront {
  name?: Candidate;
  nameGuess?: Candidate;
  dob?: Candidate;
  gender?: Candidate;
  nums: { v: string; c: number }[];
  text: string;
}

function extractFront(passes: DeepReadPass[]): ExtractedFront {
  const rs = passes.map((p) => {
    const L = p.res.lines.filter((l) => l.t);
    const conf = p.res.conf;
    const r: {
      nums: { v: string; c: number }[];
      names: Candidate[];
      dob?: Candidate | null;
      gender?: Candidate | null;
    } = { nums: numCands(L), names: [] };
    if (p.nameRow) {
      for (const l of p.res.lines) {
        const v = cleanName(l.t);
        if (v) r.names.push({ v, c: Math.round(l.c || conf), row: p.rank === 1 });
      }
    } else if (!p.digitsOnly) {
      const n = parseName(L, conf);
      if (n) r.names.push(n);
      r.dob = parseDOB(L, conf);
      r.gender = parseGender(L, conf);
    }
    return r;
  });

  const pick = (k: "dob" | "gender") => vote(rs.map((r) => r[k]).filter(Boolean));
  const d: ExtractedFront = {
    nums: rs.flatMap((r) => r.nums),
    text: passes.map((p) => p.res.text).join("\n"),
  };

  const dobV = pick("dob");
  if (dobV) d.dob = { v: dobV.v, c: dobV.c, n: dobV.n, flag: dobV.flag, soft: dobV.soft };

  const genV = pick("gender");
  if (genV) d.gender = { v: genV.v, c: genV.c, n: genV.n, flag: genV.flag, soft: genV.soft };

  const all = rs
    .flatMap((r) => r.names)
    .map((n) => ({ ...n, s: nameScore(n.v, n.c) }));
  const good = all.filter((n) => (n.s ?? 0) >= 0.45 && (n.c || 0) >= 35);
  const nv = vote(good.flatMap((n) => (n.row ? [n, n] : [n])));
  if (nv) {
    d.name = { v: nv.v, c: nv.c, n: nv.n };
  } else {
    const g = all.sort((a, b) => (b.s ?? 0) * (b.c || 0) - (a.s ?? 0) * (a.c || 0))[0];
    if (g) d.nameGuess = { v: g.v, c: g.c };
  }

  return d;
}

interface ExtractedBack {
  address?: Candidate;
  pincode?: Candidate;
  state?: Candidate;
  city?: Candidate;
  nums: { v: string; c: number }[];
  text: string;
}

function extractBack(passes: DeepReadPass[]): ExtractedBack {
  const rs = passes
    .filter((p) => !p.digitsOnly)
    .map((p) => parseBack(p.res))
    .filter((r) => r.d.address || r.d.pincode)
    .sort((x, y) => y.sc - x.sc);

  const d: ExtractedBack = {
    ...(rs.length ? rs[0].d : {}),
    nums: passes.flatMap((p) => numCands(p.res.lines.filter((l) => l.t))),
    text: passes.map((p) => p.res.text).join("\n"),
  };

  for (const r of rs.slice(1)) {
    for (const k of ["address", "pincode", "state", "city"] as const) {
      if (!d[k] && r.d[k]) d[k] = r.d[k];
    }
  }

  const pv = vote(rs.filter((r) => r.d.pincode).map((r) => r.d.pincode));
  if (pv && d.pincode && d.pincode.v === pv.v) d.pincode = { ...d.pincode, n: pv.n };
  if (pv && pv.n >= 2 && (!d.pincode || d.pincode.v !== pv.v)) {
    if (d.address) {
      d.address = {
        ...d.address,
        v: d.address.v.replace(/\b[1-9]\d{5}\b(?!.*\b[1-9]\d{5}\b)/, pv.v),
      };
    }
    d.pincode = { v: pv.v, c: pv.c, n: pv.n };
  }

  if (d.pincode && !d.state) {
    const s = statesForPin(d.pincode.v);
    if (s && s.length === 1) d.state = { v: s[0], c: 60 };
  }

  return d;
}

/** Formats a date from DD/MM/YYYY or YYYY into YYYY-MM-DD for form inputs. */
function toStandardDate(dobRaw: string | undefined): string | undefined {
  if (!dobRaw) return undefined;
  const parts = dobRaw.split("/");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  if (/^\d{4}$/.test(dobRaw)) {
    return `${dobRaw}-01-01`;
  }
  return dobRaw;
}

// ─── 10. MASTER SCANNER ENTRYPOINT (Aadhaar Deep Scan) ───────────────────────

export async function scanAadhaarSide(
  file: File,
  side: "front" | "back",
  onProgress?: (pct: number, status: string) => void,
): Promise<IdOcrResult> {
  if (!CFG.TYPES.includes(file.type)) {
    throw new Error("Only JPG, PNG or WEBP images are supported.");
  }
  if (file.size > CFG.MAX_MB * 1048576) {
    throw new Error(`Image is larger than ${CFG.MAX_MB} MB.`);
  }

  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    onProgress?.(10, "Analyzing photo quality and orientation…");
    const q = checkQuality(bmp);
    const isSmall = Math.max(q.w, q.h) < 1000;
    const isBlur = q.blur < 40;

    // 1. Silent QR probe in browser
    let qr: DecodedQRData | null = null;
    try {
      type BarcodeDetectorCtor = new (opt?: { formats?: string[] }) => {
        detect: (bmp: ImageBitmap) => Promise<Array<{ rawValue?: string }>>;
      };
      const globalBarcodeDetector = (
        globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
      ).BarcodeDetector;
      if (typeof globalBarcodeDetector !== "undefined") {
        const det = new globalBarcodeDetector({ formats: ["qr_code"] });
        const hits = await det.detect(bmp);
        if (hits.length && hits[0].rawValue) {
          qr = await decodeAadhaarQR(hits[0].rawValue);
        }
      }
    } catch {
      // Non-fatal
    }

    onProgress?.(30, `Reading ${side} face via Deep Multi-Pass OCR…`);
    const readRes = await deepRead(bmp, side, (pct) =>
      onProgress?.(30 + pct * 60, `Reading ${side} face (${Math.round(pct * 100)}%)…`),
    );

    let fields: ParsedIdFields = {
      id_type_detected: "Aadhar Card",
    };
    let confidence = 0.5;
    let message = "Aadhaar Card scanned.";

    if (side === "front") {
      const f = extractFront(readRes.passes);
      const hint4 = qr?.last4 || null;
      const an = pickAadhaarNumber(f.nums, f.text, hint4);

      const nameVal = qr?.name || f.name?.v || f.nameGuess?.v;
      const dobVal = toStandardDate(qr?.dob || f.dob?.v);
      const genderVal = qr?.gender || f.gender?.v;
      let idNumVal = an ? an.v : qr?.uid || (qr?.last4 ? `XXXX XXXX ${qr.last4}` : undefined);
      if (idNumVal && digits(idNumVal).length === 12) {
        idNumVal = fmt12(digits(idNumVal));
      }

      fields = {
        name: nameVal ? title(nameVal) : undefined,
        id_number: idNumVal,
        date_of_birth: dobVal,
        gender: genderVal,
        id_type_detected: "Aadhar Card",
      };

      const hasName = Boolean(fields.name);
      const hasId = Boolean(fields.id_number);
      const hasDob = Boolean(fields.date_of_birth);
      confidence = hasName && hasId ? 0.95 : hasName || hasId || hasDob ? 0.8 : 0.4;
      message =
        hasName && hasId
          ? "Aadhaar front details recognized."
          : isBlur || isSmall
            ? "Photo may be low quality or blurry. Please verify details."
            : "Aadhaar details detected.";
    } else {
      const b = extractBack(readRes.passes);
      const hint4 = qr?.last4 || null;
      const an = pickAadhaarNumber(b.nums, b.text, hint4);

      const addrVal = qr?.address || b.address?.v;
      const pinVal = qr?.pincode || b.pincode?.v;
      const stateVal = qr?.state || b.state?.v;
      const cityVal = qr?.city || b.city?.v;
      let idNumVal = an ? an.v : qr?.uid || (qr?.last4 ? `XXXX XXXX ${qr.last4}` : undefined);
      if (idNumVal && digits(idNumVal).length === 12) {
        idNumVal = fmt12(digits(idNumVal));
      }

      fields = {
        id_number: idNumVal,
        address: addrVal,
        pincode: pinVal,
        city: cityVal ? title(cityVal) : undefined,
        state: stateVal,
        id_type_detected: "Aadhar Card",
      };

      const hasAddr = Boolean(fields.address);
      const hasPin = Boolean(fields.pincode);
      confidence = hasAddr && hasPin ? 0.92 : hasAddr || hasPin ? 0.75 : 0.35;
      message = hasAddr
        ? "Aadhaar back address recognized."
        : "Address partially read. Please verify details.";
    }

    const canAutofill =
      Boolean(fields.name && fields.id_number) ||
      Boolean(fields.name && fields.date_of_birth) ||
      Boolean(fields.address && fields.pincode) ||
      Boolean(fields.address && side === "back") ||
      Boolean(fields.city && fields.state && side === "back") ||
      Boolean(fields.pincode && side === "back") ||
      Boolean(fields.id_number && fields.date_of_birth);

    return {
      fields,
      confidence: qr ? 1.0 : confidence,
      message: qr ? "Extracted digitally from Aadhaar QR Code" : message,
      can_autofill: canAutofill,
      source: qr ? "qr" : "tesseract",
    };
  } finally {
    if (bmp.close) {
      bmp.close();
    }
  }
}

/**
 * Merges front and back scan results into a unified Aadhaar card record.
 */
export function mergeAadhaarSides(
  front: IdOcrResult | null | undefined,
  back: IdOcrResult | null | undefined,
): IdOcrResult | null {
  if (!front && !back) return null;
  if (!front) return back ?? null;
  if (!back) return front ?? null;

  const fF = front.fields || {};
  const bF = back.fields || {};

  // ID Number: Full 12 digits always takes 100% precedence
  let resolvedId = "";
  const fDigits = digits(fF.id_number);
  const bDigits = digits(bF.id_number);
  if (fDigits.length === 12) {
    resolvedId = fmt12(fDigits);
  } else if (bDigits.length === 12) {
    resolvedId = fmt12(bDigits);
  } else {
    const last4 = fDigits.slice(-4) || bDigits.slice(-4);
    resolvedId = last4.length === 4 ? mask(last4) : fF.id_number || bF.id_number || "";
  }

  const mergedFields: ParsedIdFields = {
    name: fF.name || bF.name,
    id_number: resolvedId || undefined,
    date_of_birth: fF.date_of_birth || bF.date_of_birth,
    gender: fF.gender || bF.gender,
    address: bF.address || fF.address,
    pincode: bF.pincode || fF.pincode,
    city: bF.city || fF.city,
    state: bF.state || fF.state,
    care_of: bF.care_of || fF.care_of,
    id_type_detected: "Aadhar Card",
  };

  const confidence = Math.min(
    1.0,
    Math.max(front.confidence, back.confidence) + (mergedFields.name && mergedFields.address ? 0.05 : 0),
  );

  const canAutofill =
    front.can_autofill ||
    back.can_autofill ||
    Boolean(mergedFields.name || mergedFields.id_number || mergedFields.address);

  return {
    fields: mergedFields,
    confidence,
    message: "Aadhaar Card details detected.",
    can_autofill: canAutofill,
    source: front.source === "qr" || back.source === "qr" ? "qr" : "tesseract",
  };
}
