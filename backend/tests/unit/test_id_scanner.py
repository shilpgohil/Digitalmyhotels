from __future__ import annotations

import io
import os

import cv2
import numpy as np
from PIL import Image

from app.services.id_scanner import (
    _decode_qr_barcodes,
    _parse_aadhaar_xml,
    clean_name,
    decode_image_bytes,
    normalize_date,
    normalize_gender,
    normalize_scan_image,
    scan_id_document,
    scan_mrz_stage,
)

TEST_IMG_PATH = (
    r"C:\Users\BAPS\.gemini\antigravity-ide\brain"
    r"\037deb20-576b-4c4a-987f-64683db997cc\.user_uploaded\media_1791726464391.jpg"
)


def test_normalization_helpers() -> None:
    # Date normalization
    assert normalize_date("04/12/2000") == "2000-12-04"
    assert normalize_date("04-12-2000") == "2000-12-04"
    assert normalize_date("2000/12/04") == "2000-12-04"
    assert normalize_date("1995") == "1995-01-01"
    assert normalize_date("") is None

    # Gender normalization
    assert normalize_gender("M") == "Male"
    assert normalize_gender("MALE") == "Male"
    assert normalize_gender("F") == "Female"
    assert normalize_gender("FEMALE") == "Female"
    assert normalize_gender("महिला") == "Female"
    assert normalize_gender("T") == "Other"
    assert normalize_gender("TG") == "Other"
    assert normalize_gender("TRANSGENDER") == "Other"
    assert normalize_gender(None) is None

    # Name cleaning
    assert clean_name("GOHIL SHILP JITENDRAKUMAR") == "Gohil Shilp Jitendrakumar"
    assert clean_name("MR. RAJESH KUMAR") == "Rajesh Kumar"
    assert clean_name("AADHAAR CARD HOLDER") is None


def test_normalize_scan_image() -> None:
    import numpy as np

    # Huge 4000x3000 image should be scaled down to max_dim 1600
    huge = np.zeros((4000, 3000, 3), dtype=np.uint8)
    scaled = normalize_scan_image(huge, max_dim=1600, min_dim=900)
    assert max(scaled.shape[:2]) == 1600

    # Small 400x300 image should be scaled up (capped at 2.5x)
    small = np.zeros((300, 400, 3), dtype=np.uint8)
    scaled_small = normalize_scan_image(small, max_dim=1600, min_dim=900)
    assert scaled_small.shape == (750, 1000, 3)

    # Optimal 1200x900 image should remain unchanged
    optimal = np.zeros((900, 1200, 3), dtype=np.uint8)
    scaled_optimal = normalize_scan_image(optimal, max_dim=1600, min_dim=900)
    assert scaled_optimal.shape == (900, 1200, 3)


def test_parse_aadhaar_xml() -> None:
    xml_str = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<PrintLetterBarcodeData uid="652556104777" name="Gohil Shilp Jitendrakumar" '
        'gender="M" dob="04/12/2000" co="S/O: Jitendrakumar" house="e/112" '
        'street="jayant park" loc="adinath nagar" vtc="Ahmedabad City" '
        'dist="Ahmedabad" state="Gujarat" pc="380052"/>'
    )
    res = _parse_aadhaar_xml(xml_str)
    assert res is not None
    assert res.name == "Gohil Shilp Jitendrakumar"
    assert res.id_number in ("652556104777", "6525 5610 4777")
    assert res.date_of_birth == "2000-12-04"
    assert res.gender == "Male"
    assert res.care_of == "S/O: Jitendrakumar"
    assert res.city == "Ahmedabad City"
    assert res.state == "Gujarat"
    assert res.pincode == "380052"
    assert res.address == "e/112, jayant park, adinath nagar"
    assert "S/O" not in (res.address or "")


def test_scan_mrz_stage() -> None:
    lines = [
        "P<INDGOHIL<<SHILP<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
        "Z1234567<4IND9001015M2801012<<<<<<<<<<<<<<<4",
    ]
    res = scan_mrz_stage(lines)
    assert res is not None
    assert res.success is True
    assert res.source == "mrz"
    assert res.fields.name == "Shilp Gohil"
    assert res.fields.id_number == "Z1234567"
    assert res.fields.gender == "Male"
    assert res.fields.date_of_birth == "1990-01-01"


def test_scan_id_document_invalid_bytes() -> None:
    res = scan_id_document(b"not an image file")
    assert res.success is False
    assert res.can_autofill is False
    assert res.source == "none"


