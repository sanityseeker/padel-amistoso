"""Shared in-memory per-IP rate limiting utilities."""

from __future__ import annotations

import time
from collections import OrderedDict

from fastapi import HTTPException


class BoundedRateLimiter:
    """Per-IP rate limiter with bounded memory via LRU eviction."""

    def __init__(self, max_attempts: int, window_seconds: float, max_tracked_ips: int) -> None:
        self._max_attempts = max_attempts
        self._window_seconds = window_seconds
        self._max_tracked_ips = max_tracked_ips
        self._attempts_by_ip: OrderedDict[str, list[float]] = OrderedDict()

    def check(self, ip: str, error_message: str) -> None:
        """Raise HTTP 429 when *ip* exceeds allowed attempts in the window."""
        now = time.monotonic()
        attempts = self._attempts_by_ip.get(ip, [])
        attempts = [attempt for attempt in attempts if now - attempt < self._window_seconds]
        self._attempts_by_ip[ip] = attempts
        self._attempts_by_ip.move_to_end(ip)
        if len(attempts) >= self._max_attempts:
            raise HTTPException(429, error_message)

    def record(self, ip: str) -> None:
        """Record one attempt for *ip* and evict old keys when needed."""
        attempts = self._attempts_by_ip.get(ip, [])
        attempts.append(time.monotonic())
        self._attempts_by_ip[ip] = attempts
        self._attempts_by_ip.move_to_end(ip)
        while len(self._attempts_by_ip) > self._max_tracked_ips:
            self._attempts_by_ip.popitem(last=False)

    def clear(self) -> None:
        """Reset all tracked IP history."""
        self._attempts_by_ip.clear()
