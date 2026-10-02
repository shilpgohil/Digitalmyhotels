"""Add attendance selfie archival fields and retention days.

Revision ID: o9p0q1r2s3t4
Revises: n8o9p0q1r2s3
Create Date: 2026-10-02
"""

from alembic import op
import sqlalchemy as sa

revision = "o9p0q1r2s3t4"
down_revision = "n8o9p0q1r2s3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attendance_records",
        sa.Column("check_in_selfie_sha256", sa.String(64), nullable=True),
    )
    op.add_column(
        "attendance_records",
        sa.Column("selfie_flushed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "hotel_settings",
        sa.Column(
            "attendance_selfie_retention_days",
            sa.Integer(),
            nullable=False,
            server_default="30",
        ),
    )


def downgrade() -> None:
    op.drop_column("hotel_settings", "attendance_selfie_retention_days")
    op.drop_column("attendance_records", "selfie_flushed_at")
    op.drop_column("attendance_records", "check_in_selfie_sha256")
