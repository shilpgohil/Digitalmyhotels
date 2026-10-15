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
    assert res.id_number == "652556104777"
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
        assert res.fields.id_number == "652556104777"
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
            assert res.fields.id_number == "652556104777"

