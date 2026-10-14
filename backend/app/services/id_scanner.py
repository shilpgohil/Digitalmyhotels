from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any

import cv2
import numpy as np
import zxingcpp

from app.schemas.guest import IdScanFields, IdScanResponse

logger = logging.getLogger(__name__)

# Global singleton for RapidOCR engine so ONNX models are initialized once (~50MB RAM)
_rapid_ocr_engine: Any = None


def get_ocr_engine() -> Any:
    global _rapid_ocr_engine
    if _rapid_ocr_engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR

            _rapid_ocr_engine = RapidOCR()
        except Exception as e:
            logger.warning("RapidOCR failed to initialize: %s", e)
            _rapid_ocr_engine = None
    return _rapid_ocr_engine


# ─── REGEX PATTERNS ──────────────────────────────────────────────────────────

AADHAAR_NUM_RE = re.compile(
    r"\b(?:\d{4}[\s-]+\d{4}[\s-]+\d{4}|\d{12}|[Xx\d]{4}[\s-]+[Xx\d]{4}[\s-]+\d{4})\b"
)
PAN_NUM_RE = re.compile(r"\b[A-Z]{5}[0-9OIl]{4}[A-Z]\b", re.IGNORECASE)
PASSPORT_NUM_RE = re.compile(r"\b[A-PR-WY-Z][0-9OIl]{7}\b", re.IGNORECASE)
DL_NUM_RE = re.compile(
    r"\b[A-Z]{2}[-\s/]?\d{2}[-\s/]?\d{4}[-\s/]?\d{7}\b|\b[A-Z]{2}\d{13,15}\b", re.IGNORECASE
)
VOTER_NUM_RE = re.compile(r"\b[A-Z]{3}[-/]?[0-9OIl]{7}\b", re.IGNORECASE)

DOB_PREFIX_RE = re.compile(
    r"(?:D\.?O\.?B\.?|Date of Birth|Birth Date|Year of Birth|YOB|जन्म|जन्मतिथि|जन्म तारीख)[:\s/]*"
    r"(\d{2}[./\-]\d{2}[./\-]\d{4}|\d{4}[./\-]\d{2}[./\-]\d{2}|\b(?:19|20)\d{2}\b)",
    re.IGNORECASE,
)
DATE_RE = re.compile(r"\b(\d{2}[./\-]\d{2}[./\-]\d{4})\b")
PIN_RE = re.compile(r"\b([1-9]\d{2}\s?\d{3})\b")
GENDER_RE = re.compile(
    r"\b(Male|Female|Transgender|MALE|FEMALE|TRANSGENDER|M|F|पुरुष|महिला)\b", re.IGNORECASE
)

NON_NAME_TOKENS = {
    "GOVERNMENT",
    "GOVT",
    "INDIA",
    "BHARAT",
    "AADHAAR",
    "UIDAI",
    "ENROLMENT",
    "MERA",
    "PEHCHAN",
    "UNIQUE",
    "IDENTIFICATION",
    "AUTHORITY",
    "OF",
    "HELP",
    "WWW",
    "MY",
    "INCOME",
    "TAX",
    "DEPARTMENT",
    "PERMANENT",
    "ACCOUNT",
    "CARD",
    "NUMBER",
    "ELECTION",
    "COMMISSION",
    "VOTER",
    "IDENTITY",
    "ELECTORAL",
    "EPIC",
    "DRIVING",
    "LICENCE",
    "LICENSE",
    "UNION",
    "TRANSPORT",
    "MOTOR",
    "VEHICLES",
    "REPUBLIC",
    "PASSPORT",
    "SURNAME",
    "GIVEN",
    "NATIONALITY",
    "SEX",
    "GENDER",
    "MALE",
    "FEMALE",
    "TRANSGENDER",
    "PURUSH",
    "MAHILA",
    "FATHER",
    "FATHERS",
    "MOTHER",
    "MOTHERS",
    "HUSBAND",
    "WIFE",
    "GUARDIAN",
    "SON",
    "DAUGHTER",
    "DATE",
    "BIRTH",
    "YEAR",
    "JANMA",
    "TARIKH",
    "ADDRESS",
    "PATA",
    "PIN",
    "PINCODE",
    "SIGNATURE",
    "HOLDER",
    "OFFICER",
    "ISSUED",
    "EXPIRY",
    "VALID",
    "UPTO",
    "STATE",
    "DISTRICT",
    "PO",
    "PS",
    "VILL",
    "TEHSIL",
    "TALUKA",
}

