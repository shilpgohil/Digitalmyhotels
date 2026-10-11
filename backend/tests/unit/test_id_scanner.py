from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

from app.services.id_scanner import (
    _parse_aadhaar_xml,
    clean_name,
    normalize_date,
    normalize_gender,
    scan_id_document,
    scan_mrz_stage,
    scan_ocr_stage,
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
    assert normalize_gender(None) is None

    # Name cleaning
    assert clean_name("GOHIL SHILP JITENDRAKUMAR") == "Gohil Shilp Jitendrakumar"
    assert clean_name("MR. RAJESH KUMAR") == "Rajesh Kumar"
    assert clean_name("AADHAAR CARD HOLDER") is None


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
    assert "e/112" in (res.address or "")


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
    path = r"C:\Users\BAPS\.gemini\antigravity-ide\brain\037deb20-576b-4c4a-987f-64683db997cc\.user_uploaded\media_1791726464391.jpg"
    if os.path.exists(path):
        with open(path, "rb") as f:
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
