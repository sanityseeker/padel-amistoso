"""Participant withdrawal: the 50% rule, rotating-partner exclusion and bracket forfeits.

Pure engine logic (no HTTP, no persistence).  Four cases, picked by the
tournament wrappers from format + phase + mode:

* **G1** — fixed-team / singles group stage: the 50% rule.  Fewer than half of
  the entry's group matches played → :attr:`WithdrawalKind.ANNUL` (the entry
  and all its group matches are moved out of the group); half or more →
  :attr:`WithdrawalKind.WALKOVER` (played results stand, the remaining matches
  become walkovers).
* **G2** — rotating-partner group stage: :attr:`WithdrawalKind.EXCLUDE`.  The
  person is left out of every following round; played matches stay.  An
  unplayed match of the current round is dropped and its other three players
  sit out (with sit-out credit, so they get priority next round).
* **P** — any bracket: :attr:`WithdrawalKind.FORFEIT`.  Every bracket match of
  the entry becomes a walkover for the opponent as soon as the opponent is
  known (:func:`resolve_bracket_forfeits`, re-run after every bracket record).
* **M** — Mexicano rounds: handled by the existing remove endpoint, not here.

Planning functions never mutate.  Apply functions re-plan and raise
:class:`WithdrawalBlocked` / ``ValueError`` before mutating anything.
"""

from __future__ import annotations

import copy
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal

from ..models import InputFormat, Match, MatchStatus, Player, SetDecider, reset_match_result
from . import pairing as pairing_mod
from .errors import WithdrawalBlocked
from .group_stage import Group
from .playoff import (
    DoubleEliminationBracket,
    EspejoParallelBracket,
    SingleEliminationBracket,
    bracket_matches,
)
from .set_format import totals_from_sets, validate_decider_sets

# Walkover score defaults, winner first (opponent - withdrawn).
DEFAULT_WALKOVER_POINTS: tuple[int, int] = (6, 0)
DEFAULT_WALKOVER_SETS: tuple[tuple[int, int], ...] = ((6, 0), (6, 0))
# Same cap as ``MatchFormatOverride.points_target``.
MAX_WALKOVER_POINTS = 200

BlockerReason = Literal["pending", "disputed", "format_review"]


class WithdrawalKind(StrEnum):
    """What a withdrawal does to the entry's matches."""

    ANNUL = "annul"
    WALKOVER = "walkover"
    EXCLUDE = "exclude"
    FORFEIT = "forfeit"


# ────────────────────────────────────────────────────────────────────────────
# Walkover score template
# ────────────────────────────────────────────────────────────────────────────


@dataclass
class WalkoverResult:
    """A walkover score oriented to one match (team1 first)."""

    score: tuple[int, int]
    sets: list[tuple[int, int]] | None
    decider: SetDecider | None
    third_set_loss: bool
    # True when the organiser's set template did not fit this match's decider
    # and the 6-0 6-0 default was used instead.
    fell_back: bool = False


@dataclass
class WalkoverTemplate:
    """The walkover score chosen once per withdrawal, winner first.

    ``stage_mode`` / ``default_decider`` are the stage's score mode and the
    tournament's third-set decider captured at withdrawal; a match's own
    ``format_override`` wins over both.
    """

    points: tuple[int, int] = DEFAULT_WALKOVER_POINTS
    sets: list[tuple[int, int]] = field(default_factory=lambda: list(DEFAULT_WALKOVER_SETS))
    stage_mode: InputFormat = InputFormat.POINTS
    default_decider: SetDecider = SetDecider.FULL_SET

    def mode_for(self, m: Match) -> InputFormat:
        """Input mode the walkover of *m* is recorded in."""
        fo = getattr(m, "format_override", None)
        if fo is not None and fo.mode:
            return InputFormat(fo.mode)
        return self.stage_mode

    def decider_for(self, m: Match) -> SetDecider:
        """Third-set decider the walkover of *m* is recorded under."""
        fo = getattr(m, "format_override", None)
        if fo is not None and fo.decider:
            return SetDecider(fo.decider)
        return self.default_decider

    def result_for(self, m: Match, withdrawn_is_team1: bool) -> WalkoverResult:
        """Return the walkover score of *m*, oriented so the non-withdrawn side wins."""
        if self.mode_for(m) == InputFormat.POINTS:
            winner, loser = int(self.points[0]), int(self.points[1])
            score = (loser, winner) if withdrawn_is_team1 else (winner, loser)
            return WalkoverResult(score=score, sets=None, decider=None, third_set_loss=False)
        decider = self.decider_for(m)
        sets = [(int(a), int(b)) for a, b in self.sets]
        fell_back = False
        try:
            validate_decider_sets(sets, decider)
        except ValueError:
            sets = list(DEFAULT_WALKOVER_SETS)
            fell_back = True
        oriented = [(b, a) for a, b in sets] if withdrawn_is_team1 else sets
        total1, total2, third = totals_from_sets(oriented, decider)
        return WalkoverResult(
            score=(total1, total2),
            sets=oriented,
            decider=decider,
            third_set_loss=third,
            fell_back=fell_back,
        )

    def __getstate__(self) -> dict:
        return self.__dict__.copy()

    def __setstate__(self, state: dict) -> None:
        state.setdefault("points", DEFAULT_WALKOVER_POINTS)
        state.setdefault("sets", list(DEFAULT_WALKOVER_SETS))
        state.setdefault("stage_mode", InputFormat.POINTS)
        state.setdefault("default_decider", SetDecider.FULL_SET)
        self.__dict__.update(state)


