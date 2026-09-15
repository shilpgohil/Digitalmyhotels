"""hotel_settings.show_powered_by — invoice branding toggle (plan §3.8).

Revision ID: aa15b9c27e01
Revises: d0e1f2a3b4c5
Create Date: 2026-09-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "aa15b9c27e01"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotel_settings",
        sa.Column(
            "show_powered_by",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("hotel_settings", "show_powered_by")
