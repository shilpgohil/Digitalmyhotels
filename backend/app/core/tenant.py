from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.core.errors import ForbiddenError
from app.core.permissions import Permission, RoleCode, has_permission


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Resolved tenant context — never trust client-supplied hotel_id."""

    user_id: UUID
    hotel_id: UUID | None
    role: RoleCode | None
    is_super_admin: bool
    membership_id: UUID | None = None

    def require_hotel(self) -> UUID:
        if self.hotel_id is None:
            raise ForbiddenError("Hotel context required", code="hotel_context_required")
        return self.hotel_id

    def require_permission(self, permission: Permission) -> None:
        if self.is_super_admin:
            return
        if self.role is None or not has_permission(self.role, permission):
            raise ForbiddenError(
                f"Missing permission: {permission.value}",
                code="permission_denied",
            )

    def can(self, permission: Permission) -> bool:
        if self.is_super_admin:
            return True
        if self.role is None:
            return False
        return has_permission(self.role, permission)
