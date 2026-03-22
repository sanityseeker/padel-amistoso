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
