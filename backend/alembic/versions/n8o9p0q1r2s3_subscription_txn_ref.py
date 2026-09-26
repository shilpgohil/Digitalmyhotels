"""Add txn_ref to subscriptions.

Revision ID: n8o9p0q1r2s3
Revises: m7n8o9p0q1r2
Create Date: 2026-09-26
"""

from alembic import op
import sqlalchemy as sa

revision = "n8o9p0q1r2s3"
down_revision = "m7n8o9p0q1r2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscriptions",
        sa.Column("txn_ref", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subscriptions", "txn_ref")
