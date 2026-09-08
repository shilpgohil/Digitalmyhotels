"""per-user notification read receipts

Revision ID: a8c2e5f1d9b7
Revises: f6a1d4e2c7b3
Create Date: 2026-09-09

Client 9-08 items 2/35: hotel-wide notifications must track read state per
user — one receptionist reading an alert must not clear it for the owner.
"""

from __future__ import annotations

from alembic import op

revision = "a8c2e5f1d9b7"
down_revision = "f6a1d4e2c7b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent — safe on partial deploys.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_reads (
            id UUID PRIMARY KEY,
            notification_id UUID NOT NULL
                REFERENCES notifications(id) ON DELETE CASCADE,
            user_id UUID NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
            read_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_read_user"
        " ON notification_reads (notification_id, user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notification_reads_notification_id"
        " ON notification_reads (notification_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notification_reads_user_id"
        " ON notification_reads (user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notification_reads")
