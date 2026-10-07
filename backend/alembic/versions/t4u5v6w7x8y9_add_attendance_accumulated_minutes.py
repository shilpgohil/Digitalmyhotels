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
    # ADD COLUMN IF NOT EXISTS — idempotent: safe whether the column is already
    # there (e.g. from a previous failed Render deploy) or brand-new.
    # Single statement per op.execute for asyncpg compatibility.
    op.execute(
        "ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS "
        "accumulated_minutes INTEGER NOT NULL DEFAULT 0"
    )
    op.execute(
        "ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS "
        "first_check_in_at TIMESTAMPTZ"
    )

    # Backfill historical attendance records:
    # 1. Closed shifts calculate duration from check_out_at - check_in_at
    op.execute(
        """
        UPDATE attendance_records
        SET accumulated_minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60)::integer)
        WHERE check_out_at IS NOT NULL AND check_in_at IS NOT NULL
        """
    )

    # 2. first_check_in_at defaults to check_in_at
    op.execute(
        """
        UPDATE attendance_records
        SET first_check_in_at = check_in_at
        WHERE first_check_in_at IS NULL AND check_in_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE attendance_records DROP COLUMN IF EXISTS first_check_in_at")
    op.execute("ALTER TABLE attendance_records DROP COLUMN IF EXISTS accumulated_minutes")