def validate_walkover_points(points: tuple[int, int] | list[int]) -> None:
    """Raise ``ValueError`` unless *points* is a winner-first ``[W, L]`` with ``0 <= L < W <= 200``."""
    if len(points) != 2:
        raise ValueError("A points walkover score needs exactly two numbers")
    winner, loser = int(points[0]), int(points[1])
    if loser < 0 or winner > MAX_WALKOVER_POINTS or loser >= winner:
        raise ValueError(
            f"The walkover winner must score more than the loser (0 <= loser < winner <= {MAX_WALKOVER_POINTS})"
        )


def validate_walkover_sets(sets: list[tuple[int, int]] | list[list[int]]) -> None:
    """Raise ``ValueError`` unless the winner-first side won more sets."""
    sets1 = sum(1 for s in sets if s[0] > s[1])
    sets2 = sum(1 for s in sets if s[1] > s[0])
    if sets1 <= sets2:
        raise ValueError("The walkover winner (first score of each set) must win more sets")


def check_template_fits(template: WalkoverTemplate, matches: list[Match], future_walkovers: bool) -> None:
    """Raise ``ValueError`` when the set template breaks a known match's decider.

    Walkovers created later (bracket forfeits waiting for an opponent) are
    checked against the tournament default decider when they will be scored
    in sets.
    """
    for m in matches:
        if template.mode_for(m) == InputFormat.SETS:
            validate_decider_sets(template.sets, template.decider_for(m))
    if future_walkovers and template.stage_mode == InputFormat.SETS:
        validate_decider_sets(template.sets, template.default_decider)


def modes_needed(template: WalkoverTemplate, matches: list[Match], future_walkovers: bool) -> list[InputFormat]:
    """Score modes the organiser must enter a walkover score for (stable order)."""
    modes = {template.mode_for(m) for m in matches}
    if future_walkovers:
        modes.add(template.stage_mode)
    return [mode for mode in (InputFormat.POINTS, InputFormat.SETS) if mode in modes]


def deciders_needed(template: WalkoverTemplate, matches: list[Match], future_walkovers: bool) -> list[SetDecider]:
    """Distinct third-set deciders a set score must satisfy (stable order, full set first)."""
    found = {template.decider_for(m) for m in matches if template.mode_for(m) == InputFormat.SETS}
    if future_walkovers and template.stage_mode == InputFormat.SETS:
        found.add(template.default_decider)
    return [d for d in (SetDecider.FULL_SET, SetDecider.MATCH_TIEBREAK) if d in found]


# ────────────────────────────────────────────────────────────────────────────
# Plans and records
# ────────────────────────────────────────────────────────────────────────────


@dataclass
class WithdrawalBlocker:
    """A match whose score lifecycle must be settled before the withdrawal."""

    match_id: str
    reason: BlockerReason


@dataclass
class WithdrawalPlan:
    """Dry-run result: what a withdrawal would do.  Never mutates anything."""

    entry_key: str
    entry: list[Player]
    kind: WithdrawalKind
    group_name: str | None = None
    played: int = 0
    total: int = 0
    annul_matches: list[Match] = field(default_factory=list)
    walkover_matches: list[Match] = field(default_factory=list)
    # G2: the person's unplayed match of the current round, and its other players.
    dropped_match: Match | None = None
    sit_out_players: list[Player] = field(default_factory=list)
    # P: the pending bracket match that becomes a walkover now.
    pending_forfeit_match: Match | None = None
    # P: round label the opponent advances to (``None`` when it decides a place).
    advance_to: str | None = None
    tbd: bool = False
    lb_drop: bool = False
    third_place_note: bool = False
    # P: walkovers may still be created later (TBD opponent, LB drop, 3rd place).
    future_walkovers: bool = False
    active_after: int | None = None
    blockers: list[WithdrawalBlocker] = field(default_factory=list)
    undo_possible: bool = False

    @property
    def affected_walkover_matches(self) -> list[Match]:
        """Matches that become walkovers right away."""
        if self.pending_forfeit_match is not None:
            return [self.pending_forfeit_match]
        return list(self.walkover_matches)


