from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_correlation_id() -> str:
    return str(uuid4())


class AppError(Exception):
    """Application error with a stable machine-readable code."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | list[Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


class NotFoundError(AppError):
    def __init__(self, message: str = "Resource not found", *, code: str = "not_found") -> None:
        super().__init__(code, message, status_code=404)


class UnauthorizedError(AppError):
    def __init__(
        self, message: str = "Authentication required", *, code: str = "unauthorized"
    ) -> None:
        super().__init__(code, message, status_code=401)


class ForbiddenError(AppError):
    def __init__(self, message: str = "Permission denied", *, code: str = "forbidden") -> None:
        super().__init__(code, message, status_code=403)


class ConflictError(AppError):
    def __init__(self, message: str = "Conflict", *, code: str = "conflict") -> None:
        super().__init__(code, message, status_code=409)


class ValidationAppError(AppError):
    def __init__(
        self,
        message: str = "Validation failed",
        *,
        code: str = "validation_error",
        details: dict[str, Any] | list[Any] | None = None,
    ) -> None:
        super().__init__(code, message, status_code=422, details=details)


def error_payload(
    *,
    code: str,
    message: str,
    correlation_id: str,
    details: dict[str, Any] | list[Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "correlation_id": correlation_id,
        }
    }
    if details is not None:
        body["error"]["details"] = details
    return body


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        correlation_id = request.headers.get("X-Correlation-ID") or new_correlation_id()
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:  # noqa: RUF029
    correlation_id = getattr(request.state, "correlation_id", new_correlation_id())
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(
            code=exc.code,
            message=exc.message,
            correlation_id=correlation_id,
            details=exc.details,
        ),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:  # noqa: RUF029
    correlation_id = getattr(request.state, "correlation_id", new_correlation_id())
    # Never expose stack traces or SQL to clients.
    return JSONResponse(
        status_code=500,
        content=error_payload(
            code="internal_error",
            message="An unexpected error occurred.",
            correlation_id=correlation_id,
        ),
    )
