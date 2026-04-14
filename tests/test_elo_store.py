"""Tests for the ELO persistence layer."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.api.elo_store import (
    bulk_transfer_elos_to_profiles,
    delete_tournament_elos,
    get_profile_elo,
    get_tournament_elos,
    get_tournament_match_counts,
    initialize_tournament_elos,
    reset_tournament_elos,
    retroactive_transfer_elo,
    transfer_elo_to_profile,
    upsert_tournament_elo,
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

    def test_transfer_and_get(self, client) -> None:
        """Create a profile, tournament elo rows, transfer, and verify."""
        from backend.api.db import get_db

        # Create a profile directly
        with get_db() as conn:
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, created_at) VALUES (?, ?, ?, datetime('now'))",
                ("prof1", "secret-phrase-1", "Alice"),
            )
            # Create a player_secrets row linking player to profile
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                ("tm_t1", "p1", "Alice", "secret-phrase-1", "tok1", "prof1"),
            )
            # Create a player_history row
            conn.execute(
                "INSERT INTO player_history (profile_id, entity_type, entity_id, player_id, finished_at)"
                " VALUES (?, 'tournament', ?, ?, datetime('now'))",
                ("prof1", "tm_t1", "p1"),
            )

        # Simulate tournament ELO
        initialize_tournament_elos("tm_t1", ["p1"])
        upsert_tournament_elo(
            "tm_t1",
            [
                EloUpdate(player_id="p1", elo_before=1000, elo_after=1080, matches_before=0, matches_after=5),
            ],
        )

        transfer_elo_to_profile("prof1", "tm_t1", "p1", sport="padel")

        elo = get_profile_elo("prof1")
        assert elo["elo_padel"] == 1080.0
        assert elo["elo_padel_matches"] == 5
        assert elo["elo_tennis"] == DEFAULT_RATING  # untouched

        # Verify player_history was updated
        with get_db() as conn:
            ph = conn.execute(
                "SELECT elo_before, elo_after FROM player_history WHERE profile_id = ? AND entity_id = ?",
                ("prof1", "tm_t1"),
            ).fetchone()
        assert ph["elo_before"] == 1000.0
        assert ph["elo_after"] == 1080.0

    def test_bulk_transfer(self, client) -> None:
        from backend.api.db import get_db

        with get_db() as conn:
            # Two profiles
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, created_at) VALUES (?, ?, ?, datetime('now'))",
                ("prof_a", "phrase-a", "Alice"),
            )
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, created_at) VALUES (?, ?, ?, datetime('now'))",
                ("prof_b", "phrase-b", "Bob"),
            )
            # Link players to profiles
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                ("tm_bulk", "pa", "Alice", "phrase-a", "toka", "prof_a"),
            )
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                ("tm_bulk", "pb", "Bob", "phrase-b", "tokb", "prof_b"),
            )
            # History rows
            for prof, pid in [("prof_a", "pa"), ("prof_b", "pb")]:
                conn.execute(
                    "INSERT INTO player_history (profile_id, entity_type, entity_id, player_id, finished_at)"
                    " VALUES (?, 'tournament', ?, ?, datetime('now'))",
                    (prof, "tm_bulk", pid),
                )

        initialize_tournament_elos("tm_bulk", ["pa", "pb"])
        upsert_tournament_elo(
            "tm_bulk",
            [
                EloUpdate(player_id="pa", elo_before=1000, elo_after=1060, matches_before=0, matches_after=3),
                EloUpdate(player_id="pb", elo_before=1000, elo_after=940, matches_before=0, matches_after=3),
            ],
        )

        bulk_transfer_elos_to_profiles("tm_bulk", sport="padel")

        assert get_profile_elo("prof_a")["elo_padel"] == 1060.0
        assert get_profile_elo("prof_b")["elo_padel"] == 940.0


# ---------------------------------------------------------------------------
# Retroactive transfer
# ---------------------------------------------------------------------------


class TestRetroactiveTransfer:
    def test_retroactive_applies_chronologically(self, client) -> None:
        from backend.api.db import get_db

        with get_db() as conn:
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, created_at) VALUES (?, ?, ?, datetime('now'))",
                ("prof_retro", "phrase-retro", "Charlie"),
            )
            # History rows for two tournaments
            for tid in ["tm_old", "tm_new"]:
                conn.execute(
                    "INSERT INTO player_history (profile_id, entity_type, entity_id, player_id, finished_at)"
                    " VALUES (?, 'tournament', ?, ?, datetime('now'))",
                    ("prof_retro", tid, "px"),
                )

        # Simulate two tournaments played sequentially
        initialize_tournament_elos("tm_old", ["px"])
        upsert_tournament_elo(
            "tm_old",
            [
                EloUpdate(player_id="px", elo_before=1000, elo_after=1050, matches_before=0, matches_after=4),
            ],
        )
        initialize_tournament_elos("tm_new", ["px"])
        upsert_tournament_elo(
            "tm_new",
            [
                EloUpdate(player_id="px", elo_before=1050, elo_after=1030, matches_before=4, matches_after=7),
            ],
        )

        retroactive_transfer_elo("prof_retro", "px")

        elo = get_profile_elo("prof_retro")
        # Final ELO should be from the later tournament
        assert elo["elo_padel"] == 1030.0
        assert elo["elo_padel_matches"] == 7
