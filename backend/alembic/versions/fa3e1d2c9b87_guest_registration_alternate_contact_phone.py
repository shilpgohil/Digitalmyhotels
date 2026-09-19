"""Add alternate_contact_phone to guest_registrations.

Revision ID: fa3e1d2c9b87
Revises: dd48e2f5ab34
Create Date: 2026-09-19

Purpose: Store a booking-specific contact phone for co-guests (family visits,
         phone-changed scenarios) without modifying the guest's master record.
         Nullable — existing rows default to NULL (no data change needed).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "fa3e1d2c9b87"
down_revision: str | None = "a9f3c1e7b820"  # production head (adds payment_mode)
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "guest_registrations",
        sa.Column("alternate_contact_phone", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("guest_registrations", "alternate_contact_phone")
