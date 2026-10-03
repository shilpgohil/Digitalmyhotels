"""Add payment_method to recurring_expenses.

Revision ID: p0q1r2s3t4u5
Revises: o9p0q1r2s3t4
Create Date: 2026-10-03
"""

from alembic import op
import sqlalchemy as sa

revision = "p0q1r2s3t4u5"
down_revision = "o9p0q1r2s3t4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "recurring_expenses",
        sa.Column(
            "payment_method",
            sa.String(length=32),
            nullable=False,
            server_default="cash",
        ),
    )
    op.create_check_constraint(
        "recurring_expense_payment_method",
        "recurring_expenses",
        "payment_method IN ('cash','upi','card','credit_card','debit_card','bank_transfer','other')",
    )


def downgrade() -> None:
    op.drop_constraint("recurring_expense_payment_method", "recurring_expenses", type_="check")
    op.drop_column("recurring_expenses", "payment_method")
