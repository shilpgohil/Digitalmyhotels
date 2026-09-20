"""Add 'in_grace' to subscription status CHECK constraint.

Previously the constraint only allowed:
  trial | active | expiring_soon | expired | suspended

'expiring_soon' was overloaded: it meant BOTH "future expiry within 7 days"
AND "past expiry but still within grace window". This made it impossible for
the SA edit page to distinguish the two situations — a grace-period hotel was
showing as Active instead of In Grace.

This migration adds 'in_grace' as an explicit distinct value so the two
scenarios are cleanly separated. The old 'expiring_soon' value is preserved
for hotels whose plan lapses within the next 7 days (still active).

Revision ID: j4k5l6m7n8o9
Revises: i3j4k5l6m7n8
Create Date: 2026-09-20
"""

from alembic import op

revision = "j4k5l6m7n8o9"
down_revision = "i3j4k5l6m7n8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL does not support ALTER CONSTRAINT for CHECK constraints;
    # the only safe path is DROP + CREATE. The constraint name in the
    # original schema is "subscription_status".
    op.drop_constraint("subscription_status", "subscriptions", type_="check")
    op.create_check_constraint(
        "subscription_status",
        "subscriptions",
        "status IN ('trial','active','expiring_soon','in_grace','expired','suspended')",
    )


def downgrade() -> None:
    # First coerce any 'in_grace' rows back to 'expiring_soon' so the
    # old constraint can be re-applied without violating it.
    op.execute(
        "UPDATE subscriptions SET status = 'expiring_soon' WHERE status = 'in_grace'"
    )
    op.drop_constraint("subscription_status", "subscriptions", type_="check")
    op.create_check_constraint(
        "subscription_status",
        "subscriptions",
        "status IN ('trial','active','expiring_soon','expired','suspended')",
    )
