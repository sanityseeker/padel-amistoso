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
def _clean_state(tmp_path):
    """Reset in-memory state between tests (tournaments + users); use an isolated DB per test."""
    import backend.api.db as db_mod
    import backend.api.state as state_mod
    import backend.api.player_secret_store as ps_mod
    import backend.api.routes_player_auth as rpa_mod
    import backend.api.routes_gp as gp_mod
    import backend.api.routes_mex as mex_mod
    import backend.api.routes_playoff as po_mod
    import backend.api.routes_crud as crud_mod

    # Redirect the database to an isolated temp file so tests don't depend on
    # an already-existing padel.db file (e.g. in CI with a fresh checkout).
    orig_db_path = db_mod.DB_PATH
    db_mod.DB_PATH = tmp_path / "test.db"
    db_mod.init_db()

    state_mod._tournaments.clear()
    state_mod._counter = 0
    state_mod._tournament_versions.clear()
    state_mod._state_version = 0

    # Disable persistence for the duration of the test.
    orig_save_tournament = state_mod._save_tournament
    orig_delete_tournament = state_mod._delete_tournament
    state_mod._save_tournament = lambda tid: None
    state_mod._delete_tournament = lambda tid: None

    # Disable player secret DB I/O; store in-memory for tests.
    _test_secrets: dict[str, dict] = {}
    orig_create_secrets = ps_mod.create_secrets_for_tournament
    orig_delete_secrets = ps_mod.delete_secrets_for_tournament
    orig_get_secrets = ps_mod.get_secrets_for_tournament
    orig_lookup_passphrase = ps_mod.lookup_by_passphrase
    orig_lookup_token = ps_mod.lookup_by_token
    orig_regenerate = ps_mod.regenerate_secret

    def _mock_create(tournament_id, players):
        from backend.tournaments.player_secrets import generate_secrets_for_players

        player_ids = [p["id"] for p in players]
        secrets = generate_secrets_for_players(player_ids)
        name_map = {p["id"]: p["name"] for p in players}
        _test_secrets[tournament_id] = {
            pid: {"name": name_map.get(pid, ""), "passphrase": sec.passphrase, "token": sec.token}
            for pid, sec in secrets.items()
        }
        return secrets

    def _mock_delete(tournament_id):
        _test_secrets.pop(tournament_id, None)

    def _mock_get(tournament_id):
        return _test_secrets.get(tournament_id, {})

    def _mock_lookup_passphrase(tournament_id, passphrase):
        for pid, sec in _test_secrets.get(tournament_id, {}).items():
            if sec["passphrase"] == passphrase:
                return {"player_id": pid, "player_name": sec["name"]}
        return None

    def _mock_lookup_token(token):
        for tid, players in _test_secrets.items():
            for pid, sec in players.items():
                if sec["token"] == token:
                    return {"tournament_id": tid, "player_id": pid, "player_name": sec["name"]}
        return None

    def _mock_regenerate(tournament_id, player_id):
        from backend.tournaments.player_secrets import PlayerSecret, generate_passphrase, generate_token

        if tournament_id not in _test_secrets or player_id not in _test_secrets[tournament_id]:
            return None
        new = PlayerSecret(passphrase=generate_passphrase(), token=generate_token())
        _test_secrets[tournament_id][player_id]["passphrase"] = new.passphrase
        _test_secrets[tournament_id][player_id]["token"] = new.token
        return new

    ps_mod.create_secrets_for_tournament = _mock_create
    ps_mod.delete_secrets_for_tournament = _mock_delete
    ps_mod.get_secrets_for_tournament = _mock_get
    ps_mod.lookup_by_passphrase = _mock_lookup_passphrase
    ps_mod.lookup_by_token = _mock_lookup_token
    ps_mod.regenerate_secret = _mock_regenerate

    # Also patch the local references in route modules (created by
    # ``from .player_secret_store import func``).
    _orig_route_refs = {
        "gp_create": gp_mod.create_secrets_for_tournament,
        "mex_create": mex_mod.create_secrets_for_tournament,
        "po_create": po_mod.create_secrets_for_tournament,
        "crud_delete": crud_mod.delete_secrets_for_tournament,
        "rpa_get": rpa_mod.get_secrets_for_tournament,
        "rpa_lookup_pp": rpa_mod.lookup_by_passphrase,
        "rpa_lookup_tok": rpa_mod.lookup_by_token,
        "rpa_regenerate": rpa_mod.regenerate_secret,
    }
    gp_mod.create_secrets_for_tournament = _mock_create
    mex_mod.create_secrets_for_tournament = _mock_create
    po_mod.create_secrets_for_tournament = _mock_create
    crud_mod.delete_secrets_for_tournament = _mock_delete
    rpa_mod.get_secrets_for_tournament = _mock_get
    rpa_mod.lookup_by_passphrase = _mock_lookup_passphrase
    rpa_mod.lookup_by_token = _mock_lookup_token
    rpa_mod.regenerate_secret = _mock_regenerate

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

    # Restore the real DB path (temp file is discarded automatically by pytest).
    db_mod.DB_PATH = orig_db_path

    ps_mod.create_secrets_for_tournament = orig_create_secrets
    ps_mod.delete_secrets_for_tournament = orig_delete_secrets
    ps_mod.get_secrets_for_tournament = orig_get_secrets
    ps_mod.lookup_by_passphrase = orig_lookup_passphrase
    ps_mod.lookup_by_token = orig_lookup_token
    ps_mod.regenerate_secret = orig_regenerate

    gp_mod.create_secrets_for_tournament = _orig_route_refs["gp_create"]
    mex_mod.create_secrets_for_tournament = _orig_route_refs["mex_create"]
    po_mod.create_secrets_for_tournament = _orig_route_refs["po_create"]
    crud_mod.delete_secrets_for_tournament = _orig_route_refs["crud_delete"]
    rpa_mod.get_secrets_for_tournament = _orig_route_refs["rpa_get"]
    rpa_mod.lookup_by_passphrase = _orig_route_refs["rpa_lookup_pp"]
    rpa_mod.lookup_by_token = _orig_route_refs["rpa_lookup_tok"]
    rpa_mod.regenerate_secret = _orig_route_refs["rpa_regenerate"]

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
