"""Capitalize existing user full_names stored in all-lowercase.

Revision ID: c8d1e2f3a4b5
Revises: fa3e1d2c9b87
Create Date: 2026-09-19

Fixes team members (and guests) stored as e.g. "ranjit" instead of "Ranjit".
Uses PostgreSQL initcap() which capitalizes the first letter of each word.
"""

from alembic import op


revision = "c8d1e2f3a4b5"
down_revision = "fa3e1d2c9b87"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only fix names where the first letter is lowercase (clearly un-capitalized).
    # initcap() does "raj kumar rawat" → "Raj Kumar Rawat".
    # We skip names already having a capital first letter to avoid mangling
    # acronyms or intentional mixed-case names.
    op.execute(
        """
        UPDATE users
        SET full_name = initcap(full_name)
        WHERE full_name ~ '^[a-z]'
        """
    )


def downgrade() -> None:
    # Irreversible — we cannot know which names were originally lowercase.
    pass
