"""Community ELO summary: rating changes made inside a community's clubs.

For one community this adds up, per club and per player, the rating points
gained and lost on each club's own rating chain (``club_elo_before`` ->
``club_elo_after`` on ``player_elo_log``).  Only played matches count:

* Manual rows (``is_manual = 1``: manual club rating, tier base ELO, bulk
  tiers, adjustments) are excluded.  The first match after a seed is already
  measured from the seed, because ``club_elo_before`` holds it.
* Rows are grouped by the club's community (``clubs.community_id``), not by
  ``tournaments.community_id``.
* Legacy rows without club ratings are not counted; they are reported as
  ``unrated_matches`` so the organizer can recalculate the club.
* Sports are never mixed.  Sports hidden for a player in a club
  (``profile_club_elo.hidden``) drop out of the player list and the club total.

The module reads only; it takes no club lock and writes nothing.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timezone

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .db import get_db
from .rating_scope import RatingScope, resolve_scope, scope_stats

SPORTS = ("padel", "tennis")
NOTE = "match_deltas_only"


class EloChangeTotals(BaseModel):
    """Points gained and lost over a set of rated matches."""

    net: float = 0.0
    gained: float = 0.0
    lost: float = 0.0
    matches: int = 0
    players: int = 0


class ClubPlayerChange(BaseModel):
    """One linked player's change in one club and sport."""

    profile_id: str
    name: str
    sport: str
    net: float
    gained: float
    lost: float
    matches: int
    elo_now: float | None = None


class ClubEloSummary(BaseModel):
    """One club's change in one sport."""

    club_id: str
    club_name: str
    sport: str
    totals: EloChangeTotals
    unlinked: EloChangeTotals
    unrated_matches: int = 0
    players: list[ClubPlayerChange] = Field(default_factory=list)


class CrossClubPlayer(BaseModel):
    """A player with rated matches in two or more clubs of the community."""

    profile_id: str
    name: str
    sport: str
    net: float
    gained: float
    lost: float
    matches: int
    clubs: int


class CommunityEloSummaryOut(BaseModel):
    """Response of ``GET /api/communities/{id}/elo-summary``."""

    community_id: str
    sport: str
    from_ts: str | None = None
    to_ts: str | None = None
    totals: dict[str, EloChangeTotals] = Field(default_factory=dict)
    clubs: list[ClubEloSummary] = Field(default_factory=list)
    clubs_hidden: int = 0
    cross_club_players: list[CrossClubPlayer] = Field(default_factory=list)
    note: str = NOTE


def _r(value: float) -> float:
    return round(value, 2) + 0.0


def _check_ts(value: str | None, label: str) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"Invalid '{label}' date") from None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    # Stored timestamps are ISO strings, compared as text: always send the canonical form.
    return parsed.isoformat()


class _Acc:
    """Running gained / lost / matches / identities."""

    __slots__ = ("gained", "lost", "matches", "ids")

    def __init__(self) -> None:
        self.gained = 0.0
        self.lost = 0.0
        self.matches = 0
        self.ids: set[str] = set()

    def totals(self) -> EloChangeTotals:
        return EloChangeTotals(
            net=_r(self.gained + self.lost),
            gained=_r(self.gained),
            lost=_r(self.lost),
            matches=self.matches,
            players=len(self.ids),
        )


