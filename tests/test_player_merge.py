"""Unit tests for the shared player-merge primitives (``backend.api.player_merge``)."""

from __future__ import annotations

from datetime import datetime, timezone

from backend.api import db as db_mod
from backend.api.player_merge import materialize_participants, normalize_name


class TestNormalizeName:
    def test_accent_case_punctuation_collapse_to_same_key(self) -> None:
        assert normalize_name("José M. Ruiz") == normalize_name("jose m ruiz")
        assert normalize_name("  Ann-Marie  O'Neil ") == normalize_name("ann marie o neil")

    def test_distinct_names_differ(self) -> None:
        assert normalize_name("Maria Garcia") != normalize_name("Marta Garcia")

    def test_empty_and_none_safe(self) -> None:
        assert normalize_name("") == ""
        assert normalize_name(None) == ""  # type: ignore[arg-type]


def _insert_raw_history(player_id: str, name: str, tid: str = "t-raw") -> None:
    """A finished participation with no linked profile (profile_id NULL)."""
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO player_history
               (profile_id, entity_type, entity_id, entity_name, player_id, player_name,
                finished_at, sport, top_partners, top_rivals, all_partners, all_rivals)
               VALUES (NULL, 'tournament', ?, 'Raw T', ?, ?, ?, 'padel', '[]', '[]', '[]', '[]')""",
            (tid, player_id, name, now),
        )


class TestMaterializeParticipants:
    def test_raw_participant_becomes_ghost_and_links(self) -> None:
        _insert_raw_history("raw1", "Wandering Will")
        ids = materialize_participants(["raw1"])
        assert ids == ["ghost_raw1"]
        with db_mod.get_db() as conn:
            prof = conn.execute("SELECT is_ghost, name FROM player_profiles WHERE id = 'ghost_raw1'").fetchone()
            linked = conn.execute("SELECT profile_id FROM player_history WHERE player_id = 'raw1'").fetchone()
        assert prof is not None and prof["is_ghost"] == 1
        assert linked["profile_id"] == "ghost_raw1"

    def test_idempotent_and_deduplicated(self) -> None:
        _insert_raw_history("raw2", "Repeat Rita")
        first = materialize_participants(["raw2", "raw2"])
        second = materialize_participants(["raw2"])
        assert first == ["ghost_raw2"]
        assert second == ["ghost_raw2"]
        with db_mod.get_db() as conn:
            n = conn.execute("SELECT COUNT(*) AS n FROM player_profiles WHERE id = 'ghost_raw2'").fetchone()["n"]
        assert n == 1

    def test_unknown_player_id_skipped(self) -> None:
        assert materialize_participants(["does-not-exist", ""]) == []
