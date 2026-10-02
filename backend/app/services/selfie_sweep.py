"""Nightly selfie-flush sweep loop.

Runs once per day (at 02:00 UTC by design — sleeps until next 02:00 UTC before
each run) and calls ``attendance.sweep_flushed_selfies`` which purges binary
selfie bytes older than each hotel's configured retention window while keeping
the SHA-256 fingerprint permanently for audit-trail purposes.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

logger = logging.getLogger(__name__)

# Target UTC hour for the daily sweep (02:00 UTC = 07:30 IST, off-peak).
_TARGET_HOUR_UTC = 2


def _seconds_until_next_run() -> float:
    """Seconds until the next 02:00 UTC window."""
    now = datetime.now(UTC)
    next_run = now.replace(hour=_TARGET_HOUR_UTC, minute=0, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    return (next_run - now).total_seconds()


async def selfie_sweep_loop() -> None:
    """Background loop started from the app lifespan.

    Sleeps until the next 02:00 UTC window before each sweep so tests,
    migrations and health checks never trigger a purge.  Each cycle uses a
    fresh DB session; errors are swallowed so a transient failure can't kill
    the loop.
    """
    from app.db.session import AsyncSessionLocal
    from app.services.attendance import sweep_flushed_selfies

    while True:
        wait = _seconds_until_next_run()
        logger.info("selfie sweep: next run in %.0f s (%.1f h)", wait, wait / 3600)
        await asyncio.sleep(wait)

        try:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    result = await sweep_flushed_selfies(session)
            logger.info(
                "selfie sweep complete — scanned=%d flushed=%d errors=%d",
                result["scanned"],
                result["flushed"],
                result["errors"],
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("selfie sweep failed; will retry next cycle")
