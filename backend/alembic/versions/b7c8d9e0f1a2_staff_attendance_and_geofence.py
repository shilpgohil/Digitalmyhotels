"""Staff attendance: staff_profiles + attendance_records + hotel geofence.

- hotels: geofence_enabled (admin toggle, default OFF), latitude, longitude,
  geofence_radius_m (default 200 m)
- staff_profiles: HR profile per hotel employee (linked to users)
- attendance_records: one row per staff per hotel-local work date, with GPS
  evidence columns for the geofence audit trail
- roles: seed 'receptionist' and 'general_staff' (idempotent)

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-09-12
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "b7c8d9e0f1a2"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── hotels: geofence settings ────────────────────────────────────────
    op.add_column(
        "hotels",
        sa.Column("geofence_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("hotels", sa.Column("latitude", sa.Numeric(9, 6), nullable=True))
    op.add_column("hotels", sa.Column("longitude", sa.Numeric(9, 6), nullable=True))
    op.add_column(
        "hotels",
        sa.Column("geofence_radius_m", sa.Integer(), nullable=False, server_default="200"),
    )

    # ── staff_profiles ───────────────────────────────────────────────────
    op.create_table(
        "staff_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "hotel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("hotels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("staff_code", sa.String(32), nullable=False),
        sa.Column("department", sa.String(32), nullable=False, server_default="other"),
        sa.Column("designation", sa.String(120), nullable=True),
        sa.Column("employment_type", sa.String(16), nullable=False, server_default="full_time"),
        sa.Column("joining_date", sa.Date(), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("gender", sa.String(16), nullable=True),
        sa.Column("base_salary", sa.Numeric(12, 2), nullable=True),
        sa.Column("shift_start", sa.Time(), nullable=True),
        sa.Column("shift_end", sa.Time(), nullable=True),
        sa.Column("weekly_off", sa.SmallInteger(), nullable=True),
        sa.Column("photo_object_key", sa.String(512), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("hotel_id", "user_id", name="uq_staff_hotel_user"),
        sa.UniqueConstraint("hotel_id", "staff_code", name="uq_staff_hotel_code"),
    )
    op.create_index("ix_staff_profiles_hotel_id", "staff_profiles", ["hotel_id"])
    op.create_index("ix_staff_profiles_user_id", "staff_profiles", ["user_id"])
    op.create_index("ix_staff_profiles_status", "staff_profiles", ["status"])

    # ── attendance_records ───────────────────────────────────────────────
    op.create_table(
        "attendance_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "hotel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("hotels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "staff_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("staff_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("check_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_in_lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("check_in_lng", sa.Numeric(9, 6), nullable=True),
        sa.Column("check_in_accuracy_m", sa.Numeric(8, 1), nullable=True),
        sa.Column("check_in_distance_m", sa.Numeric(8, 1), nullable=True),
        sa.Column("check_out_lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("check_out_lng", sa.Numeric(9, 6), nullable=True),
        sa.Column("check_out_accuracy_m", sa.Numeric(8, 1), nullable=True),
        sa.Column("check_out_distance_m", sa.Numeric(8, 1), nullable=True),
        sa.Column("check_in_selfie_key", sa.String(512), nullable=True),
        sa.Column("method_in", sa.String(16), nullable=True),
        sa.Column("method_out", sa.String(16), nullable=True),
        sa.Column(
            "performed_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="present"),
        sa.Column("late_minutes", sa.Integer(), nullable=True),
        sa.Column("early_out_minutes", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "hotel_id", "staff_profile_id", "work_date", name="uq_attendance_staff_day"
        ),
        sa.CheckConstraint(
            "check_out_at IS NULL OR check_in_at IS NOT NULL",
            name="ck_attendance_out_requires_in",
        ),
    )
    op.create_index("ix_attendance_records_hotel_id", "attendance_records", ["hotel_id"])
    op.create_index(
        "ix_attendance_records_staff_profile_id", "attendance_records", ["staff_profile_id"]
    )
    op.create_index("ix_attendance_records_work_date", "attendance_records", ["work_date"])
    op.create_index("ix_attendance_records_status", "attendance_records", ["status"])

    # ── seed new roles (idempotent — production deploys don't re-run seed.py)
    import uuid as _uuid

    for code, name, desc in (
        ("receptionist", "Receptionist / Front Desk", "Front-desk staff account"),
        ("general_staff", "General Staff", "Own attendance self-service only"),
    ):
        op.execute(
            sa.text(
                "INSERT INTO roles "
                "(id, code, name, description, is_system, created_at, updated_at) "
                "VALUES (:id, :code, :name, :desc, TRUE, NOW(), NOW()) "
                "ON CONFLICT (code) DO NOTHING"
            ).bindparams(id=str(_uuid.uuid4()), code=code, name=name, desc=desc)
        )


def downgrade() -> None:
    op.drop_index("ix_attendance_records_status", table_name="attendance_records")
    op.drop_index("ix_attendance_records_work_date", table_name="attendance_records")
    op.drop_index("ix_attendance_records_staff_profile_id", table_name="attendance_records")
    op.drop_index("ix_attendance_records_hotel_id", table_name="attendance_records")
    op.drop_table("attendance_records")
    op.drop_index("ix_staff_profiles_status", table_name="staff_profiles")
    op.drop_index("ix_staff_profiles_user_id", table_name="staff_profiles")
    op.drop_index("ix_staff_profiles_hotel_id", table_name="staff_profiles")
    op.drop_table("staff_profiles")
    op.drop_column("hotels", "geofence_radius_m")
    op.drop_column("hotels", "longitude")
    op.drop_column("hotels", "latitude")
    op.drop_column("hotels", "geofence_enabled")
