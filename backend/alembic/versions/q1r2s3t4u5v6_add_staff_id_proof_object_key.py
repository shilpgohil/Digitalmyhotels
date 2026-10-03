"""Add id_proof_object_key to staff_profiles.

Revision ID: q1r2s3t4u5v6
Revises: p0q1r2s3t4u5
Create Date: 2026-10-03
"""

from alembic import op
import sqlalchemy as sa

revision = "q1r2s3t4u5v6"
down_revision = "p0q1r2s3t4u5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "staff_profiles",
        sa.Column(
            "id_proof_object_key",
            sa.String(length=512),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("staff_profiles", "id_proof_object_key")
