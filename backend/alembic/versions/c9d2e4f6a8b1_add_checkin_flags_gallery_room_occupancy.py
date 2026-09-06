"""add check-in collection flags, hotel gallery images, room occupancy

Revision ID: c9d2e4f6a8b1
Revises: b6a4996f6748
Create Date: 2026-09-06 19:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c9d2e4f6a8b1'
down_revision: Union[str, None] = 'b6a4996f6748'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Per-hotel check-in form flags (Edit Hotel — Emergency & Vehicle toggles).
    #    nullable -> backfill true -> non-nullable (style of a6254667b789).
    op.add_column(
        'hotel_settings',
        sa.Column('collect_emergency_contact', sa.Boolean(), nullable=True),
    )
    op.add_column(
        'hotel_settings',
        sa.Column('collect_vehicle_details', sa.Boolean(), nullable=True),
    )
    op.execute(
        "UPDATE hotel_settings SET collect_emergency_contact = TRUE, "
        "collect_vehicle_details = TRUE"
    )
    op.alter_column('hotel_settings', 'collect_emergency_contact', nullable=False)
    op.alter_column('hotel_settings', 'collect_vehicle_details', nullable=False)

    # 2. Per-room occupancy limits (Edit Hotel — Room Inventory Setup).
    #    Nullable — existing rooms fall back to the room type's max_occupancy.
    op.add_column('rooms', sa.Column('max_adults', sa.Integer(), nullable=True))
    op.add_column('rooms', sa.Column('max_children', sa.Integer(), nullable=True))

    # 3. Property gallery (max 5 photos per hotel, one per position slot).
    op.create_table(
        'hotel_images',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('hotel_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('object_key', sa.String(length=512), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ['hotel_id'], ['hotels.id'],
            name=op.f('fk_hotel_images_hotel_id_hotels'),
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_hotel_images')),
        sa.UniqueConstraint(
            'hotel_id', 'position', name='uq_hotel_image_hotel_position'
        ),
    )
    op.create_index(
        op.f('ix_hotel_images_hotel_id'), 'hotel_images', ['hotel_id'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_hotel_images_hotel_id'), table_name='hotel_images')
    op.drop_table('hotel_images')
    op.drop_column('rooms', 'max_children')
    op.drop_column('rooms', 'max_adults')
    op.drop_column('hotel_settings', 'collect_vehicle_details')
    op.drop_column('hotel_settings', 'collect_emergency_contact')
