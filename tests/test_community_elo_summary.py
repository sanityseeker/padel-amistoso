"""GET /api/communities/{id}/elo-summary: rating changes from played matches in a community's clubs."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

import backend.api.db as db_mod
from backend.api import club_elo
from backend.api import state as state_mod
from backend.api.leaderboard_cache import invalidate_leaderboard_cache
from backend.auth.security import create_profile_token
from tests.test_club_elo import _link, _log, _new_tournament, _play, _play_rounds, _space, _tier
from tests.test_elo_relink import _insert_profile

_REAL_SAVE_TOURNAMENT = state_mod._save_tournament


@pytest.fixture(autouse=True)
def _persist_tournaments(monkeypatch):
    monkeypatch.setattr(state_mod, "_save_tournament", _REAL_SAVE_TOURNAMENT)
    invalidate_leaderboard_cache()
    yield
    invalidate_leaderboard_cache()


def _club(club_id: str, community_id: str = "open", created_by: str = "admin") -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, 'admin', ?)",
            (community_id, community_id.upper(), now),
        )
        conn.execute(
            "INSERT INTO clubs (id, name, slug, community_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (club_id, f"Club {club_id}", club_id, community_id, created_by, now),
        )


def _get(client, headers, community_id: str = "open", **params):
    return client.get(f"/api/communities/{community_id}/elo-summary", params=params, headers=headers)


def _summary(client, headers, community_id: str = "open", **params) -> dict:
    res = _get(client, headers, community_id, **params)
    assert res.status_code == 200, res.text
    return res.json()


def _entry(data: dict, club_id: str, sport: str = "padel") -> dict:
    return next(c for c in data["clubs"] if c["club_id"] == club_id and c["sport"] == sport)


def _player(entry: dict, profile_id: str) -> dict:
    return next(p for p in entry["players"] if p["profile_id"] == profile_id)


def _expected(club_id: str) -> tuple[float, float]:
    """(gained, lost) straight from the stored rows, as an independent check."""
    with db_mod.get_db() as conn:
        rows = conn.execute(
            "SELECT l.club_elo_after - l.club_elo_before AS d FROM player_elo_log l"
            " JOIN tournaments t ON t.id = l.tournament_id"
            " WHERE t.club_id = ? AND l.is_manual = 0 AND l.club_elo_after IS NOT NULL",
            (club_id,),
        ).fetchall()
    return (
        round(sum(r["d"] for r in rows if r["d"] > 0), 2),
        round(sum(r["d"] for r in rows if r["d"] < 0), 2),
    )


def _totals(entry: dict) -> tuple[float, float, int, int]:
    t = entry["totals"]
    return t["gained"], t["lost"], t["matches"], t["players"]


class TestMatchesOnly:
    def test_seed_is_excluded_and_first_match_is_measured_from_it(self, client, auth_headers):
        _club("s1")
        bob = _insert_profile("Bob")
        _tier(client, auth_headers, "s1", bob, 1400)
        # The tier moved no community rating.
        assert _space(client, bob)["profile"]["elo_padel"] == 1000
        tid, ids = _play(client, auth_headers, "s1", winner="Bob", profiles={"Bob": bob})

        first = _log(tid, ids["Bob"])[0]
        assert first["club_elo_before"] == 1400
        data = _summary(client, auth_headers, sport="padel")
        row = _player(_entry(data, "s1"), bob)
        assert row["net"] == round(first["club_elo_after"] - 1400, 2)
        assert row["net"] < 400  # the 400 point seed is not a gain
        assert row["matches"] == 1
        assert (_entry(data, "s1")["totals"]["gained"], _entry(data, "s1")["totals"]["lost"]) == _expected("s1")
        # Community rating is the match result from 1000, untouched by the seed.
        assert _space(client, bob)["profile"]["elo_padel"] == _log(tid, ids["Bob"])[-1]["elo_after"]

    def test_manual_rating_and_bulk_tier_rows_do_not_count(self, client, auth_headers):
        _club("s2")
        alice, carol = _insert_profile("Alice"), _insert_profile("Carol")
        tid, _ids = _play(client, auth_headers, "s2", winner="Alice", profiles={"Alice": alice})
        before = _summary(client, auth_headers)
        res = client.patch(
            f"/api/clubs/s2/players/{alice}/elo", json={"sport": "padel", "elo": 1800}, headers=auth_headers
        )
        assert res.status_code == 200, res.text
        _tier(client, auth_headers, "s2", carol, 1300)
        after = _summary(client, auth_headers)
        assert after["totals"] == before["totals"]
        assert _entry(after, "s2")["totals"] == _entry(before, "s2")["totals"]
        assert after["totals"]["padel"]["matches"] == 1

    def test_unlinked_players_go_into_one_bucket_counted_in_club_totals(self, client, auth_headers):
        _club("s3")
        alice = _insert_profile("Alice")
        _play(client, auth_headers, "s3", winner="Alice", profiles={"Alice": alice})
        entry = _entry(_summary(client, auth_headers), "s3")
        assert [p["profile_id"] for p in entry["players"]] == [alice]
        assert entry["unlinked"]["players"] == 3
        assert entry["totals"]["players"] == 4
        assert entry["totals"]["matches"] == 1
        assert round(entry["totals"]["gained"] + entry["totals"]["lost"], 2) == 0

    def test_empty_community_is_200(self, client, auth_headers):
        _club("s4", "cm4")
        with db_mod.get_db() as conn:
            conn.execute("DELETE FROM clubs WHERE id = 's4'")
        data = _summary(client, auth_headers, "cm4")
        assert data["clubs"] == [] and data["note"] == "match_deltas_only"


class TestReplayInvariance:
    def test_correction_recompute_and_from_club_ratings_keep_the_sums_consistent(self, client, auth_headers):
        _club("r1")
        alice = _insert_profile("Alice")
        _tier(client, auth_headers, "r1", alice, 1250)
        tid, _ids = _new_tournament(client, auth_headers, "r1", {"Alice": alice})
        _play_rounds(client, auth_headers, tid, "Alice", rounds=2)

        def check() -> dict:
            e = _entry(_summary(client, auth_headers), "r1")
            assert (e["totals"]["gained"], e["totals"]["lost"]) == _expected("r1")
            return e

        check()
        # Correct the score of the first played match.
        first = next(m for m in client.get(f"/api/tournaments/{tid}/mex/matches").json()["all_matches"])
        res = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": first["id"], "score1": 9, "score2": 23},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text
        club_elo.recompute_club_elo("r1")
        before = check()
        client.post("/api/clubs/r1/elo/recalculate", headers=auth_headers)
        assert check() == before
        res = client.post("/api/clubs/r1/elo/recalculate?from_club_ratings=true", headers=auth_headers)
        assert res.status_code == 200, res.text
        check()

    def test_incremental_rating_equals_full_replay(self, client, auth_headers):
        _club("r2")
        alice = _insert_profile("Alice")
        for winner in ("Alice", "Bob", "Carol"):
            _play(client, auth_headers, "r2", winner=winner, profiles={"Alice": alice})
        incremental = _summary(client, auth_headers)
        invalidate_leaderboard_cache()
        club_elo._replay_club("r2")
        assert _summary(client, auth_headers) == incremental


class TestLinks:
    def test_link_unlink_and_merge_keep_the_club_total(self, client, auth_headers):
        _club("l1")
        alice, other = _insert_profile("Alice"), _insert_profile("Alice B")
        tid, ids = _play(client, auth_headers, "l1", winner="Alice")
        before = _entry(_summary(client, auth_headers), "l1")
        assert before["unlinked"]["players"] == 4 and before["players"] == []

        _link(client, auth_headers, alice, tid, ids["Alice"])
        linked = _entry(_summary(client, auth_headers), "l1")
        assert _totals(linked)[:3] == _totals(before)[:3]
        assert [p["profile_id"] for p in linked["players"]] == [alice]
        assert linked["unlinked"]["players"] == 3

        res = client.post(
            "/api/admin/player-profiles/merge-hub",
            json={"primary_id": other, "secondary_id": alice},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text
        merged = _entry(_summary(client, auth_headers), "l1")
        assert _totals(merged)[:3] == _totals(before)[:3]
        assert [p["profile_id"] for p in merged["players"]] == [other]

        res = client.delete(f"/api/admin/player-profiles/link/{tid}/{ids['Alice']}", headers=auth_headers)
        assert res.status_code == 200
        assert _totals(_entry(_summary(client, auth_headers), "l1"))[:3] == _totals(before)[:3]


class TestCrossClub:
    def test_only_players_with_matches_in_two_clubs_get_a_total(self, client, auth_headers):
        _club("x1")
        _club("x2")
        alice, bob = _insert_profile("Alice"), _insert_profile("Bob")
        _play(client, auth_headers, "x1", winner="Alice", profiles={"Alice": alice, "Bob": bob})
        data = _summary(client, auth_headers)
        assert data["cross_club_players"] == []
        _play(client, auth_headers, "x2", winner="Alice", profiles={"Alice": alice})
        data = _summary(client, auth_headers)
        assert [p["profile_id"] for p in data["cross_club_players"]] == [alice]
        total = data["cross_club_players"][0]
        a1, a2 = (_player(_entry(data, c), alice) for c in ("x1", "x2"))
        assert total["clubs"] == 2
        assert total["net"] == round(a1["net"] + a2["net"], 2)
        assert total["matches"] == 2


class TestHiddenSport:
    def test_hidden_player_drops_from_list_and_club_total(self, client, auth_headers):
        _club("h1")
        alice = _insert_profile("Alice")
        _play(client, auth_headers, "h1", winner="Alice", profiles={"Alice": alice})
        full = _entry(_summary(client, auth_headers), "h1")
        mine = _player(full, alice)
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO profile_club_elo (profile_id, club_id, sport, elo, matches) VALUES (?, 'h1', 'padel', 1000, 1)",
                (alice,),
            )
        res = client.patch(
            f"/api/clubs/h1/players/{alice}/sport-visibility",
            json={"sport": "padel", "hidden": True},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text
        cut = _entry(_summary(client, auth_headers), "h1")
        assert cut["players"] == []
        assert cut["totals"]["players"] == full["totals"]["players"] - 1
        assert round(cut["totals"]["gained"], 2) == round(full["totals"]["gained"] - mine["gained"], 2)
        assert round(cut["totals"]["lost"], 2) == round(full["totals"]["lost"] - mine["lost"], 2)


class TestLegacyRows:
    def test_rows_without_club_ratings_are_only_reported(self, client, auth_headers):
        _club("g1")
        alice = _insert_profile("Alice")
        tid, _ids = _play(client, auth_headers, "g1", winner="Alice", profiles={"Alice": alice})
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE player_elo_log SET club_identity = NULL, club_elo_before = NULL, club_elo_after = NULL,"
                " club_matches_after = NULL WHERE tournament_id = ?",
                (tid,),
            )
        entry = _entry(_summary(client, auth_headers), "g1")
        assert entry["unrated_matches"] == 1
        assert _totals(entry) == (0, 0, 0, 0)
        assert client.post("/api/clubs/g1/elo/recalculate", headers=auth_headers).status_code == 200
        entry = _entry(_summary(client, auth_headers), "g1")
        assert entry["unrated_matches"] == 0 and entry["totals"]["matches"] == 1


class TestMovesAndDeletes:
    def test_moving_a_tournament_between_clubs_moves_its_change(self, client, auth_headers):
        _club("m1")
        _club("m2")
        tid, _ids = _play(client, auth_headers, "m1", winner="Alice")
        assert (
            client.patch(f"/api/tournaments/{tid}/club", json={"club_id": "m2"}, headers=auth_headers).status_code
            == 200
        )
        data = _summary(client, auth_headers)
        assert [c["club_id"] for c in data["clubs"]] == ["m2"]

    def test_club_in_another_community_is_not_counted(self, client, auth_headers):
        _club("m3")
        _play(client, auth_headers, "m3", winner="Alice")
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO communities (id, name, created_by, created_at) VALUES ('cm9', 'Nine', 'admin', 'x')"
            )
            conn.execute("UPDATE clubs SET community_id = 'cm9' WHERE id = 'm3'")
        assert _summary(client, auth_headers)["clubs"] == []
        assert [c["club_id"] for c in _summary(client, auth_headers, "cm9")["clubs"]] == ["m3"]

    def test_tournament_community_id_does_not_decide(self, client, auth_headers):
        # A tournament whose own community differs from its club's community still counts for the club's.
        _club("m5")
        tid, _ids = _play(client, auth_headers, "m5", winner="Alice")
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO communities (id, name, created_by, created_at) VALUES ('cm8', 'Eight', 'admin', 'x')"
            )
            conn.execute("UPDATE tournaments SET community_id = 'cm8' WHERE id = ?", (tid,))
        assert [c["club_id"] for c in _summary(client, auth_headers)["clubs"]] == ["m5"]
        assert _summary(client, auth_headers, "cm8")["clubs"] == []

    def test_deleted_tournament_drops_out(self, client, auth_headers):
        _club("m6")
        tid, _ids = _play(client, auth_headers, "m6", winner="Alice")
        res = client.delete(f"/api/tournaments/{tid}", headers=auth_headers)
        assert res.status_code == 200, res.text
        invalidate_leaderboard_cache()
        assert _summary(client, auth_headers)["clubs"] == []


class TestFilters:
    def _season(self, club_id: str) -> str:
        sid = f"se-{uuid.uuid4().hex[:6]}"
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO seasons (id, club_id, name, active, created_at) VALUES (?, ?, 'S', 1, 'x')",
                (sid, club_id),
            )
        return sid

    def test_season_filter_and_wrong_club_rejected(self, client, auth_headers):
        _club("f1")
        _club("f2")
        t1, _ = _play(client, auth_headers, "f1", winner="Alice")
        _play(client, auth_headers, "f1", winner="Bob")
        season = self._season("f1")
        res = client.patch(f"/api/tournaments/{t1}/season", json={"season_id": season}, headers=auth_headers)
        assert res.status_code == 200, res.text
        data = _summary(client, auth_headers, season_id=season)
        assert [c["club_id"] for c in data["clubs"]] == ["f1"]
        assert _entry(data, "f1")["totals"]["matches"] == 1
        # The season wins over the date range.
        far = _summary(client, auth_headers, season_id=season, **{"from": "2999-01-01"})
        assert _entry(far, "f1")["totals"]["matches"] == 1 and far["from_ts"] is None
        assert _get(client, auth_headers, season_id=season, club_id="f2").status_code == 404
        other = self._season("f2")
        assert _get(client, auth_headers, season_id=other, club_id="f1").status_code == 404
        assert _get(client, auth_headers, season_id="nope").status_code == 404

    def test_season_of_a_club_outside_the_community_is_404(self, client, auth_headers):
        _club("f3")
        _club("f4", "cm5")
        assert _get(client, auth_headers, "open", season_id=self._season("f4")).status_code == 404
        assert _get(client, auth_headers, "open", club_id="f4").status_code == 404

    def test_date_bounds_from_inclusive_to_exclusive(self, client, auth_headers):
        _club("d1")
        t1, _ = _play(client, auth_headers, "d1", winner="Alice")
        t2, _ = _play(client, auth_headers, "d1", winner="Bob")
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE player_elo_log SET updated_at = '2026-01-01T10:00:00+00:00' WHERE tournament_id = ?", (t1,)
            )
            conn.execute(
                "UPDATE player_elo_log SET updated_at = '2026-02-01T10:00:00+00:00' WHERE tournament_id = ?", (t2,)
            )

        def matches(**p) -> int:
            data = _summary(client, auth_headers, **p)
            return _entry(data, "d1")["totals"]["matches"] if data["clubs"] else 0

        assert matches() == 2
        assert matches(**{"from": "2026-02-01T10:00:00+00:00"}) == 1
        assert matches(**{"to": "2026-02-01T10:00:00+00:00"}) == 1
        assert matches(**{"from": "2026-01-01T10:00:00+00:00", "to": "2026-02-01T10:00:00+00:00"}) == 1
        assert matches(**{"from": "2026-03-01"}) == 0
        assert _get(client, auth_headers, **{"from": "yesterday"}).status_code == 422

    def test_sports_are_never_mixed(self, client, auth_headers):
        _club("p1")
        _play(client, auth_headers, "p1", winner="Alice")
        t2, _ = _play(client, auth_headers, "p1", winner="Bob")
        with db_mod.get_db() as conn:
            conn.execute("UPDATE player_elo_log SET sport = 'tennis' WHERE tournament_id = ?", (t2,))
        data = _summary(client, auth_headers)
        assert {(c["sport"], c["totals"]["matches"]) for c in data["clubs"]} == {("padel", 1), ("tennis", 1)}
        assert data["totals"]["padel"]["matches"] == 1 and data["totals"]["tennis"]["matches"] == 1
        only = _summary(client, auth_headers, sport="tennis")
        assert [c["sport"] for c in only["clubs"]] == ["tennis"] and list(only["totals"]) == ["tennis"]

    def test_etag_gives_304(self, client, auth_headers):
        _club("e1")
        _play(client, auth_headers, "e1", winner="Alice")
        res = _get(client, auth_headers)
        res2 = client.get(
            "/api/communities/open/elo-summary", headers={**auth_headers, "If-None-Match": res.headers["etag"]}
        )
        assert res2.status_code == 304


class TestAccess:
    def test_matrix(self, client, auth_headers, alice_headers):
        _club("a1", created_by="alice")
        _club("a2", created_by="admin")
        _play(client, auth_headers, "a1", winner="Alice")
        _play(client, auth_headers, "a2", winner="Alice")
        profile = _insert_profile("Zed")

        assert _get(client, {}).status_code == 403
        token = {"Authorization": f"Bearer {create_profile_token(profile)}"}
        assert _get(client, token).status_code == 403

        admin = _summary(client, auth_headers)
        assert {c["club_id"] for c in admin["clubs"]} == {"a1", "a2"} and admin["clubs_hidden"] == 0

        mine = _summary(client, alice_headers)
        assert [c["club_id"] for c in mine["clubs"]] == ["a1"] and mine["clubs_hidden"] == 1
        assert mine["totals"]["padel"]["matches"] == 1
        assert _get(client, alice_headers, club_id="a2").status_code == 404
        assert _get(client, auth_headers, "missing").status_code == 404

    def test_community_creator_alone_gets_no_access(self, client, alice_headers):
        _club("a3", "cm6")
        with db_mod.get_db() as conn:
            conn.execute("UPDATE communities SET created_by = 'alice' WHERE id = 'cm6'")
        data = _summary(client, alice_headers, "cm6")
        assert data["clubs"] == [] and data["clubs_hidden"] == 1
