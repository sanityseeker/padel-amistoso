"""Scoped player card: club / community / global scope, unlisted events, gates and freshness."""

from __future__ import annotations

import json
import secrets as _secrets
from datetime import datetime, timedelta, timezone

import pytest

from backend.api import state as state_mod
from backend.api.db import get_db
from backend.api.leaderboard_cache import invalidate_leaderboard_cache
from backend.api.routes_clubs import _CLUB_CARD_MATCH_FIELDS
from backend.auth.security import create_access_token, create_profile_token
from backend.api import db as db_mod

PII_KEYS = {"email", "contact", "passphrase", "token", "is_ghost", "auto_login_token"}
BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _profile_headers(profile_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_profile_token(profile_id)}"}


VIEWER = "pp_viewer"  # a member of club A (not of club B)
OUTSIDER = "pp_outsider"  # signed in, member of no club


def _user_headers(username: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(username)}"}


def _co_editor(club_id: str, username: str) -> None:
    """Give *username* organizer (co-editor) access to a club."""
    with get_db() as conn:
        conn.execute("INSERT INTO club_shares (club_id, username) VALUES (?, ?)", (club_id, username))
    db_mod._club_co_editor_cache.clear()


@pytest.fixture(autouse=True)
def _fresh_cache():
    invalidate_leaderboard_cache()
    yield
    invalidate_leaderboard_cache()


def _keys(value) -> set[str]:
    """Every key anywhere in a JSON value."""
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in _keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in _keys(v)}
    return set()


