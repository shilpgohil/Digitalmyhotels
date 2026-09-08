"""extend payment methods with credit_card / debit_card

Revision ID: b4d7f2a9c1e6
Revises: a8c2e5f1d9b7
Create Date: 2026-09-09

Client 9-08 item 14: support Cash, UPI, Credit Card, Debit Card, Net Banking
(stored as bank_transfer) and Other consistently at check-in and checkout.
Legacy 'card' rows are preserved — the value stays valid, the UI just no
longer offers it for new payments.
"""

from __future__ import annotations

from alembic import op

revision = "b4d7f2a9c1e6"
down_revision = "a8c2e5f1d9b7"
branch_labels = None
depends_on = None

_PAYMENT_METHODS = "('cash','upi','card','credit_card','debit_card','bank_transfer','other')"


def upgrade() -> None:
    # Idempotent: DROP IF EXISTS + re-ADD with the extended set.
    op.execute("ALTER TABLE payments DROP CONSTRAINT IF EXISTS payment_method")
    op.execute(
        f"ALTER TABLE payments ADD CONSTRAINT payment_method"
        f" CHECK (method IN {_PAYMENT_METHODS})"
    )
    op.execute("ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expense_payment_method")
    op.execute(
        f"ALTER TABLE expenses ADD CONSTRAINT expense_payment_method"
        f" CHECK (payment_method IN {_PAYMENT_METHODS})"
    )


def downgrade() -> None:
    # Restore the previous narrower checks (only safe if no new-method rows).
    op.execute("ALTER TABLE payments DROP CONSTRAINT IF EXISTS payment_method")
    op.execute(
        "ALTER TABLE payments ADD CONSTRAINT payment_method"
        " CHECK (method IN ('cash','upi','card','bank_transfer','other'))"
    )
    op.execute("ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expense_payment_method")
    op.execute(
        "ALTER TABLE expenses ADD CONSTRAINT expense_payment_method"
        " CHECK (payment_method IN ('cash','upi','card','bank_transfer','other'))"
    )
