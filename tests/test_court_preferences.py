"""Preferred courts per group and per Espejo bracket side."""

from __future__ import annotations

from backend.models import Court, Player
from backend.tournaments.court_preferences import CourtPlan, clean_preferences
from backend.tournaments.group_playoff import GroupPlayoffTournament
from backend.tournaments.playoff_tournament import PlayoffTournament


def _courts(*names: str) -> list[Court]:
    return [Court(name=n) for n in names]


def _gp(group_courts: dict[str, list[str]] | None, courts: list[Court]) -> GroupPlayoffTournament:
    players = [Player(name=f"P{i}") for i in range(8)]
    t = GroupPlayoffTournament(
        players,
        num_groups=2,
        courts=courts,
        team_mode=True,
        group_courts=group_courts,
    )
    t.generate()
    return t


class TestCleanPreferences:
    def test_drops_unknown_names_duplicates_and_empty_scopes(self):
        courts = _courts("1", "2")
        assert clean_preferences({"A": ["1", " 1", "9"], "B": ["9"], "C": []}, courts) == {"A": ["1"]}


class TestCourtPlanPick:
    def test_own_court_first_then_unclaimed_then_any(self):
        c1, c2, c3 = _courts("1", "2", "3")
        players = [Player(name=str(i)) for i in range(12)]
        from backend.models import Match

        a1 = Match(team1=[players[0]], team2=[players[1]])
        a2 = Match(team1=[players[2]], team2=[players[3]])
        a3 = Match(team1=[players[4]], team2=[players[5]])
        scopes = {a1.id: "A", a2.id: "A", a3.id: "A"}
        plan = CourtPlan([c1, c2, c3], {"A": ["2"], "B": ["3"]}, lambda m: scopes.get(m.id))
        chosen = plan.pick([a1, a2, a3], [c1, c2, c3])
        # a1 gets A's court, a2 the unclaimed one, a3 borrows B's free court.
        assert chosen[id(a1)] is c2
        assert chosen[id(a2)] is c1
        assert chosen[id(a3)] is c3


def _play_out(t: GroupPlayoffTournament) -> None:
    """Finish the match that started first, one at a time, until the group stage is done."""
    while on := [m for m in t.all_group_matches() if m.on_court]:
        t.record_group_result(min(on, key=lambda m: m.slot_number).id, (6, 3))


class TestGroupCourts:
    def test_each_group_plays_on_its_own_court(self):
        t = _gp({"A": ["Court 1"], "B": ["Court 2"]}, _courts("Court 1", "Court 2"))
        _play_out(t)
        for g in t.groups:
            want = "Court 1" if g.name == "A" else "Court 2"
            assert {m.court.name for m in g.matches} == {want}

    def test_without_preferences_groups_share_courts(self):
        # No court is held for a group: once A is done, B plays on both courts.
        t = _gp(None, _courts("Court 1", "Court 2"))
        a = next(g for g in t.groups if g.name == "A")
        while on := [m for m in a.matches if m.on_court]:
            t.record_group_result(on[0].id, (6, 3))
        b = next(g for g in t.groups if g.name == "B")
        assert {m.court.name for m in b.matches if m.on_court} == {"Court 1", "Court 2"}

    def test_set_preferences_reassigns_and_update_courts_drops_removed(self):
        t = _gp(None, _courts("Court 1", "Court 2"))
        t.set_court_preferences({"A": ["Court 2"], "B": ["Court 1"]}, None)
        assert {m.court.name for m in t.groups[0].matches if m.on_court} == {"Court 2"}
        t.update_courts(_courts("Court 1", "Court 3"))
        assert t.group_courts == {"B": ["Court 1"]}

    def test_group_borrows_when_its_court_is_busy(self):
        # Group A prefers one court, but can play two matches at once: it borrows a free court.
        t = _gp({"A": ["Court 1"]}, _courts("Court 1", "Court 2", "Court 3", "Court 4"))
        a = next(g for g in t.groups if g.name == "A")
        on = [m.court.name for m in a.matches if m.on_court]
        assert len(on) == 2 and "Court 1" in on

    def test_old_pickles_default_to_no_preferences(self):
        t = _gp(None, _courts("Court 1"))
        del t.__dict__["group_courts"]
        del t.__dict__["bracket_courts"]
        assert t.group_courts == {} and t.bracket_courts == {}
        t.update_courts(_courts("Court 1", "Court 2"))


class TestEspejoCourts:
    def _po(self, bracket_courts: dict[str, list[str]] | None) -> PlayoffTournament:
        teams = [[Player(name=f"T{i}")] for i in range(8)]
        return PlayoffTournament(
            teams,
            courts=_courts("Main", "Side", "Spare"),
            espejo=True,
            bracket_courts=bracket_courts,
        )

    def test_consolation_matches_prefer_their_court(self):
        t = self._po({"winners": ["Main"], "losers": ["Side"]})
        # Finish round 1 of the main bracket so the consolation bracket exists.
        for m in list(t.bracket.winners_bracket.matches):
            if m.team1 and m.team2 and m.round_number == 1:
                t.record_result(m.id, (6, 2))
        lb = t.bracket.losers_bracket
        assert lb is not None
        lb_courts = {m.court.name for m in lb.matches if m.court is not None}
        assert "Side" in lb_courts

    def test_preferences_are_set_and_cleaned(self):
        t = self._po(None)
        t.set_court_preferences({"winners": ["Main", "Nope"]})
        assert t.bracket_courts == {"winners": ["Main"]}


class TestCourtPreferencesAPI:
    GP_BODY = {
        "name": "Cup",
        "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
        "team_mode": True,
        "court_names": ["Court 1", "Court 2"],
        "num_groups": 2,
        "group_courts": {"A": ["Court 2"], "B": ["Court 1"]},
    }

    def test_create_and_patch(self, client, auth_headers):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        status = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert status["group_courts"] == {"A": ["Court 2"], "B": ["Court 1"]}
        assert status["group_names"] == ["A", "B"]
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        assert {m["court"] for m in groups["matches"]["A"] if m["court"]} == {"Court 2"}

        r = client.patch(
            f"/api/tournaments/{tid}/gp/court-preferences",
            json={"group_courts": {"A": ["Court 1"]}, "bracket_courts": {"losers": ["Court 2"]}},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"group_courts": {"A": ["Court 1"]}, "bracket_courts": {"losers": ["Court 2"]}}

    def test_patch_rejects_unknown_side(self, client, auth_headers):
        tid = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers).json()["id"]
        r = client.patch(
            f"/api/tournaments/{tid}/gp/court-preferences",
            json={"bracket_courts": {"middle": ["Court 1"]}},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_patch_requires_auth(self, client, auth_headers):
        tid = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers).json()["id"]
        r = client.patch(f"/api/tournaments/{tid}/gp/court-preferences", json={})
        assert r.status_code in (401, 403)

    def test_playoff_espejo_create_and_patch(self, client, auth_headers):
        body = {
            "name": "Espejo",
            "participant_names": [f"T{i}" for i in range(8)],
            "court_names": ["Main", "Side"],
            "espejo": True,
            "bracket_courts": {"winners": ["Main"], "losers": ["Side"]},
        }
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        status = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert status["bracket_courts"] == {"winners": ["Main"], "losers": ["Side"]}
        r = client.patch(
            f"/api/tournaments/{tid}/po/court-preferences",
            json={"bracket_courts": {}},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert client.get(f"/api/tournaments/{tid}/po/status").json()["bracket_courts"] == {}
