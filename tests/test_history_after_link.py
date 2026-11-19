"""A player's match history shows in every card scope however and whenever the player was linked.

Matches scored before the participation is linked to a profile (admin link, Hub
self-link, ghost or profile merge, in solo and team mode, in running and finished
tournaments, with or without a club) must appear on the profile's card, in the
Hub's rating history and in club, community and global scope, even when a card was
built (and cached) before the link.
"""

from __future__ import annotations

import pytest

import backend.api.db as db_mod
from backend.api import state as state_mod
from backend.api.routes_clubs import ensure_club_roster_synced
from backend.auth.security import create_profile_token
from tests.test_club_elo import (
    _link,
    _make_club,
    _new_tournament,
    _persist_tournaments,  # noqa: F401 -- autouse fixture
    _play_rounds,
)
from tests.test_elo_relink import _insert_profile
from tests.test_scoped_player_card import NAMES, _create_open_event

ROUNDS_BEFORE_LINK = 2
SCOPES = {"club": "?club_id=hl", "community": "?community_id=open", "global": ""}


def _headers(profile_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_profile_token(profile_id)}"}


def _history(client, profile_id: str, *, club: bool) -> dict[str, int]:
    """Matches listed per scope on the card, plus the Hub's rating history (all scopes of the profile)."""
    out: dict[str, int] = {}
    for name, query in SCOPES.items():
        if name == "club" and not club:
            continue
        res = client.get(f"/api/player-cards/{profile_id}{query}", headers=_headers(profile_id))
        assert res.status_code == 200, (name, res.text)
        card = res.json()
        out[name] = len(card["recent_matches"])
        assert sum(s["matches"] for s in card["stats"]) == out[name], name
    space = client.get("/api/player-profile/space", headers=_headers(profile_id))
    assert space.status_code == 200, space.text
    out["hub"] = len(space.json()["elo_history"])
    return out


def _passphrase(tid: str, player_id: str) -> str:
    with db_mod.get_db() as conn:
        row = conn.execute(
            "SELECT passphrase FROM player_secrets WHERE tournament_id = ? AND player_id = ?", (tid, player_id)
        ).fetchone()
    return row["passphrase"]


def _self_link(client, profile_id: str, tid: str, player_id: str) -> None:
    res = client.post(
        "/api/player-profile/link",
        json={"entity_type": "tournament", "entity_id": tid, "passphrase": _passphrase(tid, player_id)},
        headers=_headers(profile_id),
    )
    assert res.status_code == 200, res.text