@dataclass
class WithdrawalRecord:
    """A stored withdrawal, with everything needed to show and (G1/G2) undo it."""

    entry_key: str
    entry: list[Player]
    kind: WithdrawalKind
    member_ids: list[str] = field(default_factory=list)
    group_name: str | None = None
    played: int = 0
    total: int = 0
    template: WalkoverTemplate | None = None
    # G1 annul: the moved-out matches and their original indices in ``group.matches``.
    annulled_matches: list[Match] = field(default_factory=list)
    annulled_positions: list[int] = field(default_factory=list)
    # G1 annul: original index of the entry in ``group.players`` / ``t.players``.
    group_index: int | None = None
    tournament_index: int | None = None
    walkover_match_ids: list[str] = field(default_factory=list)
    # G2: the dropped current-round match and its index in ``group.matches``.
    dropped_match: Match | None = None
    dropped_position: int | None = None
    sit_out_bumped: list[str] = field(default_factory=list)
    pruned_partnerships: list[frozenset[str]] = field(default_factory=list)
    released_partnerships: list[frozenset[str]] = field(default_factory=list)
    round_count_at: int | None = None
    roster_snapshot: list[str] = field(default_factory=list)
    by: str | None = None
    at: float = 0.0

    @property
    def name(self) -> str:
        return " & ".join(p.name for p in self.entry)

    def __getstate__(self) -> dict:
        return self.__dict__.copy()

    def __setstate__(self, state: dict) -> None:
        state.setdefault("member_ids", [p.id for p in state.get("entry", [])])
        state.setdefault("group_name", None)
        state.setdefault("played", 0)
        state.setdefault("total", 0)
        state.setdefault("template", None)
        state.setdefault("annulled_matches", [])
        state.setdefault("annulled_positions", [])
        state.setdefault("group_index", None)
        state.setdefault("tournament_index", None)
        state.setdefault("walkover_match_ids", [])
        state.setdefault("dropped_match", None)
        state.setdefault("dropped_position", None)
        state.setdefault("sit_out_bumped", [])
        state.setdefault("pruned_partnerships", [])
        state.setdefault("released_partnerships", [])
        state.setdefault("round_count_at", None)
        state.setdefault("roster_snapshot", [])
        state.setdefault("by", None)
        state.setdefault("at", 0.0)
        self.__dict__.update(state)


# ────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ────────────────────────────────────────────────────────────────────────────


def classify_fifty_percent(played: int, total: int) -> WithdrawalKind:
    """The 50% rule: half or more played keeps the results (walkovers), fewer annuls them."""
    if total > 0 and 2 * played >= total:
        return WithdrawalKind.WALKOVER
    return WithdrawalKind.ANNUL


def bracket_entry_key(team: list[Player]) -> str:
    """Stable key for a bracket / group entry: its id, or sorted member ids joined with ``+``."""
    if len(team) == 1:
        return team[0].id
    return "+".join(sorted(p.id for p in team))


def entry_member_ids(team: list[Player], team_roster: dict[str, list[str]] | None = None) -> list[str]:
    """Entry player ids plus composite-team members (``team_roster``)."""
    roster = team_roster or {}
    out: list[str] = []
    for p in team:
        if p.id not in out:
            out.append(p.id)
        for mid in roster.get(p.id, []):
            if mid not in out:
                out.append(mid)
    return out


def match_blocker(m: Match) -> BlockerReason | None:
    """Why *m*'s score lifecycle blocks a withdrawal, or ``None``."""
    if getattr(m, "disputed", False):
        return "disputed"
    if getattr(m, "format_review", False):
        return "format_review"
    if m.status == MatchStatus.IN_PROGRESS:
        return "pending"
    return None


def _blockers(matches: list[Match]) -> list[WithdrawalBlocker]:
    out: list[WithdrawalBlocker] = []
    for m in matches:
        reason = match_blocker(m)
        if reason is not None:
            out.append(WithdrawalBlocker(match_id=m.id, reason=reason))
    return out


def _match_ids(m: Match) -> set[str]:
    return {p.id for p in m.team1 + m.team2}


def _is_played(m: Match) -> bool:
    return m.status == MatchStatus.COMPLETED and m.score is not None and not getattr(m, "walkover", False)