def test_scan_id_document_real_image_if_available() -> None:
    if os.path.exists(TEST_IMG_PATH):
        with open(TEST_IMG_PATH, "rb") as f:
            data = f.read()
        res = scan_id_document(data)
        assert res.success is True
        assert res.source == "qr"
        assert res.fields.id_number in ("652556104777", "6525 5610 4777")
        assert res.fields.name == "Gohil Shilp Jitendrakumar"
        assert res.fields.date_of_birth == "2000-12-04"
        assert res.fields.gender == "Male"
        assert res.fields.city == "Ahmedabad City"
        assert res.fields.state == "Gujarat"
        assert res.fields.pincode == "380052"
        assert res.fields.care_of == "S/O: Jitendrakumar"
        assert res.fields.address == "e/112, jayant park, adinath nagar, memnagar"
        assert "S/O" not in (res.fields.address or "")


def test_decode_qr_portrait_gallery_photo() -> None:
    """Verifies that horizontal ID cards embedded inside vertical mobile portrait gallery photos
    with background padding and various phone rotations are correctly decoded via QR.
    """
    if os.path.exists(TEST_IMG_PATH):
        card = cv2.imread(TEST_IMG_PATH)
        ch, cw = card.shape[:2]
        # Simulate mobile portrait capture: phone held vertically, card resting in the middle
        canvas = np.full((int(cw * 1.33), cw, 3), 220, dtype=np.uint8)
        y_off = (canvas.shape[0] - ch) // 2
        canvas[y_off : y_off + ch, :] = card

        # Upright portrait frame
        b = _decode_qr_barcodes(canvas)
        assert len(b) >= 1

        # 90-degree and 180-degree phone rotations
        rot90 = cv2.rotate(canvas, cv2.ROTATE_90_CLOCKWISE)
        assert len(_decode_qr_barcodes(rot90)) >= 1

        rot180 = cv2.rotate(canvas, cv2.ROTATE_180)
        assert len(_decode_qr_barcodes(rot180)) >= 1

        rot270 = cv2.rotate(canvas, cv2.ROTATE_90_COUNTERCLOCKWISE)
        assert len(_decode_qr_barcodes(rot270)) >= 1


def test_decode_image_bytes_exif_orientation() -> None:
    """Verifies that smartphone camera EXIF orientation tags (6=90CW, 8=270CW)
    are respected by decode_image_bytes and allow scan_id_document to decode QR codes.
    """
    # Invalid bytes
    assert decode_image_bytes(b"invalid bytes") is None

    # Test real card with EXIF orientations if available
    if os.path.exists(TEST_IMG_PATH):
        base_img = Image.open(TEST_IMG_PATH)
        for orient, rot_action in [
            (6, base_img.rotate(-90, expand=True)),  # Smartphone saved sensor landscape, EXIF=6
            (8, base_img.rotate(90, expand=True)),   # Smartphone saved sensor landscape, EXIF=8
        ]:
            exif_dict = rot_action.getexif()
            exif_dict[0x0112] = orient  # 0x0112 is EXIF Orientation tag
            buf = io.BytesIO()
            rot_action.save(buf, format="JPEG", exif=exif_dict)
            file_bytes = buf.getvalue()

            res = scan_id_document(file_bytes)
            assert res.success is True
            assert res.source == "qr"
            assert res.fields.id_number in ("652556104777", "6525 5610 4777")


def test_scan_id_document_qr_only() -> None:
    """Verifies that qr_only=True returns immediately when no QR code is found
    without executing heavy CPU OCR fallback.
    """
    # Create image with no QR code (e.g. front face of a PVC card with text only)
    blank_img = np.full((600, 900, 3), 255, dtype=np.uint8)
    cv2.putText(
        blank_img,
        "GOVERNMENT OF INDIA",
        (50, 100),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 0, 0),
        2,
    )
    cv2.putText(
        blank_img,
        "Shilp Gohil",
        (50, 200),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 0, 0),
        2,
    )
    cv2.putText(
        blank_img,
        "DOB: 04/12/2000",
        (50, 300),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 0, 0),
        2,
    )
    cv2.putText(
        blank_img,
        "6525 5610 4777",
        (50, 400),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 0, 0),
        2,
    )
    _, buf = cv2.imencode(".png", blank_img)
    img_bytes = buf.tobytes()

    # Fast probe: should return in milliseconds with success=False, source="none"
    res = scan_id_document(img_bytes, qr_only=True)
    assert res.success is False
    assert res.source == "none"
    assert res.confidence == 0.0
    assert "No QR code found" in res.message

    # When TEST_IMG_PATH is present (has QR), qr_only=True should successfully decode it
    if os.path.exists(TEST_IMG_PATH):
        with open(TEST_IMG_PATH, "rb") as f:
            qr_bytes = f.read()
        res_qr = scan_id_document(qr_bytes, qr_only=True)
        assert res_qr.success is True
        assert res_qr.source == "qr"
        assert res_qr.fields.id_number in ("652556104777", "6525 5610 4777")


