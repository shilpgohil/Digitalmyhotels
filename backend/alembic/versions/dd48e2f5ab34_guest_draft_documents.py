"""Draft-stage guest document tracking (check-in draft photo persistence).

Revision ID: dd48e2f5ab34
Revises: cc37d1e49a23
Create Date: 2026-09-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "dd48e2f5ab34"
down_revision: str | None = "cc37d1e49a23"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "guest_draft_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "hotel_id",
            UUID(as_uuid=True),
            sa.ForeignKey("hotels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_key", sa.String(512), nullable=False, unique=True),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_guest_draft_documents_hotel_id", "guest_draft_documents", ["hotel_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_guest_draft_documents_hotel_id", table_name="guest_draft_documents")
    op.drop_table("guest_draft_documents")