def _community(client, headers, name: str = "Scope Community") -> str:
    res = client.post("/api/communities", json={"name": name}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _club(client, headers, community_id: str, name: str) -> str:
    res = client.post("/api/clubs", json={"community_id": community_id, "name": name}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _seed_profile(conn, profile_id: str, name: str) -> None:
    conn.execute(
        "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
        " VALUES (?, ?, ?, ?, 'secret-contact', ?, 0)",
        (profile_id, _secrets.token_hex(8), name, f"{profile_id}@example.com", BASE.isoformat()),
    )


def _seed_tournament(conn, tid: str, community_id: str, club_id: str | None, *, public: bool = True) -> None:
    conn.execute(
        "INSERT INTO tournaments (id, name, type, owner, public, tournament_blob, version,"
        " sport, community_id, created_at, club_id)"
        " VALUES (?, ?, 'group_playoff', 'admin', ?, X'00', 0, 'padel', ?, ?, ?)",
        (tid, f"Event {tid}", 1 if public else 0, community_id, BASE.isoformat(), club_id),
    )


def _link(conn, tid: str, player_id: str, profile_id: str) -> None:
    conn.execute(
        "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)"
        " VALUES (?, ?, '', ?, ?, ?)",
        (tid, player_id, _secrets.token_hex(8), _secrets.token_hex(8), profile_id),
    )


def _seed_match(
    conn,
    tid: str,
    match_id: str,
    team1: list[tuple[str, str]],
    team2: list[tuple[str, str]],
    score: tuple[int, int],
    minute: int,
) -> None:
    """One rated match: a log row for every participant, all sharing the payload."""
    payload = json.dumps(
        {
            "match_id": match_id,
            "score": list(score),
            "sets": [],
            "team1": [{"player_id": pid, "player_name": name} for pid, name in team1],
            "team2": [{"player_id": pid, "player_name": name} for pid, name in team2],
            "round_number": 1,
            "round_label": "R1",
        }
    )
    ts = (BASE + timedelta(minutes=minute)).isoformat()
    for pid, _name in team1 + team2:
        conn.execute(
            "INSERT INTO player_elo_log (tournament_id, player_id, sport, elo_before, elo_after,"
            " elo_delta, match_id, match_payload, match_order, updated_at, is_manual)"
            " VALUES (?, ?, 'padel', 1000, 1010, 10, ?, ?, ?, ?, 0)",
            (tid, pid, match_id, payload, minute, ts),
        )


@pytest.fixture()
def world(client, auth_headers) -> dict[str, str]:
    """Ann (pp_ann) plays in: club A (listed + unlisted), club B, and the community without a club."""
    comm = _community(client, auth_headers)
    club_a = _club(client, auth_headers, comm, "Club A")
    club_b = _club(client, auth_headers, comm, "Club B")
    with get_db() as conn:
        _seed_profile(conn, "pp_ann", "Ann")
        _seed_profile(conn, "pp_bob", "Bob")
        _seed_profile(conn, VIEWER, "Viewer")
        _seed_profile(conn, OUTSIDER, "Outsider")
        # The viewer is on club A's roster (an organizer added them; they never played there).
        conn.execute(
            "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
            " VALUES (?, ?, 'padel', 1000, 0, 0)",
            (VIEWER, club_a),
        )
        for tid, club, public in (
            ("t_a", club_a, True),
            ("t_a_hidden", club_a, False),
            ("t_b", club_b, True),
            ("t_comm", None, True),
            ("t_comm_hidden", None, False),
        ):
            _seed_tournament(conn, tid, comm, club, public=public)
            _link(conn, tid, f"{tid}_ann", "pp_ann")
            _link(conn, tid, f"{tid}_bob", "pp_bob")
        for minute, tid in enumerate(("t_a", "t_a_hidden", "t_b", "t_comm", "t_comm_hidden"), start=1):
            _seed_match(
                conn,
                tid,
                f"m_{tid}",
                [(f"{tid}_ann", "Ann"), (f"{tid}_bob", "Bob")],
                [(f"{tid}_x", f"Opp {tid}"), (f"{tid}_y", "Yan")],
                (6, 2),
                minute,
            )
    _co_editor(club_a, "alice")
    _co_editor(club_b, "bob")
    return {"community": comm, "club_a": club_a, "club_b": club_b}


def _card(client, query: str, headers: dict | None = None, expect: int = 200, profile: str = "pp_ann") -> dict:
    res = client.get(f"/api/player-cards/{profile}{query}", headers=headers or _profile_headers(VIEWER))
    assert res.status_code == expect, res.text
    return res.json()


def _events(card: dict) -> set[str]:
    return {m["tournament_name"] for m in card["recent_matches"]}


class TestScopeFilter:
    def test_club_scope_excludes_other_clubs_and_community_only_matches(self, client, world) -> None:
        card = _card(client, f"?club_id={world['club_a']}&sport=padel")
        assert card["scope"] == {"kind": "club", "id": world["club_a"], "label": "Club A"}
        assert _events(card) == {"Event t_a", "Event t_a_hidden"}
        assert card["stats"][0]["matches"] == 2
        assert card["stats"][0]["wins"] == 2

    def test_elo_history_starts_with_the_rating_before_the_first_match(self, client, world) -> None:
        card = _card(client, f"?club_id={world['club_a']}&sport=padel")
        # Two rated matches plot as three points: the start, then each result.
        assert card["stats"][0]["elo_history"] == [1000.0, 1010.0, 1010.0]

    def test_club_scope_lists_unlisted_club_events_for_a_signed_in_viewer(self, client, world) -> None:
        card = _card(client, f"?club_id={world['club_a']}")
        assert "Event t_a_hidden" in _events(card)
        assert card["unlisted_matches"] == 0

    def test_community_scope_hides_other_players_unlisted_rows(self, client, world) -> None:
        card = _card(client, f"?community_id={world['community']}")
        # Every match counts, but the unlisted events' rows are not listed for someone else.
        assert card["stats"][0]["matches"] == 5
        assert _events(card) == {"Event t_a", "Event t_b", "Event t_comm"}
        assert card["unlisted_matches"] == 2
        assert {p["name"] for p in card["top_opponents"]} == {"Yan", "Opp t_a", "Opp t_b"}
        assert card["top_opponents"][0]["name"] == "Yan"
        assert card["top_opponents"][0]["matches"] == 3

    def test_own_card_shows_unlisted_rows(self, client, world) -> None:
        card = _card(client, f"?community_id={world['community']}", headers=_profile_headers("pp_ann"))
        assert len(card["recent_matches"]) == 5
        assert card["unlisted_matches"] == 0

    def test_global_scope_hides_unlisted_rows_too(self, client, world) -> None:
        card = _card(client, "")
        assert card["scope"]["kind"] == "all"
        assert card["stats"][0]["matches"] == 5
        assert card["unlisted_matches"] == 2

    def test_partners_resolve_to_profiles(self, client, world) -> None:
        card = _card(client, f"?club_id={world['club_a']}")
        assert card["top_partners"] == [{"name": "Bob", "profile_id": "pp_bob", "matches": 2, "wins": 2}]

    def test_hidden_sport_returns_404(self, client, world) -> None:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES ('pp_ann', ?, 'padel', 1000, 0, 1)",
                (world["club_a"],),
            )
        _card(client, f"?club_id={world['club_a']}&sport=padel", expect=404)
        # Without a sport the hidden one is simply absent.
        assert _card(client, f"?club_id={world['club_a']}")["stats"] == []

    def test_unknown_profile_and_club(self, client, world) -> None:
        _card(client, "", profile="pp_nobody", expect=404)
        _card(client, "?club_id=cl_missing", expect=404)


class TestGates:
    def test_anonymous_gets_401(self, client, world, auth_headers) -> None:
        assert client.get("/api/player-cards/pp_ann").status_code == 401
        tid = _create_open_event(client, auth_headers)
        pid = _player_id(tid, "Ann")
        assert client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=all").status_code == 401

    def test_organizer_may_open_cards(self, client, world, auth_headers) -> None:
        card = _card(client, f"?club_id={world['club_a']}", headers=auth_headers)
        assert len(card["recent_matches"]) == 2

    def test_no_pii_keys(self, client, world, auth_headers) -> None:
        bodies = [
            _card(client, f"?club_id={world['club_a']}"),
            _card(client, f"?community_id={world['community']}", headers=_profile_headers("pp_ann")),
            _card(client, ""),
        ]
        tid = _create_open_event(client, auth_headers)
        pid = _player_id(tid, "Ann")
        public = client.get(f"/api/tournaments/{tid}/players/{pid}/public-card").json()
        bodies.append(public)
        for body in bodies:
            assert not (_keys(body) & PII_KEYS), _keys(body) & PII_KEYS
            assert "secret-contact" not in json.dumps(body)
        # The anonymous event card never names the profile.
        assert "profile_id" not in _keys(public)


# ---------------------------------------------------------------------------
# Cards opened from an event
# ---------------------------------------------------------------------------

NAMES = ["Ann", "Bea", "Cid", "Dan", "Eli", "Fay", "Gus", "Hal"]


def _create_open_event(client, headers, **extra) -> str:
    res = client.post(
        "/api/tournaments/group-playoff",
        json={
            "name": "Open Cup",
            "player_names": NAMES,
            "court_names": ["Court 1"],
            "num_groups": 1,
            "top_per_group": 2,
            **extra,
        },
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _player_id(tid: str, name: str) -> str:
    return next(p.id for p in state_mod._tournaments[tid]["tournament"].players if p.name == name)


def _link_event_player(tid: str, player_id: str, profile_id: str, name: str) -> None:
    with get_db() as conn:
        if conn.execute("SELECT 1 FROM player_profiles WHERE id = ?", (profile_id,)).fetchone() is None:
            _seed_profile(conn, profile_id, name)
        _link(conn, tid, player_id, profile_id)


def _scopes(client, tid: str, pid: str, headers: dict | None = None) -> list[str]:
    res = client.get(f"/api/tournaments/{tid}/players/{pid}/card-scopes", headers=headers or _profile_headers(VIEWER))
    assert res.status_code == 200, res.text
    return [s["kind"] for s in res.json()]


def _first_group_match(client, tid: str) -> dict:
    groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()["matches"]
    return next(m for ms in groups.values() for m in ms)


class TestEventCard:
    def test_unlinked_player_has_event_scope_only(self, client, auth_headers) -> None:
        tid = _create_open_event(client, auth_headers)
        pid = _player_id(tid, "Ann")
        public = client.get(f"/api/tournaments/{tid}/players/{pid}/public-card").json()
        assert public["has_profile"] is False
        assert "scopes" not in public
        assert _scopes(client, tid, pid) == ["event"]
        res = client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=all", headers=_profile_headers(VIEWER))
        assert res.status_code == 404

    def test_linked_player_in_open_community_widens_to_all(self, client, auth_headers) -> None:
        tid = _create_open_event(client, auth_headers)
        pid = _player_id(tid, "Ann")
        _link_event_player(tid, pid, "pp_ann", "Ann")
        public = client.get(f"/api/tournaments/{tid}/players/{pid}/public-card").json()
        assert public["has_profile"] is True
        assert _scopes(client, tid, pid) == ["event", "all"]
        res = client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=all", headers=_profile_headers(VIEWER))
        assert res.status_code == 200, res.text
        assert res.json()["profile_id"] == "pp_ann"
        # Never wider than the event allows.
        res = client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=club", headers=_profile_headers(VIEWER))
        assert res.status_code == 404

    def test_club_event_widens_to_its_club_only(self, client, auth_headers, world) -> None:
        tid = _create_open_event(client, auth_headers)
        state_mod._tournaments[tid]["club_id"] = world["club_a"]
        state_mod._tournaments[tid]["community_id"] = world["community"]
        pid = _player_id(tid, "Ann")
        _link_event_player(tid, pid, "pp_ann", "Ann")
        res = client.get(f"/api/tournaments/{tid}/players/{pid}/card-scopes", headers=_profile_headers(VIEWER))
        assert res.json()[1] == {"kind": "club", "id": world["club_a"], "label": "Club A"}
        assert len(res.json()) == 2
        for wider in ("all", "community"):
            res = client.get(
                f"/api/tournaments/{tid}/players/{pid}/card?scope={wider}", headers=_profile_headers(VIEWER)
            )
            assert res.status_code == 404
        card = client.get(
            f"/api/tournaments/{tid}/players/{pid}/card?scope=club", headers=_profile_headers(VIEWER)
        ).json()
        assert _events(card) == {"Event t_a", "Event t_a_hidden"}

    def test_closed_community_event_widens_to_its_community(self, client, auth_headers, world) -> None:
        tid = _create_open_event(client, auth_headers)
        state_mod._tournaments[tid]["community_id"] = world["community"]
        pid = _player_id(tid, "Ann")
        _link_event_player(tid, pid, "pp_ann", "Ann")
        assert _scopes(client, tid, pid) == ["event", "community"]
        card = client.get(
            f"/api/tournaments/{tid}/players/{pid}/card?scope=community", headers=_profile_headers(VIEWER)
        ).json()
        assert card["unlisted_matches"] == 2

    def test_team_resolves_to_members(self, client, auth_headers) -> None:
        teams = [["Ann", "Bea"], ["Cid", "Dan"], ["Eli", "Fay"], ["Gus", "Hal"]]
        tid = _create_open_event(client, auth_headers, team_mode=True, teams=teams)
        tournament = state_mod._tournaments[tid]["tournament"]
        team_id, member_ids = next(iter(tournament.team_roster.items()))
        _link_event_player(tid, member_ids[0], "pp_ann", "Ann")
        public = client.get(f"/api/tournaments/{tid}/players/{team_id}/public-card").json()
        assert public["has_profile"] is True
        card = client.get(
            f"/api/tournaments/{tid}/players/{team_id}/card?scope=all", headers=_profile_headers(VIEWER)
        ).json()
        assert card["is_team"] is True
        assert card["profile_id"] is None
        assert [m["player_id"] for m in card["members"]] == member_ids
        assert [m["has_profile"] for m in card["members"]] == [True, False]
        assert card["stats"] == [] and card["recent_matches"] == []
        # A member opens their own card: the linked one in the wider scope, the other has none.
        assert _scopes(client, tid, member_ids[0]) == ["event", "all"]
        ann = client.get(
            f"/api/tournaments/{tid}/players/{member_ids[0]}/card?scope=all", headers=_profile_headers(VIEWER)
        )
        assert ann.status_code == 200, ann.text
        assert ann.json()["profile_id"] == "pp_ann"
        assert _scopes(client, tid, member_ids[1]) == ["event"]
        bea = client.get(
            f"/api/tournaments/{tid}/players/{member_ids[1]}/card?scope=all", headers=_profile_headers(VIEWER)
        )
        assert bea.status_code == 404

    def test_cache_invalidated_after_a_score(self, client, auth_headers) -> None:
        tid = _create_open_event(client, auth_headers)
        match = _first_group_match(client, tid)
        pid = match["team1_ids"][0] if match.get("team1_ids") else None
        if pid is None:
            name = match["team1"][0]
            pid = _player_id(tid, name)
        _link_event_player(tid, pid, "pp_ann", "Ann")
        url = f"/api/tournaments/{tid}/players/{pid}/card?scope=all"
        before = client.get(url, headers=_profile_headers(VIEWER)).json()
        assert before["stats"] == []
        res = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match["id"], "score1": 6, "score2": 2},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text
        after = client.get(url, headers=_profile_headers(VIEWER)).json()
        assert after["stats"][0]["matches"] == 1
        assert after["stats"][0]["wins"] == 1
        assert len(after["recent_matches"]) == 1


class TestLegacyFields:
    def test_event_card_keeps_its_fields(self, client, auth_headers) -> None:
        tid = _create_open_event(client, auth_headers)
        pid = _player_id(tid, "Ann")
        body = client.get(f"/api/tournaments/{tid}/players/{pid}/public-card").json()
        legacy = {
            "tournament_id",
            "player_id",
            "player_name",
            "sport",
            "elo",
            "elo_scope",
            "elo_start",
            "elo_delta_total",
            "matches",
            "wins",
            "draws",
            "losses",
            "recent_matches",
            "elo_history",
        }
        assert legacy <= set(body)
        assert set(body) - legacy <= {"is_team", "members", "stages", "stats", "has_profile"}

    def test_club_card_keeps_its_shape(self, client, world) -> None:
        res = client.get(
            f"/api/clubs/{world['club_a']}/players/pp_ann/public-card?sport=padel", headers=_profile_headers(VIEWER)
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert set(body) == {
            "profile_id",
            "name",
            "elo_padel",
            "elo_tennis",
            "matches_padel",
            "matches_tennis",
            "tier_name_padel",
            "tier_name_tennis",
            "rank_padel",
            "rank_tennis",
            "recent_matches",
            "elo_history_padel",
            "elo_history_tennis",
            "scope",
        }
        assert body["recent_matches"]
        assert all(set(m) == set(_CLUB_CARD_MATCH_FIELDS) for m in body["recent_matches"])
        assert body["recent_matches"][0]["team1"] == ["Ann", "Bob"]
        assert body["recent_matches"][0]["round_label"] == "R1"


class TestClubBoardNumbers:
    def test_club_card_carries_rank_and_tier(self, client, world) -> None:
        card = _card(client, f"?club_id={world['club_a']}&sport=padel")
        padel = card["stats"][0]
        assert padel["sport"] == "padel"
        assert padel["rank"] in (1, 2)
        assert "tier_name" in padel

    def test_match_lists_partners_and_opponents(self, client, world) -> None:
        card = _card(client, f"?club_id={world['club_a']}")
        m = card["recent_matches"][0]
        assert m["side"] == 1 and m["outcome"] == "W"
        assert m["partners"] == ["Bob"]
        assert sorted(m["opponents"]) == ["Opp t_a_hidden", "Yan"]
        # Each name carries its linked profile (in order), so the card can open it.
        assert m["partner_profiles"] == ["pp_bob"]
        assert m["opponent_profiles"] == [None, None]


# ---------------------------------------------------------------------------
# Club gate: members and the club's organizers only
# ---------------------------------------------------------------------------


def _club_event(client, auth_headers, world, *, community: str | None = None) -> tuple[str, str]:
    """An in-memory event of club A with Ann linked; returns (tid, Ann's player id)."""
    tid = _create_open_event(client, auth_headers)
    state_mod._tournaments[tid]["club_id"] = world["club_a"]
    state_mod._tournaments[tid]["community_id"] = community or world["community"]
    pid = _player_id(tid, "Ann")
    _link_event_player(tid, pid, "pp_ann", "Ann")
    return tid, pid


class TestClubGate:
    def test_member_gets_the_club_card(self, client, world) -> None:
        card = _card(client, f"?club_id={world['club_a']}", headers=_profile_headers(VIEWER))
        assert len(card["recent_matches"]) == 2

    def test_non_member_is_denied_everywhere(self, client, world) -> None:
        outsider = _profile_headers(OUTSIDER)
        _card(client, f"?club_id={world['club_a']}", headers=outsider, expect=403)
        # A member of club A is not a member of club B.
        _card(client, f"?club_id={world['club_b']}", headers=_profile_headers(VIEWER), expect=403)
        legacy = client.get(f"/api/clubs/{world['club_a']}/players/pp_ann/public-card", headers=outsider)
        assert legacy.status_code == 403

    def test_season_scope_is_gated_too(self, client, world, auth_headers) -> None:
        res = client.post(f"/api/clubs/{world['club_a']}/seasons", json={"name": "Spring"}, headers=auth_headers)
        assert res.status_code in (200, 201), res.text
        season = res.json()["id"]
        _card(client, f"?season_id={season}", headers=_profile_headers(OUTSIDER), expect=403)
        _card(client, f"?season_id={season}", headers=_profile_headers(VIEWER))

    def test_removed_member_is_denied(self, client, world) -> None:
        with get_db() as conn:
            conn.execute("UPDATE profile_club_elo SET hidden = 1 WHERE profile_id = ?", (VIEWER,))
        _card(client, f"?club_id={world['club_a']}", headers=_profile_headers(VIEWER), expect=403)

    def test_non_member_is_not_offered_the_club(self, client, auth_headers, world) -> None:
        tid, pid = _club_event(client, auth_headers, world)
        outsider = _profile_headers(OUTSIDER)
        # The club is not offered; the club's own (closed) community is the fallback.
        assert _scopes(client, tid, pid, outsider) == ["event", "community"]
        res = client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=club", headers=outsider)
        assert res.status_code == 403
        res = client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=community", headers=outsider)
        assert res.status_code == 200, res.text
        # A member still gets the club and nothing past it.
        assert _scopes(client, tid, pid) == ["event", "club"]

    def test_club_event_in_the_open_community_offers_nothing_wider(self, client, auth_headers, world) -> None:
        tid, pid = _club_event(client, auth_headers, world, community="open")
        outsider = _profile_headers(OUTSIDER)
        assert _scopes(client, tid, pid, outsider) == ["event"]
        res = client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=all", headers=outsider)
        assert res.status_code == 404

    def test_organizer_of_the_club_gets_the_card(self, client, world, auth_headers) -> None:
        card = _card(client, f"?club_id={world['club_a']}", headers=_user_headers("alice"))
        assert len(card["recent_matches"]) == 2
        tid, pid = _club_event(client, auth_headers, world)
        assert _scopes(client, tid, pid, _user_headers("alice")) == ["event", "club"]

    def test_organizer_of_another_club_is_denied(self, client, world, auth_headers) -> None:
        _card(client, f"?club_id={world['club_a']}", headers=_user_headers("bob"), expect=403)
        tid, pid = _club_event(client, auth_headers, world)
        assert _scopes(client, tid, pid, _user_headers("bob")) == ["event", "community"]

    def test_superadmin_is_allowed(self, client, world, auth_headers) -> None:
        card = _card(client, f"?club_id={world['club_a']}", headers=auth_headers)
        assert len(card["recent_matches"]) == 2

    def test_anonymous_is_denied(self, client, world, auth_headers) -> None:
        assert client.get(f"/api/player-cards/pp_ann?club_id={world['club_a']}").status_code == 401
        assert client.get(f"/api/clubs/{world['club_a']}/players/pp_ann/public-card").status_code == 401
        tid, pid = _club_event(client, auth_headers, world)
        assert client.get(f"/api/tournaments/{tid}/players/{pid}/card-scopes").status_code == 401
        assert client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=club").status_code == 401


class TestOrganizerSeesUnlisted:
    def test_organizer_of_the_players_club_sees_unlisted_rows(self, client, world) -> None:
        # Ann plays in club A (alice organizes it): her full card in community and global scope.
        for query in (f"?community_id={world['community']}", ""):
            card = _card(client, query, headers=_user_headers("alice"))
            assert len(card["recent_matches"]) == 5
            assert card["unlisted_matches"] == 0
            assert "Yan" in {p["name"] for p in card["top_opponents"]}

    def test_organizer_of_another_club_does_not(self, client, auth_headers) -> None:
        # Bob organizes only a club Ann never played in.
        comm = _community(client, auth_headers, "Other community")
        club_c = _club(client, auth_headers, comm, "Club C")
        with get_db() as conn:
            _seed_profile(conn, "pp_ann", "Ann")
            _seed_tournament(conn, "t_open_hidden", comm, None, public=False)
            _link(conn, "t_open_hidden", "toh_ann", "pp_ann")
            _seed_match(conn, "t_open_hidden", "m_toh", [("toh_ann", "Ann")], [("toh_x", "Xo")], (6, 1), 1)
        _co_editor(club_c, "bob")
        card = _card(client, f"?community_id={comm}", headers=_user_headers("bob"))
        assert card["recent_matches"] == []
        assert card["unlisted_matches"] == 1

    def test_organizer_of_club_b_does_not_see_unlisted_rows_of_a_club_a_only_player(self, client, world) -> None:
        # Make Ann a member of club A only (drop her club B roster rows).
        with get_db() as conn:
            conn.execute("DELETE FROM player_secrets WHERE tournament_id = 't_b'")
        card = _card(client, f"?community_id={world['community']}", headers=_user_headers("bob"))
        assert card["unlisted_matches"] == 2
        assert {m["tournament_name"] for m in card["recent_matches"]} == {"Event t_a", "Event t_comm"}

    def test_superadmin_sees_unlisted_rows(self, client, world, auth_headers) -> None:
        card = _card(client, f"?community_id={world['community']}", headers=auth_headers)
        assert len(card["recent_matches"]) == 5
        assert card["unlisted_matches"] == 0

    def test_member_viewer_still_does_not(self, client, world) -> None:
        card = _card(client, f"?community_id={world['community']}", headers=_profile_headers(VIEWER))
        assert card["unlisted_matches"] == 2


class TestCommunityCreator:
    def test_community_creator_who_is_not_a_club_editor_is_denied(self, client, auth_headers, alice_headers) -> None:
        # Only admins create communities through the API: make alice the creator of this one.
        comm = _community(client, auth_headers, "Alice's community")
        club = _club(client, auth_headers, comm, "Admin's club in it")
        with get_db() as conn:
            conn.execute("UPDATE communities SET created_by = 'alice' WHERE id = ?", (comm,))
            _seed_profile(conn, "pp_ann", "Ann")
        _card(client, f"?club_id={club}", headers=alice_headers, expect=403)
        assert client.get(f"/api/clubs/{club}/public-leaderboard", headers=alice_headers).status_code == 403


# ---------------------------------------------------------------------------
# Club boards: members and the club's organizers only
# ---------------------------------------------------------------------------


def _season(client, auth_headers, club_id: str) -> str:
    res = client.post(f"/api/clubs/{club_id}/seasons", json={"name": "Spring"}, headers=auth_headers)
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


class TestClubBoards:
    @pytest.mark.parametrize(
        ("who", "expect"),
        [
            ("member", 200),
            ("outsider", 403),
            ("other_club_member", 403),
            ("club_organizer", 200),
            ("other_club_organizer", 403),
            ("superadmin", 200),
            ("anonymous", 401),
        ],
    )
    def test_public_board_and_season_standings(self, client, world, auth_headers, who, expect) -> None:
        headers = {
            "member": _profile_headers(VIEWER),
            "outsider": _profile_headers(OUTSIDER),
            "other_club_member": _profile_headers(VIEWER),
            "club_organizer": _user_headers("alice"),
            "other_club_organizer": _user_headers("bob"),
            "superadmin": auth_headers,
            "anonymous": {},
        }[who]
        club = world["club_b"] if who == "other_club_member" else world["club_a"]
        season = _season(client, auth_headers, club)
        board = client.get(f"/api/clubs/{club}/public-leaderboard", headers=headers)
        assert board.status_code == expect, board.text
        standings = client.get(f"/api/seasons/{season}/standings", headers=headers)
        assert standings.status_code == expect, standings.text

    def test_hub_club_board_is_members_only(self, client, world) -> None:
        url = f"/api/player-profile/leaderboard?club_id={world['club_a']}"
        assert client.get(url, headers=_profile_headers(VIEWER)).status_code == 200
        assert client.get(url, headers=_profile_headers(OUTSIDER)).status_code == 403
        assert client.get(url).status_code == 401
        # The community and global boards stay open to any signed-in profile.
        assert client.get("/api/player-profile/leaderboard", headers=_profile_headers(OUTSIDER)).status_code == 200


class TestOwnCardException:
    def _remove_ann_from_club_a(self, world) -> None:
        from backend.api.routes_clubs import ensure_club_roster_synced

        ensure_club_roster_synced(world["club_a"])
        with get_db() as conn:
            conn.execute(
                "UPDATE profile_club_elo SET hidden = 1 WHERE profile_id = 'pp_ann' AND club_id = ?",
                (world["club_a"],),
            )

    def test_removed_player_still_opens_their_own_club_card(self, client, world, auth_headers) -> None:
        self._remove_ann_from_club_a(world)
        ann = _profile_headers("pp_ann")
        card = _card(client, f"?club_id={world['club_a']}&sport=padel", headers=ann)
        assert card["stats"][0]["matches"] == 2
        assert len(card["recent_matches"]) == 2
        season = _season(client, auth_headers, world["club_a"])
        _card(client, f"?season_id={season}", headers=ann)
        # The legacy club card lets her past the gate but keeps its own rule: hidden rows are never shown.
        legacy = client.get(f"/api/clubs/{world['club_a']}/players/pp_ann/public-card", headers=ann)
        assert legacy.status_code == 404
        # The exception opens her own card only: not Bob's, not the board, not the standings.
        _card(client, f"?club_id={world['club_a']}", headers=ann, profile="pp_bob", expect=403)
        assert client.get(f"/api/clubs/{world['club_a']}/public-leaderboard", headers=ann).status_code == 403
        assert client.get(f"/api/seasons/{season}/standings", headers=ann).status_code == 403
        assert client.get(f"/api/player-profile/leaderboard?club_id={world['club_a']}", headers=ann).status_code == 403

    def test_others_do_not_see_a_removed_players_club_rows(self, client, world) -> None:
        self._remove_ann_from_club_a(world)
        # The club hides her: a member viewer gets 404 for the sport and no rows without one.
        _card(client, f"?club_id={world['club_a']}&sport=padel", headers=_profile_headers(VIEWER), expect=404)
        assert _card(client, f"?club_id={world['club_a']}", headers=_profile_headers(VIEWER))["stats"] == []

    def test_own_event_card_offers_the_club_after_removal(self, client, auth_headers, world) -> None:
        tid, pid = _club_event(client, auth_headers, world)
        self._remove_ann_from_club_a(world)
        assert _scopes(client, tid, pid, _profile_headers("pp_ann")) == ["event", "club"]
        res = client.get(f"/api/tournaments/{tid}/players/{pid}/card?scope=club", headers=_profile_headers("pp_ann"))
        assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# Security review regressions
# ---------------------------------------------------------------------------


def _outside_world(client, auth_headers) -> tuple[str, str]:
    """Ann's unlisted event in a community without clubs, and club C (bob edits it; Ann never played there)."""
    comm = _community(client, auth_headers, "Other community")
    club_c = _club(client, auth_headers, comm, "Club C")
    with get_db() as conn:
        _seed_profile(conn, "pp_ann", "Ann")
        _seed_tournament(conn, "t_open_hidden", comm, None, public=False)
        _link(conn, "t_open_hidden", "toh_ann", "pp_ann")
        _seed_match(conn, "t_open_hidden", "m_toh", [("toh_ann", "Ann")], [("toh_x", "Xo")], (6, 1), 1)
    _co_editor(club_c, "bob")
    return comm, club_c


class TestManualRosterAddIsNotParticipation:
    @pytest.mark.parametrize("how", ["add", "elo"])
    def test_a_hand_added_member_does_not_reveal_unlisted_rows(self, client, auth_headers, how) -> None:
        comm, club_c = _outside_world(client, auth_headers)
        bob = _user_headers("bob")
        if how == "add":
            res = client.post(f"/api/clubs/{club_c}/players", json={"profile_id": "pp_ann"}, headers=bob)
        else:
            res = client.patch(
                f"/api/clubs/{club_c}/players/pp_ann/elo", json={"sport": "padel", "elo": 1100}, headers=bob
            )
        assert res.status_code in (200, 201), res.text
        for query in (f"?community_id={comm}", ""):
            card = _card(client, query, headers=bob)
            assert card["recent_matches"] == []
            assert card["unlisted_matches"] == 1

    def test_after_playing_in_the_club_the_editor_sees_them(self, client, auth_headers) -> None:
        comm, club_c = _outside_world(client, auth_headers)
        bob = _user_headers("bob")
        with get_db() as conn:
            _seed_tournament(conn, "t_c", comm, club_c)
            _link(conn, "t_c", "tc_ann", "pp_ann")
            _seed_match(conn, "t_c", "m_tc", [("tc_ann", "Ann")], [("tc_x", "Xc")], (6, 2), 2)
        card = _card(client, f"?community_id={comm}", headers=bob)
        assert _events(card) == {"Event t_open_hidden", "Event t_c"}
        assert card["unlisted_matches"] == 0

    def test_a_removed_player_is_not_revealed_any_more(self, client, auth_headers) -> None:
        comm, club_c = _outside_world(client, auth_headers)
        with get_db() as conn:
            _seed_tournament(conn, "t_c", comm, club_c)
            _link(conn, "t_c", "tc_ann", "pp_ann")
        from backend.api.routes_clubs import ensure_club_roster_synced

        ensure_club_roster_synced(club_c)
        with get_db() as conn:
            conn.execute(
                "UPDATE profile_club_elo SET hidden = 1 WHERE profile_id = 'pp_ann' AND club_id = ?", (club_c,)
            )
        card = _card(client, f"?community_id={comm}", headers=_user_headers("bob"))
        assert card["recent_matches"] == []


class TestLegacyCardAliasOfUnlistedEvents:
    def test_alias_is_hidden_from_members_and_kept_for_editors(self, client, world) -> None:
        with get_db() as conn:
            conn.execute("UPDATE tournaments SET alias = 'secret-alias' WHERE id = 't_a_hidden'")
            conn.execute("UPDATE tournaments SET alias = 'open-alias' WHERE id = 't_a'")
        url = f"/api/clubs/{world['club_a']}/players/pp_ann/public-card"
        member = client.get(url, headers=_profile_headers(VIEWER)).json()
        by_event = {m["tournament_name"]: m["tournament_alias"] for m in member["recent_matches"]}
        assert by_event == {"Event t_a_hidden": None, "Event t_a": "open-alias"}
        editor = client.get(url, headers=_user_headers("alice")).json()
        by_event = {m["tournament_name"]: m["tournament_alias"] for m in editor["recent_matches"]}
        assert by_event == {"Event t_a_hidden": "secret-alias", "Event t_a": "open-alias"}


class TestCardCacheFollowsVisibility:
    def test_unlisting_a_tournament_drops_its_row_at_once(self, client, auth_headers, world) -> None:
        # An in-memory event of the community, listed, with Ann linked and one rated match.
        tid = _create_open_event(client, auth_headers)
        state_mod._tournaments[tid]["community_id"] = world["community"]
        match = _first_group_match(client, tid)
        pid = match["team1_ids"][0]
        _link_event_player(tid, pid, "pp_ann", "Ann")
        with get_db() as conn:
            conn.execute(
                "UPDATE tournaments SET community_id = ?, public = 1, name = ? WHERE id = ?",
                (world["community"], f"Event {tid}", tid),
            )
        res = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match["id"], "score1": 6, "score2": 2},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text
        query = f"?community_id={world['community']}"
        assert "Event " + tid in _events(_card(client, query))
        # The organizer unlists it (the DB row follows the in-memory flag on save; tests skip the save).
        res = client.patch(f"/api/tournaments/{tid}/public", json={"public": False}, headers=auth_headers)
        assert res.status_code == 200, res.text
        with get_db() as conn:
            conn.execute("UPDATE tournaments SET public = 0 WHERE id = ?", (tid,))
        card = _card(client, query)
        assert "Event " + tid not in _events(card)
        assert card["unlisted_matches"] == 3


class TestClubDetailsForEditorsOnly:
    @pytest.mark.parametrize(
        ("who", "sees"),
        [("alice", True), ("admin", True), ("bob", False), ("profile", False), ("anonymous", False)],
    )
    def test_creator_and_reply_to(self, client, world, auth_headers, who, sees) -> None:
        with get_db() as conn:
            conn.execute(
                "UPDATE clubs SET email_settings = ? WHERE id = ?",
                (json.dumps({"reply_to": "owner@example.com", "sender_name": "Club A"}), world["club_a"]),
            )
        headers = {
            "alice": _user_headers("alice"),  # co-editor of club A
            "admin": auth_headers,
            "bob": _user_headers("bob"),  # organizer of club B only
            "profile": _profile_headers(VIEWER),
            "anonymous": {},
        }[who]
        body = client.get(f"/api/clubs/{world['club_a']}", headers=headers).json()
        if sees:
            assert body["created_by"] == "admin"
            assert body["email_settings"]["reply_to"] == "owner@example.com"
        else:
            assert body["created_by"] is None
            assert "reply_to" not in (body["email_settings"] or {})
            assert body["email_settings"]["sender_name"] == "Club A"
            assert "owner@example.com" not in json.dumps(body)
