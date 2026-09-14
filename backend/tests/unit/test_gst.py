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


class TestInclusiveMode:
    """Client 09/2026 'GST Included by Hotel': the customer total NEVER
    changes — tax is extracted from within the listed price."""

    def test_total_equals_gross(self) -> None:
        breakup = calculate_gst(Decimal("1120.00"), RATES, inclusive=True)
        assert breakup.total_amount == Decimal("1120.00")
        assert breakup.taxable_amount == Decimal("1000.00")
        assert breakup.total_tax == Decimal("120.00")
        assert breakup.cgst_amount == Decimal("60.00")
        assert breakup.sgst_amount == Decimal("60.00")

    def test_total_exact_even_with_awkward_gross(self) -> None:
        # Whatever the rounding, taxable + tax must reconstruct the gross
        # EXACTLY — the customer pays the listed price, no drift allowed.
        for gross in ("999", "1001", "1234.56", "57"):
            b = calculate_gst(Decimal(gross), RATES, inclusive=True)
            assert b.total_amount == money(Decimal(gross))
            assert b.taxable_amount + b.total_tax == b.total_amount

    def test_interstate_inclusive_uses_igst(self) -> None:
        b = calculate_gst(Decimal("1120.00"), RATES, inclusive=True, is_interstate=True)
        assert b.igst_amount == Decimal("120.00")
        assert b.cgst_amount == Decimal("0.00")
        assert b.total_amount == Decimal("1120.00")

    def test_unregistered_ignores_inclusive_flag(self) -> None:
        # no_gst mode: inclusive flag is irrelevant — zero tax either way.
        b = calculate_gst(Decimal("1000.00"), RATES, inclusive=True, is_registered=False)
        assert b.total_tax == Decimal("0.00")
        assert b.total_amount == Decimal("1000.00")
