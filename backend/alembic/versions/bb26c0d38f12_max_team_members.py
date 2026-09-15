"""hotels.max_team_members — team size cap, default 5 (plan §7.1).

Revision ID: bb26c0d38f12
Revises: aa15b9c27e01
Create Date: 2026-09-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "bb26c0d38f12"
down_revision = "aa15b9c27e01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column(
            "max_team_members",
            sa.Integer(),
            nullable=False,
            server_default="5",
        ),
    )


def downgrade() -> None:
    op.drop_column("hotels", "max_team_members")