def stamp_walkover(
    m: Match,
    result: WalkoverResult,
    *,
    entry_key: str,
    by: str | None,
    at: float,
    both_withdrawn: bool = False,
) -> None:
    """Mark *m* (already holding the walkover score) as a confirmed walkover."""
    m.walkover = True
    m.decider = result.decider
    m.third_set_loss = result.third_set_loss
    m.score_confirmed = True
    m.scored_by = None
    m.scored_at = at
    m.disputed = False
    m.dispute_score = None
    m.dispute_sets = None
    m.dispute_by = None
    m.dispute_at = None
    m.dispute_escalated = False
    m.format_review = False
    m.review_score = None
    m.review_sets = None
    m.review_decider = None
    entry: dict[str, Any] = {
        "player_id": by or "system",
        "action": "walkover",
        "score": list(m.score) if m.score else None,
        "sets": [list(s) for s in m.sets] if m.sets else None,
        "timestamp": at,
        "withdrawn": entry_key,
    }
    if result.fell_back:
        entry["note"] = "template_fallback"
    if both_withdrawn:
        entry["both_withdrawn"] = True
    m.score_history.append(entry)


# ────────────────────────────────────────────────────────────────────────────
# G1 — fixed-team / singles group stage (the 50% rule)
# ────────────────────────────────────────────────────────────────────────────


def _group_entry(group: Group, entry_id: str) -> Player:
    entry = next((p for p in group.players if p.id == entry_id), None)
    if entry is None:
        raise KeyError(f"Entry {entry_id} is not in group {group.name}")
    return entry


def plan_group_team_withdrawal(group: Group, entry_id: str, withdrawn_ids: set[str]) -> WithdrawalPlan:
    """Plan a G1 withdrawal of *entry_id* from a fixed-team group.

    ``withdrawn_ids`` are entries that already withdrew (walkover branch, so
    still in the group); walkovers against them count neither as played nor
    in the total, which keeps a second withdrawal in the same group
    well-defined.
    """
    entry = _group_entry(group, entry_id)
    matches = [m for m in group.matches if entry_id in _match_ids(m)]

    def _vs_withdrawn(m: Match) -> bool:
        return getattr(m, "walkover", False) and any(pid in withdrawn_ids for pid in _match_ids(m) - {entry_id})

    counted = [m for m in matches if not _vs_withdrawn(m)]
    played = sum(1 for m in counted if _is_played(m))
    total = len(counted)
    kind = classify_fifty_percent(played, total)
    plan = WithdrawalPlan(
        entry_key=entry_id,
        entry=[entry],
        kind=kind,
        group_name=group.name,
        played=played,
        total=total,
        blockers=_blockers(matches),
        undo_possible=True,
    )
    if kind == WithdrawalKind.ANNUL:
        plan.annul_matches = list(matches)
    else:
        plan.walkover_matches = [
            m for m in matches if m.status == MatchStatus.SCHEDULED and match_blocker(m) is None and not m.walkover
        ]
    return plan


def apply_group_team_withdrawal(
    tournament_players: list[Player],
    group: Group,
    entry_id: str,
    withdrawn_ids: set[str],
    template: WalkoverTemplate | None,
    *,
    member_ids: list[str],
    by: str | None = None,
    at: float | None = None,
) -> WithdrawalRecord:
    """Apply a G1 withdrawal.  Mutates *group* and *tournament_players* (annul only)."""
    at = time.time() if at is None else at
    plan = plan_group_team_withdrawal(group, entry_id, withdrawn_ids)
    if plan.blockers:
        raise WithdrawalBlocked("Settle the pending, disputed or under-review scores first")
    template = template or WalkoverTemplate()
    entry = plan.entry[0]
    record = WithdrawalRecord(
        entry_key=entry_id,
        entry=[entry],
        kind=plan.kind,
        member_ids=list(member_ids),
        group_name=group.name,
        played=plan.played,
        total=plan.total,
        by=by,
        at=at,
    )
    if plan.kind == WithdrawalKind.ANNUL:
        positions = [i for i, m in enumerate(group.matches) if entry_id in _match_ids(m)]
        record.annulled_matches = [group.matches[i] for i in positions]
        record.annulled_positions = positions
        record.group_index = group.players.index(entry)
        record.tournament_index = next((i for i, p in enumerate(tournament_players) if p.id == entry_id), None)
        drop = set(positions)
        group.matches = [m for i, m in enumerate(group.matches) if i not in drop]
        group.players = [p for p in group.players if p.id != entry_id]
        tournament_players[:] = [p for p in tournament_players if p.id != entry_id]
    else:
        record.template = template
        for m in plan.walkover_matches:
            withdrawn_is_team1 = any(p.id == entry_id for p in m.team1)
            result = template.result_for(m, withdrawn_is_team1)
            m.score = result.score
            m.sets = result.sets
            m.status = MatchStatus.COMPLETED
            stamp_walkover(m, result, entry_key=entry_id, by=by, at=at)
            record.walkover_match_ids.append(m.id)
        group.withdrawn_ids.add(entry_id)
    group._standings_cache = None
    record.roster_snapshot = [p.id for p in group.players]
    return record


