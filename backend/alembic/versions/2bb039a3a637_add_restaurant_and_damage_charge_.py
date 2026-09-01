"""add restaurant and damage charge categories

Revision ID: 2bb039a3a637
Revises: 3098be9b9d72
Create Date: 2026-09-02 01:11:51.092752

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '2bb039a3a637'
down_revision: Union[str, None] = '3098be9b9d72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NEW = (
    "category IN ('food','restaurant','laundry','room_service','extra_bed','minibar',"
    "'transport','damage','other')"
)
_OLD = (
    "category IN ('food','laundry','room_service','extra_bed','minibar','transport','other')"
)


def upgrade() -> None:
    op.drop_constraint("charge_category", "hotel_charges", type_="check")
    op.create_check_constraint("charge_category", "hotel_charges", _NEW)


def downgrade() -> None:
    op.drop_constraint("charge_category", "hotel_charges", type_="check")
    op.create_check_constraint("charge_category", "hotel_charges", _OLD)
