"""Add discount_reason to bookings and backfill from audit logs.

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-10-07
"""

from alembic import op
import sqlalchemy as sa

revision = "s3t4u5v6w7x8"
down_revision = "r2s3t4u5v6w7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column(
            "discount_reason",
            sa.Text(),
            nullable=True,
        ),
    )
    # Backfill historical discount reasons from checkout audit logs if any exist
    op.execute(
        """
        UPDATE bookings b
        SET discount_reason = a.after->>'reason'
        FROM audit_logs a
        WHERE a.entity_type = 'booking'
          AND a.entity_id = b.id::text
          AND a.action = 'stay.checkout_discount'
          AND a.after->>'reason' IS NOT NULL
          AND b.discount_reason IS NULL;
        """
    )


def downgrade() -> None:
    op.drop_column("bookings", "discount_reason")
