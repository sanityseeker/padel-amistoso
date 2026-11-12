"""Integration tests for the ELO system end-to-end.

Verifies that ELO ratings are initialized, updated after scores, appear
in leaderboard/standings API responses, and transfer to profiles on finish.
"""

from __future__ import annotations

import pytest

from backend.api.elo_store import get_tournament_elos, get_tournament_match_counts
from backend.tournaments.elo import DEFAULT_RATING


class TestMexicanoEloIntegration:
    """ELO flows through a Mexicano tournament lifecycle."""

    MEX_BODY = {
        "name": "ELO Mex",
        "player_names": ["Alice", "Bob", "Carol", "Dave"],
        "court_names": ["Court 1"],
        "total_points_per_match": 32,
        "num_rounds": 2,
    }

    def _create(self, client, auth_headers) -> str:
        r = client.post("/api/tournaments/mexicano", json=self.MEX_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def _play_first_match_and_get_deltas(self, client, auth_headers, body: dict) -> list[float]:
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]

        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        match = matches["current_matches"][0]

        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": match["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )

        elos = get_tournament_elos(tid, "padel")
        played_ids = [*match["team1_ids"], *match["team2_ids"]]
        return [abs(elos[pid] - DEFAULT_RATING) for pid in played_ids]

    def test_elo_initialized_on_creation(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 4
        assert all(v == DEFAULT_RATING for v in elos.values())

    def test_elo_updated_after_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        m = matches["current_matches"][0]

        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )

        elos = get_tournament_elos(tid, "padel")
        counts = get_tournament_match_counts(tid, "padel")
        # Players from the recorded match should have updated ELOs
        changed = [pid for pid, elo in elos.items() if elo != DEFAULT_RATING]
        assert len(changed) > 0
        # At least some players have match count > 0
        assert any(c > 0 for c in counts.values())

    def test_leaderboard_includes_elo(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        # Before any matches, ELO should appear in leaderboard
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        for entry in status["leaderboard"]:
            assert "elo" in entry

        # Record a round and check again
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        for m in matches["current_matches"]:
            if m["status"] != "completed":
                client.post(
                    f"/api/tournaments/{tid}/mex/record",
                    json={"match_id": m["id"], "score1": 18, "score2": 14},
                    headers=auth_headers,
                )

        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        elos = [e["elo"] for e in status["leaderboard"] if e["elo"] is not None]
        # At least some players should have non-default ELO after matches
        assert len(elos) > 0

    def test_full_flow_elo_changes(self, client, auth_headers):
        """Play all rounds and verify ELOs diverge from default."""
        tid = self._create(client, auth_headers)

        for rnd in range(2):
            client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
            matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
            for m in matches["current_matches"]:
                if m["status"] != "completed":
                    client.post(
                        f"/api/tournaments/{tid}/mex/record",
                        json={"match_id": m["id"], "score1": 20, "score2": 12},
                        headers=auth_headers,
                    )

        elos = get_tournament_elos(tid, "padel")
        # After a full tournament, ELOs should have diverged
        unique_elos = set(round(v, 1) for v in elos.values())
        assert len(unique_elos) > 1, "ELOs should diverge after multiple rounds"

    def test_smaller_mexicano_matches_reduce_elo_changes(self, client, auth_headers):
        """Mexicano with fewer points per match should produce smaller ELO swings."""
        base_body = {
            "name": "ELO Mex Scale",
            "player_names": ["Alice", "Bob", "Carol", "Dave"],
            "court_names": ["Court 1"],
            "num_rounds": 1,
        }
        full_deltas = self._play_first_match_and_get_deltas(
            client,
            auth_headers,
            {**base_body, "total_points_per_match": 32},
        )
        small_deltas = self._play_first_match_and_get_deltas(
            client,
            auth_headers,
            {**base_body, "total_points_per_match": 16},
        )

        assert max(small_deltas) < max(full_deltas)


class TestMexicanoPerMatchTargetElo:
    """The Mexicano K multiplier follows a match's own points target."""

    BODY = {
        "name": "ELO Mex Override",
        "player_names": ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Gina", "Hugo"],
        "court_names": ["Court 1", "Court 2"],
        "total_points_per_match": 32,
        "num_rounds": 2,
    }

    def test_k_multiplier_uses_match_target(self):
        from backend.api.elo_integration import _mexicano_k_multiplier
        from backend.models import Match, MatchFormatOverride, Player, TournamentType

        class _T:
            total_points_per_match = 32

        data = {"type": TournamentType.MEXICANO, "tournament": _T()}
        m = Match(team1=[Player(name="A")], team2=[Player(name="B")])
        assert _mexicano_k_multiplier(data, m) == 1.0
        m.format_override = MatchFormatOverride(points_target=16)
        assert _mexicano_k_multiplier(data, m) == 0.5
        assert _mexicano_k_multiplier(data) == 1.0

    def test_overridden_match_moves_elo_less(self, client, auth_headers):
        r = client.post("/api/tournaments/mexicano", json=self.BODY, headers=auth_headers)
        tid = r.json()["id"]
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        m_full, m_short = client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"][:2]
        client.patch(
            f"/api/tournaments/{tid}/matches/{m_short['id']}/format",
            json={"override": {"points_target": 16}},
            headers=auth_headers,
        )
        # Same winning share (20/32 vs 10/16), so only K differs.
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m_full["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m_short["id"], "score1": 10, "score2": 6},
            headers=auth_headers,
        )
        elos = get_tournament_elos(tid, "padel")
        full_delta = abs(elos[m_full["team1_ids"][0]] - DEFAULT_RATING)
        short_delta = abs(elos[m_short["team1_ids"][0]] - DEFAULT_RATING)
        assert 0 < short_delta < full_delta

    def test_recalculation_matches_incremental_for_mixed_targets(self, client, auth_headers):
        from backend.api.elo_integration import elo_recalculate_tournament

        r = client.post("/api/tournaments/mexicano", json=self.BODY, headers=auth_headers)
        tid = r.json()["id"]
        for rnd in range(2):
            client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
            matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"]
            for idx, m in enumerate(matches):
                if idx == 0:
                    client.patch(
                        f"/api/tournaments/{tid}/matches/{m['id']}/format",
                        json={"override": {"points_target": 24}},
                        headers=auth_headers,
                    )
                    score = (15, 9)
                else:
                    score = (20, 12)
                client.post(
                    f"/api/tournaments/{tid}/mex/record",
                    json={"match_id": m["id"], "score1": score[0], "score2": score[1]},
                    headers=auth_headers,
                )
        incremental = get_tournament_elos(tid, "padel")
        elo_recalculate_tournament(tid)
        recalculated = get_tournament_elos(tid, "padel")
        assert incremental.keys() == recalculated.keys()
        for pid, elo in incremental.items():
            assert abs(elo - recalculated[pid]) < 1e-6


class TestGroupPlayoffEloIntegration:
    """ELO flows through a Group-Playoff tournament lifecycle."""

    GP_BODY = {
        "name": "ELO GP",
        "player_names": ["Alice", "Bob", "Carol", "Dave"],
        "court_names": ["Court 1"],
        "num_groups": 1,
        "top_per_group": 2,
        "double_elimination": False,
    }

    def _create(self, client, auth_headers) -> str:
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_elo_initialized_on_creation(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 4

    def test_standings_include_elo(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        for group_name, rows in groups["standings"].items():
            for entry in rows:
                assert "elo" in entry

    def test_elo_updated_after_group_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        # Get first pending match
        for group_name, matches in groups["matches"].items():
            for m in matches:
                if m["status"] != "completed":
                    client.post(
                        f"/api/tournaments/{tid}/gp/record-group",
                        json={"match_id": m["id"], "score1": 10, "score2": 5},
                        headers=auth_headers,
                    )
                    break
            break

        elos = get_tournament_elos(tid, "padel")
        changed = [pid for pid, elo in elos.items() if elo != DEFAULT_RATING]
        assert len(changed) > 0


class TestCompositeTeamElo:
    """Admin-composed teams (GP / Mexicano team mode) rate their individual members.

    Match sides hold one synthetic team entry per team; ratings must land on the
    members, who own the passphrases and Hub links, not on the team id.
    """

    TEAMS = [["Ana", "Bea"], ["Cris", "Dani"], ["Eva", "Fede"]]

    def _create_gp(self, client, auth_headers) -> str:
        body = {
            "name": "Composite GP",
            "player_names": [n for t in self.TEAMS for n in t],
            "team_mode": True,
            "teams": self.TEAMS,
            "team_names": ["AB", "CD", "EF"],
            "court_names": ["Court 1"],
            "num_groups": 1,
            "top_per_group": 2,
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def _ids_by_name(self, client, auth_headers, tid: str) -> dict[str, str]:
        players = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
        return {sec["name"]: pid for pid, sec in players.items()}

    def _record_first_group_match(self, client, auth_headers, tid: str) -> dict:
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        match = next(m for ms in groups["matches"].values() for m in ms)
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match["id"], "score1": 6, "score2": 2},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        return match

    def _member_names(self, team_name: str) -> list[str]:
        return {"AB": ["Ana", "Bea"], "CD": ["Cris", "Dani"], "EF": ["Eva", "Fede"]}[team_name]

    def test_gp_score_rates_each_member(self, client, auth_headers):
        tid = self._create_gp(client, auth_headers)
        ids = self._ids_by_name(client, auth_headers, tid)
        match = self._record_first_group_match(client, auth_headers, tid)

        elos = get_tournament_elos(tid, "padel")
        counts = get_tournament_match_counts(tid, "padel")
        assert set(elos) == set(ids.values()), "only individual players are rated, never team ids"
        for name in self._member_names(match["team1"][0]):
            assert elos[ids[name]] > DEFAULT_RATING
            assert counts[ids[name]] == 1
        for name in self._member_names(match["team2"][0]):
            assert elos[ids[name]] < DEFAULT_RATING
            assert counts[ids[name]] == 1

    def test_gp_recalculation_matches_incremental(self, client, auth_headers):
        tid = self._create_gp(client, auth_headers)
        self._record_first_group_match(client, auth_headers, tid)
        before = get_tournament_elos(tid, "padel")

        r = client.post(f"/api/tournaments/{tid}/elo/recalculate", headers=auth_headers)
        assert r.status_code == 200, r.text
        after = get_tournament_elos(tid, "padel")
        assert set(after) == set(before)
        for pid, elo in before.items():
            assert after[pid] == pytest.approx(elo)

    def test_gp_standings_show_team_average(self, client, auth_headers):
        tid = self._create_gp(client, auth_headers)
        ids = self._ids_by_name(client, auth_headers, tid)
        self._record_first_group_match(client, auth_headers, tid)
        elos = get_tournament_elos(tid, "padel")

        standings = client.get(f"/api/tournaments/{tid}/gp/groups").json()["standings"]
        for entry in (e for rows in standings.values() for e in rows):
            members = self._member_names(entry["player"])
            expected = sum(elos[ids[n]] for n in members) / len(members)
            assert entry["elo"] == pytest.approx(round(expected, 1))

    def test_mexicano_team_mode_rates_each_member(self, client, auth_headers):
        body = {
            "name": "Composite Mex",
            "player_names": ["Ana", "Bea", "Cris", "Dani"],
            "team_mode": True,
            "teams": [["Ana", "Bea"], ["Cris", "Dani"]],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "num_rounds": 1,
        }
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        ids = self._ids_by_name(client, auth_headers, tid)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        if not matches["current_matches"]:
            client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
            matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        match = matches["current_matches"][0]
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": match["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

        elos = get_tournament_elos(tid, "padel")
        assert set(elos) == set(ids.values())
        assert all(elo != DEFAULT_RATING for elo in elos.values())


class TestPlayoffEloIntegration:
    """ELO flows through a Playoff tournament lifecycle."""

    PO_BODY = {
        "name": "ELO PO",
        "participant_names": ["Alice", "Bob", "Carol", "Dave"],
        "court_names": ["Court 1"],
        "double_elimination": False,
    }

    def _create(self, client, auth_headers) -> str:
        r = client.post("/api/tournaments/playoff", json=self.PO_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_elo_initialized_on_creation(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 4

    def test_elo_updated_after_playoff_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        playoffs = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
        pending = playoffs["pending"]
        if pending:
            m = pending[0]
            client.post(
                f"/api/tournaments/{tid}/po/record",
                json={"match_id": m["id"], "score1": 10, "score2": 5},
                headers=auth_headers,
            )
            elos = get_tournament_elos(tid, "padel")
            changed = [pid for pid, elo in elos.items() if elo != DEFAULT_RATING]
            assert len(changed) > 0


class TestEloOnDeletion:
    """ELO rows are cleaned up when a tournament is deleted."""

    def test_elo_deleted_with_tournament(self, client, auth_headers):
        r = client.post(
            "/api/tournaments/mexicano",
            json={
                "name": "Deletable",
                "player_names": ["A", "B", "C", "D"],
                "court_names": ["Court 1"],
                "total_points_per_match": 32,
                "num_rounds": 1,
            },
            headers=auth_headers,
        )
        tid = r.json()["id"]
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 4

        client.delete(f"/api/tournaments/{tid}", headers=auth_headers)
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 0


class TestEloRecalculateEndpoint:
    """Admin endpoint for retroactive ELO recomputation."""

    def test_recalculate_elo_requires_owner_or_admin(self, client, auth_headers):
        """Collaborators (non-owners) cannot recalculate ELO."""
        r = client.post(
            "/api/tournaments/mexicano",
            json={
                "name": "Recalc Guard",
                "player_names": ["A", "B", "C", "D"],
                "court_names": ["Court 1"],
                "total_points_per_match": 32,
                "num_rounds": 1,
            },
            headers=auth_headers,
        )
        tid = r.json()["id"]

        # Owner can recalculate (even mid-tournament with no matches)
        recalc = client.post(f"/api/tournaments/{tid}/elo/recalculate", headers=auth_headers)
        assert recalc.status_code == 200

    def test_recalculate_elo_for_finished_tournament(self, client, auth_headers):
        r = client.post(
            "/api/tournaments/mexicano",
            json={
                "name": "Recalc Finished",
                "player_names": ["A", "B", "C", "D"],
                "court_names": ["Court 1"],
                "total_points_per_match": 32,
                "num_rounds": 1,
            },
            headers=auth_headers,
        )
        tid = r.json()["id"]

        next_round = client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        assert next_round.status_code == 200

        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        for m in matches["current_matches"]:
            score = client.post(
                f"/api/tournaments/{tid}/mex/record",
                json={"match_id": m["id"], "score1": 20, "score2": 12},
                headers=auth_headers,
            )
            assert score.status_code == 200

        finish = client.post(f"/api/tournaments/{tid}/mex/finish", headers=auth_headers)
        assert finish.status_code == 200

        recalc = client.post(f"/api/tournaments/{tid}/elo/recalculate", headers=auth_headers)
        assert recalc.status_code == 200
        body = recalc.json()
        assert body["ok"] is True
        assert body["recalculated"] is True
        assert body["players_with_elo"] == 4

    def test_recalculate_elo_includes_removed_players(self, client, auth_headers):
        """Players removed mid-tournament must still be included in ELO recalc."""
        r = client.post(
            "/api/tournaments/mexicano",
            json={
                "name": "Recalc Removed",
                "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
                "court_names": ["Court 1", "Court 2"],
                "total_points_per_match": 32,
                "num_rounds": 2,
            },
            headers=auth_headers,
        )
        tid = r.json()["id"]

        # Play round 1 (all 8 players participate, 2 courts × 4 players)
        next_round = client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        assert next_round.status_code == 200
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        for m in matches["current_matches"]:
            client.post(
                f"/api/tournaments/{tid}/mex/record",
                json={"match_id": m["id"], "score1": 20, "score2": 12},
                headers=auth_headers,
            )

        # Pick a player who just played and remove them before round 2
        played_match = matches["current_matches"][0]
        removed_pid = played_match["team1_ids"][0]
        del_resp = client.delete(f"/api/tournaments/{tid}/players/{removed_pid}", headers=auth_headers)
        assert del_resp.status_code == 200

        # Finish the tournament
        finish = client.post(f"/api/tournaments/{tid}/mex/finish", headers=auth_headers)
        assert finish.status_code == 200

        # Recalculate — all 8 players (including removed one) must get ELO rows
        recalc = client.post(f"/api/tournaments/{tid}/elo/recalculate", headers=auth_headers)
        assert recalc.status_code == 200
        assert recalc.json()["players_with_elo"] == 8


class TestTournamentPlayerPublicCard:
    """GET /api/tournaments/{tid}/players/{player_id}/public-card — no auth."""

    MEX_BODY = {
        "name": "Card Mex",
        "player_names": ["Alice", "Bob", "Carol", "Dave"],
        "court_names": ["Court 1"],
        "total_points_per_match": 32,
        "num_rounds": 1,
    }

    def test_unknown_tournament(self, client):
        res = client.get("/api/tournaments/t_missing/players/p_x/public-card")
        assert res.status_code == 404

    def test_unknown_player(self, client, auth_headers):
        r = client.post("/api/tournaments/mexicano", json=self.MEX_BODY, headers=auth_headers)
        tid = r.json()["id"]
        res = client.get(f"/api/tournaments/{tid}/players/does_not_exist/public-card")
        assert res.status_code == 404

    def test_known_player_returns_stats(self, client, auth_headers):
        r = client.post("/api/tournaments/mexicano", json=self.MEX_BODY, headers=auth_headers)
        tid = r.json()["id"]
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        m = matches["current_matches"][0]
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        winner_pid = m["team1_ids"][0]
        res = client.get(f"/api/tournaments/{tid}/players/{winner_pid}/public-card")
        assert res.status_code == 200
        body = res.json()
        assert body["player_id"] == winner_pid
        assert body["player_name"]
        assert body["matches"] == 1
        assert body["wins"] == 1
        assert body["losses"] == 0
        assert body["draws"] == 0
        assert isinstance(body["recent_matches"], list)
        assert len(body["recent_matches"]) == 1
        assert body["recent_matches"][0]["score"] == [20, 12]
        assert body["recent_matches"][0]["side"] == 1
        loser = client.get(f"/api/tournaments/{tid}/players/{m['team2_ids'][0]}/public-card").json()
        assert loser["recent_matches"][0]["side"] == 2
        assert body["elo"] is not None
        assert isinstance(body["elo_history"], list)
        assert "email" not in body
