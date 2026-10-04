"""Add attendance checkout selfie fields.

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-10-04
"""

from alembic import op
import sqlalchemy as sa

revision = "r2s3t4u5v6w7"
down_revision = "q1r2s3t4u5v6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attendance_records",
        sa.Column(
            "check_out_selfie_key",
            sa.String(length=512),
            nullable=True,
        ),
    )
    op.add_column(
        "attendance_records",
        sa.Column(
            "check_out_selfie_sha256",
            sa.String(length=64),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("attendance_records", "check_out_selfie_sha256")
    op.drop_column("attendance_records", "check_out_selfie_key")