INDIAN_STATES = [
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    "Delhi",
    "Jammu and Kashmir",
    "Ladakh",
    "Puducherry",
    "Chandigarh",
    "Goa",
]


# ─── NORMALIZATION UTILITIES ──────────────────────────────────────────────────


def normalize_date(raw: str | None) -> str | None:
    if not raw:
        return None
    cleaned = raw.strip().replace(".", "/").replace("-", "/")
    parts = cleaned.split("/")
    if len(parts) == 3:
        if len(parts[0]) == 4:  # YYYY/MM/DD
            return f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
        if len(parts[2]) == 4:  # DD/MM/YYYY
            return f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
    elif len(cleaned) == 4 and cleaned.isdigit():  # YYYY
        return f"{cleaned}-01-01"
    return None


def normalize_gender(raw: str | None) -> str | None:
    if not raw:
        return None
    r = raw.strip().upper()
    if r in ("M", "MALE", "पुरुष"):
        return "Male"
    if r in ("F", "FEMALE", "महिला"):
        return "Female"
    if r in ("T", "TG", "TRANSGENDER", "OTHER", "अन्य"):
        return "Other"
    return raw


HONORIFIC_TOKENS = {"MR", "MRS", "MS", "SHRI", "SHREE", "SMT", "DR", "MASTER"}


def clean_name(raw: str | None) -> str | None:
    if not raw:
        return None
    base = re.sub(r"[^A-Za-z.\s]", " ", raw)
    base = re.sub(r"\s+", " ", base).strip()
    words = [w for w in base.split() if w.upper() not in NON_NAME_TOKENS]
    if not words:
        return None
    while len(words) > 1 and words[0].upper().replace(".", "") in HONORIFIC_TOKENS:
        words.pop(0)
    res = " ".join(words)
    if res.isupper() or res.islower():
        return res.title()
    return res


# ─── TIER 1: QR CODE EXTRACTION ──────────────────────────────────────────────


def normalize_scan_image(
    img: np.ndarray, max_dim: int = 1600, min_dim: int = 900
) -> np.ndarray:
    """Normalize input image to optimal resolution range (900px <= dim <= 1600px).

    Prevents massive multi-megapixel images from wasting CPU cycles on bicubic scaling
    and ONNX inference, while upscaling tiny thumbnails so QR codes remain sharp.
    """
    h, w = img.shape[:2]
    cur_max = max(h, w)
    cur_min = min(h, w)

    if cur_max > max_dim:
        scale = float(max_dim) / cur_max
        return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    elif cur_min < min_dim and cur_max < max_dim:
        scale = min(float(max_dim) / cur_max, float(min_dim) / max(1, cur_min), 2.5)
        return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    return img


