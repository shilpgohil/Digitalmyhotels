"""data integrity: indexes + CheckConstraints for guest_type, source, full_name

Revision ID: d2f4b8a1c6e9
Revises: c9e3a6b2d8f4
Create Date: 2026-09-09

- guest_type and source CheckConstraints on bookings (data integrity)
- lower(full_name) functional index on guests (ILIKE search performance)
All operations are idempotent so they are safe on partial deploys.

Constraint names follow the SQLAlchemy naming convention
(ck_%(table_name)s_%(constraint_name)s) so `alembic check` stays green.
"""

from __future__ import annotations

from alembic import op

revision = "d2f4b8a1c6e9"
down_revision = "c9e3a6b2d8f4"
branch_labels = None
depends_on = None

# Live UI values (check-in + advance-booking forms). Title-case leftovers
# from an earlier draft constraint are normalized before the CHECK is added.
_GUEST_TYPES = "('business','personal','family','group','other')"


def upgrade() -> None:
    # ── Booking source CHECK ──────────────────────────────────────────────
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_source")
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS ck_bookings_booking_source")
    op.execute(
        "ALTER TABLE bookings ADD CONSTRAINT ck_bookings_booking_source"
        " CHECK (source IN ('walk_in','advance','online','phone','other'))"
    )

    # ── Booking guest_type CHECK ──────────────────────────────────────────
    # Normalize any Title-Case / synonym leftovers to the live lowercase set.
    op.execute("UPDATE bookings SET guest_type = lower(guest_type) WHERE guest_type IS NOT NULL")
    op.execute(
        "UPDATE bookings SET guest_type = CASE guest_type"
        " WHEN 'leisure' THEN 'personal'"
        " WHEN 'medical' THEN 'other'"
        " WHEN 'wedding' THEN 'other'"
        " ELSE guest_type END"
        " WHERE guest_type IS NOT NULL"
    )
    op.execute(
        "UPDATE bookings SET guest_type = 'other'"
        " WHERE guest_type IS NOT NULL"
        f"   AND guest_type NOT IN {_GUEST_TYPES}"
    )
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_guest_type")
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS ck_bookings_booking_guest_type")
    op.execute(
        "ALTER TABLE bookings ADD CONSTRAINT ck_bookings_booking_guest_type CHECK ("
        f"guest_type IS NULL OR guest_type IN {_GUEST_TYPES})"
    )

    # ── Functional lowercase index on guests.full_name ────────────────────
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_guests_hotel_name_lower"
        " ON guests (hotel_id, lower(full_name))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_source")
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS ck_bookings_booking_source")
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_guest_type")
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS ck_bookings_booking_guest_type")
    op.execute("DROP INDEX IF EXISTS ix_guests_hotel_name_lower")
