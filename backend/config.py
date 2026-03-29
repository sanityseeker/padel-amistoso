"""
Centralised configuration for the backend.

The data directory is read from the ``AMISTOSO_DATA_DIR`` (or legacy
``PADEL_DATA_DIR``) environment variable.  Falls back to a ``data/`` folder
at the repository root when not set:

    AMISTOSO_DATA_DIR=data/instance_a uv run uvicorn backend.api:app --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

_DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"

DATA_DIR: Path = Path(os.environ.get("AMISTOSO_DATA_DIR", os.environ.get("PADEL_DATA_DIR", _DEFAULT_DATA_DIR)))


def _optional_env(name: str) -> str | None:
    """Return optional env var value, treating empty/None/null as unset."""
    raw = os.environ.get(name)
    if raw is None:
        return None
    value = raw.strip()
    if not value or value.lower() in {"none", "null"}:
        return None
    return value


def _smtp_port() -> int:
    """Return SMTP port with a safe default when env value is invalid/unset."""
    raw = _optional_env("AMISTOSO_SMTP_PORT")
    if raw is None:
        return 587
    try:
        return int(raw)
    except ValueError:
        return 587


# ────────────────────────────────────────────────────────────────────────────
# Email / SMTP — all optional.  When AMISTOSO_SMTP_HOST is unset, email
# features are silently disabled.
# ────────────────────────────────────────────────────────────────────────────
SMTP_HOST: str | None = _optional_env("AMISTOSO_SMTP_HOST")
SMTP_PORT: int = _smtp_port()
SMTP_USER: str | None = _optional_env("AMISTOSO_SMTP_USER")
SMTP_PASS: str | None = _optional_env("AMISTOSO_SMTP_PASS")
SMTP_FROM: str | None = _optional_env("AMISTOSO_FROM_EMAIL")
SMTP_USE_TLS: bool = os.environ.get("AMISTOSO_SMTP_USE_TLS", "1").lower() in ("1", "true", "yes")
SITE_URL: str | None = _optional_env("AMISTOSO_SITE_URL")
