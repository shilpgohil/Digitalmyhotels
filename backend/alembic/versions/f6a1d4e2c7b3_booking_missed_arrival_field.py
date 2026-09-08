"""booking missed-arrival notification field

Revision ID: f6a1d4e2c7b3
Revises: e3f5a2c1b8d9
Create Date: 2026-09-09

Client 9-08 item 23: after a missed scheduled arrival plus the two-hour
grace, Front Desk gets ONE notification; the room is only released by a
manual No-show/Cancel action. This column dedupes the sweep.
"""

from __future__ import annotations

from alembic import op

revision = "f6a1d4e2c7b3"
down_revision = "e3f5a2c1b8d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent — safe whether the column already exists (partial deploy)
    # or is brand new.
    op.execute(
        "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS"
        " missed_arrival_notified_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE bookings DROP COLUMN IF EXISTS missed_arrival_notified_at")
