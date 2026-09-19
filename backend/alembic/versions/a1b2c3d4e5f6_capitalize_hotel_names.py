"""Capitalize hotel names stored in all-lowercase (e.g. 'rakhi' → 'Rakhi').

Revision ID: a1b2c3d4e5f6
Revises: f5a6b7c8d9e0
Create Date: 2026-09-19

Uses PostgreSQL initcap() which uppercases the first letter of each word.
Only fixes names whose first character is lowercase to avoid mangling
already-correct names like 'Hotel Shilp Gohil'.
"""

from alembic import op


revision = "a1b2c3d4e5f6"
down_revision = "f5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE hotels
        SET name = initcap(name)
        WHERE name ~ '^[a-z]'
        """
    )


def downgrade() -> None:
    # Irreversible — cannot know which names were originally lowercase.
    pass
