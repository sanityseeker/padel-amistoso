"""Public player card for one tournament.

The match list comes from the tournament's own matches (they carry team ids,
walkovers and the stage of each match), and the rating change of each match is
joined from ``player_elo_log``.  A composed team is rated through its members,
so its per-match change is the mean of its members' changes.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from ..models import Match, MatchStatus, Sport, TournamentType
from ..tournaments.playoff import bracket_matches
from . import state
from .club_elo import elo_scope, get_tournament_display_elos
from .db import get_db
from .player_card import HISTORY_DEFAULT_LIMIT, HISTORY_HARD_CAP, participant_profiles

STAGE_ALL = "all"
STAGE_GROUP = "group"
STAGE_ROUNDS = "rounds"
STAGE_PLAYOFF = "playoff"


def _staged_matches(tournament: object, ttype: str) -> list[tuple[str, int, Match]]:
    """Every match of the tournament as ``(stage, round_fallback, match)``, in play order."""
    out: list[tuple[str, int, Match]] = []
    if ttype == TournamentType.MEXICANO:
        for idx, round_matches in enumerate(getattr(tournament, "rounds", []) or [], start=1):
            out.extend((STAGE_ROUNDS, idx, m) for m in round_matches)
    elif ttype == TournamentType.GROUP_PLAYOFF:
        for group in getattr(tournament, "groups", []) or []:
            out.extend((STAGE_GROUP, 0, m) for m in group.matches)
    bracket = getattr(tournament, "playoff_bracket", None) if ttype != TournamentType.PLAYOFF else None
    if ttype == TournamentType.PLAYOFF:
        bracket = getattr(tournament, "bracket", None)
    if bracket is not None:
        out.extend((STAGE_PLAYOFF, 0, m) for m in bracket_matches(bracket))
    return out


def _outcome(m: Match, side: int) -> str:
    s1, s2 = m.score or (0, 0)
    if s1 == s2:
        return "D"
    return "W" if (s1 > s2) == (side == 1) else "L"


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _round1(value: float | None) -> float | None:
    return round(value, 1) if value is not None else None


def build_tournament_player_card(
    tid: str, player_id: str, limit: int = HISTORY_DEFAULT_LIMIT, only_stage: str | None = None
) -> dict[str, Any]:
    """Build (uncached) the public card payload for a tournament player or composed team.

    ``recent_matches`` lists the newest *limit* matches (of the one *only_stage* when given and the player has matches in more than one stage; at most
    :data:`HISTORY_HARD_CAP`), ``recent_total`` how many there are to list.  The numbers always
    cover the whole event.
    """
    data = state._tournaments[tid]
    tournament = data.get("tournament")
    sport = data.get("sport", Sport.PADEL)
    ttype = data.get("type", "")
    club = bool(data.get("club_id"))

    roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
    member_names: dict[str, list[str]] = getattr(tournament, "team_member_names", None) or {}
    is_team = player_id in roster
    member_ids = list(roster.get(player_id, [])) if is_team else []
    rated_ids = member_ids or [player_id]

    staged = _staged_matches(tournament, ttype)
    names: dict[str, str] = {}
    for p in getattr(tournament, "players", []) or []:
        names[p.id] = p.name
    for _stage, _rnd, m in staged:
        for p in m.team1 + m.team2:
            names.setdefault(p.id, p.name)

    # A club tournament shows the club's own ratings (see ``club_elo``).
    elo_columns = (
        "COALESCE(club_elo_before, elo_before) AS elo_before, COALESCE(club_elo_after, elo_after) AS elo_after,"
        " COALESCE(club_elo_after - club_elo_before, elo_delta) AS elo_delta"
        if club
        else "elo_before, elo_after, elo_delta"
    )
    placeholders = ",".join("?" for _ in rated_ids)
    with get_db() as conn:
        log_rows = conn.execute(
            f"""SELECT match_id, player_id, {elo_columns}, updated_at
               FROM player_elo_log
              WHERE tournament_id = ? AND player_id IN ({placeholders}) AND is_manual = 0
              ORDER BY updated_at ASC, match_order ASC""",
            (tid, *rated_ids),
        ).fetchall()
    # ``_seq`` keeps the order the ratings were applied in, which can differ from bracket order
    # (a later round scored first, a corrected score replayed).
    log_rows = [{**dict(r), "_seq": i} for i, r in enumerate(log_rows)]
    by_match: dict[str, dict[str, Any]] = {}
    for r in log_rows:
        by_match.setdefault(r["match_id"], {})[r["player_id"]] = r

    if player_id not in names and not is_team and not log_rows:
        raise HTTPException(404, "Player not in this tournament")
    player_name = names.get(player_id) or player_id

    entries: list[dict[str, Any]] = []
    for stage, round_fallback, m in staged:
        if m.status != MatchStatus.COMPLETED or m.score is None:
            continue  # unplayed, or a bye
        side = 1 if any(p.id == player_id for p in m.team1) else 2 if any(p.id == player_id for p in m.team2) else 0
        if not side:
            continue
        walkover = bool(getattr(m, "walkover", False))
        rows = [] if walkover else [by_match[m.id][pid] for pid in rated_ids if pid in by_match.get(m.id, {})]
        sets = [list(s) for s in (m.sets or [])]
        decider = getattr(m, "decider", None)
        entries.append(
            {
                "match_id": m.id,
                "stage": stage,
                "score": list(m.score),
                "sets": sets,
                "decider": getattr(decider, "value", decider) or ("full_set" if sets else None),
                "team1": [p.name for p in m.team1],
                "team2": [p.name for p in m.team2],
                # This event's player ids, in the same order: a name opens that player's card.
                "team1_ids": [p.id for p in m.team1],
                "team2_ids": [p.id for p in m.team2],
                # The card's own player: 1 or 2, so the card can show the match from their side.
                "side": side,
                "elo_before": _mean([float(r["elo_before"]) for r in rows if r["elo_before"] is not None]),
                "elo_after": _mean([float(r["elo_after"]) for r in rows if r["elo_after"] is not None]),
                "elo_delta": _mean([float(r["elo_delta"]) for r in rows if r["elo_delta"] is not None]),
                "updated_at": rows[0]["updated_at"] if rows else None,
                "is_manual": False,
                "walkover": walkover,
                "round_number": int(m.round_number or round_fallback or 0) or None,
                "round_label": m.round_label or "",
                "_rows": rows,
                "_outcome": _outcome(m, side),
            }
        )

    def stats_of(scope: list[dict[str, Any]]) -> dict[str, Any]:
        deltas = [d for d in (_member_delta(scope, pid) for pid in rated_ids) if d is not None]
        return {
            "matches": len(scope),
            "wins": sum(1 for e in scope if e["_outcome"] == "W"),
            "draws": sum(1 for e in scope if e["_outcome"] == "D"),
            "losses": sum(1 for e in scope if e["_outcome"] == "L"),
            "walkovers": sum(1 for e in scope if e["walkover"]),
            "elo_delta": _round1(_mean(deltas)),
        }

    stages = [s for s in (STAGE_GROUP, STAGE_ROUNDS, STAGE_PLAYOFF) if any(e["stage"] == s for e in entries)]
    stats = {STAGE_ALL: stats_of(entries)}
    for s in stages:
        stats[s] = stats_of([e for e in entries if e["stage"] == s])

    rated = sorted((e for e in entries if e["_rows"]), key=lambda e: min(r["_seq"] for r in e["_rows"]))
    elo_history = [e["elo_after"] for e in rated if e["elo_after"] is not None]
    starts = [d for d in (_member_start(entries, pid) for pid in rated_ids) if d is not None]
    starting = _mean(starts)

    display = get_tournament_display_elos(tid, sport)

    def current_elo(pid: str, rows: list[dict[str, Any]]) -> float | None:
        if club and display.get(pid) is not None:
            return _round1(display[pid])
        last = [float(r["elo_after"]) for r in sorted(rows, key=lambda r: r["_seq"]) if r["elo_after"] is not None]
        if last:
            return round(last[-1], 1)
        return _round1(display.get(pid)) if is_team else None

    own_rows = [r for e in entries for r in e["_rows"]]
    members: list[dict[str, Any]] = []
    for i, mid in enumerate(member_ids):
        listed = member_names.get(player_id) or []
        members.append(
            {
                "player_id": mid,
                "name": listed[i] if i < len(listed) else names.get(mid, mid),
                "elo": current_elo(mid, [r for r in own_rows if r["player_id"] == mid]),
                "elo_delta": {
                    s: _round1(
                        _member_delta(entries if s == STAGE_ALL else [e for e in entries if e["stage"] == s], mid)
                    )
                    for s in [STAGE_ALL, *stages]
                },
            }
        )
    if is_team:
        current = _round1(display.get(player_id)) or _round1(_mean([m["elo"] for m in members if m["elo"] is not None]))
    else:
        current = current_elo(player_id, own_rows)

    keep_stage = only_stage if only_stage in stages and len(stages) > 1 else None
    recent = [
        {k: v for k, v in e.items() if not k.startswith("_")}
        for e in reversed(entries)
        if keep_stage is None or e["stage"] == keep_stage
    ]
    total = stats[STAGE_ALL]
    # Whether a wider card can exist (a linked profile; a team through any member). Which scopes a
    # viewer may open depends on who asks: ``/card-scopes``. Never the profile id: this card is anonymous.
    linked = participant_profiles(tid, rated_ids)
    has_profile = bool(linked)
    for member in members:
        # Whether each player of a team has a profile: a wider team card needs both.
        member["has_profile"] = member["player_id"] in linked
    return {
        "tournament_id": tid,
        "player_id": player_id,
        "player_name": player_name,
        "sport": sport,
        "is_team": is_team,
        "members": members,
        "elo": current,
        "elo_scope": elo_scope(data),
        "elo_start": _round1(starting),
        "elo_delta_total": total["elo_delta"],
        "matches": total["matches"],
        "wins": total["wins"],
        "draws": total["draws"],
        "losses": total["losses"],
        "stages": stages,
        "stats": stats,
        "recent_matches": recent[: min(limit, HISTORY_HARD_CAP)],
        "recent_total": len(recent),
        "elo_history": elo_history,
        "has_profile": has_profile,
    }


def _member_rows(entries: list[dict[str, Any]], pid: str) -> list[dict[str, Any]]:
    """*pid*'s rating rows in *entries*, in the order the ratings were applied."""
    return sorted((r for e in entries for r in e["_rows"] if r["player_id"] == pid), key=lambda r: r["_seq"])


def _member_start(entries: list[dict[str, Any]], pid: str) -> float | None:
    """Rating of *pid* before the first rated match in *entries*."""
    return next((float(r["elo_before"]) for r in _member_rows(entries, pid) if r["elo_before"] is not None), None)


def _member_delta(entries: list[dict[str, Any]], pid: str) -> float | None:
    """Rating change of *pid* over *entries*: the sum of each match's own change.

    Summing (not last-after minus first-before) stays right when *entries* is one stage whose
    matches were rated between another stage's, or in a different order than the bracket.
    """
    deltas = [
        float(r["elo_after"]) - float(r["elo_before"])
        for r in _member_rows(entries, pid)
        if r["elo_before"] is not None and r["elo_after"] is not None
    ]
    return sum(deltas) if deltas else None
