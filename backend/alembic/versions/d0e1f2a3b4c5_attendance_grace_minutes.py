"""Configurable late-grace for staff attendance.

Revision ID: d0e1f2a3b4c5
Revises: c8d9e0f1a2b3
Create Date: 2026-09-12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "d0e1f2a3b4c5"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column(
            "attendance_grace_minutes",
            sa.Integer(),
            nullable=False,
            server_default="10",
        ),
    )


def downgrade() -> None:
    op.drop_column("hotels", "attendance_grace_minutes")
