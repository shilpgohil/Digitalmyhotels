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
    def test_only_owner_manages_team_among_hotel_roles(self) -> None:
        assert has_permission(RoleCode.OWNER, Permission.HOTEL_MANAGE_TEAM)
        for role in (RoleCode.MANAGER, RoleCode.ADMIN, RoleCode.HOUSEKEEPING):
            assert not has_permission(role, Permission.HOTEL_MANAGE_TEAM), role

    def test_super_admin_has_all_permissions(self) -> None:
        assert permissions_for_role(RoleCode.SUPER_ADMIN) == frozenset(Permission)
