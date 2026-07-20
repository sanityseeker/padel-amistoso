"""Unit tests for the shared player-merge primitives (``backend.api.player_merge``)."""

from __future__ import annotations

from datetime import datetime, timezone

from backend.api import db as db_mod
from backend.api.player_merge import (
    materialize_participants,
    normalize_name,
    reassign_profile_data,
    resolve_current_identities,
)


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


def _make_profile(profile_id: str, name: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO player_profiles (id, passphrase, name, created_at) VALUES (?, ?, ?, ?)",
            (profile_id, f"pass-{profile_id}", name, now),
        )


def _insert_linked_history(profile_id: str, player_id: str, name: str, tid: str) -> None:
    _insert_raw_history(player_id, name, tid)
    with db_mod.get_db() as conn:
        conn.execute("UPDATE player_history SET profile_id = ? WHERE player_id = ?", (profile_id, player_id))


class TestResolveCurrentIdentities:
    def test_old_player_ids_resolve_to_current_name(self) -> None:
        """The whole point: two tournaments, two old names, one current account."""
        _make_profile("prof-new", "Juan Pérez")
        _insert_linked_history("prof-new", "pid-old", "Juan", "t-id-1")
        _insert_linked_history("prof-new", "pid-newer", "Juan P", "t-id-2")

        with db_mod.get_db() as conn:
            resolved = resolve_current_identities(conn, ["pid-old", "pid-newer"])

        assert resolved["pid-old"] == ("prof-new", "Juan Pérez")
        assert resolved["pid-newer"] == ("prof-new", "Juan Pérez")

    def test_resolves_across_a_merge(self) -> None:
        _make_profile("prof-primary", "Ana Merged")
        _make_profile("prof-secondary", "Ana Old")
        _insert_linked_history("prof-secondary", "pid-merged", "Ana Old", "t-id-3")

        with db_mod.get_db() as conn:
            reassign_profile_data(conn, "prof-primary", "prof-secondary")
            resolved = resolve_current_identities(conn, ["pid-merged"])

        assert resolved["pid-merged"] == ("prof-primary", "Ana Merged")

    def test_unlinked_and_unknown_ids_absent(self) -> None:
        _insert_raw_history("pid-unlinked", "Nobody", "t-id-4")
        with db_mod.get_db() as conn:
            resolved = resolve_current_identities(conn, ["pid-unlinked", "pid-missing", ""])
        assert resolved == {}
