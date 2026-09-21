"""Add mrp_price to subscription_plans.

Stores the original / list price before any discount, shown as a
strikethrough on the hotel's Choose Your Plan page alongside the actual
discounted price and an auto-calculated "Save X%" badge.
NULL = no discount shown for that plan.

Revision ID: m7n8o9p0q1r2
Revises: l6m7n8o9p0q1
Create Date: 2026-09-21
"""

from alembic import op
import sqlalchemy as sa

revision = "m7n8o9p0q1r2"
down_revision = "l6m7n8o9p0q1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "subscription_plans",
        sa.Column("mrp_price", sa.Numeric(12, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subscription_plans", "mrp_price")
