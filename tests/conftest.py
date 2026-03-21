"""
Shared test fixtures for the padel-amistoso test suite.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.auth.models import User, UserRole
from backend.auth.security import create_access_token, hash_password
from backend.auth.store import user_store

# Pre-compute password hashes once per process to avoid paying bcrypt cost
# per test (bcrypt is intentionally slow; precomputing keeps the suite fast).
_ADMIN_HASH = hash_password("admin")
_ALICE_HASH = hash_password("alice")
_BOB_HASH = hash_password("bob")


@pytest.fixture(autouse=True)
def _clean_state():
    """Reset in-memory state between tests (tournaments + users); disable all DB writes."""
    import backend.api.state as state_mod

    state_mod._tournaments.clear()
    state_mod._counter = 0
    state_mod._tournament_versions.clear()
    state_mod._state_version = 0

    # Disable persistence for the duration of the test.
    orig_save_tournament = state_mod._save_tournament
    orig_delete_tournament = state_mod._delete_tournament
    state_mod._save_tournament = lambda tid: None
    state_mod._delete_tournament = lambda tid: None

    # Reset users and seed test accounts (use pre-computed hashes to avoid
    # re-running bcrypt for every single test).
    user_store._users.clear()
    orig_save_user = user_store._save_user
    orig_remove_user = user_store._remove_user
    user_store._save_user = lambda u: None
    user_store._remove_user = lambda u: None

    user_store._users["admin"] = User(username="admin", password_hash=_ADMIN_HASH, role=UserRole.ADMIN)
    user_store._users["alice"] = User(username="alice", password_hash=_ALICE_HASH, role=UserRole.USER)
    user_store._users["bob"] = User(username="bob", password_hash=_BOB_HASH, role=UserRole.USER)

    yield

    state_mod._tournaments.clear()
    state_mod._counter = 0
    state_mod._tournament_versions.clear()
    state_mod._state_version = 0
    state_mod._save_tournament = orig_save_tournament
    state_mod._delete_tournament = orig_delete_tournament

    user_store._users.clear()
    user_store._save_user = orig_save_user
    user_store._remove_user = orig_remove_user


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Return Authorization headers with a valid admin JWT."""
    token = create_access_token("admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def alice_headers() -> dict[str, str]:
    """Return Authorization headers for regular user alice."""
    token = create_access_token("alice")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def bob_headers() -> dict[str, str]:
    """Return Authorization headers for regular user bob."""
    token = create_access_token("bob")
    return {"Authorization": f"Bearer {token}"}
