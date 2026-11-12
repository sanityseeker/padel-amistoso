"""One definition of "which matches count" for every rating view.

Leaderboards (club, community, global, season), the Player Hub header and ELO
history, the public club mini-card and the admin players list all show numbers
derived from ``player_elo_log``.  They used to carry their own copies of the
scope SQL and drifted apart (hidden sports leaked, manual club adjustments
showed up in global history, sports were mixed on the club card).  This module
holds the single scope definition:

* :class:`RatingScope` — which club / community / season / sport is selected.
* :func:`resolve_scope` — validates the query parameters into one scope.
* :func:`scoped_log_cte` — SQL that yields the scope's log rows per profile.
* :func:`scope_stats` — per ``(profile, sport)`` match count and latest rating.

Scope rules (the same for participants and for their match history):

* ``global`` — every rated match of every tournament.  Club-only manual
  adjustment rows (``tournament_id`` is a club id) are not part of it.
* ``community`` — matches of tournaments in that community, community chain.
* ``club`` — matches of that club's tournaments plus the club's manual rating
  adjustments, on the club's own rating chain.  Sports a club hides for a
  profile (``profile_club_elo.hidden``) are dropped.
* ``season`` — matches of that season's tournaments, club chain, hidden sports
  dropped.

A club wins over a community when both are given (clubs live inside
communities); a season wins over both.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException, Query
from pydantic import BaseModel, ConfigDict

from .db import get_db

ScopeKind = Literal["global", "community", "club", "season"]


class RatingScope(BaseModel):
    """The club / community / season / sport an ELO view is restricted to."""

    model_config = ConfigDict(frozen=True)

    club_id: str | None = None
    community_id: str | None = None
    season_id: str | None = None
    sport: str | None = None

    @property
    def kind(self) -> ScopeKind:
        """The narrowest scope that is set."""
        if self.season_id:
            return "season"
        if self.club_id:
            return "club"
        if self.community_id:
            return "community"
        return "global"

    @property
    def uses_club_chain(self) -> bool:
        """Club and season views show the club's own rating chain."""
        return self.kind in ("club", "season")

    def cache_key(self) -> tuple[str, str, str, str, str]:
        """Hashable key for per-scope caches."""
        return (
            self.kind,
            self.club_id or "",
            self.community_id or "",
            self.season_id or "",
            self.sport or "",
        )


class ScopeStats(BaseModel):
    """Match count and latest rating of one profile in one sport within a scope."""

    matches: int = 0
    elo: float | None = None


def resolve_scope(
    *,
    community_id: str | None = None,
    club_id: str | None = None,
    season_id: str | None = None,
    sport: str | None = None,
) -> RatingScope:
    """Build a :class:`RatingScope` from request parameters.

    Empty strings count as unset.  A season fixes the club (404 when it does not
    exist or belongs to a different club than the one given).  A club with a
    community keeps both; the club decides the filter, the community only
    names where the club lives.  ``sport`` of ``"all"`` means no sport filter.
    """
    community_id = community_id or None
    club_id = club_id or None
    season_id = season_id or None
    sport = None if sport in (None, "", "all") else sport
    if season_id:
        with get_db() as conn:
            row = conn.execute("SELECT club_id FROM seasons WHERE id = ?", (season_id,)).fetchone()
        if row is None or (club_id is not None and row["club_id"] != club_id):
            raise HTTPException(404, "Season not found")
        club_id = row["club_id"]
    return RatingScope(club_id=club_id, community_id=community_id, season_id=season_id, sport=sport)


def scope_query(
    community_id: str | None = Query(default=None, max_length=64),
    club_id: str | None = Query(default=None, max_length=64),
    season_id: str | None = Query(default=None, max_length=64),
    sport: str | None = Query(default=None, pattern=r"^(padel|tennis|all)$"),
) -> RatingScope:
    """FastAPI dependency: the scope selected by the query string."""
    return resolve_scope(community_id=community_id, club_id=club_id, season_id=season_id, sport=sport)


