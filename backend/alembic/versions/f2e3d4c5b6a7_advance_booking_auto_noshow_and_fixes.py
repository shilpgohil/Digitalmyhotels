"""Add no_show_auto_at to bookings; expense pending_amount support

Revision ID: f2e3d4c5b6a7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-11

Changes:
  - bookings.no_show_auto_at (TIMESTAMPTZ, nullable) — set by the background
    sweep when a confirmed advance booking is auto-marked no_show after 24h.
    Distinguishes automated no-show from manual staff action.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "f2e3d4c5b6a7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("no_show_auto_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bookings", "no_show_auto_at")
