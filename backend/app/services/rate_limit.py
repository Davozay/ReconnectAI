"""Sliding-window rate limiter (in-memory, per user + action)."""

import time

_hits: dict[tuple[str, str], list[float]] = {}


def reset() -> None:
    _hits.clear()


def check(bucket: str, key: str, limit: int, window_seconds: int) -> bool:
    """Record a hit; returns True when allowed, False when over the limit."""
    now = time.time()
    history = _hits.setdefault((bucket, key), [])
    cutoff = now - window_seconds
    while history and history[0] <= cutoff:
        history.pop(0)
    if len(history) >= limit:
        return False
    history.append(now)
    return True