def scoped_log_cte(
    scope: RatingScope,
    *,
    profile_ids: list[str] | None = None,
    include_hidden: bool = False,
) -> tuple[str, list]:
    """SQL prefix defining ``scoped_log`` plus its parameters.

    Callers append their own ``SELECT ... FROM scoped_log``.  Columns:
    ``profile_id, tournament_id, player_id, sport, match_id, is_manual,
    elo_before, elo_after, elo_delta, match_order, updated_at, match_payload,
    adjustment_reason, adjusted_by, tournament_name, tournament_alias``.

    A log row belongs to a profile through ``player_secrets`` / ``player_history``
    on ``(tournament_id, player_id)``; manual club adjustments (whose
    ``tournament_id`` is the club id) through the profile's player ids.
    *profile_ids* restricts the profiles considered; *include_hidden* keeps
    sports hidden in the club (admin rosters need them).
    """
    params: list = []
    id_filter_ps = id_filter_ph = ""
    if profile_ids is not None:
        marks = ",".join("?" for _ in profile_ids) or "NULL"
        id_filter_ps = f" AND ps.profile_id IN ({marks})"
        id_filter_ph = f" AND ph.profile_id IN ({marks})"

    def _ids() -> list:
        return list(profile_ids) if profile_ids is not None else []

    linked_sql = f"""
        SELECT ps.profile_id AS profile_id, ps.tournament_id AS tournament_id, ps.player_id AS player_id
          FROM player_secrets ps
         WHERE ps.profile_id IS NOT NULL{id_filter_ps}
        UNION
        SELECT ph.profile_id AS profile_id, ph.entity_id AS tournament_id, ph.player_id AS player_id
          FROM player_history ph
         WHERE ph.entity_type = 'tournament'
           AND ph.profile_id IS NOT NULL{id_filter_ph}
    """
    params += _ids() + _ids()

    if scope.uses_club_chain:
        elo_cols = (
            "COALESCE(l.club_elo_before, l.elo_before) AS elo_before,"
            " COALESCE(l.club_elo_after, l.elo_after) AS elo_after,"
            " COALESCE(l.club_elo_after - l.club_elo_before, l.elo_delta) AS elo_delta"
        )
    else:
        elo_cols = "l.elo_before AS elo_before, l.elo_after AS elo_after, l.elo_delta AS elo_delta"

    select_cols = f"""
            l.tournament_id AS tournament_id, l.player_id AS player_id, l.sport AS sport,
            l.match_id AS match_id, l.is_manual AS is_manual, {elo_cols},
            l.match_order AS match_order, l.updated_at AS updated_at, l.match_payload AS match_payload,
            l.adjustment_reason AS adjustment_reason, l.adjusted_by AS adjusted_by,
            COALESCE(t.name, mc.name) AS tournament_name, t.alias AS tournament_alias"""

    where: list[str] = []
    where_params: list = []
    if scope.kind == "season":
        where.append("t.season_id = ?")
        where_params.append(scope.season_id)
    elif scope.kind == "club":
        where.append("t.club_id = ?")
        where_params.append(scope.club_id)
    elif scope.kind == "community":
        where.append("t.community_id = ?")
        where_params.append(scope.community_id)
    else:
        # Club-only manual adjustments belong to that club's scope alone.
        where.append("NOT (l.is_manual = 1 AND mc.id IS NOT NULL)")
    if scope.sport:
        where.append("l.sport = ?")
        where_params.append(scope.sport)
    hidden_sql = ""
    hidden_params: list = []
    if scope.uses_club_chain and not include_hidden:
        hidden_sql = (
            " AND NOT EXISTS (SELECT 1 FROM profile_club_elo h WHERE h.profile_id = {pid}"
            " AND h.club_id = ? AND h.sport = l.sport AND h.hidden = 1)"
        )
        hidden_params = [scope.club_id]

    tournament_rows = f"""
        SELECT lk.profile_id AS profile_id,{select_cols}
          FROM player_elo_log l
          JOIN linked lk ON lk.tournament_id = l.tournament_id AND lk.player_id = l.player_id
     LEFT JOIN tournaments t ON t.id = l.tournament_id
     LEFT JOIN clubs mc ON l.is_manual = 1 AND mc.id = l.tournament_id
         WHERE {" AND ".join(where)}{hidden_sql.format(pid="lk.profile_id")}
    """
    params += where_params + hidden_params

    if scope.kind == "club":
        # Manual rating adjustments of this club: linked by the profile's player ids.
        manual_where = ["l.is_manual = 1", "l.tournament_id = ?"]
        manual_params: list = [scope.club_id]
        if scope.sport:
            manual_where.append("l.sport = ?")
            manual_params.append(scope.sport)
        manual_rows = f"""
        UNION ALL
        SELECT lp.profile_id AS profile_id,{select_cols}
          FROM player_elo_log l
          JOIN (SELECT DISTINCT profile_id, player_id FROM linked) lp ON lp.player_id = l.player_id
     LEFT JOIN tournaments t ON t.id = l.tournament_id
     LEFT JOIN clubs mc ON l.is_manual = 1 AND mc.id = l.tournament_id
         WHERE {" AND ".join(manual_where)}{hidden_sql.format(pid="lp.profile_id")}
        """
        params += manual_params + hidden_params
    else:
        manual_rows = ""

    cte = f"""
        WITH linked AS ({linked_sql}),
        scoped_log AS ({tournament_rows}{manual_rows})
    """
    return cte, params


