"""
Tests for the organizer custom information, the old-banner migration and match comments.
"""

from __future__ import annotations


class TestBannerAndComments:
    """Tests for TV-settings organizer text and match comment API endpoints."""

    GP_BODY = {
        "name": "Banner Test",
        "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
        "team_mode": False,
        "court_names": ["Court 1", "Court 2"],
        "num_groups": 2,
        "top_per_group": 2,
        "double_elimination": False,
    }

    def _create(self, client, auth_headers) -> str:
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    # ── Organizer text ─────────────────────────────────────

    def test_anonymous_tv_settings_returns_custom_info(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        public = client.get(f"/api/tournaments/{tid}/tv-settings").json()
        assert public["custom_info_title"] == ""
        assert public["custom_info_text"] == ""
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"custom_info_title": "Format", "custom_info_text": "**Short sets**"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        # No auth header: the Player Hub and the TV page read this anonymously.
        public = client.get(f"/api/tournaments/{tid}/tv-settings").json()
        assert public["custom_info_title"] == "Format"
        assert public["custom_info_text"] == "**Short sets**"

    def test_custom_tv_info_defaults_and_partial_update(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        settings = client.get(f"/api/tournaments/{tid}/tv-settings").json()
        assert settings["custom_info_title"] == ""
        assert settings["custom_info_text"] == ""

        updated = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"custom_info_title": "Tournament format", "custom_info_text": "Short sets\nNo-ad scoring"},
            headers=auth_headers,
        )
        assert updated.status_code == 200
        assert updated.json()["custom_info_title"] == "Tournament format"
        assert updated.json()["custom_info_text"] == "Short sets\nNo-ad scoring"

        updated = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"show_courts": False},
            headers=auth_headers,
        )
        assert updated.json()["custom_info_title"] == "Tournament format"
        assert updated.json()["custom_info_text"] == "Short sets\nNo-ad scoring"

    def test_banner_text_is_no_longer_a_setting(self, client, auth_headers):
        """The banner became pinned announcements; tv-settings ignores the old key."""
        tid = self._create(client, auth_headers)
        r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"banner_text": "Old"}, headers=auth_headers)
        assert r.status_code == 200
        assert "banner_text" not in r.json()
        assert r.json()["announcements"] == []

    # ── Match comments ─────────────────────────────────────

    def test_set_match_comment(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        pending = [m for m in all_matches if m["status"] != "completed"]
        assert len(pending) > 0

        match_id = pending[0]["id"]
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Play on time!"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["comment"] == "Play on time!"

        # Verify comment is serialized in response
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        match = next(m for ms in groups["matches"].values() for m in ms if m["id"] == match_id)
        assert match["comment"] == "Play on time!"

    def test_clear_match_comment(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        match_id = all_matches[0]["id"]

        # Set then clear
        client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Temp"},
            headers=auth_headers,
        )
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": ""},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["comment"] == ""

    def test_match_comment_requires_auth(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        match_id = all_matches[0]["id"]

        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Nope"},
        )
        assert r.status_code in (401, 403)

    def test_match_comment_not_found(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": "nonexistent", "comment": "test"},
            headers=auth_headers,
        )
        assert r.status_code == 404

    def test_match_comment_tournament_not_found(self, client, auth_headers):
        r = client.patch(
            "/api/tournaments/fake/match-comment",
            json={"match_id": "x", "comment": "test"},
            headers=auth_headers,
        )
        assert r.status_code == 404

    def test_comment_max_length_enforced(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        match_id = all_matches[0]["id"]

        long_comment = "x" * 501
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": long_comment},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_match_comment_default_empty_in_serialized_match(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        assert all(m.get("comment", "") == "" for m in all_matches)

    def test_comment_on_mexicano_match(self, client, auth_headers):
        """Comments work across tournament types (mexicano)."""
        body = {
            "name": "Mex Comment Test",
            "player_names": ["A", "B", "C", "D"],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "num_rounds": 2,
        }
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)

        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        current = matches["current_matches"]
        assert len(current) > 0

        match_id = current[0]["id"]
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Vamos!"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["comment"] == "Vamos!"

    def test_comment_on_playoff_match(self, client, auth_headers):
        """Comments work on standalone playoff matches."""
        body = {
            "name": "PO Comment Test",
            "participant_names": ["A & B", "C & D", "E & F", "G & H"],
            "court_names": ["Court 1"],
            "team_mode": True,
        }
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]

        playoffs = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
        pending = [m for m in playoffs.get("pending", []) if m["status"] != "completed"]
        assert len(pending) > 0

        match_id = pending[0]["id"]
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Semi-final!"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["comment"] == "Semi-final!"


def test_init_db_moves_old_banners_into_pinned_announcements(tmp_path, monkeypatch):
    """A stored ``tv_settings.banner_text`` becomes a pinned announcement, once."""
    import json
    import sqlite3

    from backend.api import db as db_mod

    monkeypatch.setattr(db_mod, "DB_PATH", tmp_path / "padel.db")
    db_mod.init_db()
    older = json.dumps(
        [{"id": "a1", "text": "Earlier post", "created_at": "2026-01-02T10:00:00+00:00", "pinned": False}]
    )
    with sqlite3.connect(tmp_path / "padel.db") as conn:
        conn.execute(
            "INSERT INTO tournaments (id, name, type, owner, tv_settings, tournament_blob, created_at, announcements)"
            " VALUES ('t1', 'Cup', 'mexicano', 'admin', ?, x'', '2026-01-01 09:30:00', ?)",
            (json.dumps({"banner_text": "  Doors close at **nine**  ", "show_courts": False}), older),
        )
        conn.execute(
            "INSERT INTO tournaments (id, name, type, owner, tv_settings, tournament_blob) VALUES ('t2', 'Empty', 'mexicano', 'admin', ?, x'')",
            (json.dumps({"banner_text": ""}),),
        )
    db_mod.init_db()
    db_mod.init_db()  # idempotent
    with sqlite3.connect(tmp_path / "padel.db") as conn:
        rows = {
            r[0]: (json.loads(r[1]), r[2])
            for r in conn.execute("SELECT id, tv_settings, announcements FROM tournaments")
        }
    settings, raw = rows["t1"]
    assert settings == {"show_courts": False}
    items = json.loads(raw)
    assert [(a["text"], a["pinned"]) for a in items] == [("Doors close at **nine**", True), ("Earlier post", False)]
    assert items[0]["created_at"] == "2026-01-01T09:30:00+00:00"
    assert rows["t2"] == ({}, None)