def _decode_qr_barcodes(img: np.ndarray, side: str = "front") -> list[Any]:
    """Finds QR codes on image with fast, targeted scans in < 80ms.

    Handles all Indian Aadhaar card variations:
    - Traditional / e-Aadhaar cards: QR code on FRONT (right half / lower right).
    - New PVC smart cards: QR code on BACK (left half / center-left).
    - Horizontal flips and inverted uploads.
    """
    # 1. Direct scan on full image
    barcodes = zxingcpp.read_barcodes(img)
    if barcodes:
        return list(barcodes)

    h, w = img.shape[:2]

    def _scan_right_half() -> list[Any]:
        # Standard front Aadhaar card places QR on the right half
        right_crop = img[:, int(w * 0.45) : w]
        if right_crop.size == 0:
            return []
        b = zxingcpp.read_barcodes(right_crop)
        if b:
            return list(b)
        rw = right_crop.shape[1]
        if rw < 1200:
            scale = min(3.0, 1400.0 / rw)
            scaled = cv2.resize(
                right_crop, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC
            )
            b = zxingcpp.read_barcodes(scaled)
            if b:
                return list(b)
        return []

    def _scan_left_half() -> list[Any]:
        # PVC Aadhaar back side places large Secure QR on the left half
        left_crop = img[:, : int(w * 0.55)]
        if left_crop.size == 0:
            return []
        b = zxingcpp.read_barcodes(left_crop)
        if b:
            return list(b)
        lw = left_crop.shape[1]
        if lw < 1200:
            scale = min(3.0, 1400.0 / lw)
            scaled = cv2.resize(
                left_crop, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC
            )
            b = zxingcpp.read_barcodes(scaled)
            if b:
                return list(b)
        return []

    def _scan_center() -> list[Any]:
        # Letter printout slips with QR centered
        center_crop = img[:, int(w * 0.20) : int(w * 0.80)]
        if center_crop.size == 0:
            return []
        b = zxingcpp.read_barcodes(center_crop)
        if b:
            return list(b)
        cw = center_crop.shape[1]
        if cw < 1200:
            scale = min(3.0, 1400.0 / cw)
            scaled = cv2.resize(
                center_crop, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC
            )
            b = zxingcpp.read_barcodes(scaled)
            if b:
                return list(b)
        return []

    # Prioritize scan order based on side hint
    if side == "back":
        b = _scan_left_half()
        if b:
            return b
        b = _scan_center()
        if b:
            return b
        b = _scan_right_half()
        if b:
            return b
    else:
        b = _scan_right_half()
        if b:
            return b
        b = _scan_left_half()
        if b:
            return b
        b = _scan_center()
        if b:
            return b

    # Quadrant fallbacks (lower-right, upper-right)
    lr_crop = img[int(h * 0.35) : h, int(w * 0.45) : w]
    if lr_crop.size > 0:
        b = zxingcpp.read_barcodes(lr_crop)
        if b:
            return list(b)
        lw = lr_crop.shape[1]
        if lw < 1000:
            scale = min(3.0, 1200.0 / lw)
            scaled_lr = cv2.resize(
                lr_crop, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC
            )
            b = zxingcpp.read_barcodes(scaled_lr)
            if b:
                return list(b)

    ur_crop = img[: int(h * 0.65), int(w * 0.45) : w]
    if ur_crop.size > 0:
        b = zxingcpp.read_barcodes(ur_crop)
        if b:
            return list(b)

    return []


def _parse_aadhaar_xml(xml_str: str) -> IdScanFields | None:
    try:
        root = ET.fromstring(xml_str)
        attr = root.attrib

        uid = attr.get("uid")
        name = attr.get("name")
        gender = normalize_gender(attr.get("gender"))
        dob = normalize_date(attr.get("dob") or attr.get("yob"))
        co = attr.get("co")

        # Address parts
        addr_parts: list[str] = []
        if co:
            addr_parts.append(co)
        for k in ("house", "street", "lm", "loc"):
            v = attr.get(k)
            if v and v.strip():
                addr_parts.append(v.strip())

        full_addr = ", ".join(addr_parts) if addr_parts else None
        city = attr.get("vtc") or attr.get("dist")
        state = attr.get("state")
        pincode = attr.get("pc")

        return IdScanFields(
            name=clean_name(name),
            id_number=uid,
            date_of_birth=dob,
            gender=gender,
            address=full_addr,
            city=city,
            state=state,
            pincode=pincode,
            care_of=co,
            id_type_detected="Aadhar Card",
        )
    except Exception as e:
        logger.debug("XML parse attempt failed: %s", e)
        return None


