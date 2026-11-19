"""Tests for the ELO persistence layer."""

from __future__ import annotations


import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.api.elo_store import (
    delete_tournament_elos,
    get_profile_elo,
    get_tournament_elos,
    get_tournament_match_counts,
    initialize_tournament_elos,
    reset_tournament_elos,
    refresh_profile_elo,
    upsert_tournament_elo,
    upsert_tournament_elo_log,
)
from backend.tournaments.elo import DEFAULT_RATING, EloUpdate


@pytest.fixture()
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# initialize + get
# ---------------------------------------------------------------------------


class TestInitializeAndGet:
    def test_initialize_creates_rows(self) -> None:
        tid = "tm_test1"
        pids = ["p1", "p2", "p3"]
        initialize_tournament_elos(tid, pids)
        elos = get_tournament_elos(tid)
        assert len(elos) == 3
        for pid in pids:
            assert elos[pid] == DEFAULT_RATING

    def test_initialize_idempotent(self) -> None:
        tid = "tm_test2"
        initialize_tournament_elos(tid, ["p1"])
        # Upsert changes elo_after
        upsert_tournament_elo(
            tid,
            [
                EloUpdate(
                    player_id="p1",
                    elo_before=1000,
                    elo_after=1050,
                    matches_before=0,
                    matches_after=1,
                )
            ],
        )
        # Re-initialize should NOT overwrite (INSERT OR IGNORE)
        initialize_tournament_elos(tid, ["p1"])
        elos = get_tournament_elos(tid)
        assert elos["p1"] == 1050.0

    def test_get_match_counts(self) -> None:
        tid = "tm_test3"
        initialize_tournament_elos(tid, ["p1", "p2"])
        upsert_tournament_elo(
            tid,
            [
                EloUpdate(player_id="p1", elo_before=1000, elo_after=1020, matches_before=0, matches_after=1),
                EloUpdate(player_id="p2", elo_before=1000, elo_after=980, matches_before=0, matches_after=1),
            ],
        )
        counts = get_tournament_match_counts(tid)
        assert counts["p1"] == 1
        assert counts["p2"] == 1

    def test_sport_isolation(self) -> None:
        tid = "tm_test4"
        initialize_tournament_elos(tid, ["p1"], sport="padel")
        initialize_tournament_elos(tid, ["p1"], sport="tennis")
        upsert_tournament_elo(
            tid,
            [
                EloUpdate(player_id="p1", elo_before=1000, elo_after=1100, matches_before=0, matches_after=5),
            ],
            sport="padel",
        )
        upsert_tournament_elo(
            tid,
            [
                EloUpdate(player_id="p1", elo_before=1000, elo_after=900, matches_before=0, matches_after=3),
            ],
            sport="tennis",
        )
        assert get_tournament_elos(tid, sport="padel")["p1"] == 1100.0
        assert get_tournament_elos(tid, sport="tennis")["p1"] == 900.0


# ---------------------------------------------------------------------------
# upsert
# ---------------------------------------------------------------------------


class TestUpsert:
    def test_upsert_updates_existing(self) -> None:
        tid = "tm_upsert1"
        initialize_tournament_elos(tid, ["p1"])
        upsert_tournament_elo(
            tid,
            [
                EloUpdate(player_id="p1", elo_before=1000, elo_after=1020, matches_before=0, matches_after=1),
            ],
        )
        assert get_tournament_elos(tid)["p1"] == 1020.0
        # Second upsert
        upsert_tournament_elo(
            tid,
            [
                EloUpdate(player_id="p1", elo_before=1020, elo_after=1045, matches_before=1, matches_after=2),
            ],
        )
        assert get_tournament_elos(tid)["p1"] == 1045.0
        assert get_tournament_match_counts(tid)["p1"] == 2


# ---------------------------------------------------------------------------
# reset / delete
# ---------------------------------------------------------------------------