def scope_stats(
    conn,
    scope: RatingScope,
    *,
    profile_ids: list[str] | None = None,
    include_hidden: bool = False,
) -> dict[tuple[str, str], ScopeStats]:
    """``{(profile_id, sport): ScopeStats}`` for the profiles that have log rows in *scope*.

    ``matches`` counts non-manual rows; ``elo`` is the rating after the latest
    row, a manual adjustment included.  Profiles without rows are absent so
    callers can fall back to a stored snapshot.
    """
    if profile_ids is not None and not profile_ids:
        return {}
    cte, params = scoped_log_cte(scope, profile_ids=profile_ids, include_hidden=include_hidden)
    rows = conn.execute(
        f"""{cte},
        agg AS (
            SELECT profile_id, sport, SUM(CASE WHEN is_manual = 0 THEN 1 ELSE 0 END) AS matches
              FROM scoped_log GROUP BY profile_id, sport
        ),
        latest AS (
            SELECT profile_id, sport, elo_after,
                   ROW_NUMBER() OVER (PARTITION BY profile_id, sport
                                      ORDER BY updated_at DESC, match_order DESC) AS rn
              FROM scoped_log
        )
        SELECT a.profile_id AS profile_id, a.sport AS sport, a.matches AS matches, lt.elo_after AS elo
          FROM agg a
     LEFT JOIN latest lt ON lt.profile_id = a.profile_id AND lt.sport = a.sport AND lt.rn = 1
        """,
        params,
    ).fetchall()
    return {(r["profile_id"], r["sport"]): ScopeStats(matches=int(r["matches"] or 0), elo=r["elo"]) for r in rows}


def scoped_recent_logs(
    conn,
    scope: RatingScope,
    profile_id: str,
    limit: int,
) -> list[dict]:
    """Newest *limit* log rows of one profile per sport within *scope*, newest first."""
    cte, params = scoped_log_cte(scope, profile_ids=[profile_id])
    rows = conn.execute(
        f"""{cte},
        ranked AS (
            SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.sport
                                           ORDER BY s.updated_at DESC, s.match_order DESC) AS rn
              FROM scoped_log s
        )
        SELECT tournament_id, sport, match_id, player_id, match_order,
               elo_before, elo_after, elo_delta, match_payload,
               updated_at, tournament_name, tournament_alias,
               is_manual, adjustment_reason, adjusted_by
          FROM ranked
         WHERE rn <= ?
      ORDER BY updated_at DESC, match_order DESC
        """,
        [*params, limit],
    ).fetchall()
    return [dict(r) for r in rows]