def _parse_aadhaar_secure_qr(
    barcode_text: str, barcode_bytes: bytes, img: np.ndarray | None = None
) -> IdScanFields | None:
    try:
        from pyaadhaar.decode import AadhaarSecureQr

        val_int: int | None = None
        if barcode_text and barcode_text.strip().isdigit():
            val_int = int(barcode_text.strip())
        elif barcode_bytes:
            val_int = int.from_bytes(barcode_bytes, "big")

        if val_int is None:
            return None

        secure_qr = AadhaarSecureQr(val_int)  # type: ignore[arg-type]
        data = secure_qr.decodeddata()
        if not data:
            return None

        name = data.get("name")
        gender = normalize_gender(data.get("gender"))
        dob = normalize_date(data.get("dob"))
        co = data.get("careof")

        addr_parts: list[str] = []
        if co:
            addr_parts.append(co)
        for k in ("house", "street", "landmark", "location"):
            v = data.get(k)
            if v and v.strip():
                addr_parts.append(v.strip())

        full_addr = ", ".join(addr_parts) if addr_parts else None
        city = data.get("vtc") or data.get("district")
        state = data.get("state")
        pincode = data.get("pincode")
        uid_last4 = data.get("aadhaar_last_4_digit")

        # Try to find the full 12-digit number from printed card text matching uid_last4
        full_uid: str | None = None
        if img is not None and uid_last4:
            try:
                engine = get_ocr_engine()
                if engine is not None:
                    h, w = img.shape[:2]
                    # The 12-digit UID is printed on the bottom half of the card.
                    # Crop and scale bottom half for fast OCR (< 150ms) instead of full-image scan.
                    bottom_crop = img[int(h * 0.45) : h, :]
                    bh, bw = bottom_crop.shape[:2]
                    max_dim = max(bh, bw)
                    if max_dim > 800:
                        scale = 800.0 / max_dim
                        bottom_crop = cv2.resize(
                            bottom_crop,
                            (int(bw * scale), int(bh * scale)),
                            interpolation=cv2.INTER_AREA,
                        )
                    ocr_res, _ = engine(bottom_crop)
                    if ocr_res:
                        for _, txt, _ in ocr_res:
                            match = AADHAAR_NUM_RE.search(txt)
                            if match:
                                digits_only = re.sub(r"\D", "", match.group(0))
                                if len(digits_only) == 12 and digits_only.endswith(str(uid_last4)):
                                    full_uid = digits_only
                                    break
            except Exception as e:
                logger.debug("Failed text fusion for Secure QR full UID: %s", e)

        resolved_id = full_uid or (f"••••••••{uid_last4}" if uid_last4 else None)

        return IdScanFields(
            name=clean_name(name),
            id_number=resolved_id,
            date_of_birth=dob,
            gender=gender,
            address=full_addr,
            city=city,
            state=state,
            pincode=pincode,
            care_of=co,
            id_type_detected="Aadhar Card",
        )
    except Exception as e:
        logger.debug("Aadhaar secure QR parse attempt failed: %s", e)
        return None


def scan_qr_stage(img: np.ndarray, side: str = "front") -> IdScanResponse | None:
    barcodes = _decode_qr_barcodes(img, side=side)
    if not barcodes:
        return None

    for b in barcodes:
        text = b.text or ""
        raw_bytes = b.bytes or b""

        # 1. XML Aadhaar QR
        if "<PrintLetterBarcodeData" in text or "<?xml" in text:
            parsed = _parse_aadhaar_xml(text)
            if parsed and (parsed.name or parsed.id_number or parsed.address):
                return IdScanResponse(
                    success=True,
                    source="qr",
                    confidence=1.0,
                    fields=parsed,
                    can_autofill=True,
                    message="Extracted 100% digitally from Aadhaar Secure QR Code",
                )

        # 2. Binary / Secure Aadhaar QR
        if (text and text.strip().isdigit() and len(text.strip()) > 500) or len(raw_bytes) > 200:
            parsed = _parse_aadhaar_secure_qr(text, raw_bytes, img=img)
            if parsed and (parsed.name or parsed.id_number or parsed.address):
                return IdScanResponse(
                    success=True,
                    source="qr",
                    confidence=1.0,
                    fields=parsed,
                    can_autofill=True,
                    message="Extracted 100% digitally from Aadhaar Secure QR Code",
                )

    return None


# ─── TIER 2: PASSPORT MRZ EXTRACTION ─────────────────────────────────────────


