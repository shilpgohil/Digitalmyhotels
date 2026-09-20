"""add status_note to rooms

Revision ID: h2i3j4k5l6m7
Revises: g7h8i9j0k1l2
Create Date: 2026-09-20

Stores a staff-supplied reason on each room row so the Room Status page
can show *why* a room is in maintenance or out-of-service without a
separate API call (client request: "show maintenance reason on card").
"""

from alembic import op
import sqlalchemy as sa

revision = "h2i3j4k5l6m7"
down_revision = "g7h8i9j0k1l2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("status_note", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "status_note")
