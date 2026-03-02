"""
Shared test fixtures for the padel-amistoso test suite.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.auth.security import create_access_token
from backend.auth.store import user_store


@pytest.fixture(autouse=True)
def _clean_state():
    """Reset in-memory state between tests (tournaments + users)."""
    import backend.api.state as state_mod

    state_mod._tournaments.clear()
    state_mod._counter = 0

    # Reset users and bootstrap a test admin
    user_store._users.clear()
    user_store._save = lambda: None  # prevent disk writes in tests
    user_store.create_user("admin", "admin")

    yield

    state_mod._tournaments.clear()
    state_mod._counter = 0
    user_store._users.clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Return Authorization headers with a valid admin JWT."""
    token = create_access_token("admin")
    return {"Authorization": f"Bearer {token}"}
