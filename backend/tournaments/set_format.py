"""Shared set-score arithmetic that honours the third-set decider.

A match can end with a full third set (``SetDecider.FULL_SET``, the default) or
with a match tie-break (``SetDecider.MATCH_TIEBREAK``: a super tie-break, first
to 10 points, win by 2, entered in the third-set boxes as e.g. ``10-8``).

Only the *games* arithmetic differs between the two: a match tie-break counts
as **one game** for its winner (``1-0``) wherever games are summed (standings
points for/against, ELO margin, Player Hub game differences, score totals),
instead of the 18 games a literal ``10-8`` would add.  Sets won/lost and
head-to-head logic are unaffected because the set winner is the same.

Every place that sums games across sets must go through :func:`games_from_sets`
so standings, ELO and the Hub agree.
"""

from __future__ import annotations

from collections.abc import Sequence

from ..models import SetDecider

# A match tie-break is played to 10 points, win by 2 (ITF rules of tennis,
# appendix V).  Longer deciders (e.g. 12-10) are valid.
MATCH_TIEBREAK_MIN_POINTS = 10
MATCH_TIEBREAK_MIN_MARGIN = 2

SetPair = Sequence[int]


def match_decider(match: object) -> SetDecider:
    """Return the decider a *scored* match was recorded under.

    ``Match.decider`` is stamped by the API when a set score is recorded;
    legacy records (no stamp) were counted as full sets, so that is the
    fallback.  Pending matches never reach the games arithmetic.
    """
    decider = getattr(match, "decider", None)
    if isinstance(decider, SetDecider):
        return decider
    if isinstance(decider, str):
        try:
            return SetDecider(decider)
        except ValueError:
            return SetDecider.FULL_SET
    return SetDecider.FULL_SET


def is_match_tiebreak_set(sets: Sequence[SetPair], index: int, decider: SetDecider | str | None) -> bool:
    """Return True when set *index* of *sets* is a match tie-break under *decider*.

    Only the third set of a three-set result can be a match tie-break; two-set
    results and best-of-five results never contain one.
    """
    return decider == SetDecider.MATCH_TIEBREAK and len(sets) == 3 and index == 2


def games_from_sets(sets: Sequence[SetPair], decider: SetDecider | str | None = None) -> tuple[int, int]:
    """Sum games across *sets*, counting a match tie-break as a single game.

    Args:
        sets: ``(games_a, games_b)`` per set, as stored on ``Match.sets``.
        decider: How the deciding set was played.  ``None`` means full set.

    Returns:
        ``(games_a, games_b)``.  For ``[(6, 4), (3, 6), (10, 8)]`` with a
        match tie-break decider this is ``(10, 10)``: 6+3+1 and 4+6+0.
    """
    games_a = 0
    games_b = 0
    for i, s in enumerate(sets):
        a, b = int(s[0]), int(s[1])
        if is_match_tiebreak_set(sets, i, decider):
            if a > b:
                games_a += 1
            elif b > a:
                games_b += 1
            continue
        games_a += a
        games_b += b
    return games_a, games_b


def totals_from_sets(
    sets: Sequence[SetPair],
    decider: SetDecider | str | None = None,
) -> tuple[int, int, bool]:
    """Total the games of a set score so the set winner always has the higher total.

    Games are summed with :func:`games_from_sets` (a match tie-break counts as
    one game).  When the totals do not favour the team that won more sets
    (equal totals, or the set winner has fewer games), the set winner's total
    is raised to one more than the other's, so ``Match.winner_team`` (which
    compares the two totals) always names the set winner.

    Returns:
        ``(games_a, games_b, decided_by_third_set)``; the flag is True whenever
        exactly three sets were played.
    """
    total1, total2 = games_from_sets(sets, decider)
    sets1_won = sum(1 for s in sets if s[0] > s[1])
    sets2_won = sum(1 for s in sets if s[1] > s[0])
    if sets1_won > sets2_won and total1 <= total2:
        total1 = total2 + 1
    elif sets2_won > sets1_won and total2 <= total1:
        total2 = total1 + 1
    return total1, total2, len(sets) == 3


def validate_decider_sets(sets: Sequence[SetPair], decider: SetDecider | str | None) -> None:
    """Raise ``ValueError`` when the third set does not fit the decider.

    Rule (documented here, enforced on every record path): with a match
    tie-break decider and exactly three sets, the third set must be a
    tie-break result — the winner has at least ``MATCH_TIEBREAK_MIN_POINTS``
    (10) points and leads by at least ``MATCH_TIEBREAK_MIN_MARGIN`` (2).
    A full-set decider adds no rule beyond the generic set validation, so a
    legacy ``10-8`` full set stays accepted.  Two-set results are never
    checked: the decider is only meaningful when a third set was played.
    """
    if decider != SetDecider.MATCH_TIEBREAK or len(sets) != 3:
        return
    a, b = int(sets[2][0]), int(sets[2][1])
    hi, lo = max(a, b), min(a, b)
    if hi < MATCH_TIEBREAK_MIN_POINTS or hi - lo < MATCH_TIEBREAK_MIN_MARGIN:
        raise ValueError(
            f"The match tie-break must be won with at least {MATCH_TIEBREAK_MIN_POINTS} points "
            f"and a {MATCH_TIEBREAK_MIN_MARGIN}-point lead, got {a}-{b}"
        )


def format_sets(
    sets: Sequence[SetPair],
    decider: SetDecider | str | None = None,
    sep: str = " ",
    swap: bool = False,
) -> str:
    """Render set scores as text, bracketing a match tie-break: ``6-4 3-6 [10-8]``.

    Args:
        sets: Set pairs as stored on the match.
        decider: Decider the score was recorded under.
        sep: Separator between sets.
        swap: Show the second team's games first (Player Hub "my side first").
    """
    parts: list[str] = []
    for i, s in enumerate(sets):
        a, b = (int(s[1]), int(s[0])) if swap else (int(s[0]), int(s[1]))
        text = f"{a}-{b}"
        parts.append(f"[{text}]" if is_match_tiebreak_set(sets, i, decider) else text)
    return sep.join(parts)
