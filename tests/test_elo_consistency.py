"""Cross-surface consistency of ELO ratings and match counts.

Guards against the admin panel, the Player Hub headers / chips and the
leaderboards disagreeing about how many rated matches a profile has played or
what its current rating is.  Each scenario drives the real store functions the
score routes call (seed → update → log → sync → finish) rather than inserting
pre-cooked rows, so the numbers reflect the actual write path.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import backend.api.db as db_mod
from backend.api.elo_integration import elo_finish_tournament
from backend.api.elo_store import (
    get_live_profile_elo_stats,
    get_tournament_elos,
    get_tournament_match_counts,
    initialize_tournament_elos,
    sync_live_elos_to_profiles,
    upsert_tournament_elo,
    upsert_tournament_elo_log,
)
from backend.api.routes_clubs import _compute_club_leaderboard_rows_uncached
from backend.api.routes_player_space import _get_player_clubs, _get_profile_club_elo, _leaderboard_for_sport
from backend.api.leaderboard_cache import invalidate_leaderboard_cache
from backend.api.rating_scope import RatingScope, resolve_scope, scope_stats
from backend.api.state import _tournaments
from backend.models import Match, MatchStatus, Player
from backend.tournaments.elo import compute_match_elo_updates
from tests.test_elo_recalc_continuity import _insert_profile, _link_player

_BASE_TS = 1_700_000_000


def _insert_tournament(
    tid: str, community_id: str = "open", club_id: str | None = None, season_id: str | None = None
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, 'admin', ?)",
            (community_id, f"Community {community_id}", now),
        )
        conn.execute(
            """INSERT OR IGNORE INTO tournaments
               (id, name, type, owner, public, tournament_blob, version, sport, community_id, club_id,
                season_id)
               VALUES (?, ?, 'mexicano', 'admin', 1, ?, 0, 'padel', ?, ?, ?)""",
            (tid, f"T-{tid}", b"", community_id, club_id, season_id),
        )


def _play_and_finish(tid: str, pid: str, n_matches: int, ts_base: int) -> None:
    """Rate *n_matches* for linked player *pid* against unlinked fillers, then finish."""
    others = [Player(name=f"o{i}", id=f"{tid}-o{i}") for i in range(3)]
    initialize_tournament_elos(tid, [pid] + [o.id for o in others], "padel")
    for i in range(n_matches):
        ratings = get_tournament_elos(tid, "padel")
        counts = get_tournament_match_counts(tid, "padel")
        match = Match(
            team1=[Player(name="P", id=pid), others[0]],
            team2=[others[1], others[2]],
            status=MatchStatus.COMPLETED,
            score=(6, 3),
            id=f"{tid}-m{i}",
        )
        match.scored_at = ts_base + i * 60
        updates = compute_match_elo_updates(match, ratings, counts, False)
        ts = datetime.fromtimestamp(match.scored_at, tz=timezone.utc).isoformat()
        upsert_tournament_elo(tid, updates, "padel", updated_at=ts)
        upsert_tournament_elo_log(tid, match, updates, "padel", match_order=i + 1, updated_at=ts)
        sync_live_elos_to_profiles(tid, "padel")
    finished_at = datetime.fromtimestamp(ts_base + n_matches * 60, tz=timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_history (profile_id, entity_type, entity_id, entity_name, player_id,"
            " player_name, finished_at, sport)"
            " SELECT profile_id, 'tournament', ?, ?, player_id, 'P', ?, 'padel'"
            " FROM player_secrets WHERE tournament_id = ? AND profile_id IS NOT NULL",
            (tid, tid, finished_at, tid),
        )
    _tournaments[tid] = {"sport": "padel", "type": "mexicano", "tournament": object()}
    elo_finish_tournament(tid)
    _tournaments.pop(tid, None)


def _lb_row(sport: str, community_id: str, name: str):
    return next((e for e in _leaderboard_for_sport(sport, community_id) if e.name == name), None)


class TestGlobalAndCommunityCounts:
    """A profile playing in two communities: c1 (5) → c2 (3) → c1 (2)."""

    def _setup(self, client, name: str = "Nadal") -> str:
        profile = _insert_profile(name)
        for tid, community in (("t1", "c1"), ("t2", "c2"), ("t3", "c1")):
            _insert_tournament(tid, community)
            _link_player(tid, f"{tid}-p", profile)
        _play_and_finish("t1", "t1-p", 5, _BASE_TS)
        _play_and_finish("t2", "t2-p", 3, _BASE_TS + 10_000)
        _play_and_finish("t3", "t3-p", 2, _BASE_TS + 20_000)
        return profile

    def test_live_stats_total_all_matches(self, client):
        profile = self._setup(client)
        stats = get_live_profile_elo_stats([profile])[profile]["padel"]
        assert stats["matches"] == 10
        # Latest rating is the end of the most recent tournament (t3, community c1).
        assert stats["elo"] == get_tournament_elos("t3", "padel")["t3-p"]

    def test_global_leaderboard_counts_all_communities(self, client):
        profile = self._setup(client)
        row = _lb_row("padel", "", "Nadal")
        assert row is not None
        assert row.matches == 10
        assert row.elo == get_tournament_elos("t3", "padel")["t3-p"]
        assert get_live_profile_elo_stats([profile])[profile]["padel"]["matches"] == row.matches

    def test_community_leaderboards_count_only_their_matches(self, client):
        self._setup(client)
        assert _lb_row("padel", "c1", "Nadal").matches == 7
        assert _lb_row("padel", "c2", "Nadal").matches == 3

    def test_admin_list_and_detail_match_global_leaderboard(self, client, auth_headers):
        self._setup(client)
        listed = client.get("/api/admin/player-profiles?q=Nadal", headers=auth_headers).json()
        assert len(listed) == 1
        assert listed[0]["elo_padel_matches"] == 10
        detail = client.get(f"/api/admin/player-profiles/{listed[0]['id']}", headers=auth_headers).json()
        assert detail["elo_padel_matches"] == 10
        assert round(detail["elo_padel"], 6) == round(_lb_row("padel", "", "Nadal").elo, 6)

    def test_hub_headers_match_leaderboards(self, client):
        profile = self._setup(client)
        token = client.post(
            "/api/player-profile/login",
            json={"passphrase": _passphrase(profile)},
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        glob = client.get("/api/player-profile/space", headers=headers).json()["profile"]
        assert glob["elo_padel_matches"] == 10

        for community, expected in (("c1", 7), ("c2", 3)):
            res = client.get(f"/api/player-profile/space?community_id={community}", headers=headers).json()
            assert res["profile"]["elo_padel_matches"] == expected
            assert round(res["profile"]["elo_padel"], 6) == round(_lb_row("padel", community, "Nadal").elo, 6)


def _passphrase(profile_id: str) -> str:
    with db_mod.get_db() as conn:
        return conn.execute("SELECT passphrase FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()[0]


def _make_club(profile_id: str, club_id: str = "k1", community_id: str = "c1") -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, 'admin', ?)",
            (community_id, f"Community {community_id}", now),
        )
        conn.execute(
            "INSERT INTO clubs (id, name, slug, community_id, created_by, created_at) VALUES (?, 'Club', ?, ?, 'admin', ?)",
            (club_id, club_id, community_id, now),
        )
        for sport in ("padel", "tennis"):
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches) VALUES (?, ?, ?, 1000, 0)",
                (profile_id, club_id, sport),
            )


class TestClubScope:
    def _setup(self, client, name: str = "Alcaraz") -> str:
        profile = _insert_profile(name)
        _make_club(profile)
        _insert_tournament("tk", "c1", club_id="k1")
        _link_player("tk", "tk-p", profile)
        _play_and_finish("tk", "tk-p", 4, _BASE_TS + 100_000)
        return profile

    def test_hub_club_chip_counts_each_match_once(self, client):
        """Regression: the chip used to report matches² (16 for 4) via a fan-out join."""
        profile = self._setup(client)
        chip = next(c for c in _get_player_clubs(profile) if c.id == "k1")
        header = _get_profile_club_elo(profile, "k1")
        with db_mod.get_db() as conn:
            roster = next(r for r in _compute_club_leaderboard_rows_uncached(conn, "k1") if r["sport"] == "padel")
        assert chip.matches_padel == 4
        assert header["elo_padel_matches"] == 4
        assert roster["matches"] == 4
        assert round(chip.elo_padel, 1) == round(header["elo_padel"], 1) == roster["elo"]

    def test_manual_club_elo_override_is_visible_everywhere(self, client, auth_headers):
        profile = self._setup(client)
        res = client.patch(
            f"/api/clubs/k1/players/{profile}/elo",
            json={"sport": "padel", "elo": 1500},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text

        with db_mod.get_db() as conn:
            roster = next(r for r in _compute_club_leaderboard_rows_uncached(conn, "k1") if r["sport"] == "padel")
        assert roster["elo"] == 1500.0
        assert roster["matches"] == 4, "an override must not count as a match"

        header = _get_profile_club_elo(profile, "k1")
        assert header["elo_padel"] == 1500.0
        assert header["elo_padel_matches"] == 4

        chip = next(c for c in _get_player_clubs(profile) if c.id == "k1")
        assert chip.elo_padel == 1500.0
        assert chip.matches_padel == 4

        lb = next(e for e in _leaderboard_for_sport("padel", "", club_id="k1") if e.name == "Alcaraz")
        assert lb.elo == 1500.0
        assert lb.matches == 4

        public = client.get("/api/clubs/k1/public-leaderboard?sport=padel", headers=auth_headers).json()
        assert next(e for e in public if e["name"] == "Alcaraz")["elo"] == 1500.0

        # The override shows up in the player's ELO history, labelled with the club.
        token = client.post("/api/player-profile/login", json={"passphrase": _passphrase(profile)}).json()[
            "access_token"
        ]
        history = client.get(
            "/api/player-profile/space?club_id=k1",
            headers={"Authorization": f"Bearer {token}"},
        ).json()["elo_history"]
        manual = next(e for e in history if e["is_manual"])
        assert manual["elo_after"] == 1500.0
        assert manual["tournament_name"] == "Club"

    def test_tier_base_elo_is_visible_after_apply(self, client, auth_headers):
        profile = self._setup(client)
        tier = client.post(
            "/api/clubs/k1/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1300, "position": 0},
            headers=auth_headers,
        )
        assert tier.status_code in (200, 201), tier.text
        res = client.patch(
            f"/api/clubs/k1/players/{profile}/tier",
            json={"sport": "padel", "tier_id": tier.json()["id"], "apply_base_elo": True},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text
        with db_mod.get_db() as conn:
            roster = next(r for r in _compute_club_leaderboard_rows_uncached(conn, "k1") if r["sport"] == "padel")
        assert roster["elo"] == 1300.0
        assert roster["tier_name"] == "Gold"


# ---------------------------------------------------------------------------
# Leaderboard / history scope parity
# ---------------------------------------------------------------------------


def _club_row(profile_id: str, club_id: str, *, hidden_sports: tuple[str, ...] = (), ghost: bool = False) -> None:
    """Put *profile_id* on the roster of *club_id* (both sports; ghosts un-hidden)."""
    with db_mod.get_db() as conn:
        if ghost:
            conn.execute("UPDATE player_profiles SET is_ghost = 1 WHERE id = ?", (profile_id,))
        for sport in ("padel", "tennis"):
            conn.execute(
                "INSERT OR REPLACE INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, ?, 1000, 0, ?)",
                (profile_id, club_id, sport, 1 if sport in hidden_sports else 0),
            )


def _tennis_match(tid: str, pid: str, ts_base: int) -> None:
    """One rated tennis match for linked player *pid* of tournament *tid*."""
    ts = datetime.fromtimestamp(ts_base, tz=timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_elo_log (tournament_id, sport, match_id, player_id, match_order, elo_before,"
            " elo_after, elo_delta, match_payload, updated_at, is_manual)"
            " VALUES (?, 'tennis', ?, ?, 1, 1000, 1012, 12, ?, ?, 0)",
            (
                tid,
                f"{tid}-tm",
                pid,
                '{"team1":[{"player_id":"%s","player_name":"X"}],"team2":[],"score":[6,3]}' % pid,
                ts,
            ),
        )
        conn.execute(
            "INSERT INTO player_history (profile_id, entity_type, entity_id, entity_name, player_id, player_name,"
            " finished_at, sport) SELECT profile_id, 'tournament', ?, ?, player_id, 'X', ?, 'tennis'"
            " FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
            (tid, tid, ts, tid, pid),
        )


def _hub_headers(client, profile_id: str) -> dict[str, str]:
    token = client.post("/api/player-profile/login", json={"passphrase": _passphrase(profile_id)}).json()[
        "access_token"
    ]
    return {"Authorization": f"Bearer {token}"}


def _member() -> dict[str, str]:
    from backend.auth.security import create_profile_token

    return {"Authorization": f"Bearer {create_profile_token('member-viewer')}"}


class TestLeaderboardHistoryScopeParity:
    """Boards, cards and histories apply one scope to participants and to their matches."""

    def _world(self, client) -> dict[str, str]:
        # Club ids repeat across tests; process-level caches must not carry rows over.
        invalidate_leaderboard_cache()
        now = datetime.now(timezone.utc).isoformat()
        pat, quinn, ghost = _insert_profile("Pat"), _insert_profile("Quinn"), _insert_profile("Gus")
        _make_club(pat, "k1")
        _make_club(pat, "k2")
        _club_row(quinn, "k1", hidden_sports=("tennis",))
        _club_row(ghost, "k1", ghost=True)
        with db_mod.get_db() as conn:
            for sid, kid in (("s1", "k1"), ("s2", "k2")):
                conn.execute(
                    "INSERT INTO seasons (id, club_id, name, active, created_at) VALUES (?, ?, ?, 1, ?)",
                    (sid, kid, f"Season {sid}", now),
                )
        _insert_tournament("t1", "c1", "k1", "s1")
        _insert_tournament("t2", "c1", "k2", "s2")
        _insert_tournament("t3", "c2")
        _insert_tournament("t4", "c1", "k1", "s1")
        _insert_tournament("tq", "c1", "k1", "s1")
        _insert_tournament("tqt", "c1", "k1", "s1")
        _insert_tournament("tg", "c1", "k1")
        for tid, prof in (
            ("t1", pat),
            ("t2", pat),
            ("t3", pat),
            ("t4", pat),
            ("tq", quinn),
            ("tqt", quinn),
            ("tg", ghost),
        ):
            _link_player(tid, f"{tid}-p", prof)
        _play_and_finish("t1", "t1-p", 3, _BASE_TS)
        _play_and_finish("t2", "t2-p", 2, _BASE_TS + 10_000)
        _play_and_finish("t3", "t3-p", 4, _BASE_TS + 20_000)
        _tennis_match("t4", "t4-p", _BASE_TS + 30_000)
        _play_and_finish("tq", "tq-p", 2, _BASE_TS + 40_000)
        _tennis_match("tqt", "tqt-p", _BASE_TS + 50_000)
        _play_and_finish("tg", "tg-p", 1, _BASE_TS + 60_000)
        return {"pat": pat, "quinn": quinn, "ghost": ghost}

    def _card(self, client, club: str, profile: str, query: str = ""):
        return client.get(f"/api/clubs/{club}/players/{profile}/public-card{query}", headers=_member())

    def _board(self, client, sport: str, club: str = "k1") -> list[dict]:
        return client.get(f"/api/clubs/{club}/public-leaderboard?sport={sport}", headers=_member()).json()

    def test_club_board_matches_card_per_sport(self, client, auth_headers):
        w = self._world(client)
        client.patch(
            f"/api/clubs/k1/players/{w['pat']}/elo", json={"sport": "padel", "elo": 1500}, headers=auth_headers
        )
        board = next(e for e in self._board(client, "padel") if e["profile_id"] == w["pat"])
        assert board["matches"] == 3, "only t1 counts: t2 is another club, t3 has no club, t4 is tennis"
        card = self._card(client, "k1", w["pat"], "?sport=padel").json()
        rows = card["recent_matches"]
        played = [r for r in rows if not r["is_manual"]]
        assert board["matches"] == card["matches_padel"] == len(played)
        assert {r["tournament_name"] for r in played} == {"T-t1"}
        assert [r for r in rows if r["is_manual"]], "the club's manual adjustment is in the club card"
        assert card["elo_padel"] == board["elo"] == 1500.0
        assert card["scope"] == {"sport": "padel", "season_id": None}
        assert card["elo_tennis"] is None and card["matches_tennis"] == 0
        assert card["elo_history_tennis"] == [] and all(r["sport"] == "padel" for r in rows)

        tennis = self._card(client, "k1", w["pat"], "?sport=tennis").json()
        assert tennis["matches_tennis"] == 1 and tennis["elo_padel"] is None
        assert [r["sport"] for r in tennis["recent_matches"]] == ["tennis"]
        both = self._card(client, "k1", w["pat"]).json()
        assert both["matches_padel"] == 3 and both["matches_tennis"] == 1

    def test_hidden_sport_never_leaks(self, client):
        w = self._world(client)
        # Quinn plays tennis in k1 but the club hides it for her.
        assert all(e["profile_id"] != w["quinn"] for e in self._board(client, "tennis"))
        card = self._card(client, "k1", w["quinn"]).json()
        assert card["elo_tennis"] is None and card["matches_tennis"] == 0
        assert card["elo_history_tennis"] == []
        assert all(r["sport"] != "tennis" for r in card["recent_matches"])
        assert self._card(client, "k1", w["quinn"], "?sport=tennis").status_code == 404
        space = client.get("/api/player-profile/space?club_id=k1", headers=_hub_headers(client, w["quinn"])).json()
        assert all(m["sport"] != "tennis" for m in space["elo_history"])
        assert space["profile"]["elo_tennis_matches"] == 0
        # Outside the club the same matches are Quinn's own history.
        glob = client.get("/api/player-profile/space", headers=_hub_headers(client, w["quinn"])).json()
        assert glob["profile"]["elo_tennis_matches"] == 1

    def test_hub_club_board_equals_public_board_with_ghosts(self, client):
        w = self._world(client)
        hub = client.get("/api/player-profile/leaderboard?club_id=k1", headers=_hub_headers(client, w["pat"])).json()
        for sport in ("padel", "tennis"):
            public = self._board(client, sport)
            mine = hub[sport]
            assert [(e["rank"], e["name"], e["elo"], e["matches"], e["tier_name"]) for e in mine] == [
                (e["rank"], e["name"], e["elo"], e["matches"], e["tier_name"]) for e in public
            ]
            assert [e["profile_id"] for e in mine] == [e["profile_id"] for e in public]
        padel_ids = [e["profile_id"] for e in hub["padel"]]
        assert w["ghost"] in padel_ids, "ghosts are on both club boards"
        assert next(e for e in hub["padel"] if e["profile_id"] == w["ghost"])["has_profile"] is False

    def test_community_and_global_history_match_counts(self, client):
        w = self._world(client)
        headers = _hub_headers(client, w["pat"])

        def padel_rows(query: str) -> list[dict]:
            space = client.get(f"/api/player-profile/space?elo_history_limit=50{query}", headers=headers).json()
            return [m for m in space["elo_history"] if m["sport"] == "padel" and not m["is_manual"]]

        comm = padel_rows("&community_id=c1")
        assert len(comm) == _lb_row("padel", "c1", "Pat").matches == 5
        assert {m["tournament_id"] for m in comm} <= {"t1", "t2"}
        glob = padel_rows("")
        assert len(glob) == _lb_row("padel", "", "Pat").matches == 9

    def test_global_history_excludes_club_manual_rows(self, client, auth_headers):
        w = self._world(client)
        client.patch(
            f"/api/clubs/k1/players/{w['pat']}/elo", json={"sport": "padel", "elo": 1500}, headers=auth_headers
        )
        headers = _hub_headers(client, w["pat"])
        glob = client.get("/api/player-profile/space?elo_history_limit=50", headers=headers).json()["elo_history"]
        assert not [m for m in glob if m["is_manual"] or m["tournament_id"] == "k1"]
        club = client.get("/api/player-profile/space?club_id=k1&elo_history_limit=50", headers=headers).json()
        assert [m for m in club["elo_history"] if m["is_manual"]]
        # The manual row does not change the global rating either.
        stats = get_live_profile_elo_stats([w["pat"]])[w["pat"]]["padel"]
        assert stats["matches"] == 9 and stats["elo"] != 1500.0

    def test_season_standings_equal_season_card(self, client):
        w = self._world(client)
        standings = client.get("/api/seasons/s1/standings", headers=_member()).json()
        row = next(e for e in standings["padel"] if e["profile_id"] == w["pat"])
        assert row["matches_played"] == 3
        card = self._card(client, "k1", w["pat"], "?sport=padel&season_id=s1").json()
        assert card["matches_padel"] == row["matches_played"]
        assert card["elo_padel"] == pytest.approx(row["elo_end"], abs=0.1)
        assert len([r for r in card["recent_matches"] if not r["is_manual"]]) == 3
        assert card["scope"] == {"sport": "padel", "season_id": "s1"}
        # A season of another club is not a scope of this club.
        assert self._card(client, "k1", w["pat"], "?season_id=s2").status_code == 404

    def test_moving_a_tournament_updates_boards_and_cards(self, client):
        w = self._world(client)
        assert self._card(client, "k1", w["pat"], "?sport=padel").json()["matches_padel"] == 3
        before_k2 = next(e for e in self._board(client, "padel", "k2") if e["profile_id"] == w["pat"])
        assert before_k2["matches"] == 2

        # What a club move does (state.save_tournament): write the new club, then the
        # replay of both clubs invalidates their cached boards and cards when ratings change.
        with db_mod.get_db() as conn:
            conn.execute("UPDATE tournaments SET club_id = 'k2', season_id = NULL WHERE id = 't1'")
        invalidate_leaderboard_cache("k1")
        invalidate_leaderboard_cache("k2")
        assert next(e for e in self._board(client, "padel", "k2") if e["profile_id"] == w["pat"])["matches"] == 5
        assert self._card(client, "k2", w["pat"], "?sport=padel").json()["matches_padel"] == 5
        k1 = self._card(client, "k1", w["pat"], "?sport=padel")
        assert k1.status_code == 404 or k1.json()["matches_padel"] == 0

    def test_merged_profile_is_consistent(self, client, auth_headers):
        w = self._world(client)
        merged = client.post(
            "/api/admin/player-profiles/merge-hub",
            json={"primary_id": w["pat"], "secondary_id": w["quinn"]},
            headers=auth_headers,
        )
        assert merged.status_code == 200, merged.text
        board = next(e for e in self._board(client, "padel") if e["profile_id"] == w["pat"])
        card = self._card(client, "k1", w["pat"], "?sport=padel").json()
        assert card["matches_padel"] == board["matches"] == 5
        assert len([r for r in card["recent_matches"] if not r["is_manual"]]) == 5

    def test_admin_list_shows_scoped_numbers(self, client, auth_headers):
        w = self._world(client)
        base = "/api/admin/player-profiles?q=Pat"
        assert client.get(base, headers=auth_headers).json()[0]["elo_padel_matches"] == 9
        assert client.get(f"{base}&club_id=k1", headers=auth_headers).json()[0]["elo_padel_matches"] == 3
        assert client.get(f"{base}&community_id=c1", headers=auth_headers).json()[0]["elo_padel_matches"] == 5
        detail = client.get(f"/api/admin/player-profiles/{w['pat']}?club_id=k1", headers=auth_headers).json()
        assert detail["elo_padel_matches"] == 3 and detail["elo_tennis_matches"] == 1


class TestResolveScope:
    def test_kinds_and_precedence(self, client):
        assert resolve_scope().kind == "global"
        assert resolve_scope(community_id="c1").kind == "community"
        assert resolve_scope(community_id="c1", club_id="k1").kind == "club"
        assert resolve_scope(sport="all").sport is None
        assert resolve_scope(club_id="").club_id is None

    def test_season_fixes_club_and_rejects_foreign_club(self, client):
        now = datetime.now(timezone.utc).isoformat()
        _make_club(_insert_profile("S"), "k1")
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO seasons (id, club_id, name, active, created_at) VALUES ('s1', 'k1', 'S', 1, ?)", (now,)
            )
        scope = resolve_scope(season_id="s1")
        assert (scope.kind, scope.club_id) == ("season", "k1")
        with pytest.raises(HTTPException) as err:
            resolve_scope(season_id="s1", club_id="k2")
        assert err.value.status_code == 404
        with pytest.raises(HTTPException):
            resolve_scope(season_id="missing")

    def test_cache_key_distinguishes_scopes(self):
        keys = {
            RatingScope(club_id="k1").cache_key(),
            RatingScope(club_id="k1", sport="padel").cache_key(),
            RatingScope(club_id="k1", season_id="s").cache_key(),
            RatingScope().cache_key(),
        }
        assert len(keys) == 4

    def test_scope_stats_empty_profile_list(self, client):
        with db_mod.get_db() as conn:
            assert scope_stats(conn, RatingScope(), profile_ids=[]) == {}