class TestResetDelete:
    def test_reset_clears_sport(self) -> None:
        tid = "tm_reset1"
        initialize_tournament_elos(tid, ["p1"], sport="padel")
        initialize_tournament_elos(tid, ["p1"], sport="tennis")
        reset_tournament_elos(tid, sport="padel")
        assert get_tournament_elos(tid, sport="padel") == {}
        assert len(get_tournament_elos(tid, sport="tennis")) == 1

    def test_delete_clears_all(self) -> None:
        tid = "tm_del1"
        initialize_tournament_elos(tid, ["p1"], sport="padel")
        initialize_tournament_elos(tid, ["p1"], sport="tennis")
        delete_tournament_elos(tid)
        assert get_tournament_elos(tid, sport="padel") == {}
        assert get_tournament_elos(tid, sport="tennis") == {}


# ---------------------------------------------------------------------------
# Profile ELO
# ---------------------------------------------------------------------------


class TestProfileElo:
    def test_get_profile_elo_nonexistent(self) -> None:
        result = get_profile_elo("nonexistent")
        assert result["elo_padel"] == DEFAULT_RATING
        assert result["elo_tennis"] == DEFAULT_RATING


# ---------------------------------------------------------------------------
# Rebuilding a profile from its rated matches
# ---------------------------------------------------------------------------


class TestRefreshProfileElo:
    def test_rating_per_community_is_its_latest_match(self, client) -> None:
        from backend.api.db import get_db
        from backend.models import Match, MatchStatus, Player

        with get_db() as conn:
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, created_at) VALUES (?, ?, ?, datetime('now'))",
                ("prof_retro", "phrase-retro", "Charlie"),
            )
            conn.execute(
                "INSERT INTO communities (id, name, created_by, created_at) VALUES ('c2', 'C2', 'admin', datetime('now'))"
            )
            for tid, community in (("tm_a", "open"), ("tm_b", "open"), ("tm_c", "c2")):
                conn.execute(
                    "INSERT INTO tournaments (id, name, type, owner, tournament_blob, sport, community_id)"
                    " VALUES (?, ?, 'mexicano', 'admin', X'80', 'padel', ?)",
                    (tid, tid, community),
                )
                conn.execute(
                    "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)"
                    " VALUES (?, 'px', 'Charlie', ?, ?, 'prof_retro')",
                    (tid, f"pp-{tid}", f"tok-{tid}"),
                )

        def log(tid: str, match_id: str, before: float, after: float, minute: int) -> None:
            match = Match(
                id=match_id,
                team1=[Player(id="px", name="Charlie")],
                team2=[Player(id="py", name="Y")],
                status=MatchStatus.COMPLETED,
                score=(6, 3),
            )
            update = EloUpdate(player_id="px", elo_before=before, elo_after=after, matches_before=0, matches_after=1)
            upsert_tournament_elo_log(tid, match, [update], "padel", updated_at=f"2026-01-01T00:{minute:02d}:00+00:00")

        # Two open tournaments interleaved on one chain, then a match in c2.
        log("tm_a", "m1", 1000, 1020, 1)
        log("tm_b", "m2", 1020, 1035, 2)
        log("tm_a", "m3", 1035, 1030, 3)
        log("tm_c", "m4", 1000, 990, 4)

        refresh_profile_elo("prof_retro")

        assert get_profile_elo("prof_retro", "open")["elo_padel"] == 1030.0
        assert get_profile_elo("prof_retro", "open")["elo_padel_matches"] == 3
        assert get_profile_elo("prof_retro", "c2")["elo_padel"] == 990.0
        # The flat columns follow the community played in last.
        with get_db() as conn:
            row = conn.execute(
                "SELECT elo_padel, elo_padel_matches FROM player_profiles WHERE id = 'prof_retro'"
            ).fetchone()
        assert (row["elo_padel"], row["elo_padel_matches"]) == (990.0, 1)
