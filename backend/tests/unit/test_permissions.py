from app.core.permissions import (
    Permission,
    RoleCode,
    has_permission,
    permissions_for_role,
)


class TestUpiPermissionBoundary:
    """The UPI raw-ID boundary is a non-negotiable business rule."""

    def test_housekeeping_can_view_qr_but_never_raw_upi_id(self) -> None:
        assert has_permission(RoleCode.HOUSEKEEPING, Permission.HOTEL_VIEW_PAYMENT_QR)
        assert not has_permission(RoleCode.HOUSEKEEPING, Permission.HOTEL_VIEW_UPI_ID)
        assert not has_permission(RoleCode.HOUSEKEEPING, Permission.HOTEL_MANAGE_UPI)

    def test_only_owner_and_admin_can_manage_upi(self) -> None:
        # Product owner decision: manager cannot manage UPI, only owner and admin.
        assert has_permission(RoleCode.OWNER, Permission.HOTEL_MANAGE_UPI)
        assert has_permission(RoleCode.OWNER, Permission.HOTEL_VIEW_UPI_ID)
        assert has_permission(RoleCode.ADMIN, Permission.HOTEL_MANAGE_UPI)
        assert has_permission(RoleCode.ADMIN, Permission.HOTEL_VIEW_UPI_ID)
        # Manager can only VIEW the QR (for showing to guests), not the raw ID.
        assert not has_permission(RoleCode.MANAGER, Permission.HOTEL_MANAGE_UPI)
        assert not has_permission(RoleCode.MANAGER, Permission.HOTEL_VIEW_UPI_ID)
        assert has_permission(RoleCode.MANAGER, Permission.HOTEL_VIEW_PAYMENT_QR)


class TestFinancialBoundary:
    def test_housekeeping_has_no_financial_access(self) -> None:
        financial = {
            Permission.PAYMENTS_COLLECT,
            Permission.PAYMENTS_VIEW,
            Permission.PAYMENTS_REFUND,
            Permission.INVOICES_MANAGE,
            Permission.EXPENSES_VIEW,
            Permission.FINANCIAL_REPORTS,
        }
        hk_perms = permissions_for_role(RoleCode.HOUSEKEEPING)
        assert not (financial & hk_perms)

    def test_admin_collects_payments_but_no_financial_reports(self) -> None:
        assert has_permission(RoleCode.ADMIN, Permission.PAYMENTS_COLLECT)
        assert not has_permission(RoleCode.ADMIN, Permission.FINANCIAL_REPORTS)
        assert not has_permission(RoleCode.ADMIN, Permission.EXPENSES_APPROVE)

    def test_manager_has_full_financial_access(self) -> None:
        assert has_permission(RoleCode.MANAGER, Permission.EXPENSES_APPROVE)
        assert has_permission(RoleCode.MANAGER, Permission.FINANCIAL_REPORTS)
        assert has_permission(RoleCode.MANAGER, Permission.PAYMENTS_CORRECT)


class TestTeamBoundary:
    def test_owner_and_manager_manage_team_among_hotel_roles(self) -> None:
        assert has_permission(RoleCode.OWNER, Permission.HOTEL_MANAGE_TEAM)
        assert has_permission(RoleCode.MANAGER, Permission.HOTEL_MANAGE_TEAM)
        for role in (
            RoleCode.ADMIN,
            RoleCode.RECEPTIONIST,
            RoleCode.HOUSEKEEPING,
            RoleCode.GENERAL_STAFF,
        ):
            assert not has_permission(role, Permission.HOTEL_MANAGE_TEAM), role

    def test_manager_cannot_modify_owner_via_team_service(self) -> None:
        import asyncio
        import uuid
        from types import SimpleNamespace
        from unittest.mock import AsyncMock

        import pytest

        from app.core.errors import ValidationAppError
        from app.core.tenant import TenantContext
        from app.schemas.team import TeamMemberUpdate
        from app.services import team as team_service

        hotel_id = uuid.uuid4()
        owner_membership = SimpleNamespace(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            hotel_id=hotel_id,
            role=SimpleNamespace(code=RoleCode.OWNER.value, name="Owner"),
            user=SimpleNamespace(id=uuid.uuid4(), full_name="Owner User", email="o@x.com", phone="9999999999"),
        )
        orig_get = team_service._get_membership
        team_service._get_membership = AsyncMock(return_value=owner_membership)  # type: ignore[method-assign]
        try:
            manager_tenant = TenantContext(
                user_id=uuid.uuid4(),
                hotel_id=hotel_id,
                role=RoleCode.MANAGER,
                is_super_admin=False,
            )
            with pytest.raises(ValidationAppError) as exc:
                asyncio.run(
                    team_service.update_team_member(
                        AsyncMock(),
                        manager_tenant,
                        owner_membership.id,
                        TeamMemberUpdate(full_name="Hacked Owner"),
                    )
                )
            assert exc.value.code == "owner_protected"
        finally:
            team_service._get_membership = orig_get  # type: ignore[method-assign]

    def test_manager_receptionist_general_staff_never_manage_upi(self) -> None:
        for role in (
            RoleCode.MANAGER,
            RoleCode.RECEPTIONIST,
            RoleCode.HOUSEKEEPING,
            RoleCode.GENERAL_STAFF,
        ):
            assert not has_permission(role, Permission.HOTEL_MANAGE_UPI), role
            assert not has_permission(role, Permission.HOTEL_VIEW_UPI_ID), role

    def test_super_admin_has_all_permissions(self) -> None:
        assert permissions_for_role(RoleCode.SUPER_ADMIN) == frozenset(Permission)


class TestRoleDepartmentMapping:
    def test_default_department_for_role_sync(self) -> None:
        from app.schemas.staff import STAFF_ACCESS_ROLES, StaffUpdate
        from app.services.team import default_department_for_role

        assert default_department_for_role("owner") == "management"
        assert default_department_for_role("manager") == "management"
        assert default_department_for_role("receptionist") == "reception"
        assert default_department_for_role("admin") == "reception"
        assert default_department_for_role("housekeeping") == "housekeeping"
        assert default_department_for_role("general_staff") == "other"
        assert default_department_for_role("general_staff", "fnb") == "fnb"
        assert default_department_for_role("general_staff", "maintenance") == "maintenance"
        assert default_department_for_role("housekeeping", "fnb") == "housekeeping"

        # New staff creation excludes legacy 'admin', while StaffUpdate accepts existing 'admin'
        assert "admin" not in STAFF_ACCESS_ROLES
        assert StaffUpdate(access_role="admin").access_role == "admin"
