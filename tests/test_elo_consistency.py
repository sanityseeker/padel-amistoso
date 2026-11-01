"""Cross-surface consistency of ELO ratings and match counts.

Guards against the admin panel, the Player Hub headers / chips and the
leaderboards disagreeing about how many rated matches a profile has played or
what its current rating is.  Each scenario drives the real store functions the
score routes call (seed → update → log → sync → finish) rather than inserting
pre-cooked rows, so the numbers reflect the actual write path.
"""

from __future__ import annotations

from datetime import datetime, timezone

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
from backend.api.state import _tournaments
from backend.models import Match, MatchStatus, Player
from backend.tournaments.elo import compute_match_elo_updates
from tests.test_elo_recalc_continuity import _insert_profile, _link_player

_BASE_TS = 1_700_000_000


def _insert_tournament(tid: str, community_id: str = "open", club_id: str | None = None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, 'admin', ?)",
            (community_id, f"Community {community_id}", now),
        )
        conn.execute(
            """INSERT OR IGNORE INTO tournaments
               (id, name, type, owner, public, tournament_blob, version, sport, community_id, club_id)
               VALUES (?, ?, 'mexicano', 'admin', 1, ?, 0, 'padel', ?, ?)""",
            (tid, f"T-{tid}", b"", community_id, club_id),
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
