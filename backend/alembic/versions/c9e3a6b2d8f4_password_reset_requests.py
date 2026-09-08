"""hierarchical password reset requests

Revision ID: c9e3a6b2d8f4
Revises: b4d7f2a9c1e6
Create Date: 2026-09-09

Client 9-08 item 34: staff ask their hotel administrator; the hotel
owner/administrator asks the platform Super Admin. Requests are stored so
the right audience sees them and resolutions are tracked.
"""

from __future__ import annotations

from alembic import op

revision = "c9e3a6b2d8f4"
down_revision = "b4d7f2a9c1e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS password_reset_requests (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
            audience VARCHAR(16) NOT NULL
                CONSTRAINT pwreq_audience CHECK (audience IN ('hotel_admin','super_admin')),
            status VARCHAR(16) NOT NULL DEFAULT 'pending'
                CONSTRAINT pwreq_status CHECK (status IN ('pending','completed','dismissed')),
            resolved_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
            resolved_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_pwreq_pending"
        " ON password_reset_requests (audience, status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_password_reset_requests_user_id"
        " ON password_reset_requests (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_password_reset_requests_hotel_id"
        " ON password_reset_requests (hotel_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS password_reset_requests")
