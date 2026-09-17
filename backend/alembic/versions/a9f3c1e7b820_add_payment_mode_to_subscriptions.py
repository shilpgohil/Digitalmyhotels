"""add payment_mode to subscriptions

Revision ID: a9f3c1e7b820
Revises: dd48e2f5ab34
Create Date: 2026-09-18 01:38:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9f3c1e7b820"
down_revision: Union[str, None] = "dd48e2f5ab34"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add nullable payment_mode column to subscriptions.
    # Nullable so existing rows are unaffected (shown as "\u2014" in the UI).
    # Allowed values mirror the reference image payment modes.
    op.add_column(
        "subscriptions",
        sa.Column("payment_mode", sa.String(length=32), nullable=True),
    )
    op.create_check_constraint(
        "subscription_payment_mode",
        "subscriptions",
        "payment_mode IN ('cash','upi','credit_card','debit_card','other') "
        "OR payment_mode IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "subscription_payment_mode", "subscriptions", type_="check"
    )
    op.drop_column("subscriptions", "payment_mode")
