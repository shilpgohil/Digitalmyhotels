"""Render free-tier keep-alive: the service pings its own public URL.

Why this exists: the GitHub Actions cron that pings /health is scheduled
every 10 minutes but GitHub throttles scheduled workflows heavily — observed
gaps of 1–5 HOURS between runs — while Render free tier sleeps after 15
minutes without inbound traffic. A request from the service to its own
PUBLIC hostname routes through Render's edge and counts as inbound traffic,
so a 10-minute self-ping keeps the service awake as long as the process is
running. The GitHub cron stays as the wake-up backup for the one case the
self-ping can't cover: the service already being asleep (e.g. right after
Render maintenance or a crash).

Render injects RENDER_EXTERNAL_URL automatically on every service — the loop
is a no-op when that variable is absent (local dev, tests, CI).
"""

from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

PING_INTERVAL_SECONDS = 10 * 60


async def self_ping_loop() -> None:
    """Ping our own public /health every 10 minutes (production only)."""
    base_url = (os.environ.get("RENDER_EXTERNAL_URL") or "").rstrip("/")
    if not base_url:
        return  # not on Render — nothing to keep alive

    import httpx

    logger.info("keep-alive: self-ping enabled for %s", base_url)
    while True:
        await asyncio.sleep(PING_INTERVAL_SECONDS)
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(f"{base_url}/health")
                if resp.status_code != 200:
                    logger.warning("keep-alive: /health returned %s", resp.status_code)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Transient network errors must never kill the loop.
            logger.warning("keep-alive: self-ping failed (%s); retrying next cycle", exc)