def undo_group_team_withdrawal(
    tournament_players: list[Player],
    group: Group,
    record: WithdrawalRecord,
    *,
    by: str | None = None,
    at: float | None = None,
) -> None:
    """Reverse a G1 withdrawal.  The caller checks phase and later records first."""
    at = time.time() if at is None else at
    if [p.id for p in group.players] != record.roster_snapshot:
        raise WithdrawalBlocked("The group roster changed since the withdrawal; it can no longer be undone")
    if record.kind == WithdrawalKind.ANNUL:
        entry = record.entry[0]
        clash = next(
            (p for p in tournament_players if p.id == entry.id or p.name.strip().lower() == entry.name.strip().lower()),
            None,
        )
        if clash is not None:
            raise WithdrawalBlocked(f"Another participant is now called '{clash.name}'; rename them first")
        gi = record.group_index if record.group_index is not None else len(group.players)
        group.players.insert(min(gi, len(group.players)), entry)
        ti = record.tournament_index if record.tournament_index is not None else len(tournament_players)
        tournament_players.insert(min(ti, len(tournament_players)), entry)
        for pos, m in sorted(zip(record.annulled_positions, record.annulled_matches), key=lambda x: x[0]):
            group.matches.insert(min(pos, len(group.matches)), m)
    else:
        by_id = {m.id: m for m in group.matches}
        for mid in record.walkover_match_ids:
            m = by_id.get(mid)
            if m is None or not m.walkover:
                continue
            prev_score = list(m.score) if m.score else None
            prev_sets = [list(s) for s in m.sets] if m.sets else None
            reset_match_result(m)
            m.score_history.append(
                {
                    "player_id": by or "system",
                    "action": "walkover_undo",
                    "score": prev_score,
                    "sets": prev_sets,
                    "timestamp": at,
                }
            )
        group.withdrawn_ids.discard(record.entry_key)
    group._standings_cache = None


# ────────────────────────────────────────────────────────────────────────────
# G2 — rotating-partner group stage (exclude from following rounds)
# ────────────────────────────────────────────────────────────────────────────


def plan_group_rotating_withdrawal(group: Group, person_id: str) -> WithdrawalPlan:
    """Plan a G2 withdrawal: exclude *person_id* from every following round."""
    person = _group_entry(group, person_id)
    if person_id in group.withdrawn_ids:
        raise WithdrawalBlocked("This player has already withdrawn")
    matches = [m for m in group.matches if person_id in _match_ids(m)]
    unplayed = [m for m in matches if m.status == MatchStatus.SCHEDULED and not m.format_review]
    if len(unplayed) > 1:
        raise WithdrawalBlocked("The player has more than one unplayed match; settle the earlier rounds first")
    dropped = unplayed[0] if unplayed else None
    return WithdrawalPlan(
        entry_key=person_id,
        entry=[person],
        kind=WithdrawalKind.EXCLUDE,
        group_name=group.name,
        played=sum(1 for m in matches if _is_played(m)),
        total=len(matches),
        dropped_match=dropped,
        sit_out_players=[p for p in (dropped.team1 + dropped.team2) if p.id != person_id] if dropped else [],
        active_after=len(group.active_players) - 1,
        blockers=_blockers(matches),
        undo_possible=True,
    )


def apply_group_rotating_withdrawal(
    group: Group,
    person_id: str,
    *,
    by: str | None = None,
    at: float | None = None,
) -> WithdrawalRecord:
    """Apply a G2 withdrawal.  Mutates *group* only."""
    at = time.time() if at is None else at
    plan = plan_group_rotating_withdrawal(group, person_id)
    if plan.blockers:
        raise WithdrawalBlocked("Settle the pending, disputed or under-review scores first")
    record = WithdrawalRecord(
        entry_key=person_id,
        entry=list(plan.entry),
        kind=WithdrawalKind.EXCLUDE,
        member_ids=[person_id],
        group_name=group.name,
        played=plan.played,
        total=plan.total,
        round_count_at=group._round_count,
        by=by,
        at=at,
    )
    dropped = plan.dropped_match
    if dropped is not None:
        pos = group.matches.index(dropped)
        group.matches.pop(pos)
        record.dropped_match = dropped
        record.dropped_position = pos
        pairing_mod.revert_history(dropped.team1, dropped.team2, group._partner_history, group._opponent_history)
        for team in (dropped.team1, dropped.team2):
            if len(team) != 2:
                continue
            key = frozenset([team[0].id, team[1].id])
            still_used = any(
                len(t) == 2 and frozenset([t[0].id, t[1].id]) == key for m in group.matches for t in (m.team1, m.team2)
            )
            if not still_used and key in group._used_partnerships:
                group._used_partnerships.discard(key)
                record.released_partnerships.append(key)
        for p in plan.sit_out_players:
            group._sit_out_counts[p.id] = group._sit_out_counts.get(p.id, 0) + 1
            record.sit_out_bumped.append(p.id)
    pruned = [pp for pp in group._all_partnerships if person_id in pp]
    group._all_partnerships.difference_update(pruned)
    record.pruned_partnerships = pruned
    group.withdrawn_ids.add(person_id)
    group._standings_cache = None
    record.roster_snapshot = [p.id for p in group.players]
    return record


