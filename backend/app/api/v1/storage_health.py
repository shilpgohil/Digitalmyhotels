"""Storage health-check endpoint — accessible to hotel owners and managers.

Lets admins verify from the UI whether the storage backend is correctly
configured in production. Returns backend type, write/read test result,
and the effective bucket/path being used.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permissions
from app.core.config import get_settings
from app.core.permissions import Permission
from app.core.tenant import TenantContext
from app.db.session import get_db

router = APIRouter(prefix="/storage", tags=["storage"])


@router.get("/health")
async def storage_health(
    tenant: TenantContext = Depends(
        require_permissions(Permission.HOTEL_MANAGE_SETTINGS)
    ),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Round-trip a tiny test object to verify the storage backend is working.

    A successful result means photos and selfies will actually persist.
    If this returns 'backend=local' on production you need to add B2 env vars.
    """
    from app.integrations.storage.base import get_storage

    settings = get_settings()
    backend = settings.storage_backend
    location = (
        settings.b2_bucket_name if backend == "b2"
        else settings.r2_bucket_name if backend == "r2"
        else settings.local_storage_path
    )

    test_key = f"hotels/{tenant.hotel_id}/_storage_test.txt"
    payload = b"ok"
    write_ok = False
    read_ok = False
    delete_ok = False
    error: str | None = None

    try:
        storage = get_storage()
        await storage.put_bytes(key=test_key, data=payload, content_type="text/plain")
        write_ok = True
        back = await storage.get_bytes(test_key)
        read_ok = back == payload
        await storage.delete(test_key)
        delete_ok = True
    except Exception as exc:
        error = str(exc)

    return {
        "backend": backend,
        "location": location,
        "write_ok": write_ok,
        "read_ok": read_ok,
        "delete_ok": delete_ok,
        "files_persist_across_restarts": backend in ("b2", "r2"),
        "error": error,
    }