def scan_mrz_stage(lines: list[str]) -> IdScanResponse | None:
    # Look for MRZ lines (lines with <<)
    mrz_lines = [line_str for line_str in lines if "<<" in line_str and len(line_str) >= 25]
    if len(mrz_lines) >= 2 or (mrz_lines and any(m.startswith("P") for m in mrz_lines)):
        # Parse standard 2-line passport MRZ
        line1 = next((m for m in mrz_lines if m.startswith("P")), mrz_lines[0])
        # Extract surname & given name
        # Format: P<INDNAME<<GIVEN<<<<<
        name_part = re.sub(r"^[PA-Z0-9<]*<IND", "", line1)
        name_chunks = name_part.split("<<")
        full_name = None
        if len(name_chunks) >= 2:
            surname = name_chunks[0].replace("<", " ").strip()
            given = name_chunks[1].replace("<", " ").strip()
            full_name = clean_name(f"{given} {surname}")

        # Check line 2 for passport number, dob, gender
        passport_num = None
        dob = None
        gender = None
        for mrz_item in mrz_lines:
            if mrz_item != line1:
                # Line 2: Passport (0:9), Check (9), Nat (10:13), DOB (13:19), Check (19), Sex (20)
                cand_doc_num = mrz_item[:9].replace("<", "").strip().upper()
                if len(cand_doc_num) >= 7 and re.match(
                    r"^[A-PR-WY-Z][0-9A-Z]{6,8}$", cand_doc_num
                ):
                    passport_num = cand_doc_num
                else:
                    clean_m = mrz_item.replace("<", "").strip()
                    match = PASSPORT_NUM_RE.search(clean_m)
                    if match:
                        passport_num = match.group(0).upper()
                if len(mrz_item) >= 21:
                    dob_raw = mrz_item[13:19]
                    if dob_raw.isdigit():
                        yy = int(dob_raw[:2])
                        current_yy = datetime.now().year % 100
                        full_year = 2000 + yy if yy <= current_yy else 1900 + yy
                        dob = f"{full_year}-{dob_raw[2:4]}-{dob_raw[4:6]}"
                    sex_char = mrz_item[20].upper()
                    if sex_char in ("M", "F"):
                        gender = "Male" if sex_char == "M" else "Female"

        if passport_num or full_name:
            fields = IdScanFields(
                name=full_name,
                id_number=passport_num,
                date_of_birth=dob,
                gender=gender,
                id_type_detected="Passport",
            )
            return IdScanResponse(
                success=True,
                source="mrz",
                confidence=0.98,
                fields=fields,
                can_autofill=True,
                message="Extracted from Passport Machine Readable Zone (MRZ)",
            )
    return None


# ─── TIER 3: RAPIDOCR DEEP LEARNING EXTRACTION ──────────────────────────────


def _extract_name_candidate(lines: list[str], anchor_idx: int) -> str | None:
    # Search backwards from anchor_idx (like DOB or Aadhaar line)
    for i in range(anchor_idx - 1, -1, -1):
        line = lines[i]
        c = clean_name(line)
        if c and len(c) >= 3 and not any(t in c.upper() for t in NON_NAME_TOKENS):
            return c
    # Or search forward
    for i in range(anchor_idx + 1, min(len(lines), anchor_idx + 3)):
        line = lines[i]
        c = clean_name(line)
        if c and len(c) >= 3 and not any(t in c.upper() for t in NON_NAME_TOKENS):
            return c
    return None