def build_summary(
    community_id: str,
    *,
    sport: str,
    date_from: str | None,
    date_to: str | None,
    club_id: str | None,
    season_id: str | None,
    can_see_club: Callable[[dict], bool],
) -> CommunityEloSummaryOut:
    """Compute the summary; *can_see_club* decides which clubs the caller may see.

    Raises 404 for an unknown community, club or season (also for a club the
    caller may not see, or a season of a club outside the community).
    """
    date_from = _check_ts(date_from, "from")
    date_to = _check_ts(date_to, "to")
    with get_db() as conn:
        if conn.execute("SELECT 1 FROM communities WHERE id = ?", (community_id,)).fetchone() is None:
            raise HTTPException(404, "Community not found")
        club_rows = [
            dict(r) for r in conn.execute("SELECT * FROM clubs WHERE community_id = ? ORDER BY name", (community_id,))
        ]
        visible = {c["id"]: c for c in club_rows if can_see_club(c)}
        hidden_count = len(club_rows) - len(visible)

        # Season fixes the club (404 on a mismatch) and wins over the date range.
        scope: RatingScope = resolve_scope(club_id=club_id, season_id=season_id)
        if scope.club_id is not None and scope.club_id not in visible:
            raise HTTPException(404, "Club not found")
        if scope.season_id:
            date_from = date_to = None
        sports = SPORTS if sport == "all" else (sport,)
        out = CommunityEloSummaryOut(
            community_id=community_id,
            sport=sport,
            from_ts=date_from,
            to_ts=date_to,
            clubs_hidden=hidden_count,
        )
        club_ids = [scope.club_id] if scope.club_id else list(visible)
        if not club_ids:
            return out

        where = [
            "l.is_manual = 0",
            f"t.club_id IN ({','.join('?' for _ in club_ids)})",
            f"l.sport IN ({','.join('?' for _ in sports)})",
        ]
        params: list = [*club_ids, *sports]
        if scope.season_id:
            where.append("t.season_id = ?")
            params.append(scope.season_id)
        if date_from:
            where.append("l.updated_at >= ?")
            params.append(date_from)
        if date_to:
            where.append("l.updated_at < ?")
            params.append(date_to)
        identity = "COALESCE(l.club_identity, l.tournament_id || ':' || l.player_id)"
        base = f"""
              FROM player_elo_log l
              JOIN tournaments t ON t.id = l.tournament_id
              JOIN clubs c ON c.id = t.club_id AND c.community_id = ?
             WHERE {" AND ".join(where)}
               AND NOT EXISTS (SELECT 1 FROM profile_club_elo h WHERE h.profile_id = l.club_identity
                               AND h.club_id = t.club_id AND h.sport = l.sport AND h.hidden = 1)
        """
        base_params = [community_id, *params]
        rated = "l.club_elo_after IS NOT NULL AND l.club_elo_before IS NOT NULL"
        delta = "(l.club_elo_after - l.club_elo_before)"
        match_key = "l.tournament_id || ':' || l.match_id"

        # Per club / sport / identity: gained, lost, distinct matches.
        by_identity = conn.execute(
            f"""SELECT t.club_id AS club_id, l.sport AS sport, {identity} AS ident,
                       SUM(CASE WHEN {delta} > 0 THEN {delta} ELSE 0 END) AS gained,
                       SUM(CASE WHEN {delta} < 0 THEN {delta} ELSE 0 END) AS lost,
                       COUNT(DISTINCT {match_key}) AS matches
                {base} AND {rated}
             GROUP BY t.club_id, l.sport, ident""",
            base_params,
        ).fetchall()
        # Per club / sport: distinct matches (one match has several players) and unrated ones.
        by_club = conn.execute(
            f"""SELECT t.club_id AS club_id, l.sport AS sport,
                       COUNT(DISTINCT CASE WHEN {rated} THEN {match_key} END) AS matches,
                       COUNT(DISTINCT CASE WHEN NOT ({rated}) AND NOT EXISTS (
                           SELECT 1 FROM player_elo_log x
                            WHERE x.tournament_id = l.tournament_id AND x.match_id = l.match_id
                              AND x.sport = l.sport AND x.is_manual = 0
                              AND x.club_elo_after IS NOT NULL AND x.club_elo_before IS NOT NULL)
                       THEN {match_key} END) AS unrated
                {base}
             GROUP BY t.club_id, l.sport""",
            base_params,
        ).fetchall()

        names: dict[str, str] = {}
        linked_ids = sorted({r["ident"] for r in by_identity if ":" not in r["ident"]})
        for i in range(0, len(linked_ids), 500):
            chunk = linked_ids[i : i + 500]
            for row in conn.execute(
                f"SELECT id, name FROM player_profiles WHERE id IN ({','.join('?' for _ in chunk)})", chunk
            ):
                names[row["id"]] = row["name"]

        elo_now: dict[str, dict[tuple[str, str], float | None]] = {}
        for cid in {r["club_id"] for r in by_identity}:
            idents = sorted({r["ident"] for r in by_identity if r["club_id"] == cid and ":" not in r["ident"]})
            stats = scope_stats(conn, RatingScope(club_id=cid), profile_ids=idents) if idents else {}
            elo_now[cid] = {k: v.elo for k, v in stats.items()}

    club_matches = {(r["club_id"], r["sport"]): (r["matches"], r["unrated"]) for r in by_club}
    rows_by_club: dict[tuple[str, str], list] = defaultdict(list)
    for r in by_identity:
        rows_by_club[(r["club_id"], r["sport"])].append(r)

    community_acc: dict[str, _Acc] = {s: _Acc() for s in sports}
    cross: dict[tuple[str, str], list[tuple[float, float, int]]] = defaultdict(list)
    for (cid, sp), (matches, unrated) in sorted(
        club_matches.items(), key=lambda kv: (visible[kv[0][0]]["name"].lower(), kv[0][1])
    ):
        club_acc, unl_acc = _Acc(), _Acc()
        players: list[ClubPlayerChange] = []
        for r in rows_by_club.get((cid, sp), []):
            ident, gained, lost = r["ident"], float(r["gained"] or 0), float(r["lost"] or 0)
            club_acc.gained += gained
            club_acc.lost += lost
            club_acc.ids.add(ident)
            if ":" in ident:
                unl_acc.gained += gained
                unl_acc.lost += lost
                unl_acc.matches += r["matches"]
                unl_acc.ids.add(ident)
                continue
            cross[(ident, sp)].append((gained, lost, r["matches"]))
            players.append(
                ClubPlayerChange(
                    profile_id=ident,
                    name=names.get(ident, ""),
                    sport=sp,
                    net=_r(gained + lost),
                    gained=_r(gained),
                    lost=_r(lost),
                    matches=r["matches"],
                    elo_now=elo_now.get(cid, {}).get((ident, sp)),
                )
            )
        club_acc.matches = matches
        if not club_acc.ids and not unrated:
            continue
        players.sort(key=lambda p: (-p.net, p.name.lower()))
        out.clubs.append(
            ClubEloSummary(
                club_id=cid,
                club_name=visible[cid]["name"],
                sport=sp,
                totals=club_acc.totals(),
                unlinked=unl_acc.totals(),
                unrated_matches=unrated,
                players=players,
            )
        )
        acc = community_acc[sp]
        acc.gained += club_acc.gained
        acc.lost += club_acc.lost
        acc.matches += matches
        acc.ids |= club_acc.ids
    out.totals = {s: a.totals() for s, a in community_acc.items()}

    for (pid, sp), parts in cross.items():
        if len(parts) < 2:
            continue
        gained = sum(p[0] for p in parts)
        lost = sum(p[1] for p in parts)
        out.cross_club_players.append(
            CrossClubPlayer(
                profile_id=pid,
                name=names.get(pid, ""),
                sport=sp,
                net=_r(gained + lost),
                gained=_r(gained),
                lost=_r(lost),
                matches=sum(p[2] for p in parts),
                clubs=len(parts),
            )
        )
    out.cross_club_players.sort(key=lambda p: (-p.net, p.name.lower()))
    return out
