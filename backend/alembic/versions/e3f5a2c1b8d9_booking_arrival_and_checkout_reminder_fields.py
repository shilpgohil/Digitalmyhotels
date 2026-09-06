"""booking: arrival_notified_at + checkout_reminded_at reminder dedup fields

Revision ID: e3f5a2c1b8d9
Revises: d7e1a3c5f2b4
Create Date: 2026-09-06 22:00:00.000000

These two timestamptz columns allow the new reminder sweep services to fire
each notification exactly once per booking:
- arrival_notified_at  : set when the "arriving today" front-desk alert fires
- checkout_reminded_at : set when the "checkout in 2h" reminder fires
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "e3f5a2c1b8d9"
down_revision = "d7e1a3c5f2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("arrival_notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "bookings",
        sa.Column("checkout_reminded_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bookings", "checkout_reminded_at")
    op.drop_column("bookings", "arrival_notified_at")
