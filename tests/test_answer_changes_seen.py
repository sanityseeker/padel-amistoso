"""
Tests for the per-organizer "seen" marker of registration answer changes.

Each organizer (owner or co-editor) has their own marker per lobby, stored on
the server: the lobby list and the lobby detail report how many answer changes
are newer than it, until the organizer marks them seen.
"""

from __future__ import annotations

_QUESTIONS = [
    {"key": "level", "label": "Level", "type": "choice", "required": False, "choices": ["A", "B", "C"]},
]


def _create_lobby(client, headers) -> str:
    r = client.post("/api/registrations", json={"name": "Seen Lobby", "questions": _QUESTIONS}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _register(client, rid: str, name: str, level: str) -> str:
    r = client.post(f"/api/registrations/{rid}/register", json={"player_name": name, "answers": {"level": level}})
    assert r.status_code == 200, r.text
    return r.json()["passphrase"]


def _unseen_in_list(client, rid: str, headers) -> int:
    r = client.get("/api/registrations", headers=headers)
    assert r.status_code == 200
    return next(reg for reg in r.json() if reg["id"] == rid)["unseen_answer_changes"]


def _newest_change(client, rid: str, headers) -> int:
    r = client.get(f"/api/registrations/{rid}/answer-changes", headers=headers)
    assert r.status_code == 200
    return r.json()[0]["id"]


def _mark_seen(client, rid: str, headers, up_to: int):
    return client.post(f"/api/registrations/{rid}/answer-changes/seen", json={"up_to_id": up_to}, headers=headers)


class TestAnswerChangesSeen:
    def test_new_changes_are_unseen_in_list_and_detail(self, client, alice_headers):
        rid = _create_lobby(client, alice_headers)
        passphrase = _register(client, rid, "Ana", "B")
        client.patch(
            f"/api/registrations/{rid}/player-answers", json={"passphrase": passphrase, "answers": {"level": "A"}}
        )

        assert _unseen_in_list(client, rid, alice_headers) == 2
        detail = client.get(f"/api/registrations/{rid}", headers=alice_headers).json()
        assert detail["unseen_answer_changes"] == 2
        assert detail["answer_changes_seen_id"] == 0

    def test_mark_seen_clears_and_never_moves_back(self, client, alice_headers):
        rid = _create_lobby(client, alice_headers)
        _register(client, rid, "Ana", "B")
        _register(client, rid, "Ben", "C")
        newest = _newest_change(client, rid, alice_headers)

        r = _mark_seen(client, rid, alice_headers, newest)
        assert r.status_code == 200
        assert r.json()["last_seen_id"] == newest
        assert _unseen_in_list(client, rid, alice_headers) == 0

        # An older marker does not move it back; one past the newest change is clamped.
        assert _mark_seen(client, rid, alice_headers, 0).json()["last_seen_id"] == newest
        assert _mark_seen(client, rid, alice_headers, newest + 50).json()["last_seen_id"] == newest

        _register(client, rid, "Cid", "A")
        detail = client.get(f"/api/registrations/{rid}", headers=alice_headers).json()
        assert detail["unseen_answer_changes"] == 1
        assert detail["answer_changes_seen_id"] == newest

    def test_each_organizer_has_their_own_marker(self, client, alice_headers, bob_headers):
        rid = _create_lobby(client, alice_headers)
        r = client.post(f"/api/registrations/{rid}/collaborators", json={"username": "bob"}, headers=alice_headers)
        assert r.status_code == 200, r.text
        _register(client, rid, "Ana", "B")

        _mark_seen(client, rid, alice_headers, _newest_change(client, rid, alice_headers))
        assert _unseen_in_list(client, rid, alice_headers) == 0
        assert _unseen_in_list(client, rid, bob_headers) == 1

    def test_platform_admin_is_not_flagged_on_other_lobbies(self, client, alice_headers, auth_headers):
        rid = _create_lobby(client, alice_headers)
        _register(client, rid, "Ana", "B")
        assert _unseen_in_list(client, rid, auth_headers) == 0

    def test_marking_seen_requires_editor_access(self, client, alice_headers, bob_headers):
        rid = _create_lobby(client, alice_headers)
        assert client.post(f"/api/registrations/{rid}/answer-changes/seen", json={"up_to_id": 1}).status_code in (
            401,
            403,
        )
        assert _mark_seen(client, rid, bob_headers, 1).status_code == 403

    def test_deleting_lobby_drops_the_markers(self, client, alice_headers):
        rid = _create_lobby(client, alice_headers)
        _register(client, rid, "Ana", "B")
        _mark_seen(client, rid, alice_headers, _newest_change(client, rid, alice_headers))
        assert client.delete(f"/api/registrations/{rid}", headers=alice_headers).status_code == 200

        from backend.api.db import get_db

        with get_db() as conn:
            left = conn.execute(
                "SELECT COUNT(*) FROM registration_answer_seen WHERE registration_id = ?", (rid,)
            ).fetchone()[0]
        assert left == 0
