"""add subscription_renewal_requests table

Revision ID: d7e1a3c5f2b4
Revises: c9d2e4f6a8b1
Create Date: 2026-09-06 20:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd7e1a3c5f2b4'
down_revision: Union[str, None] = 'c9d2e4f6a8b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'subscription_renewal_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('hotel_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('requested_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decided_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('pending','approved','rejected')",
            name=op.f('ck_subscription_renewal_requests_renewal_request_status'),
        ),
        sa.ForeignKeyConstraint(
            ['hotel_id'], ['hotels.id'],
            name=op.f('fk_subscription_renewal_requests_hotel_id_hotels'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['plan_id'], ['subscription_plans.id'],
            name=op.f('fk_subscription_renewal_requests_plan_id_subscription_plans'),
        ),
        sa.ForeignKeyConstraint(
            ['requested_by_id'], ['users.id'],
            name=op.f('fk_subscription_renewal_requests_requested_by_id_users'),
            ondelete='SET NULL',
        ),
        sa.ForeignKeyConstraint(
            ['decided_by_id'], ['users.id'],
            name=op.f('fk_subscription_renewal_requests_decided_by_id_users'),
            ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_subscription_renewal_requests')),
    )
    op.create_index(
        op.f('ix_subscription_renewal_requests_hotel_id'),
        'subscription_renewal_requests', ['hotel_id'], unique=False,
    )
    op.create_index(
        op.f('ix_subscription_renewal_requests_status'),
        'subscription_renewal_requests', ['status'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_subscription_renewal_requests_status'),
        table_name='subscription_renewal_requests',
    )
    op.drop_index(
        op.f('ix_subscription_renewal_requests_hotel_id'),
        table_name='subscription_renewal_requests',
    )
    op.drop_table('subscription_renewal_requests')
