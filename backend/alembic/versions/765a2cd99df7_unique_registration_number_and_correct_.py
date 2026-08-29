"""unique_registration_number_and_correct_next_counter

Revision ID: 765a2cd99df7
Revises: 2ced3e1cf0ee
Create Date: 2026-08-29 19:53:19.464776

Two steps:
1. Seed hotel_settings.registration_next_number from the real count of
   existing guest_registrations per hotel so the counter never overlaps
   historic numbers.
2. Add unique constraint (hotel_id, registration_number) on
   guest_registrations so the DB enforces uniqueness going forward.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '765a2cd99df7'
down_revision: Union[str, None] = '2ced3e1cf0ee'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Step 1: Fix registration_next_number for any hotel that already has
    # registrations.  The counter must be > the current max number already
    # issued to avoid overlap.  For hotels with no registrations the counter
    # stays at 1 (set by the previous migration).
    conn.execute(sa.text("""
        UPDATE hotel_settings hs
        SET registration_next_number = sub.max_seq + 1
        FROM (
            SELECT
                gr.hotel_id,
                COALESCE(MAX(
                    CAST(SUBSTRING(gr.registration_number FROM 5) AS INTEGER)
                ), 0) AS max_seq
            FROM guest_registrations gr
            WHERE gr.registration_number ~ '^REG-[0-9]+$'
            GROUP BY gr.hotel_id
        ) sub
        WHERE hs.hotel_id = sub.hotel_id
          AND sub.max_seq >= hs.registration_next_number
    """))

    # Step 2: If there are any duplicate registration numbers (from the old
    # COUNT()-based generator), make them unique before adding the constraint.
    # Strategy: append a suffix -DUP-<rowid> to all but the first occurrence.
    conn.execute(sa.text("""
        UPDATE guest_registrations gr
        SET registration_number = gr.registration_number || '-DUP-' || gr.id::text
        WHERE gr.id IN (
            SELECT id FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY hotel_id, registration_number
                        ORDER BY created_at
                    ) AS rn
                FROM guest_registrations
            ) ranked
            WHERE rn > 1
        )
    """))

    # Step 3: Now it is safe to add the unique constraint.
    op.create_unique_constraint(
        'uq_registration_hotel_number',
        'guest_registrations',
        ['hotel_id', 'registration_number'],
    )


def downgrade() -> None:
    op.drop_constraint('uq_registration_hotel_number', 'guest_registrations', type_='unique')
