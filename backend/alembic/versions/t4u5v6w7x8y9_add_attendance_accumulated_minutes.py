"""Add accumulated_minutes and first_check_in_at to attendance_records.

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-10-08
"""

from alembic import op
import sqlalchemy as sa

revision = "t4u5v6w7x8y9"
down_revision = "s3t4u5v6w7x8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attendance_records",
        sa.Column(
            "accumulated_minutes",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "attendance_records",
        sa.Column(
            "first_check_in_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    # Backfill historical attendance records:
    # 1. Closed shifts calculate duration from check_out_at - check_in_at
    # 2. first_check_in_at defaults to check_in_at
    op.execute(
        """
        UPDATE attendance_records
        SET accumulated_minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60)::integer)
        WHERE check_out_at IS NOT NULL AND check_in_at IS NOT NULL;

        UPDATE attendance_records
        SET first_check_in_at = check_in_at
        WHERE first_check_in_at IS NULL AND check_in_at IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.drop_column("attendance_records", "accumulated_minutes")
    op.drop_column("attendance_records", "first_check_in_at")
