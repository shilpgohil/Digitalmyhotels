"""booking guest_type and per-booking times

Revision ID: 8a8183198d71
Revises: a6254667b789
Create Date: 2026-09-02 00:55:17.367651

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8a8183198d71'
down_revision: Union[str, None] = 'a6254667b789'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("guest_type", sa.String(length=32), nullable=True))
    op.add_column("bookings", sa.Column("check_in_time", sa.String(length=5), nullable=True))
    op.add_column("bookings", sa.Column("check_out_time", sa.String(length=5), nullable=True))


def downgrade() -> None:
    op.drop_column("bookings", "check_out_time")
    op.drop_column("bookings", "check_in_time")
    op.drop_column("bookings", "guest_type")