def undo_group_rotating_withdrawal(group: Group, record: WithdrawalRecord) -> None:
    """Reverse a G2 withdrawal (only before the next round was generated)."""
    if group._round_count != record.round_count_at:
        raise WithdrawalBlocked("A new round was generated since the withdrawal; it can no longer be undone")
    group.withdrawn_ids.discard(record.entry_key)
    group._all_partnerships.update(record.pruned_partnerships)
    dropped = record.dropped_match
    if dropped is not None:
        pos = record.dropped_position if record.dropped_position is not None else len(group.matches)
        group.matches.insert(min(pos, len(group.matches)), dropped)
        pairing_mod.update_history(dropped.team1, dropped.team2, group._partner_history, group._opponent_history)
        group._used_partnerships.update(record.released_partnerships)
        for pid in record.sit_out_bumped:
            group._sit_out_counts[pid] = max(0, group._sit_out_counts.get(pid, 0) - 1)
    group._standings_cache = None


# ────────────────────────────────────────────────────────────────────────────
# P — brackets (forfeit with walkovers)
# ────────────────────────────────────────────────────────────────────────────


def bracket_teams(bracket: object) -> list[list[Player]]:
    """Seeded entries of *bracket* (Oro then Plata for the split Espejo)."""
    if isinstance(bracket, EspejoParallelBracket):
        teams = list(bracket.winners_bracket.original_teams)
        if getattr(bracket, "is_split", False) and bracket.losers_bracket is not None:
            teams += list(bracket.losers_bracket.original_teams)
        return teams
    return list(getattr(bracket, "original_teams", []) or [])


def find_bracket_entry(
    bracket: object,
    person_id: str,
    team_roster: dict[str, list[str]] | None = None,
) -> list[Player] | None:
    """The bracket entry containing *person_id* (directly or as a composite-team member)."""
    for team in bracket_teams(bracket):
        if person_id in entry_member_ids(team, team_roster):
            return team
    for m in bracket_matches(bracket):
        for team in (m.team1, m.team2):
            if team and person_id in entry_member_ids(team, team_roster):
                return team
    return None


def _seed_index(bracket: object, key: str) -> int:
    for i, team in enumerate(bracket_teams(bracket)):
        if bracket_entry_key(team) == key:
            return i
    return 10**6


def _match_by_id(bracket: object, match_id: str) -> Match | None:
    mm = getattr(bracket, "_match_map", None)
    if mm and match_id in mm:
        return mm[match_id]
    return next((m for m in bracket_matches(bracket) if m.id == match_id), None)


def bracket_match(bracket: object, match_id: str) -> Match | None:
    """Public lookup of a bracket match by id (any bracket class)."""
    return _match_by_id(bracket, match_id)


def _downstream_ids(bracket: object, match_id: str, *, winner_only: bool = False) -> list[str]:
    """Matches fed by *match_id*'s winner (and loser, unless *winner_only*)."""
    if isinstance(bracket, EspejoParallelBracket):
        wb = bracket.winners_bracket
        lb = bracket.losers_bracket
        if match_id in wb._match_map:
            out = _downstream_ids(wb, match_id, winner_only=winner_only)
            m = wb._match_map[match_id]
            if not winner_only and m.round_number == 1 and lb is not None and not getattr(bracket, "is_split", False):
                out += [x.id for x in lb.matches]
            return out
        if lb is not None and match_id in lb._match_map:
            return _downstream_ids(lb, match_id, winner_only=winner_only)
        return []
    if isinstance(bracket, DoubleEliminationBracket):
        return [to for to, _slot, is_loser in bracket._advancement.get(match_id, []) if not (winner_only and is_loser)]
    if isinstance(bracket, SingleEliminationBracket):
        out: list[str] = []
        if match_id in bracket._next_match:
            out.append(bracket._next_match[match_id][0])
        loser_next = getattr(bracket, "_loser_next", None) or {}
        if not winner_only and match_id in loser_next:
            out.append(loser_next[match_id][0])
        return out
    return []


