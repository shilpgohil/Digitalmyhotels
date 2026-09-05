"""clear_must_reset_password_for_all_users

Revision ID: ef9d4c3515c7
Revises: 95c1dcc60bfe
Create Date: 2026-09-05 17:01:40.691886

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'ef9d4c3515c7'
down_revision: Union[str, None] = '95c1dcc60bfe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Clear must_reset_password for all users so no one is locked out after the
    # server-side enforcement (which was reverted) accidentally blocked access.
    # This is a safe one-time data fix — the flag only applies to temp-password
    # invited users, and they will need to reset via the normal flow.
    op.execute("UPDATE users SET must_reset_password = FALSE WHERE must_reset_password = TRUE")


def downgrade() -> None:
    pass  # Cannot meaningfully reverse a data wipe
