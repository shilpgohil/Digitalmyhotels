"""access_mode three-value enforcement: checkin_only | checkin_expense | full.

Revision ID: f5a6b7c8d9e0
Revises: c8d1e2f3a4b5
Create Date: 2026-09-19

Adds a CHECK constraint so the DB rejects any invalid access_mode values.
The third mode 'checkin_expense' sits between checkin_only and full:
  checkin_only     → check-in/out only (no expenses, no staff)
  checkin_expense  → check-in + all financial features (no staff/attendance)
  full             → everything, incl. staff management + daily attendance

Existing rows are already 'full' or 'checkin_only' — both valid. No data
migration needed.
"""

import sqlalchemy as sa
from alembic import op


revision = "f5a6b7c8d9e0"
down_revision = "c8d1e2f3a4b5"
branch_labels = None
depends_on = None

# Valid values for the access_mode column (ordered by feature breadth).
_VALID = ("checkin_only", "checkin_expense", "full")
_CHECK_NAME = "ck_hotel_settings_access_mode"


def upgrade() -> None:
    # Update the model comment to reflect 3 values.
    op.execute(
        "COMMENT ON COLUMN hotel_settings.access_mode IS "
        "'checkin_only | checkin_expense | full'"
    )
    # Add a CHECK constraint to prevent invalid values from being stored.
    op.create_check_constraint(
        _CHECK_NAME,
        "hotel_settings",
        sa.text(f"access_mode IN {_VALID}"),
    )


def downgrade() -> None:
    op.drop_constraint(_CHECK_NAME, "hotel_settings", type_="check")
