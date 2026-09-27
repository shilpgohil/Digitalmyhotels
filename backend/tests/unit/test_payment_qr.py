from decimal import Decimal

from app.services.payment_config import build_upi_uri


def test_build_upi_uri_without_amount() -> None:
    uri = build_upi_uri("hotel@okhdfcbank", "Grand Hotel")
    assert "pa=hotel%40okhdfcbank" in uri
    assert "pn=Grand+Hotel" in uri
    assert "cu=INR" in uri
    assert "mc=5812" in uri
    assert "am=" not in uri


def test_build_upi_uri_with_amount() -> None:
    uri = build_upi_uri("hotel@okhdfcbank", "Grand Hotel", amount=Decimal("1500.00"))
    assert "pa=hotel%40okhdfcbank" in uri
    assert "pn=Grand+Hotel" in uri
    assert "cu=INR" in uri
    assert "mc=5812" in uri
    assert "am=1500.00" in uri


def test_build_upi_uri_with_amount_and_note() -> None:
    uri = build_upi_uri(
        "hotel@okhdfcbank",
        "Grand Hotel",
        amount=Decimal("250.50"),
        note="Room 101 Bill",
    )
    assert "am=250.50" in uri
    assert "tn=Room+101+Bill" in uri


def test_build_upi_uri_with_zero_or_negative_amount() -> None:
    uri_zero = build_upi_uri("hotel@okhdfcbank", "Grand Hotel", amount=Decimal("0.00"))
    assert "am=" not in uri_zero

    uri_neg = build_upi_uri("hotel@okhdfcbank", "Grand Hotel", amount=Decimal("-10.00"))
    assert "am=" not in uri_neg
