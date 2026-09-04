"""Centralized GST calculation engine.

All tax math in the product flows through this module — never duplicate
GST rules in routes, services or the frontend. Amounts use Decimal with
half-up rounding to 2 places (standard Indian invoice rounding).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

# Client requirement (2026-09-04): all monetary amounts are WHOLE RUPEES,
# system-wide (stored values included) — ₹200.49 → 200, ₹200.50 → 201.
# DB columns remain Numeric(12,2); whole-rupee values store cleanly.
WHOLE_RUPEE = Decimal("1")


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(WHOLE_RUPEE, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class GstRates:
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    version: int = 1


@dataclass(frozen=True, slots=True)
class GstBreakup:
    taxable_amount: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    total_tax: Decimal
    total_amount: Decimal
    is_interstate: bool
    rates_version: int


def calculate_gst(
    taxable_amount: Decimal,
    rates: GstRates,
    *,
    is_interstate: bool = False,
    is_registered: bool = True,
) -> GstBreakup:
    """Compute the GST breakup for a taxable amount.

    Intra-state: CGST + SGST. Inter-state: IGST. Unregistered hotels
    charge no GST.
    """
    taxable = money(taxable_amount)
    if not is_registered:
        return GstBreakup(
            taxable_amount=taxable,
            cgst_amount=Decimal("0.00"),
            sgst_amount=Decimal("0.00"),
            igst_amount=Decimal("0.00"),
            total_tax=Decimal("0.00"),
            total_amount=taxable,
            is_interstate=is_interstate,
            rates_version=rates.version,
        )

    if is_interstate:
        igst = money(taxable * rates.igst / Decimal("100"))
        cgst = sgst = Decimal("0.00")
    else:
        cgst = money(taxable * rates.cgst / Decimal("100"))
        sgst = money(taxable * rates.sgst / Decimal("100"))
        igst = Decimal("0.00")

    total_tax = money(cgst + sgst + igst)
    return GstBreakup(
        taxable_amount=taxable,
        cgst_amount=cgst,
        sgst_amount=sgst,
        igst_amount=igst,
        total_tax=total_tax,
        total_amount=money(taxable + total_tax),
        is_interstate=is_interstate,
        rates_version=rates.version,
    )


def extract_taxable_from_inclusive(
    gross_amount: Decimal, rates: GstRates, *, is_interstate: bool = False
) -> Decimal:
    """For tax-inclusive pricing: derive the taxable base from a gross price."""
    gross = money(gross_amount)
    rate = rates.igst if is_interstate else (rates.cgst + rates.sgst)
    divisor = Decimal("1") + (rate / Decimal("100"))
    return money(gross / divisor)
