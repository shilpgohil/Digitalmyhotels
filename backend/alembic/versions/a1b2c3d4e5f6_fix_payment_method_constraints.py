"""fix payment method constraints — drop the ORIGINAL prefixed checks

Root-cause repair (client 09/2026 bug: "Could not save expense" with
Credit/Debit Card, and checkout failing with card methods):

The initial schema (9332942844b7) created the payment-method checks WITH the
naming-convention prefix:
    ck_payments_payment_method        CHECK (method IN ('cash','upi'))
    ck_expenses_expense_payment_method CHECK (payment_method IN ('cash','upi'))

Migration b4d7f2a9c1e6 then dropped the UNPREFIXED names ('payment_method' /
'expense_payment_method') — a silent no-op because of IF EXISTS — and added
new, extended constraints alongside. Result: BOTH constraints active, and the
old cash/upi-only check still rejected credit_card / debit_card /
bank_transfer / other at the database level.

This migration drops EVERY name variant on both tables and re-adds a single
canonical extended constraint. Fully idempotent.

Revision ID: a1b2c3d4e5f6
Revises: f2e3d4c5b6a7
Create Date: 2026-09-11
"""

from __future__ import annotations

from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "f2e3d4c5b6a7"
branch_labels = None
depends_on = None

_PAYMENT_METHODS = "('cash','upi','card','credit_card','debit_card','bank_transfer','other')"


def upgrade() -> None:
    # payments.method — drop both possible constraint names, re-add canonical.
    op.execute("ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_payment_method")
    op.execute("ALTER TABLE payments DROP CONSTRAINT IF EXISTS payment_method")
    op.execute(
        f"ALTER TABLE payments ADD CONSTRAINT payment_method"
        f" CHECK (method IN {_PAYMENT_METHODS})"
    )

    # expenses.payment_method — same treatment.
    op.execute("ALTER TABLE expenses DROP CONSTRAINT IF EXISTS ck_expenses_expense_payment_method")
    op.execute("ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expense_payment_method")
    op.execute(
        f"ALTER TABLE expenses ADD CONSTRAINT expense_payment_method"
        f" CHECK (payment_method IN {_PAYMENT_METHODS})"
    )


def downgrade() -> None:
    # Keep the extended set — narrowing would break rows already written with
    # the new methods. Downgrade is a no-op by design.
    pass