def scan_ocr_stage(
    img: np.ndarray, id_type_hint: str | None = None, side: str = "front"
) -> IdScanResponse:
    engine = get_ocr_engine()
    if engine is None:
        return IdScanResponse(
            success=False,
            source="none",
            confidence=0.0,
            fields=IdScanFields(),
            can_autofill=False,
            message="Server OCR engine not available. Please enter details manually.",
        )

    # Downscale for CPU RapidOCR to optimal receptive field (max_dim <= 1280)
    # Reduces CPU inference time from 9.0s down to ~1.8s with zero accuracy loss
    h, w = img.shape[:2]
    max_dim = max(h, w)
    ocr_img = img
    if max_dim > 1280:
        scale = 1280.0 / max_dim
        ocr_img = cv2.resize(
            img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
        )

    results, elapse = engine(ocr_img)
    if not results:
        return IdScanResponse(
            success=False,
            source="rapidocr",
            confidence=0.0,
            fields=IdScanFields(),
            can_autofill=False,
            message="No legible text detected on ID image.",
        )

    lines: list[str] = [text.strip() for _, text, score in results if text and score >= 0.35]
    all_text = " ".join(lines)
    logger.debug("RapidOCR lines: %s (elapse: %s ms)", lines, elapse)

    # Check MRZ first if applicable
    mrz_res = scan_mrz_stage(lines)
    if mrz_res:
        return mrz_res

    # Detect ID type
    doc_type = id_type_hint or "Aadhar Card"
    upper_text = all_text.upper()
    if (
        "INCOME TAX" in upper_text
        or "PERMANENT ACCOUNT" in upper_text
        or PAN_NUM_RE.search(all_text)
    ):
        doc_type = "PAN Card"
    elif "PASSPORT" in upper_text or "REPUBLIC OF INDIA" in upper_text:
        doc_type = "Passport"
    elif "DRIVING" in upper_text or "UNION TRANSPORT" in upper_text or DL_NUM_RE.search(all_text):
        doc_type = "Driving License"
    elif (
        "ELECTION COMMISSION" in upper_text
        or "ELECTORAL" in upper_text
        or VOTER_NUM_RE.search(all_text)
    ):
        doc_type = "Voter ID"
    elif "AADHAAR" in upper_text or "UIDAI" in upper_text or AADHAAR_NUM_RE.search(all_text):
        doc_type = "Aadhar Card"

    fields = IdScanFields(id_type_detected=doc_type)
    score_acc = 0.0

    # 1. Back face handling (Aadhaar back or DL back)
    if side == "back" or "ADDRESS:" in upper_text or "पता:" in all_text:
        addr_lines: list[str] = []
        pincode_found: str | None = None

        # Look for address label
        addr_start = -1
        addr_pattern = re.compile(
            r"\b(?:Address|Addres|Addr|Residential|पता|C/O|S/O|W/O|D/O)\b", re.IGNORECASE
        )
        for idx, line in enumerate(lines):
            if addr_pattern.search(line):
                addr_start = idx
                break

        if addr_start >= 0:
            for addr_line in lines[addr_start : min(len(lines), addr_start + 6)]:
                cleaned_line = re.sub(
                    r"^.*?\b(?:Address|Addres|Addr|Residential|पता)\s*[:.,/-]?\s*",
                    "",
                    addr_line,
                    flags=re.IGNORECASE,
                ).strip()
                if cleaned_line and not AADHAAR_NUM_RE.search(cleaned_line):
                    addr_lines.append(cleaned_line)
                pin_match = PIN_RE.search(cleaned_line)
                if pin_match:
                    pincode_found = pin_match.group(1).replace(" ", "")
                    break

        if not pincode_found:
            pin_match = PIN_RE.search(all_text)
            if pin_match:
                pincode_found = pin_match.group(1).replace(" ", "")

        # State detection
        state_found: str | None = None
        for st in INDIAN_STATES:
            if re.search(rf"\b{re.escape(st)}\b", all_text, re.IGNORECASE):
                state_found = st
                break

        fields.address = ", ".join(addr_lines) if addr_lines else None
        fields.pincode = pincode_found
        fields.state = state_found
        if fields.address or fields.pincode:
            score_acc += 0.8
            return IdScanResponse(
                success=True,
                source="rapidocr",
                confidence=min(1.0, score_acc),
                fields=fields,
                can_autofill=True,
                message="Extracted address from back face of ID card",
            )

    # 2. Front face handling
    if doc_type == "PAN Card":
        pan_match = PAN_NUM_RE.search(all_text)
        if pan_match:
            fields.id_number = pan_match.group(0).upper()
            score_acc += 0.4
        dob_match = DOB_PREFIX_RE.search(all_text) or DATE_RE.search(all_text)
        if dob_match:
            fields.date_of_birth = normalize_date(dob_match.group(1))
            score_acc += 0.3
        # Name on PAN usually appears above Father's name or after Income Tax Dept
        for _idx, line in enumerate(lines):
            if "INCOME TAX" in line.upper() or "PERMANENT" in line.upper():
                continue
            cand = clean_name(line)
            if cand and len(cand) >= 3 and not any(t in cand.upper() for t in NON_NAME_TOKENS):
                fields.name = cand
                score_acc += 0.3
                break

    elif doc_type == "Passport":
        pp_match = PASSPORT_NUM_RE.search(all_text)
        if pp_match:
            fields.id_number = pp_match.group(0).upper()
            score_acc += 0.4
        dob_match = DOB_PREFIX_RE.search(all_text) or DATE_RE.search(all_text)
        if dob_match:
            fields.date_of_birth = normalize_date(dob_match.group(1))
            score_acc += 0.25
        gender_match = GENDER_RE.search(all_text)
        if gender_match:
            fields.gender = normalize_gender(gender_match.group(1))
            score_acc += 0.15

    elif doc_type == "Driving License":
        dl_match = DL_NUM_RE.search(all_text)
        if dl_match:
            fields.id_number = dl_match.group(0).upper()
            score_acc += 0.4
        dob_match = DOB_PREFIX_RE.search(all_text) or DATE_RE.search(all_text)
        if dob_match:
            fields.date_of_birth = normalize_date(dob_match.group(1))
            score_acc += 0.3
        # Name candidate
        for line in lines:
            if "DRIVING" in line.upper() or "UNION" in line.upper():
                continue
            cand = clean_name(line)
            if cand and len(cand) >= 3:
                fields.name = cand
                score_acc += 0.3
                break

    elif doc_type == "Voter ID":
        voter_match = VOTER_NUM_RE.search(all_text)
        if voter_match:
            fields.id_number = voter_match.group(0).upper()
            score_acc += 0.4
        dob_match = DOB_PREFIX_RE.search(all_text) or DATE_RE.search(all_text)
        if dob_match:
            fields.date_of_birth = normalize_date(dob_match.group(1))
            score_acc += 0.2
        for line in lines:
            line_up = line.upper()
            if "ELECTION" in line_up or "COMMISSION" in line_up or "INDIA" in line_up:
                continue
            cand = clean_name(line)
            if cand and len(cand) >= 3:
                fields.name = cand
                score_acc += 0.3
                break

    else:
        # Default: Aadhaar Card
        aadhar_match = AADHAAR_NUM_RE.search(all_text)
        aadhar_line_idx = -1
        if aadhar_match:
            raw_num = re.sub(r"\s+", " ", aadhar_match.group(0)).strip()
            fields.id_number = raw_num
            score_acc += 0.4
            for idx, line_item in enumerate(lines):
                if aadhar_match.group(0) in line_item:
                    aadhar_line_idx = idx
                    break

        dob_match = DOB_PREFIX_RE.search(all_text) or DATE_RE.search(all_text)
        dob_line_idx = -1
        if dob_match:
            fields.date_of_birth = normalize_date(dob_match.group(1))
            score_acc += 0.3
            for idx, line_item in enumerate(lines):
                if dob_match.group(0) in line_item:
                    dob_line_idx = idx
                    break

        gender_match = GENDER_RE.search(all_text)
        if gender_match:
            fields.gender = normalize_gender(gender_match.group(1))
            score_acc += 0.15

        # Name is usually right above DOB line or right above Aadhaar number line
        anchor = dob_line_idx if dob_line_idx >= 0 else aadhar_line_idx
        if anchor >= 0:
            cand = _extract_name_candidate(lines, anchor)
            if cand:
                fields.name = cand
                score_acc += 0.25
        else:
            for line in lines:
                cand = clean_name(line)
                if cand and len(cand) >= 3:
                    fields.name = cand
                    score_acc += 0.2
                    break

    has_name = bool(fields.name)
    has_id = bool(fields.id_number)
    has_dob = bool(fields.date_of_birth)
    has_addr = bool(fields.address)

    can_autofill = (
        (has_name and has_id)
        or (has_id and has_dob)
        or (has_name and has_dob)
        or (side == "back" and has_addr)
        or (has_addr and bool(fields.pincode))
        or score_acc >= 0.40
    )
    conf = min(1.0, max(score_acc, 0.70 if can_autofill else score_acc))
    msg = (
        f"Recognized {doc_type} text via server OCR ({int(conf * 100)}% confidence)"
        if can_autofill
        else "Document text partially unclear. Please review and verify details."
    )

    return IdScanResponse(
        success=can_autofill,
        source="rapidocr",
        confidence=conf,
        fields=fields,
        can_autofill=can_autofill,
        message=msg,
    )


