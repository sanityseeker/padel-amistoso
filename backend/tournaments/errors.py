"""Shared tournament-engine exceptions."""

from __future__ import annotations


class MatchClearBlocked(ValueError):
    """Raised when a match result cannot be cleared because later state depends on it."""
