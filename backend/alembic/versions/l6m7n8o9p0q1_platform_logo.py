"""Add platform_logo_object_key to platform_config.

Stores the B2 object key of the DigitalMyHotels brand logo that gets
composited in the centre of the platform subscription payment QR code.
The SA uploads the logo via the Settings page.

Revision ID: l6m7n8o9p0q1
Revises: k5l6m7n8o9p0
Create Date: 2026-09-21
"""

from alembic import op
import sqlalchemy as sa

revision = "l6m7n8o9p0q1"
down_revision = "k5l6m7n8o9p0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_config",
        sa.Column("platform_logo_object_key", sa.String(512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("platform_config", "platform_logo_object_key")
