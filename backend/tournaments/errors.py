"""Shared tournament-engine exceptions."""

from __future__ import annotations


class MatchClearBlocked(ValueError):
    """Raised when a match result cannot be cleared because later state depends on it."""


class WithdrawalBlocked(ValueError):
    """Raised when a participant cannot be withdrawn (or a withdrawal cannot be undone) right now."""