def _next_round_label(bracket: object, match_id: str) -> str | None:
    """Round label the winner of *match_id* advances to, or ``None`` when it decides a place."""
    for nid in _downstream_ids(bracket, match_id, winner_only=True):
        nm = _match_by_id(bracket, nid)
        if nm is not None:
            return nm.round_label
    return None


def _entry_matches(bracket: object, key: str) -> list[Match]:
    return [
        m
        for m in bracket_matches(bracket)
        if (m.team1 and bracket_entry_key(m.team1) == key) or (m.team2 and bracket_entry_key(m.team2) == key)
    ]


def _pending_espejo_lb_seed(bracket: object, key: str) -> bool:
    """True while an Espejo R1 loser waits for the consolation bracket to be seeded."""
    if not isinstance(bracket, EspejoParallelBracket) or getattr(bracket, "is_split", False):
        return False
    if bracket.losers_bracket is not None:
        return False
    r1 = [m for m in bracket.winners_bracket.matches if m.round_number == 1]
    if not r1 or all(m.status == MatchStatus.COMPLETED for m in r1):
        return False
    return any(
        m.status == MatchStatus.COMPLETED and m.loser_team and bracket_entry_key(m.loser_team) == key for m in r1
    )


def _feeds_third_place(bracket: object, match_id: str) -> bool:
    subs: list[object] = [bracket]
    if isinstance(bracket, EspejoParallelBracket):
        subs = [bracket.winners_bracket] + ([bracket.losers_bracket] if bracket.losers_bracket is not None else [])
    for sub in subs:
        if match_id in (getattr(sub, "_loser_next", None) or {}):
            return True
    return False


def _drops_to_losers(bracket: object, m: Match) -> bool:
    if isinstance(bracket, DoubleEliminationBracket):
        return any(x.id == m.id for x in bracket.winners_matches) and any(
            is_loser for _to, _slot, is_loser in bracket._advancement.get(m.id, [])
        )
    if isinstance(bracket, EspejoParallelBracket) and not getattr(bracket, "is_split", False):
        return bracket.losers_bracket is None and m.id in bracket.winners_bracket._match_map and m.round_number == 1
    return False


def plan_bracket_forfeit(bracket: object, team: list[Player], records: dict[str, WithdrawalRecord]) -> WithdrawalPlan:
    """Plan a P forfeit of *team* (dry run)."""
    key = bracket_entry_key(team)
    if key in records:
        raise WithdrawalBlocked("This entry has already withdrawn")
    matches = _entry_matches(bracket, key)
    current = next((m for m in matches if m.status != MatchStatus.COMPLETED), None)
    if current is None and not _pending_espejo_lb_seed(bracket, key):
        raise WithdrawalBlocked("This entry is already eliminated or has finished its bracket")
    pending = current if current is not None and current.team1 and current.team2 else None
    plan = WithdrawalPlan(
        entry_key=key,
        entry=list(team),
        kind=WithdrawalKind.FORFEIT,
        played=sum(1 for m in matches if _is_played(m)),
        total=len(matches),
        pending_forfeit_match=pending,
        advance_to=_next_round_label(bracket, pending.id) if pending is not None else None,
        tbd=pending is None,
        lb_drop=current is not None and _drops_to_losers(bracket, current),
        third_place_note=current is not None and _feeds_third_place(bracket, current.id),
        blockers=_blockers(matches),
        undo_possible=False,
    )
    plan.future_walkovers = plan.tbd or plan.lb_drop or plan.third_place_note
    return plan


def resolve_bracket_forfeits(
    bracket: object,
    records: dict[str, WithdrawalRecord],
    *,
    by: str | None = None,
    at: float | None = None,
) -> list[Match]:
    """Turn every pending match with a withdrawn side into a walkover.

    Uses the bracket's own ``record_result`` so advancement (next round, 3rd
    place, double-elimination loser edges and byes, Espejo LB seeding,
    multi-winner slots) works exactly as for a played match.  Restarts after
    each walkover because recording can make new matches pending.  When both
    sides withdrew, the better seed takes the walkover (and forfeits next).

    Returns:
        The matches turned into walkovers, in creation order.
    """
    forfeits = {k: r for k, r in records.items() if r.kind == WithdrawalKind.FORFEIT}
    created: list[Match] = []
    if not forfeits or bracket is None:
        return created
    at = time.time() if at is None else at
    while True:
        target: tuple[Match, str, bool, bool] | None = None
        for m in bracket.pending_matches():  # type: ignore[attr-defined]
            k1, k2 = bracket_entry_key(m.team1), bracket_entry_key(m.team2)
            w1, w2 = k1 in forfeits, k2 in forfeits
            if not (w1 or w2):
                continue
            both = w1 and w2
            if both:
                withdrawn_is_team1 = _seed_index(bracket, k1) > _seed_index(bracket, k2)
            else:
                withdrawn_is_team1 = w1
            target = (m, k1 if withdrawn_is_team1 else k2, withdrawn_is_team1, both)
            break
        if target is None:
            return created
        m, key, withdrawn_is_team1, both = target
        record = forfeits[key]
        template = record.template or WalkoverTemplate()
        result = template.result_for(m, withdrawn_is_team1)
        bracket.record_result(m.id, result.score, sets=result.sets)  # type: ignore[attr-defined]
        stamp_walkover(m, result, entry_key=key, by=by or "system", at=at, both_withdrawn=both)
        record.walkover_match_ids.append(m.id)
        created.append(m)


