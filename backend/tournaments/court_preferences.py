"""Preferred courts per group or per Espejo bracket.

An organiser can give a group ("A", "B", ...) or an Espejo bracket side
(``"winners"`` = main / Oro, ``"losers"`` = consolation / Plata) its own
courts.  The courts are *preferred*, not reserved: a match first takes a free
court from its own list, then a court that no scope claims, then any free
court.  So a scope with more simultaneous matches than courts borrows, and
no court stays empty while a match waits.

Preferences are stored as court *names* because ``update_courts`` replaces
the ``Court`` objects (new ids) every time the organiser edits the list.
"""

from __future__ import annotations

from collections.abc import Callable

from ..models import Court, Match

ESPEJO_SIDES: tuple[str, ...] = ("winners", "losers")


def clean_preferences(prefs: dict[str, list[str]] | None, courts: list[Court]) -> dict[str, list[str]]:
    """Keep only names of existing courts, drop empty scopes, keep order, no duplicates."""
    known = {c.name for c in courts}
    out: dict[str, list[str]] = {}
    for scope, names in (prefs or {}).items():
        seen: list[str] = []
        for n in names:
            n = n.strip()
            if n in known and n not in seen:
                seen.append(n)
        if seen:
            out[scope] = seen
    return out


class CourtPlan:
    """Resolve each match to its preferred courts and pick courts for a batch."""

    def __init__(
        self,
        courts: list[Court],
        prefs: dict[str, list[str]] | None,
        scope_of: Callable[[Match], str | None],
    ):
        self.courts = list(courts)
        by_name = {c.name: c for c in self.courts}
        self.by_scope: dict[str, list[Court]] = {
            scope: [by_name[n] for n in names if n in by_name] for scope, names in (prefs or {}).items()
        }
        self.by_scope = {k: v for k, v in self.by_scope.items() if v}
        self.claimed_ids = {c.id for cs in self.by_scope.values() for c in cs}
        self.scope_of = scope_of

    @property
    def active(self) -> bool:
        return bool(self.by_scope)

    def preferred(self, m: Match) -> list[Court]:
        scope = self.scope_of(m)
        return self.by_scope.get(scope, []) if scope is not None else []

    def pick(self, matches: list[Match], free: list[Court], rotate: int = 0) -> dict[int, Court]:
        """Choose a court for each match from *free* (a court is used once).

        Returns ``{id(match): court}``; matches left out found no free court.
        *rotate* shifts each scope's own list so successive slots spread
        matches over all of that scope's courts.
        """
        available = list(free)
        chosen: dict[int, Court] = {}

        def take(m: Match, candidates: list[Court]) -> bool:
            for c in candidates:
                if c in available:
                    available.remove(c)
                    chosen[id(m)] = c
                    return True
            return False

        # 1. Own courts.
        for m in matches:
            own = self.preferred(m)
            if own:
                k = rotate % len(own)
                take(m, own[k:] + own[:k])
        # 2. Unclaimed courts, then 3. anything still free.
        for m in matches:
            if id(m) in chosen:
                continue
            if not take(m, [c for c in available if c.id not in self.claimed_ids]):
                take(m, available)
        return chosen


def group_scope_of(groups: list) -> Callable[[Match], str | None]:
    """Map a match to the name of the group that holds it."""
    index = {m.id: g.name for g in groups for m in g.matches}
    return lambda m: index.get(m.id)


def espejo_scope_of(bracket: object) -> Callable[[Match], str | None]:
    """Map a match to its Espejo side (``"winners"``/``"losers"``); ``None`` otherwise."""
    wb = getattr(bracket, "winners_bracket", None)
    if wb is None:
        return lambda _m: None
    lb = getattr(bracket, "losers_bracket", None)
    wb_ids = {m.id for m in wb.matches}
    lb_ids = {m.id for m in lb.matches} if lb is not None else set()

    def _side(m: Match) -> str | None:
        if m.id in wb_ids:
            return "winners"
        if m.id in lb_ids:
            return "losers"
        return None

    return _side
