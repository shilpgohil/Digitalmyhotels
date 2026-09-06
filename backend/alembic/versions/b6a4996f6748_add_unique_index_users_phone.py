"""add partial unique index on users.phone

Revision ID: b6a4996f6748
Revises: ef9d4c3515c7
Create Date: 2026-09-06 19:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b6a4996f6748'
down_revision: Union[str, None] = 'ef9d4c3515c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Phone-first team accounts: staff can log in with phone + password.
    # Partial unique index — enforces uniqueness only for users that have a
    # phone set (column stays nullable, no backfill needed).
    op.create_index(
        'ix_users_phone',
        'users',
        ['phone'],
        unique=True,
        postgresql_where=sa.text('phone IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('ix_users_phone', table_name='users')
