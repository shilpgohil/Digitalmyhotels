from decimal import Decimal

from app.domain.gst import (
    GstRates,
    calculate_gst,
    extract_taxable_from_inclusive,
    money,
)

RATES = GstRates(cgst=Decimal("6"), sgst=Decimal("6"), igst=Decimal("12"), version=3)


class TestIntraState:
    def test_splits_cgst_sgst(self) -> None:
        breakup = calculate_gst(Decimal("1000.00"), RATES)
        assert breakup.cgst_amount == Decimal("60.00")
        assert breakup.sgst_amount == Decimal("60.00")
        assert breakup.igst_amount == Decimal("0.00")
        assert breakup.total_tax == Decimal("120.00")
        assert breakup.total_amount == Decimal("1120.00")
        assert breakup.rates_version == 3

    def test_rounding_half_up(self) -> None:
        # Whole-rupee policy: 6% of 1234.56 = 74.0736 → ₹74 per component;
        # taxable itself rounds to ₹1235 → total = 1235 + 74 + 74 = 1383.
        breakup = calculate_gst(Decimal("1234.56"), RATES)
        assert breakup.cgst_amount == Decimal("74")
        assert breakup.sgst_amount == Decimal("74")
        assert breakup.total_amount == Decimal("1383")

    def test_half_up_boundary(self) -> None:
        # Whole-rupee rounding: .50 rounds up, .49 rounds down.
        assert money(Decimal("200.50")) == Decimal("201")
        assert money(Decimal("200.49")) == Decimal("200")
        assert money(Decimal("10.005")) == Decimal("10")


class TestInterState:
    def test_uses_igst_only(self) -> None:
        breakup = calculate_gst(Decimal("1000.00"), RATES, is_interstate=True)
        assert breakup.igst_amount == Decimal("120.00")
        assert breakup.cgst_amount == Decimal("0.00")
        assert breakup.sgst_amount == Decimal("0.00")
        assert breakup.total_amount == Decimal("1120.00")


class TestUnregistered:
    def test_no_tax_when_unregistered(self) -> None:
        breakup = calculate_gst(Decimal("1000.00"), RATES, is_registered=False)
        assert breakup.total_tax == Decimal("0.00")
        assert breakup.total_amount == Decimal("1000.00")


class TestInclusivePricing:
    def test_extracts_taxable_base(self) -> None:
        taxable = extract_taxable_from_inclusive(Decimal("1120.00"), RATES)
        assert taxable == Decimal("1000.00")

    def test_roundtrip_close(self) -> None:
        taxable = extract_taxable_from_inclusive(Decimal("999.00"), RATES)
        breakup = calculate_gst(taxable, RATES)
        # Whole-rupee rounding: roundtrip may drift by up to ₹2
        # (taxable rounds once, each tax component rounds once more).
        assert abs(breakup.total_amount - Decimal("999.00")) <= Decimal("2")