def test_scan_v5_secure_qr_back_face() -> None:
    """Verifies that modern UIDAI V5 Secure QR codes on the back face of PVC smart cards
    are decoded with 100% digital accuracy and physical address is cleanly isolated from care_of.
    """
    v5_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "main documents",
        "adhaar cards",
        "fe791cef-e088-4284-9700-05cf31f971ee.jpg",
    )
    if os.path.exists(v5_path):
        with open(v5_path, "rb") as f:
            data = f.read()
        res = scan_id_document(data, side="back", qr_only=True)
        assert res.success is True
        assert res.source == "qr"
        assert res.fields.name == "Bijendra Singh Meena"
        assert res.fields.date_of_birth == "1989-07-01"
        assert res.fields.gender == "Male"
        assert res.fields.care_of == "S/O: Mangi Lal Meena"
        assert "S/O" not in (res.fields.address or "")
        assert res.fields.pincode == "476224"
        assert res.fields.city == "Kailaras"
        assert res.fields.state == "Madhya Pradesh"
        assert res.fields.id_number in ("7192", "7374 7366 7192", "•••• •••• 7192")


def test_scan_square_eaadhaar_slip_format() -> None:
    """Verifies that non-standard square or unevenly proportioned e-Aadhaar slips
    with bottom-mounted QR codes are detected and decoded reliably.
    """
    import cv2
    v5_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "main documents",
        "adhaar cards",
        "fe791cef-e088-4284-9700-05cf31f971ee.jpg",
    )
    if os.path.exists(v5_path):
        card = cv2.imread(v5_path)
        assert card is not None
        ch, cw = card.shape[:2]
        # Create a square 1:1 canvas representing an e-Aadhaar slip or cut letter
        dim = max(ch, cw) + 300
        square_canvas = np.full((dim, dim, 3), 255, dtype=np.uint8)
        # Position card towards the bottom half of the square canvas
        y_offset = dim - ch - 50
        x_offset = (dim - cw) // 2
        square_canvas[y_offset : y_offset + ch, x_offset : x_offset + cw] = card

        _, enc = cv2.imencode(".jpg", square_canvas)
        res = scan_id_document(enc.tobytes(), side="back", qr_only=True)
        assert res.success is True
        assert res.source == "qr"
        assert res.fields.name == "Bijendra Singh Meena"
        assert res.fields.pincode == "476224"


def test_scan_user_eaadhaar_attached_card() -> None:
    """Verifies that the user's uploaded non-standard ratio (1.31) e-Aadhaar paper cut slip
    with bottom-right mounted QR code is decoded with full digital fidelity and 12-digit UID.
    """
    front_path = (
        r"C:\Users\BAPS\.gemini\antigravity\brain"
        r"\82b32637-67ef-4a11-b6d8-4bfff4052599\.user_uploaded\media_1793183439906_75e3c1f4.jpg"
    )
    back_path = (
        r"C:\Users\BAPS\.gemini\antigravity\brain"
        r"\82b32637-67ef-4a11-b6d8-4bfff4052599\.user_uploaded\media_1793183436007_f466d8d8.jpg"
    )

    if os.path.exists(front_path):
        with open(front_path, "rb") as f:
            front_bytes = f.read()

        # Front fast QR probe
        res_qr = scan_id_document(front_bytes, side="front", qr_only=True)
        assert res_qr.success is True
        assert res_qr.source == "qr"
        assert "Manav" in (res_qr.fields.name or "")
        assert res_qr.fields.date_of_birth in ("2012-08-24", "2012-01-01")
        assert res_qr.fields.gender == "Male"
        assert res_qr.fields.state is None  # Corrupted state bytes "izA Xade" strictly filtered out

        # Front full scan recovers the QR payload
        res_full = scan_id_document(front_bytes, side="front", qr_only=False)
        assert res_full.success is True
        assert "Manav" in (res_full.fields.name or "")

    if os.path.exists(back_path):
        with open(back_path, "rb") as f:
            back_bytes = f.read()

        # Back face has no QR code: qr_only=True returns fast non-detection
        res_back_qr = scan_id_document(back_bytes, side="back", qr_only=True)
        assert res_back_qr.success is False
        assert "No QR code found" in res_back_qr.message

        # When qr_only=False, server-side text fusion extracts the printed address and UID
        res_back_full = scan_id_document(back_bytes, side="back", qr_only=False)
        assert res_back_full.success is True
        assert res_back_full.fields.id_number in ("5424 9071 2078", "542490712078")



