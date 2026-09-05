from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from functools import partial
from pathlib import Path
from uuid import uuid4

from app.core.config import get_settings


class StorageBackend(ABC):
    @abstractmethod
    async def put_bytes(self, *, key: str, data: bytes, content_type: str) -> str:
        """Store bytes and return the object key."""

    @abstractmethod
    async def get_bytes(self, key: str) -> bytes:
        ...

    @abstractmethod
    async def delete(self, key: str) -> None:
        ...

    @abstractmethod
    def public_url(self, key: str) -> str | None:
        ...


class LocalStorage(StorageBackend):
    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    async def put_bytes(self, *, key: str, data: bytes, content_type: str) -> str:
        self._path(key).write_bytes(data)
        return key

    async def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    async def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def public_url(self, key: str) -> str | None:
        return f"/local-files/{key}"


class _S3CompatibleStorage(StorageBackend):
    """Generic S3-compatible backend — works with Cloudflare R2, Backblaze B2, AWS S3."""

    def __init__(
        self,
        *,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        bucket: str,
        public_base: str,
        region: str = "auto",
    ) -> None:
        import boto3

        self.bucket = bucket
        self.public_base = public_base.rstrip("/") if public_base else ""
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=region,
        )

    @staticmethod
    def _map_boto_error(exc: Exception) -> Exception:
        """Map boto3/botocore errors to AppErrors so callers get 404/503, not 500."""
        # Import lazily so local/non-S3 storage never imports boto3.
        try:
            from botocore.exceptions import BotoCoreError, ClientError
        except ImportError:  # pragma: no cover
            return exc
        if isinstance(exc, ClientError):
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "NoSuchBucket", "404"):
                from app.core.errors import NotFoundError

                return NotFoundError("Object not found in storage")
        if isinstance(exc, ClientError | BotoCoreError):
            from app.core.errors import AppError

            return AppError(
                "storage_unavailable",
                "Object storage is temporarily unavailable",
                status_code=503,
            )
        return exc

    async def put_bytes(self, *, key: str, data: bytes, content_type: str) -> str:
        # boto3 is synchronous — run in a thread so the asyncio event loop is
        # never blocked during network I/O to the S3-compatible endpoint.
        try:
            await asyncio.to_thread(
                partial(
                    self.client.put_object,
                    Bucket=self.bucket,
                    Key=key,
                    Body=data,
                    ContentType=content_type,
                )
            )
        except Exception as exc:
            raise self._map_boto_error(exc) from exc
        return key

    async def get_bytes(self, key: str) -> bytes:
        try:
            result = await asyncio.to_thread(
                partial(self.client.get_object, Bucket=self.bucket, Key=key)
            )
            # Body.read() is also blocking I/O — run it in the thread too.
            return await asyncio.to_thread(result["Body"].read)
        except Exception as exc:
            raise self._map_boto_error(exc) from exc

    async def delete(self, key: str) -> None:
        try:
            await asyncio.to_thread(
                partial(self.client.delete_object, Bucket=self.bucket, Key=key)
            )
        except Exception as exc:
            raise self._map_boto_error(exc) from exc

    def public_url(self, key: str) -> str | None:
        if not self.public_base:
            return None
        return f"{self.public_base}/{key}"


# Aliases kept for clarity in get_storage()
class R2Storage(_S3CompatibleStorage):
    def __init__(self) -> None:
        settings = get_settings()
        super().__init__(
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            access_key_id=settings.r2_access_key_id,
            secret_access_key=settings.r2_secret_access_key,
            bucket=settings.r2_bucket_name,
            public_base=settings.r2_public_base_url,
            region="auto",
        )


class B2Storage(_S3CompatibleStorage):
    """Backblaze B2 via its S3-compatible API."""

    def __init__(self) -> None:
        settings = get_settings()
        super().__init__(
            endpoint_url=settings.b2_endpoint,
            access_key_id=settings.b2_key_id,
            secret_access_key=settings.b2_application_key,
            bucket=settings.b2_bucket_name,
            public_base=settings.b2_public_base_url,
            region=settings.b2_region,
        )


_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage
    if _storage is None:
        settings = get_settings()
        if settings.storage_backend == "r2":
            _storage = R2Storage()
        elif settings.storage_backend == "b2":
            _storage = B2Storage()
        else:
            _storage = LocalStorage(settings.local_storage_path)
    return _storage


def new_object_key(prefix: str, filename: str) -> str:
    safe = filename.replace("..", "").replace("/", "_").replace("\\", "_")
    return f"{prefix}/{uuid4().hex}_{safe}"
