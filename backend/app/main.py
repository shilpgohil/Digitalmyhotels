from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.errors import (
    AppError,
    CorrelationIdMiddleware,
    app_error_handler,
    error_payload,
    new_correlation_id,
    unhandled_error_handler,
)
from app.core.logging import setup_logging


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import asyncio

    from app.services.keepalive import self_ping_loop
    from app.services.overdue import overdue_sweep_loop

    settings = get_settings()
    setup_logging(debug=settings.debug)
    # Background loops (both sleep before their first cycle, so tests and
    # short-lived processes never execute them):
    # - overdue sweep: checkout-overdue notifications every 15 min
    # - keep-alive: self-ping via public URL every 10 min (Render free tier
    #   sleeps after 15 min without inbound traffic; GitHub cron alone is
    #   throttled to 1-5 h gaps and cannot prevent sleep). No-op off Render.
    tasks = [
        asyncio.create_task(overdue_sweep_loop()),
        asyncio.create_task(self_ping_loop()),
    ]
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )

    # Compress responses ≥ 1 kB — reduces payload significantly for list endpoints.
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Correlation-ID"],
    )
    app.add_middleware(CorrelationIdMiddleware)

    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_error_handler)  # type: ignore[arg-type]

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        correlation_id = getattr(request.state, "correlation_id", new_correlation_id())
        # Surface the FIRST field error as a human message (client bug: forms
        # showed a useless generic "Request validation failed" toast while the
        # real reason — e.g. an invalid GSTIN — sat unread in `details`).
        message = "Request validation failed"
        errors = exc.errors()
        if errors:
            first = errors[0]
            loc = [str(p) for p in first.get("loc", []) if p not in ("body", "query", "path")]
            field = ".".join(loc)
            msg = str(first.get("msg", "")).removeprefix("Value error, ").strip()
            if msg:
                message = f"{field}: {msg}" if field else msg
        return JSONResponse(
            status_code=422,
            content=error_payload(
                code="validation_error",
                message=message,
                correlation_id=correlation_id,
                details=jsonable_encoder(
                    exc.errors(), custom_encoder={Exception: str}
                ),
            ),
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.app_name}

    @app.get("/health/db")
    async def health_db() -> dict[str, float | str]:
        """Diagnostic: measures DB session checkout + query time server-side.

        checkout_ms ≈ connection acquisition (pool reuse should make this ~0–5 ms;
        a fresh Neon connection costs 1000–3000 ms on this CPU tier).
        query_ms ≈ pure round-trip for SELECT 1 (same-region should be 1–5 ms).
        """
        import time

        from sqlalchemy import text

        from app.db.session import AsyncSessionLocal

        t0 = time.perf_counter()
        async with AsyncSessionLocal() as session:
            await session.connection()          # force pool checkout now
            t1 = time.perf_counter()
            await session.execute(text("SELECT 1"))
            t2 = time.perf_counter()
        return {
            "status": "ok",
            "checkout_ms": round((t1 - t0) * 1000, 1),
            "query_ms": round((t2 - t1) * 1000, 1),
        }

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
