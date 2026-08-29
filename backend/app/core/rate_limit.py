from __future__ import annotations

import os
import time
from collections import defaultdict, deque

from app.core.config import get_settings
from app.core.errors import AppError

# In-process sliding-window store. This is sufficient for a single-worker
# deployment (e.g. Render free tier with one uvicorn process).
#
# KNOWN LIMITATION: With multiple workers (--workers N) or after a process
# restart, each worker maintains its own independent counter. An attacker
# could spread requests across workers and exceed the per-process limit.
# For strict multi-worker rate limiting, replace _hits with a Redis-backed
# counter (e.g. redis-py INCRBY + EXPIRE). Architecture decision: Redis has
# not been introduced as an infrastructure dependency for this project, so
# this limitation is accepted for the current single-worker deployment model.
# Revisit if the deployment moves to multi-worker or serverless.
_hits: dict[str, deque[float]] = defaultdict(deque)


def check_login_rate(key: str) -> None:
    if os.getenv("PYTEST_CURRENT_TEST"):
        return
    settings = get_settings()
    if settings.app_env == "test":
        return
    limit = settings.rate_limit_login_per_minute
    now = time.monotonic()
    window = 60.0
    bucket = _hits[key]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise AppError(
            "rate_limited",
            "Too many login attempts. Try again shortly.",
            status_code=429,
        )
    bucket.append(now)
