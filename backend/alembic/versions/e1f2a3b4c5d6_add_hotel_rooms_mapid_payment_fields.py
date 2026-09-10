"""Add total_rooms, map_id to hotels; merchant_name, payment_url to hotel_payment_config

Revision ID: e1f2a3b4c5d6
Revises: d2f4b8a1c6e9
Create Date: 2026-09-09

Adds:
  - hotels.total_rooms (INTEGER, nullable) — declared total room count
  - hotels.map_id (VARCHAR(255), nullable) — Google Maps embed/place ID
  - hotel_payment_config.merchant_name (VARCHAR(200), nullable)
  - hotel_payment_config.payment_url (VARCHAR(1024), nullable)
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "e1f2a3b4c5d6"
down_revision = "d2f4b8a1c6e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # hotels table
    op.add_column("hotels", sa.Column("total_rooms", sa.Integer(), nullable=True))
    op.add_column("hotels", sa.Column("map_id", sa.String(255), nullable=True))

    # hotel_payment_config table
    op.add_column(
        "hotel_payment_config",
        sa.Column("merchant_name", sa.String(200), nullable=True),
    )
    op.add_column(
        "hotel_payment_config",
        sa.Column("payment_url", sa.String(1024), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("hotel_payment_config", "payment_url")
    op.drop_column("hotel_payment_config", "merchant_name")
    op.drop_column("hotels", "map_id")
    op.drop_column("hotels", "total_rooms")
