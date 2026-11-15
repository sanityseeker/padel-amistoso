"""Live court queue: keep every court busy as matches finish.

The up-front plan (``assign_courts``) is only a starting point: matches never
take exactly the same time, so after every change (a result, a cleared
result, a withdrawal, new matches, a court edit) :func:`refill_courts`
re-plans what is not on court yet:

1. Matches flagged ``on_court`` stay where they are (people are playing them).
2. Every free court takes the best waiting match whose players are all free.
3. The rest of the queue is ordered into later slots the same way (that
   order is "up next"), but gets no court: a court shown to anyone always
   means "now playing there".

"Best" means, in this order:

* the group with the most time left (matches left divided by how many it can
  play at once), so a larger group gets more courts and the groups finish
  together; the figure is updated after every pick, so groups alternate;
* within a group, an earlier round (a later round only fills a court that no
  earlier-round match can use);
* the match whose players rested longest;
* the original plan order.

Group weight goes before round order: with courts short, a simulation of
uneven match lengths showed the group stage ends earlier and the groups
finish closer together that way.  With enough courts for every group to play
at full speed the weight changes nothing (a smaller group just has less to
play).

Rest is measured in slots: each fill gets a higher slot number than anything
already played or on court, so a player's latest slot says how recently they
started a match.  When there are more players than the courts can hold, this
spreads the waiting evenly.  Each match takes the free court its players
played on least.

With ``ordered_rounds`` (team-mode Group+Playoff) the round order is a hard
rule instead of a tie-break: a match goes on court, or into a queue slot, only
when every lower-round match of either of its teams is played, on court or in
an earlier slot.  Group balancing and the rest of the ranking pick among the
eligible matches; ``lag`` only breaks ties.  This cannot deadlock: the lowest
open round of a group is always eligible.  Old plans are re-planned on the next
refill; matches already on court stay.

A score waiting for confirmation frees the court: the match was played.

A waiting match is flagged ``waiting_for_players`` when one of its players is
still on court, so a free court next to it is not shown as "waiting for a court".
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping

from ..models import Court, Match, MatchStatus
from .court_preferences import CourtPlan


def court_done(m: Match) -> bool:
    """Whether *m* no longer needs a court (finished, or its score awaits confirmation)."""
    return m.status == MatchStatus.COMPLETED or (m.status == MatchStatus.IN_PROGRESS and m.score is not None)


def _ready(m: Match) -> bool:
    return bool(m.team1 and m.team2) and not court_done(m)


def _ids(m: Match) -> set[str]:
    return {p.id for p in m.team1 + m.team2}


def is_on_court(m: Match) -> bool:
    """Whether *m* is being played now (its court is held for it)."""
    return bool(m.on_court) and m.court is not None and _ready(m)


def remap_courts(matches: Iterable[Match], courts: list[Court]) -> None:
    """Point matches at the new ``Court`` objects with the same name (court edits replace the objects)."""
    by_name = {c.name: c for c in courts}
    for m in matches:
        if m.court is not None and m.court.name in by_name:
            m.court = by_name[m.court.name]


def nothing_played(matches: Iterable[Match]) -> bool:
    """True before any real result: a court edit may then re-plan from scratch."""
    return not any(court_done(m) and not m.walkover for m in matches)


def clear_plan(matches: Iterable[Match]) -> None:
    """Drop the court of every match that still needs one, so the next plan starts fresh."""
    for m in matches:
        if not court_done(m):
            m.court = None
            m.on_court = False


def refill_courts(
    matches: Iterable[Match],
    courts: list[Court],
    plan: CourtPlan | None = None,
    *,
    scope_of: Callable[[Match], str | None] | None = None,
    capacity: Mapping[str, int] | None = None,
    round_order: bool = False,
    ordered_rounds: bool = False,
) -> None:
    """Fill free courts with waiting matches and re-plan the queue (see the module docstring).

    *matches* is the whole stage, finished matches included (they give each
    player's last slot and courts played).  *scope_of* maps a match to its
    group and *capacity* says how many matches a group can play at once; the
    group with the most time left (matches left / capacity) goes first.
    With *round_order* a group's earlier rounds go before its later ones.
    With *ordered_rounds* a match is eligible only when every lower-round
    match (round number above 0) of one of its teams is already played, on
    court or placed in an earlier slot.
    Waiting matches get a slot (their place in the queue) and no court.
    """
    matches = list(matches)
    if not courts:
        _flag_waiting(matches)
        return
    index = {c.id: i for i, c in enumerate(courts)}
    ready = [m for m in matches if _ready(m)]
    # 1. What is on court now.  Older data has no flags: then the first
    #    match planned on each court counts as being played.
    flagged = any(m.on_court for m in matches)
    for m in matches:
        if court_done(m):
            # Played: it keeps its court (where it was played) but frees it.
            m.on_court = False
        elif not _ready(m):
            # A side is not known (any more): it holds no court.
            m.court = None
            m.on_court = False

    def on_court_key(m: Match) -> tuple[int, int]:
        return (m.slot_number, index[m.court.id])

    candidates = [m for m in ready if m.court is not None and m.court.id in index and (m.on_court or not flagged)]
    seen: set[str] = set()
    busy: set[str] = set()
    locked: list[Match] = []
    for m in sorted(candidates, key=on_court_key):
        if m.court.id in seen:
            continue
        seen.add(m.court.id)
        if _ids(m) & busy:
            continue
        busy |= _ids(m)
        m.on_court = True
        locked.append(m)
    locked_ids = {id(m) for m in locked}
    taken = {m.court.id for m in locked}

    # 2. Each player's latest slot and courts played (walkovers were not played).
    last: dict[str, int] = {}
    uses: defaultdict[tuple[str, str], int] = defaultdict(int)
    for m in matches:
        if id(m) in locked_ids or (court_done(m) and not m.walkover and m.court is not None):
            for pid in _ids(m):
                last[pid] = max(last.get(pid, -1), m.slot_number)
                uses[(pid, m.court.id)] += 1
    slot = max((m.slot_number for m in matches if id(m) in locked_ids or court_done(m)), default=-1) + 1

    # 3. The queue, in its previous plan order (new matches last).
    queue = [m for m in ready if id(m) not in locked_ids]
    ordered = sorted(
        queue,
        key=lambda m: (m.court is None, m.slot_number, index.get(m.court.id, 0) if m.court is not None else 0),
    )
    pos = {id(m): i for i, m in enumerate(ordered)}
    for m in queue:
        m.court = None
        m.on_court = False

    scope = {id(m): (scope_of(m) if scope_of else None) for m in queue}
    left: defaultdict[str | None, int] = defaultdict(int)
    for m in queue:
        left[scope[id(m)]] += 1

    def load(sc: str | None) -> float:
        if sc is None or capacity is None:
            return 0.0
        return left[sc] / max(1, min(capacity.get(sc, 1), len(courts)))

    def rank(m: Match, first_round: dict[str | None, int]) -> tuple[float, int, int, int, int]:
        sc = scope[id(m)]
        lag = m.round_number - first_round[sc] if round_order else 0
        lasts = [last.get(pid, -1) for pid in _ids(m)]
        return (-load(sc), lag, max(lasts), sum(lasts), pos[id(m)])

    def place(chosen: list[Match], free: list[Court]) -> dict[int, Court]:
        if plan is not None and plan.active:
            return plan.pick(chosen, free, rotate=slot)
        # Each match takes the free court its players played on least.
        avail = list(free)
        out: dict[int, Court] = {}
        for m in chosen:
            c = min(avail, key=lambda c: sum(uses[(pid, c.id)] for pid in _ids(m)))
            avail.remove(c)
            out[id(m)] = c
        return out

    remaining = queue
    now = True
    while remaining:
        # Rotate the court order by slot so play spreads over all courts.
        k = slot % len(courts)
        rotated = courts[k:] + courts[:k]
        if now:
            free = [c for c in rotated if c.id not in taken]
            blocked = set(busy)
        else:
            # Queue order only: assume every court is free for this slot.
            free = rotated
            blocked = set()
        chosen: list[Match] = []
        # Preferred courts: on the courts free now, a match that fits its own
        # (or an unclaimed) court goes before one that would borrow another's.
        prefs = now and plan is not None and plan.active
        if prefs:
            free_ids = {c.id for c in free}
            own_free = {sc: sum(1 for c in cs if c.id in free_ids) for sc, cs in plan.by_scope.items()}
            spare_free = sum(1 for c in free if c.id not in plan.claimed_ids)
            own_used: defaultdict[str, int] = defaultdict(int)
            spare_used = 0

        def borrows(m: Match) -> int:
            if not prefs:
                return 0
            sc = plan.scope_of(m) if plan.preferred(m) else None
            if sc is not None and own_used[sc] < own_free.get(sc, 0):
                return 0
            return 0 if spare_used < spare_free else 1

        while len(chosen) < len(free):
            first_round: dict[str | None, int] = {}
            for m in remaining:
                sc = scope[id(m)]
                first_round[sc] = min(first_round.get(sc, m.round_number), m.round_number)
            placed = {id(x) for x in chosen}

            def prereqs_done(m: Match) -> bool:
                # No lower-round match of a team of *m* may still wait (or be picked just now).
                if not ordered_rounds or m.round_number <= 0:
                    return True
                return not any(
                    o is not m
                    and id(o) not in placed
                    and 0 < o.round_number < m.round_number
                    and scope[id(o)] == scope[id(m)]
                    and _ids(o) & _ids(m)
                    for o in remaining
                )

            fits = [m for m in remaining if id(m) not in placed and not _ids(m) & blocked and prereqs_done(m)]
            if not fits:
                break
            best = min(fits, key=lambda m: (borrows(m), rank(m, first_round)))
            if prefs:
                sc = plan.scope_of(best) if plan.preferred(best) else None
                if sc is not None and own_used[sc] < own_free.get(sc, 0):
                    own_used[sc] += 1
                elif spare_used < spare_free:
                    spare_used += 1
            chosen.append(best)
            blocked |= _ids(best)
            left[scope[id(best)]] -= 1
        if chosen:
            picked = place(chosen, free) if now else {}
            for m in chosen:
                m.court = picked.get(id(m))
                m.slot_number = slot
                m.on_court = now
                for pid in _ids(m):
                    last[pid] = slot
            done = {id(m) for m in chosen}
            remaining = [m for m in remaining if id(m) not in done]
            slot += 1
        now = False
    _flag_waiting(matches)


def _flag_waiting(matches: list[Match]) -> None:
    """Mark the waiting matches held back by a player who is still on court."""
    playing: set[str] = set()
    for m in matches:
        if is_on_court(m):
            playing |= _ids(m)
    for m in matches:
        m.waiting_for_players = _ready(m) and not is_on_court(m) and bool(_ids(m) & playing)
