"""Regression tests: Player Hub history stats must include play-off bracket matches.

``all_matches`` is a *property* on ``DoubleEliminationBracket`` and
``EspejoParallelBracket`` but absent on ``SingleEliminationBracket``.  The
stats collector used to call it as a method, which raised ``TypeError`` that
``extract_history_stats`` swallowed -> play-off matches silently dropped.
"""

from __future__ import annotations

import pytest

from backend.api.player_secret_store import extract_history_stats
from backend.models import Court, Player
from backend.tournaments import GroupPlayoffTournament, MexicanoTournament
from backend.tournaments.playoff import bracket_matches


def _play_all_playoffs(t) -> None:
    """Play every ready play-off match (team1 wins) until none are pending."""
    for _ in range(200):
        pending = t.pending_playoff_matches()
        if not pending:
            return
        t.record_playoff_result(pending[0].id, (10, 4))
    raise AssertionError("play-offs did not terminate")


def _games_played(player_id: str, matches: list) -> int:
    return sum(
        1 for m in matches if m.score is not None and player_id in {p.id for p in [*(m.team1 or []), *(m.team2 or [])]}
    )


def _assert_counts_every_match_once(stats: dict, matches: list) -> None:
    ids = [m.id for m in matches if m.score is not None]
    assert len(ids) == len(set(ids)), "test setup: duplicate match objects"
    assert stats, "extract_history_stats returned nothing (error swallowed?)"
    for pid, s in stats.items():
        assert s["wins"] + s["losses"] + s["draws"] == _games_played(pid, matches), pid


def _gp_tournament(*, n_players: int, top_per_group: int, **start_kwargs) -> GroupPlayoffTournament:
    players = [Player(name=f"P{i}") for i in range(n_players)]
    t = GroupPlayoffTournament(
        players=players,
        num_groups=2,
        courts=[Court(name="C1"), Court(name="C2")],
        top_per_group=top_per_group,
        team_mode=True,
    )
    t.generate()
    for idx, m in enumerate(t.pending_group_matches()):
        t.record_group_result(m.id, (10, 6) if idx % 2 == 0 else (6, 10))
    if start_kwargs.get("espejo_split"):
        ranked = t.recommend_playoff_participants()
        start_kwargs = {
            **start_kwargs,
            "oro_player_ids": [r["player_id"] for r in ranked if r["group_rank"] <= top_per_group],
            "plata_player_ids": [r["player_id"] for r in ranked if r["group_rank"] > top_per_group],
        }
    t.start_playoffs(**start_kwargs)
    _play_all_playoffs(t)
    assert t.champion() is not None
    return t


@pytest.mark.parametrize(
    "start_kwargs",
    [
        pytest.param({}, id="single-elim"),
        pytest.param({"double_elimination": True}, id="double-elim"),
        pytest.param({"espejo": True}, id="espejo"),
        pytest.param({"espejo_split": True}, id="espejo-split"),
    ],
)
def test_group_playoff_history_stats_include_bracket_matches(start_kwargs):
    t = _gp_tournament(n_players=16, top_per_group=4, **start_kwargs)
    stats = extract_history_stats({"type": "group_playoff", "tournament": t})

    group_matches = [m for g in t.groups for m in g.matches]
    playoff = [m for m in bracket_matches(t.playoff_bracket) if m.score is not None]
    assert playoff, "test setup: no play-off matches were played"
    _assert_counts_every_match_once(stats, group_matches + playoff)

    champion_ids = {p.id for p in t.champion()}
    assert champion_ids
    for pid in champion_ids:
        assert stats[pid]["playoff_stage"] == "Champion"


def test_group_playoff_espejo_stats_cover_losers_bracket_players():
    t = _gp_tournament(n_players=16, top_per_group=4, espejo=True)
    stats = extract_history_stats({"type": "group_playoff", "tournament": t})
    lb_players = {p.id for m in t.playoff_bracket.losers_bracket.matches for p in [*m.team1, *m.team2]}
    assert lb_players
    assert all("playoff_stage" in stats[pid] for pid in lb_players)


def _mexicano_with_playoffs(*, double_elimination: bool) -> MexicanoTournament:
    players = [Player(name=f"P{i}") for i in range(8)]
    t = MexicanoTournament(players=players, courts=[Court(name="C1"), Court(name="C2")], num_rounds=2)
    for _ in range(2):
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (20, 12))
    t.end_mexicano()
    t.start_playoffs(n_teams=8, double_elimination=double_elimination)
    _play_all_playoffs(t)
    assert t.champion() is not None
    return t


@pytest.mark.parametrize("double_elimination", [False, True], ids=["single-elim", "double-elim"])
def test_mexicano_history_stats_include_playoff_matches_once(double_elimination):
    t = _mexicano_with_playoffs(double_elimination=double_elimination)
    stats = extract_history_stats({"type": "mexicano", "tournament": t})

    mex_matches = t.all_matches()
    playoff = [m for m in bracket_matches(t.playoff_bracket) if m.score is not None]
    assert playoff, "test setup: no play-off matches were played"
    assert not {m.id for m in mex_matches} & {m.id for m in playoff}
    # Every player: Mexicano-round games + play-off games, each counted once.
    _assert_counts_every_match_once(stats, mex_matches + playoff)

    champion_ids = {p.id for p in t.champion()}
    for pid in champion_ids:
        assert stats[pid]["playoff_stage"] == "Champion"
    # Players who reached the bracket carry a stage; the stage comes only from the bracket.
    bracket_players = {p.id for m in playoff for p in [*m.team1, *m.team2]}
    assert all("playoff_stage" in stats[pid] for pid in bracket_players)


def test_bracket_matches_accessor_handles_all_bracket_classes():
    from backend.tournaments.playoff import (
        DoubleEliminationBracket,
        EspejoParallelBracket,
        SingleEliminationBracket,
    )

    teams = [[Player(name=f"T{i}")] for i in range(4)]
    for cls in (SingleEliminationBracket, DoubleEliminationBracket, EspejoParallelBracket):
        b = cls(teams)
        found = bracket_matches(b)
        assert found and all(hasattr(m, "id") for m in found)
