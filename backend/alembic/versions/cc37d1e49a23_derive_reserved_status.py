"""Room-status redesign: 'reserved' is derived, not stored.

Converts every stored 'reserved' room to 'available'. Reservation state is
now derived at read time from confirmed bookings (arriving_today /
next_booking on the rooms list), so the stored flag is obsolete. Truthful
because double-booking safety always lived in the booking-overlap check,
never in room.status.

Revision ID: cc37d1e49a23
Revises: bb26c0d38f12
Create Date: 2026-09-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "cc37d1e49a23"
down_revision: str | None = "bb26c0d38f12"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE rooms SET status = 'available' WHERE status = 'reserved'")


def downgrade() -> None:
    # Irreversible data migration: the stored flag cannot be reconstructed
    # (it was drifting anyway). Rooms stay 'available'; reservation state is
    # re-derived from bookings, so nothing is lost.
    pass
