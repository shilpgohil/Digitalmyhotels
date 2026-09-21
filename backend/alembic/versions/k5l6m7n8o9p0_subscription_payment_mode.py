"""Extend subscription payment_mode constraint + add to renewal_requests.

The existing subscriptions.payment_mode column (added in a9f3c1e7b820) had a
narrow CHECK that excluded 'bank_transfer', 'card', and 'manual'.  This
migration:
  1. Drops and recreates that constraint to allow the full canonical set.
  2. Adds payment_mode to subscription_renewal_requests so partner-initiated
     renewal requests carry the hotel's self-reported payment method.

Canonical values: upi | cash | bank_transfer | card | other | manual

Revision ID: k5l6m7n8o9p0
Revises: j4k5l6m7n8o9
Create Date: 2026-09-21
"""

from alembic import op
import sqlalchemy as sa

revision = "k5l6m7n8o9p0"
down_revision = "j4k5l6m7n8o9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Widen the existing CHECK on subscriptions.payment_mode ────────────
    # The old constraint (from a9f3c1e7b820) only allowed:
    #   cash | upi | credit_card | debit_card | other | NULL
    # We now need: bank_transfer | card | manual as well.
    op.drop_constraint(
        "subscription_payment_mode", "subscriptions", type_="check"
    )
    op.create_check_constraint(
        "subscription_payment_mode",
        "subscriptions",
        "payment_mode IN ('upi','cash','bank_transfer','card',"
        "'credit_card','debit_card','other','manual') OR payment_mode IS NULL",
    )

    # ── 2. Add index on subscriptions.payment_mode (for summary aggregation) ─
    # Guard with IF NOT EXISTS in raw SQL — Alembic's create_index raises if
    # it already exists on some deploys.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_subscriptions_payment_mode "
        "ON subscriptions (payment_mode)"
    )

    # ── 3. Add payment_mode to subscription_renewal_requests ─────────────────
    op.add_column(
        "subscription_renewal_requests",
        sa.Column("payment_mode", sa.String(32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subscription_renewal_requests", "payment_mode")
    op.execute("DROP INDEX IF EXISTS ix_subscriptions_payment_mode")
    op.drop_constraint("subscription_payment_mode", "subscriptions", type_="check")
    op.create_check_constraint(
        "subscription_payment_mode",
        "subscriptions",
        "payment_mode IN ('cash','upi','credit_card','debit_card','other') "
        "OR payment_mode IS NULL",
    )