def apply_bracket_forfeit(
    bracket: object,
    team: list[Player],
    records: dict[str, WithdrawalRecord],
    template: WalkoverTemplate | None,
    *,
    member_ids: list[str],
    by: str | None = None,
    at: float | None = None,
) -> tuple[WithdrawalRecord, list[Match]]:
    """Apply a P forfeit: store the record in *records* and resolve walkovers now."""
    at = time.time() if at is None else at
    plan = plan_bracket_forfeit(bracket, team, records)
    if plan.blockers:
        raise WithdrawalBlocked("Settle the pending, disputed or under-review scores first")
    record = WithdrawalRecord(
        entry_key=plan.entry_key,
        entry=list(team),
        kind=WithdrawalKind.FORFEIT,
        member_ids=list(member_ids),
        played=plan.played,
        total=plan.total,
        template=template or WalkoverTemplate(),
        by=by,
        at=at,
    )
    records[plan.entry_key] = record
    created = resolve_bracket_forfeits(bracket, records, by=by, at=at)
    return record, created


def unwind_downstream_walkovers(bracket: object, match_id: str) -> list[str]:
    """Clear the walkovers that depend on *match_id*'s result, deepest first.

    Follows the bracket's advancement edges (through auto-resolved byes) and
    clears every walkover reached through a chain of walkovers.  A really
    played downstream match is left alone, so the caller's own clear still
    raises ``MatchClearBlocked`` for it.  Callers take a
    :func:`snapshot_bracket` first so a failure can be rolled back.

    Returns:
        The ids of the cleared walkovers, in clearing order.
    """
    order: list[str] = []
    seen: set[str] = set()

    def visit(mid: str) -> None:
        for nid in _downstream_ids(bracket, mid):
            if nid in seen:
                continue
            seen.add(nid)
            nm = _match_by_id(bracket, nid)
            if nm is None:
                continue
            if getattr(nm, "walkover", False):
                visit(nid)
                order.append(nid)
            elif nm.status == MatchStatus.COMPLETED and nm.score is None:
                visit(nid)  # auto-resolved bye: look through it

    visit(match_id)
    for wid in order:
        bracket.clear_result(wid)  # type: ignore[attr-defined]
        wm = _match_by_id(bracket, wid)
        if wm is not None:
            wm.walkover = False
    return order


def winner_changes(m: Match, new_score: tuple[int, int]) -> bool:
    """True when re-recording *m* with *new_score* would change its winner."""
    if m.status != MatchStatus.COMPLETED or m.score is None:
        return False
    old = (m.score[0] > m.score[1]) - (m.score[0] < m.score[1])
    new = (new_score[0] > new_score[1]) - (new_score[0] < new_score[1])
    return old != new


def snapshot_bracket(bracket: object) -> object:
    """Deep copy of *bracket* for rollback; ``Player`` objects are shared, not copied."""
    memo: dict[int, object] = {}
    for m in bracket_matches(bracket):
        for p in m.team1 + m.team2:
            memo[id(p)] = p
    for team in bracket_teams(bracket):
        for p in team:
            memo[id(p)] = p
    return copy.deepcopy(bracket, memo)


def forget_walkovers(records: dict[str, WithdrawalRecord], match_ids: list[str]) -> None:
    """Drop cleared walkover ids from every record's ``walkover_match_ids``."""
    gone = set(match_ids)
    if not gone:
        return
    for r in records.values():
        r.walkover_match_ids = [mid for mid in r.walkover_match_ids if mid not in gone]


def has_forfeits(records: dict[str, WithdrawalRecord] | None) -> bool:
    """True when any stored record is a bracket forfeit."""
    return any(r.kind == WithdrawalKind.FORFEIT for r in (records or {}).values())
