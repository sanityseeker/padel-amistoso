"""A manual club rating belongs to the profile, not to a tournament participation.

``player_elo_log.profile_id`` names the owner of an ``is_manual`` row.  Unlinking,
relinking or merging participations must never move or lose the rating, and the
club chain keeps the order: matches before it use the old rating, matches after it
start from the new one.
"""

from __future__ import annotations

import backend.api.db as db_mod
from tests.test_club_elo import (
    _link,
    _log,
    _make_club,
    _persist_tournaments,  # noqa: F401 -- autouse fixture
    _play,
    _space,
)
from tests.test_elo_relink import _insert_profile


def _set_manual(client, auth_headers, club_id: str, profile_id: str, elo: int) -> None:
    res = client.patch(
        f"/api/clubs/{club_id}/players/{profile_id}/elo", json={"sport": "padel", "elo": elo}, headers=auth_headers
    )
    assert res.status_code == 200, res.text


def _manual_rows(club_id: str) -> list[dict]:
    with db_mod.get_db() as conn:
        rows = conn.execute(
            "SELECT player_id, profile_id, elo_after FROM player_elo_log WHERE tournament_id = ? AND is_manual = 1",
            (club_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def _unlink(client, auth_headers, tid: str, player_id: str) -> None:
    res = client.delete(f"/api/admin/player-profiles/link/{tid}/{player_id}", headers=auth_headers)
    assert res.status_code == 200, res.text


class TestManualRatingOwner:
    def test_row_stores_the_profile(self, client, auth_headers):
        _make_club("mo1")
        alice = _insert_profile("Alice")
        _play(client, auth_headers, "mo1", winner="Alice", profiles={"Alice": alice})
        _set_manual(client, auth_headers, "mo1", alice, 1300)
        [row] = _manual_rows("mo1")
        assert row["profile_id"] == alice

    def test_never_played_profile_row_stores_the_profile(self, client, auth_headers):
        _make_club("mo2")
        carol = _insert_profile("Carol")
        _set_manual(client, auth_headers, "mo2", carol, 1250)
        [row] = _manual_rows("mo2")
        assert row["profile_id"] == carol

    def test_backfill_resolves_legacy_rows_and_is_idempotent(self, client, auth_headers):
        _make_club("mo3")
        alice = _insert_profile("Alice")
        tid, ids = _play(client, auth_headers, "mo3", winner="Alice", profiles={"Alice": alice})
        _set_manual(client, auth_headers, "mo3", alice, 1300)
        carol = _insert_profile("Carol")
        _set_manual(client, auth_headers, "mo3", carol, 1250)
        with db_mod.get_db() as conn:
            conn.execute("UPDATE player_elo_log SET profile_id = NULL WHERE is_manual = 1")
        for _ in range(2):
            db_mod.init_db()
            owners = {r["player_id"]: r["profile_id"] for r in _manual_rows("mo3")}
            assert set(owners.values()) == {alice, carol}


class TestManualRatingSurvivesLinkChanges:
    def test_survives_unlink_of_the_participation_it_was_keyed_on(self, client, auth_headers):
        _make_club("mu1")
        alice = _insert_profile("Alice")
        t1, ids1 = _play(client, auth_headers, "mu1", winner="Alice", profiles={"Alice": alice})
        _set_manual(client, auth_headers, "mu1", alice, 1300)
        # Only T1 is linked, so the legacy key is Alice's T1 player id.
        assert _manual_rows("mu1")[0]["player_id"] == ids1["Alice"]
        t2, ids2 = _play(client, auth_headers, "mu1", winner="Bob", profiles={"Alice": alice})
        assert _log(t2, ids2["Alice"])[0]["club_elo_before"] == 1300

        _unlink(client, auth_headers, t1, ids1["Alice"])

        assert _manual_rows("mu1")[0]["profile_id"] == alice
        assert _log(t2, ids2["Alice"])[0]["club_elo_before"] == 1300
        assert (
            _space(client, alice, "?club_id=mu1")["profile"]["elo_padel"]
            == _log(t2, ids2["Alice"])[-1]["club_elo_after"]
        )

    def test_relink_to_another_profile_leaves_rating_with_original_profile(self, client, auth_headers):
        _make_club("mu2")
        alice, bob = _insert_profile("Alice"), _insert_profile("Bob")
        t1, ids1 = _play(client, auth_headers, "mu2", winner="Alice", profiles={"Alice": alice})
        _set_manual(client, auth_headers, "mu2", alice, 1300)
        t2, ids2 = _play(client, auth_headers, "mu2", winner="Bob", profiles={"Alice": alice, "Bob": bob})

        # Bob's profile takes over the participation the manual row was keyed on.
        _link(client, auth_headers, bob, t1, ids1["Alice"])

        assert _manual_rows("mu2")[0]["profile_id"] == alice
        assert _log(t2, ids2["Alice"])[0]["club_elo_before"] == 1300
        assert _log(t2, ids2["Bob"])[0]["club_elo_before"] != 1300
        alice_hist = _space(client, alice, "?club_id=mu2")["elo_history"]
        assert [e["elo_after"] for e in alice_hist if e["is_manual"]] == [1300]
        assert not [e for e in _space(client, bob, "?club_id=mu2")["elo_history"] if e["is_manual"]]

    def test_merge_of_never_played_profile_keeps_rating_on_primary(self, client, auth_headers):
        _make_club("mu3")
        primary, secondary = _insert_profile("Ana"), _insert_profile("Ana B")
        _set_manual(client, auth_headers, "mu3", secondary, 1250)

        res = client.post(
            "/api/admin/player-profiles/merge-hub",
            json={"primary_id": primary, "secondary_id": secondary},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text
        assert _manual_rows("mu3")[0]["profile_id"] == primary

        tid, ids = _play(client, auth_headers, "mu3", winner="Bob", profiles={"Alice": primary})
        assert _log(tid, ids["Alice"])[0]["club_elo_before"] == 1250


class TestManualRatingOrdering:
    def test_matches_before_are_untouched_and_matches_after_start_from_it(self, client, auth_headers):
        _make_club("mt1")
        alice = _insert_profile("Alice")
        t1, ids1 = _play(client, auth_headers, "mt1", winner="Alice", profiles={"Alice": alice})
        before = _log(t1, ids1["Alice"])
        _set_manual(client, auth_headers, "mt1", alice, 1400)
        t2, ids2 = _play(client, auth_headers, "mt1", winner="Alice", profiles={"Alice": alice})
        after = _log(t2, ids2["Alice"])
        assert after[0]["club_elo_before"] == 1400

        res = client.post("/api/clubs/mt1/elo/recalculate", headers=auth_headers)
        assert res.status_code == 200, res.text

        assert _log(t1, ids1["Alice"]) == before
        assert _log(t2, ids2["Alice"]) == after