def _merge_hub(client, auth_headers, primary: str, secondary: str) -> None:
    res = client.post(
        "/api/admin/player-profiles/merge-hub",
        json={"primary_id": primary, "secondary_id": secondary},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text


def _merge_ghost(client, auth_headers, primary: str, player_id: str) -> None:
    res = client.post(
        "/api/admin/player-profiles/consolidate-ghosts",
        json={"source_ids": [primary, f"ghost_{player_id}"]},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text


def _link_by(how: str, client, auth_headers, profile_id: str, tid: str, player_id: str) -> None:
    if how == "admin":
        _link(client, auth_headers, profile_id, tid, player_id)
    elif how == "self":
        _self_link(client, profile_id, tid, player_id)
    elif how == "ghost_merge":
        # Roster sync made a ghost of every unlinked club participant.
        _merge_ghost(client, auth_headers, profile_id, player_id)
    elif how == "hub_merge":
        other = _insert_profile("Alice B")
        _link(client, auth_headers, other, tid, player_id)
        _merge_hub(client, auth_headers, profile_id, other)
    else:  # pragma: no cover
        raise AssertionError(how)


# Ghost profiles are made by the club roster sync, so a ghost merge needs a club.
_LINK_CASES = [
    pytest.param(club, how, id=f"{'club' if club else 'no-club'}-{how}")
    for club in (True, False)
    for how in ("admin", "self", "ghost_merge", "hub_merge")
    if club or how != "ghost_merge"
]


@pytest.mark.parametrize(("club", "how"), _LINK_CASES)
class TestSoloLinkedAfterStart:
    @pytest.mark.parametrize("finished", [False, True], ids=["running", "finished"])
    def test_history_before_the_link_is_listed_in_every_scope(self, client, auth_headers, club, finished, how):
        if club:
            _make_club("hl")
        alice = _insert_profile("Alice")
        tid, ids = _new_tournament(client, auth_headers, "hl" if club else None)
        _play_rounds(client, auth_headers, tid, "Alice", rounds=ROUNDS_BEFORE_LINK)
        if club:
            # Opening the club board turns every unlinked participant into a ghost profile.
            ensure_club_roster_synced("hl")
        # A card built before the link is cached for a moment: the link must not leave it in place.
        assert set(_history(client, alice, club=club).values()) == {0}

        _play_rounds(client, auth_headers, tid, "Alice", rounds=1)
        if finished:
            assert client.post(f"/api/tournaments/{tid}/mex/finish", headers=auth_headers).status_code == 200
        _link_by(how, client, auth_headers, alice, tid, ids["Alice"])

        expected = ROUNDS_BEFORE_LINK + 1
        counts = _history(client, alice, club=club)
        assert counts == {k: expected for k in counts}
        assert set(counts) == ({"club", "community", "global", "hub"} if club else {"community", "global", "hub"})
        if club:
            # The club chain was replayed under the profile, so the rows before the link are on it too.
            with db_mod.get_db() as conn:
                rows = conn.execute(
                    "SELECT club_identity FROM player_elo_log WHERE tournament_id = ? AND player_id = ?",
                    (tid, ids["Alice"]),
                ).fetchall()
            assert [r["club_identity"] for r in rows] == [alice] * expected

    def test_matches_after_the_link_are_added(self, client, auth_headers, club, how):
        # Running tournaments only: a finished one has no later matches.
        if club:
            _make_club("hl")
        alice = _insert_profile("Alice")
        tid, ids = _new_tournament(client, auth_headers, "hl" if club else None)
        _play_rounds(client, auth_headers, tid, "Alice", rounds=ROUNDS_BEFORE_LINK)
        if club:
            ensure_club_roster_synced("hl")
        _link_by(how, client, auth_headers, alice, tid, ids["Alice"])
        _history(client, alice, club=club)
        _play_rounds(client, auth_headers, tid, "Alice", rounds=1)
        counts = _history(client, alice, club=club)
        assert counts == {k: ROUNDS_BEFORE_LINK + 1 for k in counts}


class TestSelfLinkOfGhostOwnedHistory:
    def test_finished_participation_history_moves_off_the_ghost(self, client, auth_headers):
        """The durable history row followed the ghost; a self-link must take it over."""
        _make_club("hl")
        alice = _insert_profile("Alice")
        tid, ids = _new_tournament(client, auth_headers, "hl")
        _play_rounds(client, auth_headers, tid, "Alice", rounds=3)
        assert client.post(f"/api/tournaments/{tid}/mex/finish", headers=auth_headers).status_code == 200
        ensure_club_roster_synced("hl")
        with db_mod.get_db() as conn:
            owner = conn.execute(
                "SELECT profile_id FROM player_history WHERE entity_id = ? AND player_id = ?", (tid, ids["Alice"])
            ).fetchone()["profile_id"]
        assert owner == f"ghost_{ids['Alice']}"

        _self_link(client, alice, tid, ids["Alice"])

        with db_mod.get_db() as conn:
            rows = conn.execute(
                "SELECT profile_id FROM player_history WHERE entity_id = ? AND player_id = ?", (tid, ids["Alice"])
            ).fetchall()
            left = conn.execute(
                "SELECT COUNT(*) AS n FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
                (tid, ids["Alice"]),
            ).fetchone()["n"]
        assert [r["profile_id"] for r in rows] == [alice]
        assert left == 0
        assert _history(client, alice, club=True) == {"club": 3, "community": 3, "global": 3, "hub": 3}


@pytest.mark.parametrize("how", ["admin", "self"])
class TestTeamModeLinkedAfterStart:
    def _team_event(self, client, auth_headers) -> tuple[str, list[str]]:
        teams = [["Ann", "Bea"], ["Cid", "Dan"], ["Eli", "Fay"], ["Gus", "Hal"]]
        tid = _create_open_event(client, auth_headers, team_mode=True, teams=teams)
        players = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
        # conftest keeps secrets in memory; the link endpoints need the DB rows.
        with db_mod.get_db() as conn:
            conn.executemany(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token)"
                " VALUES (?, ?, ?, ?, ?)",
                [(tid, pid, info["name"], info["passphrase"], info["token"]) for pid, info in players.items()],
            )
        roster = state_mod._tournaments[tid]["tournament"].team_roster
        assert NAMES  # the event is built from the shared roster of names
        return tid, next(iter(roster.values()))

    def test_member_linked_after_scoring_sees_the_team_matches(self, client, auth_headers, how):
        tid, members = self._team_event(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()["matches"]
        matches = [m for ms in groups.values() for m in ms]
        own = [m for m in matches if members[0] in _member_ids(tid, m)]
        assert own, "the first team plays a group match"
        for m in matches[:2]:
            res = client.post(
                f"/api/tournaments/{tid}/gp/record-group",
                json={"match_id": m["id"], "score1": 6, "score2": 2},
                headers=auth_headers,
            )
            assert res.status_code == 200, res.text
        played = sum(1 for m in matches[:2] if m in own)
        assert played >= 1
        ann = _insert_profile("Ann")
        assert _history(client, ann, club=False) == {"community": 0, "global": 0, "hub": 0}

        if how == "admin":
            _link(client, auth_headers, ann, tid, members[0])
        else:
            _self_link(client, ann, tid, members[0])

        counts = _history(client, ann, club=False)
        assert counts == {"community": played, "global": played, "hub": played}
        # The member's own event card opens the wider scope too.
        res = client.get(f"/api/tournaments/{tid}/players/{members[0]}/card?scope=all", headers=_headers(ann))
        assert res.status_code == 200, res.text
        assert len(res.json()["recent_matches"]) == played


def _member_ids(tid: str, match: dict) -> list[str]:
    roster = state_mod._tournaments[tid]["tournament"].team_roster
    return [mid for team_id in match["team1_ids"] + match["team2_ids"] for mid in roster.get(team_id, [])]
