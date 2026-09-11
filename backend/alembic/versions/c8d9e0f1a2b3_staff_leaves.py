"""Staff leave requests (phase 2 of the staff attendance module).

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-09-12
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "c8d9e0f1a2b3"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_leaves",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "hotel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("hotels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "staff_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("staff_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.Column("leave_type", sa.String(16), nullable=False, server_default="annual"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column(
            "decided_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("to_date >= from_date", name="ck_leave_range"),
    )
    op.create_index("ix_staff_leaves_hotel_id", "staff_leaves", ["hotel_id"])
    op.create_index("ix_staff_leaves_staff_profile_id", "staff_leaves", ["staff_profile_id"])
    op.create_index("ix_staff_leaves_status", "staff_leaves", ["status"])


def downgrade() -> None:
    op.drop_index("ix_staff_leaves_status", table_name="staff_leaves")
    op.drop_index("ix_staff_leaves_staff_profile_id", table_name="staff_leaves")
    op.drop_index("ix_staff_leaves_hotel_id", table_name="staff_leaves")
    op.drop_table("staff_leaves")