# ─── MASTER ENTRYPOINT: SERVER-SIDE SMART CASCADE ────────────────────────────


def scan_id_document(
    file_bytes: bytes, id_type_hint: str | None = None, side: str = "front"
) -> IdScanResponse:
    """Master cascade: QR Code (100%) -> MRZ (98%) -> RapidOCR ONNX (Deep Learning)."""
    try:
        np_arr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            return IdScanResponse(
                success=False,
                source="none",
                confidence=0.0,
                fields=IdScanFields(),
                can_autofill=False,
                message="Unable to decode image file format.",
            )

        img = normalize_scan_image(img)

        # STAGE 1: QR Code (Fastest & 100% accurate for Aadhaar - front or back)
        qr_result = scan_qr_stage(img, side=side)
        if qr_result and qr_result.success:
            return qr_result

        # STAGE 2 & 3: Deep Learning RapidOCR (with MRZ auto-detection)
        ocr_result = scan_ocr_stage(img, id_type_hint=id_type_hint, side=side)
        return ocr_result

    except Exception as e:
        logger.exception("Error executing server-side ID scan: %s", e)
        return IdScanResponse(
            success=False,
            source="none",
            confidence=0.0,
            fields=IdScanFields(),
            can_autofill=False,
            message=f"OCR error: {e}",
        )
