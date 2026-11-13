"""
Combined Group‑Stage → Play‑Off tournament.

Orchestrates:
  1. Group stage (round‑robin within groups)
  2. Play‑off bracket (single or double elimination)

Usage:
    t = GroupPlayoffTournament(players, num_groups=2, courts=courts,
                               top_per_group=2, double_elimination=False)
    t.generate()               # creates group matches
    t.record_group_result(...)  # record scores
    t.start_playoffs()          # auto‑seeds from group standings
    t.record_playoff_result(...)
"""

from __future__ import annotations

import time
from collections import defaultdict

from ..models import Court, GPPhase, Match, MatchStatus, Player, reset_match_result
from .errors import MatchClearBlocked, WithdrawalBlocked
from .court_preferences import CourtPlan, clean_preferences, espejo_scope_of, group_scope_of
from .group_stage import Group, assign_courts, distribute_players_to_groups
from . import live_courts
from . import pairing as pairing_mod
from . import withdrawal as wd
from .playoff import (
    DoubleEliminationBracket,
    EspejoParallelBracket,
    EspejoSplitBracket,
    SingleEliminationBracket,
    bracket_matches,
    validate_num_winners,
)


class GroupPlayoffTournament:
    # Preferred courts (court names) per group name and per Espejo side
    # ("winners" / "losers").  Class defaults cover older pickles; always
    # replace these dicts, never mutate them in place.
    group_courts: dict[str, list[str]] = {}
    bracket_courts: dict[str, list[str]] = {}

    def __init__(
        self,
        players: list[Player],
        num_groups: int = 2,
        courts: list[Court] | None = None,
        top_per_group: int = 2,
        double_elimination: bool = False,
        team_mode: bool = False,
        group_names: list[str] | None = None,
        initial_strength: dict[str, float] | None = None,
        team_roster: dict[str, list[str]] | None = None,
        team_member_names: dict[str, list[str]] | None = None,
        group_assignments: dict[str, list[str]] | None = None,
        group_courts: dict[str, list[str]] | None = None,
        bracket_courts: dict[str, list[str]] | None = None,
    ):
        self.players = list(players)
        self.num_groups = num_groups
        self.courts = courts or []
        self.top_per_group = top_per_group
        self.double_elimination = double_elimination
        self.team_mode = team_mode
        self.group_names = group_names or []
        self.initial_strength = initial_strength
        self.team_roster = team_roster or {}
        self.team_member_names = team_member_names or {}
        self.group_assignments = group_assignments or {}
        self.group_courts = clean_preferences(group_courts, self.courts)
        self.bracket_courts = clean_preferences(bracket_courts, self.courts)

        self.groups: list[Group] = []
        self.playoff_bracket: SingleEliminationBracket | DoubleEliminationBracket | EspejoParallelBracket | None = None
        self._espejo: bool = False

        self._phase: GPPhase = GPPhase.SETUP
        # Withdrawals by entry key, in the order they happened.
        self.withdrawals: dict[str, wd.WithdrawalRecord] = {}

    def __getstate__(self) -> dict:
        return self.__dict__.copy()

    def __setstate__(self, state: dict) -> None:
        # Tournaments pickled before withdrawals existed.
        state.setdefault("withdrawals", {})
        self.__dict__.update(state)

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    @property
    def phase(self) -> GPPhase:
        return self._phase

    @property
    def espejo(self) -> bool:
        """Whether the play-offs run as an Espejo (Winners + consolation Losers bracket)."""
        return bool(getattr(self, "_espejo", False))

    def generate(self) -> None:
        """Create groups and generate matches.

        * **team_mode** — generates all round-robin matches at once.
        * **individual mode** — generates only the first round of matches.
          Call ``generate_next_group_round()`` after recording scores to
          produce subsequent rounds with score-based opponent matching.

        When ``group_assignments`` is provided, players are placed into
        groups according to the explicit mapping (group name → player names).
        Otherwise, when ``initial_strength`` is provided, players are sorted
        by strength descending before distribution so that snake-draft
        group assignment produces balanced groups.
        """
        if self.group_assignments:
            # Explicit group assignments provided by the admin
            name_to_player = {p.name: p for p in self.players}
            self.groups = []
            for g_name, member_names in self.group_assignments.items():
                group_players = [name_to_player[n] for n in member_names if n in name_to_player]
                self.groups.append(Group(name=g_name, players=group_players, team_mode=self.team_mode))
        else:
            players = list(self.players)
            if self.initial_strength:
                players.sort(key=lambda p: -self.initial_strength.get(p.id, 0.0))
            self.groups = distribute_players_to_groups(
                players,
                self.num_groups,
                shuffle=not bool(self.initial_strength),
                team_mode=self.team_mode,
                group_names=self.group_names,
                snake_draft=bool(self.initial_strength),
            )
        if not self.team_mode:
            for g in self.groups:
                if len(g.players) < 4:
                    raise ValueError(
                        f"Group '{g.name}' has only {len(g.players)} player(s). "
                        "Individual mode requires at least 4 players per group."
                    )

        if self.team_mode:
            for g in self.groups:
                g.generate_round_robin()
            if self.courts:
                self._assign_group_courts()
        else:
            for g in self.groups:
                g.generate_next_round()
            if self.courts:
                assign_courts(self.all_group_matches(), self.courts, plan=self._group_plan())
        self._phase = GPPhase.GROUPS
        # The plan above only orders the queue; nobody is on court yet.
        live_courts.clear_plan(self.all_group_matches())
        self.refill_group_courts()

    def generate_next_group_round(self) -> list[Match]:
        """Generate the next round of group matches across all groups.

        Requires all pending matches from the previous round to be completed
        first so that cumulative scores can inform opponent selection.

        Returns:
            Newly generated matches (empty if all partnerships exhausted).

        Raises:
            RuntimeError: If not in group phase or pending matches remain.
        """
        if self._phase != GPPhase.GROUPS:
            raise RuntimeError("Must be in group phase to generate rounds")
        if self.pending_group_matches():
            raise RuntimeError("Complete current round matches before generating next round")

        new_matches: list[Match] = []
        for g in self.groups:
            new_matches.extend(g.generate_next_round())
        if self.courts and new_matches:
            # Offset slot numbers so they don't collide with previous rounds.
            max_slot = self._max_slot_number()
            start_slot = max_slot + 1 if max_slot >= 0 else 0
            # Rotate courts so successive rounds use different physical courts.
            assign_courts(new_matches, self.courts, court_offset=start_slot, plan=self._group_plan())
            for m in new_matches:
                m.slot_number += start_slot
        self.refill_group_courts()
        return new_matches

    @property
    def has_more_group_rounds(self) -> bool:
        """Whether any group still has unused partnerships to form matches."""
        if self.team_mode:
            return False
        return any(g.has_more_rounds for g in self.groups)

    def update_courts(self, courts: list[Court]) -> None:
        """Replace the court list and reassign courts across all existing matches."""
        self.courts = list(courts)
        live_courts.remap_courts(self.all_group_matches() + self.playoff_matches(), self.courts)
        # Preferences for courts that no longer exist are dropped.
        self.group_courts = clean_preferences(self.group_courts, self.courts)
        self.bracket_courts = clean_preferences(self.bracket_courts, self.courts)
        self._reassign_courts()

    def set_court_preferences(
        self,
        group_courts: dict[str, list[str]] | None,
        bracket_courts: dict[str, list[str]] | None,
    ) -> None:
        """Replace the preferred courts per group / Espejo side and reassign courts."""
        self.group_courts = clean_preferences(group_courts, self.courts)
        self.bracket_courts = clean_preferences(bracket_courts, self.courts)
        self._reassign_courts()

    def _group_plan(self) -> CourtPlan:
        return CourtPlan(self.courts, self.group_courts, group_scope_of(self.groups))

    def _bracket_plan(self) -> CourtPlan:
        return CourtPlan(self.courts, self.bracket_courts, espejo_scope_of(self.playoff_bracket))

    def refill_group_courts(self) -> None:
        """Put waiting group matches on free courts (see ``live_courts``)."""
        if not self.courts or self._phase != GPPhase.GROUPS:
            return
        # How many matches each group can play at once: groups with more
        # time left get free courts first, so the groups finish together.
        per_match = 2 if self.team_mode else 4
        capacity = {
            g.name: max(1, sum(1 for p in g.players if p.id not in g.withdrawn_ids) // per_match) for g in self.groups
        }
        live_courts.refill_courts(
            self.all_group_matches(),
            self.courts,
            self._group_plan(),
            scope_of=group_scope_of(self.groups),
            capacity=capacity,
            round_order=True,
        )

    def refill_playoff_courts(self) -> None:
        """Put ready play-off matches on free courts (see ``live_courts``)."""
        if self.courts and self.playoff_bracket is not None:
            live_courts.refill_courts(self.playoff_matches(), self.courts, self._bracket_plan())

    def _reassign_courts(self) -> None:
        """Re-plan courts after a court or preference edit.

        Before any result the whole plan starts over; once matches are being
        played, the ones on court keep their court and the queue is re-planned.
        """
        group_ms = self.all_group_matches()
        if group_ms and live_courts.nothing_played(group_ms):
            live_courts.clear_plan(group_ms)
            for m in group_ms:
                m.slot_number = 0
            self._assign_group_courts()
        self.refill_group_courts()
        po_ms = self.playoff_matches()
        if po_ms and live_courts.nothing_played(po_ms):
            live_courts.clear_plan(po_ms)
        self.refill_playoff_courts()

    def add_player_to_group(self, player: Player, group_name: str) -> list[Match]:
        """Add a new player to a specific group during the group stage.

        The player is registered in the tournament-level roster and inserted
        into the target group.  In **team mode**, new match stubs are generated
        immediately (new player vs every existing group member) and returned so
        the frontend can display them right away.  In **individual mode**, the
        player is included in the next ``generate_next_group_round()`` call;
        no matches are created immediately.

        If courts are configured, they are assigned to the new matches using the
        same slot-offset logic as ``generate_next_group_round()``.

        Args:
            player: The new player to add.
            group_name: Name of the group to add the player to (e.g. ``"A"``).

        Returns:
            Newly created ``Match`` objects (team mode only; empty list otherwise).

        Raises:
            RuntimeError: If the tournament is not in the group phase.
            KeyError: If no group with *group_name* exists.
            ValueError: If the player already exists in the tournament.
        """
        if self._phase != GPPhase.GROUPS:
            raise RuntimeError("Players can only be added during the group stage")
        if any(p.id == player.id for p in self.players):
            raise ValueError(f"Player '{player.name}' is already in this tournament")

        group = next((g for g in self.groups if g.name == group_name), None)
        if group is None:
            available = ", ".join(g.name for g in self.groups)
            raise KeyError(f"Group '{group_name}' not found. Available groups: {available}")

        new_matches = group.add_player(player)
        self.players.append(player)
        # A new fixed-team entry never plays an entry that already withdrew:
        # those matches are walkovers straight away, with that withdrawal's score.
        if self.team_mode and group.withdrawn_ids:
            now = time.time()
            for m in new_matches:
                other = next((x for x in m.team1 + m.team2 if x.id in group.withdrawn_ids), None)
                rec = self.withdrawals.get(other.id) if other is not None else None
                if rec is None:
                    continue
                template = rec.template or wd.WalkoverTemplate()
                withdrawn_is_team1 = any(x.id == other.id for x in m.team1)
                result = template.result_for(m, withdrawn_is_team1)
                m.score, m.sets, m.status = result.score, result.sets, MatchStatus.COMPLETED
                wd.stamp_walkover(m, result, entry_key=rec.entry_key, by="system", at=now)
                rec.walkover_match_ids.append(m.id)
            group._standings_cache = None

        if new_matches and self.courts:
            max_slot = self._max_slot_number()
            start_slot = max_slot + 1 if max_slot >= 0 else 0
            assign_courts(new_matches, self.courts, court_offset=start_slot, plan=self._group_plan())
            for m in new_matches:
                if m.slot_number is not None:
                    m.slot_number += start_slot
        self.refill_group_courts()

        return new_matches

    def _assign_group_courts(self) -> None:
        """Assign courts across all group matches using the global greedy algorithm.

        In **individual mode**, all group-stage matches are pooled together and
        assigned via ``assign_courts``, which greedily fills every available court
        in each time slot while ensuring no participant plays two matches
        simultaneously and balancing court exposure across participants.

        In **team mode**, matches are processed one round at a time so that slot
        numbers respect the pre-computed round ordering (round 1 slots come before
        round 2 slots, etc.).  This lets organizers instruct players to play all
        round-1 matches before starting round 2.
        """
        plan = self._group_plan()
        if not self.team_mode:
            assign_courts(self.all_group_matches(), self.courts, plan=plan)
            return

        # Team mode: partition by round_number and assign courts sequentially.
        rounds: defaultdict[int, list[Match]] = defaultdict(list)
        for m in self.all_group_matches():
            rounds[m.round_number].append(m)

        slot_offset = 0
        for rn in sorted(rounds):
            batch = rounds[rn]
            assign_courts(batch, self.courts, court_offset=slot_offset, plan=plan)
            # assign_courts numbers slots from 0; shift them up by the offset.
            max_batch_slot = max((m.slot_number for m in batch if m.slot_number is not None), default=-1)
            for m in batch:
                if m.slot_number is not None:
                    m.slot_number += slot_offset
            slot_offset += max_batch_slot + 1

    def _max_slot_number(self) -> int:
        """Return the highest slot_number across all existing group matches, or -1."""
        slots = [m.slot_number for m in self.all_group_matches() if m.slot_number is not None]
        return max(slots) if slots else -1

    def _player_scores(self) -> dict[str, tuple[float, float, float, float]]:
        """Aggregate standings data across all groups for seeding.

        Returns:
            Dict mapping player ID to ``(wins, sets_diff, point_diff, points_for)``
            tuple — the same ranking criteria used in standings.
        """
        scores: dict[str, tuple[float, float, float, float]] = {p.id: (0.0, 0.0, 0.0, 0.0) for p in self.players}
        for g in self.groups:
            for row in g.standings():
                scores[row.player.id] = (
                    float(row.wins),
                    float(row.sets_diff),
                    float(row.point_diff),
                    float(row.points_for),
                )
        return scores

    def all_group_matches(self) -> list[Match]:
        matches: list[Match] = []
        for g in self.groups:
            matches.extend(g.matches)
        return matches

    def pending_group_matches(self) -> list[Match]:
        return [m for m in self.all_group_matches() if m.status != MatchStatus.COMPLETED]

    def record_group_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
        third_set_loss: bool = False,
    ) -> None:
        for g in self.groups:
            for m in g.matches:
                if m.id == match_id:
                    if m.walkover:
                        raise RuntimeError("This result is a walkover; undo the withdrawal to change it")
                    m.score = score
                    m.sets = sets
                    m.third_set_loss = third_set_loss
                    m.status = MatchStatus.COMPLETED
                    self.refill_group_courts()
                    return
        raise KeyError(f"Match {match_id} not found in any group")

    def clear_group_result(self, match_id: str) -> None:
        """Revert a group-stage match to unplayed (group phase only).

        In individual mode only the latest round of the match's group may be
        cleared, because later rounds are generated from earlier results.
        """
        if self._phase != GPPhase.GROUPS:
            raise MatchClearBlocked("Group results can only be cleared during the group stage")
        for g in self.groups:
            for m in g.matches:
                if m.id != match_id:
                    continue
                if m.walkover:
                    raise MatchClearBlocked("This result is a walkover; undo the withdrawal to change it")
                if not self.team_mode:
                    latest = max((x.round_number for x in g.matches), default=0)
                    if m.round_number != latest:
                        raise MatchClearBlocked("Only the latest round of a group can be cleared")
                reset_match_result(m)
                g._standings_cache = None
                # It goes back to the queue; its old court may be in use by now.
                m.court = None
                m.on_court = False
                self.refill_group_courts()
                return
        raise KeyError(f"Match {match_id} not found in any group")

    def group_standings(self) -> dict[str, list]:
        """Return standings per group as serialisable dicts."""
        result = {}
        for g in self.groups:
            standings = g.standings()
            result[g.name] = [
                {
                    "player": s.player.name,
                    "player_id": s.player.id,
                    "played": s.played,
                    "wins": s.wins,
                    "draws": s.draws,
                    "losses": s.losses,
                    "sets_won": s.sets_won,
                    "sets_lost": s.sets_lost,
                    "sets_diff": s.sets_diff,
                    "points_for": s.points_for,
                    "points_against": s.points_against,
                    "point_diff": s.point_diff,
                    "withdrawn": s.withdrawn,
                }
                for s in standings
            ]
        return result

    def recommend_playoff_participants(self) -> list[dict]:
        """Return all group-stage participants ranked by standings.

        Each entry contains player info and group standings data so the
        frontend can present a selection UI for playoff configuration.
        """
        ranked: list[dict] = []
        all_standings = self.group_standings()
        for group_name, rows in all_standings.items():
            for group_rank, row in enumerate(rows, start=1):
                # ``group_rank`` is the 1-based position inside the group; the
                # list below is sorted globally, so it cannot be inferred from order.
                ranked.append({**row, "group": group_name, "group_rank": group_rank})
        # Withdrawn entries are flagged (``withdrawn``) and listed last: they cannot advance.
        ranked.sort(
            key=lambda r: (r.get("withdrawn", False), -r["wins"], -r["sets_diff"], -r["point_diff"], -r["points_for"])
        )
        return ranked

    def start_playoffs(
        self,
        advancing_player_ids: list[str] | None = None,
        extra_players: list[tuple[str, float]] | None = None,
        double_elimination: bool | None = None,
        espejo: bool = False,
        playoff_teams: list[list[str]] | None = None,
        num_winners: int = 1,
        third_place: bool = False,
        espejo_split: bool = False,
        oro_player_ids: list[str] | None = None,
        plata_player_ids: list[str] | None = None,
        oro_extra_players: list[tuple[str, float]] | None = None,
        plata_extra_players: list[tuple[str, float]] | None = None,
        plata_third_place: bool = False,
    ) -> None:
        """Seed the play‑off bracket from group results.

        In **individual mode** (``team_mode=False``), advancing players
        are paired into balanced teams of 2 using the fold method (best
        with worst, second-best with second-worst, etc.) based on their
        group-stage cumulative scores.  An even number of total
        advancing participants is required.

        In **team mode**, each advancing entry is already a team and
        enters the bracket directly.

        When ``playoff_teams`` is provided, each entry is a list of
        player IDs forming one bracket entry.  This overrides automatic
        pairing and allows composing teams for the playoff bracket
        regardless of the tournament's ``team_mode``.

        All teams (or individual-mode formed pairs) are sorted by
        combined score descending before seeding into the bracket so
        that the strongest team gets seed #1.

        Parameters
        ----------
        advancing_player_ids : list[str] | None
            Manually chosen player IDs from the group stage.  If ``None``,
            the top ``top_per_group`` players per group are selected
            automatically.
        extra_players : list[tuple[str, float]] | None
            External participants as ``(name, score)`` tuples.  The
            score is used for seeding alongside group-stage participants.
        double_elimination : bool | None
            Override the tournament-level setting.  ``None`` keeps the
            value from ``__init__``.
        playoff_teams : list[list[str]] | None
            Pre-composed teams as lists of player IDs.  When provided,
            the bracket uses these teams directly instead of automatic
            pairing.
        num_winners : int
            Number of equal winners (single elimination only; 1 = classic
            champion).  Validated against the formed team count.
        third_place : bool
            Add a 3rd-place match (single elimination or Espejo; in split
            mode it applies to the Oro bracket).
        espejo_split : bool
            Oro / Plata mode: two independent brackets that exist from the
            start.  The organiser assigns participants via ``oro_player_ids``
            and ``plata_player_ids`` (same id space as ``advancing_player_ids``);
            ids in neither list are excluded.  ``advancing_player_ids``,
            ``extra_players``, ``playoff_teams``, ``double_elimination`` and
            ``num_winners != 1`` are rejected in this mode.
        oro_extra_players / plata_extra_players : list[tuple[str, float]] | None
            Split mode only: external participants of the Oro / Plata
            bracket, ``(name, score)`` like ``extra_players``.
        plata_third_place : bool
            Optional 3rd-place match in the Plata bracket (split mode only).
        """
        if self._phase != GPPhase.GROUPS:
            raise RuntimeError("Must be in group phase to start play‑offs")
        if self.pending_group_matches():
            raise RuntimeError("All group matches must be completed first")

        self._reject_withdrawn(
            [
                *(advancing_player_ids or []),
                *(oro_player_ids or []),
                *(plata_player_ids or []),
                *(pid for team in (playoff_teams or []) for pid in team),
            ]
        )

        if espejo_split:
            self._start_split_playoffs(
                oro_player_ids=oro_player_ids,
                plata_player_ids=plata_player_ids,
                oro_extra_players=oro_extra_players,
                plata_extra_players=plata_extra_players,
                advancing_player_ids=advancing_player_ids,
                extra_players=extra_players,
                double_elimination=double_elimination,
                playoff_teams=playoff_teams,
                num_winners=num_winners,
                third_place=third_place,
                plata_third_place=plata_third_place,
            )
            return
        if oro_player_ids or plata_player_ids or oro_extra_players or plata_extra_players or plata_third_place:
            raise RuntimeError("Oro/Plata options require the split Espejo mode")

        prev_double_elimination = self.double_elimination
        prev_espejo = getattr(self, "_espejo", False)
        if double_elimination is not None:
            self.double_elimination = double_elimination
        self._espejo = espejo

        # Build player lookup from group-stage participants
        player_map: dict[str, Player] = {p.id: p for p in self.players}

        # For automatic selection, track which group each player came from.
        player_group_index: dict[str, int] = {}
        if advancing_player_ids is not None:
            if len(set(advancing_player_ids)) != len(advancing_player_ids):
                raise RuntimeError("Advancing player IDs must be unique")
            advancing: list[Player] = []
            for pid in advancing_player_ids:
                if pid not in player_map:
                    raise KeyError(f"Player {pid} not found in tournament")
                advancing.append(player_map[pid])
            # Best-effort group lookup for manually supplied IDs.
            for g_idx, g in enumerate(self.groups):
                for p in g.players:
                    if p.id in {pid for pid in advancing_player_ids}:
                        player_group_index[p.id] = g_idx
        else:
            advancing = []
            for g_idx, g in enumerate(self.groups):
                for p in g.top_players(self.top_per_group):
                    advancing.append(p)
                    player_group_index[p.id] = g_idx

        # Aggregate scores for seeding (wins, sets_diff, point_diff, points_for)
        scores = self._player_scores()

        # Rank of each player within their group (1 = 1st place).
        # External participants default to 999 (placed after all group-stage players).
        player_rank: dict[str, int] = {}
        for g in self.groups:
            for rank_idx, row in enumerate(g.standings(), start=1):
                player_rank[row.player.id] = rank_idx

        # Add external participants
        if extra_players:
            for name, ext_score in extra_players:
                p = Player(name=name)
                advancing.append(p)
                player_map[p.id] = p
                # External score is treated as wins for seeding
                scores[p.id] = (float(ext_score), 0.0, 0.0, 0.0)

        if len(advancing) < 2:
            raise RuntimeError("Need at least 2 participants to start play‑offs")

        teams = self._form_seeded_teams(
            advancing,
            scores=scores,
            player_rank=player_rank,
            player_group_index=player_group_index,
            player_map=player_map,
            playoff_teams=playoff_teams,
        )

        try:
            if num_winners != 1 and (espejo or self.double_elimination):
                raise ValueError("Multiple winners are only supported for single-elimination brackets")
            if third_place and self.double_elimination and not espejo:
                raise ValueError("A 3rd-place match is not supported for double elimination")
            if num_winners != 1 or third_place:
                validate_num_winners(len(teams), num_winners, third_place)
        except ValueError:
            # Leave the tournament untouched so the organiser can retry with other options.
            self.double_elimination = prev_double_elimination
            self._espejo = prev_espejo
            raise

        if espejo:
            self.playoff_bracket = EspejoParallelBracket(teams, third_place=third_place)
        elif self.double_elimination:
            self.playoff_bracket = DoubleEliminationBracket(teams, courts=self.courts)
        else:
            self.playoff_bracket = SingleEliminationBracket(teams, num_winners=num_winners, third_place=third_place)

        self._phase = GPPhase.PLAYOFFS
        live_courts.clear_plan(self.playoff_matches())
        self.refill_playoff_courts()

    def _start_split_playoffs(
        self,
        *,
        oro_player_ids: list[str] | None,
        plata_player_ids: list[str] | None,
        oro_extra_players: list[tuple[str, float]] | None,
        plata_extra_players: list[tuple[str, float]] | None,
        advancing_player_ids: list[str] | None,
        extra_players: list[tuple[str, float]] | None,
        double_elimination: bool | None,
        playoff_teams: list[list[str]] | None,
        num_winners: int,
        third_place: bool,
        plata_third_place: bool,
    ) -> None:
        """Start the Oro / Plata Espejo.  Leaves the tournament untouched on any error."""
        if advancing_player_ids is not None:
            raise RuntimeError("advancing_player_ids cannot be combined with the Oro/Plata split; use oro/plata lists")
        if extra_players:
            raise RuntimeError("Use per-bracket external participants (Oro / Plata) in the split")
        if playoff_teams is not None:
            raise RuntimeError("Pre-composed playoff teams are not supported in the Oro/Plata split")
        if double_elimination:
            raise ValueError("Double elimination is not supported in the Oro/Plata split")
        if num_winners != 1:
            raise ValueError("Multiple winners are not supported in the Oro/Plata split")

        oro_ids = list(oro_player_ids or [])
        plata_ids = list(plata_player_ids or [])
        if len(set(oro_ids)) != len(oro_ids) or len(set(plata_ids)) != len(plata_ids):
            raise RuntimeError("Oro/Plata player IDs must be unique")
        overlap = set(oro_ids) & set(plata_ids)
        if overlap:
            raise RuntimeError("A player cannot be in both the Oro and Plata brackets")

        player_map: dict[str, Player] = {p.id: p for p in self.players}
        group_of: dict[str, int] = {}
        for g_idx, g in enumerate(self.groups):
            for p in g.players:
                group_of[p.id] = g_idx
        for pid in (*oro_ids, *plata_ids):
            if pid not in player_map or pid not in group_of:
                raise KeyError(f"Player {pid} is not a group participant")

        scores = self._player_scores()
        player_rank: dict[str, int] = {}
        for g in self.groups:
            for rank_idx, row in enumerate(g.standings(), start=1):
                player_rank[row.player.id] = rank_idx

        brackets: list[tuple[str, list[str], list[tuple[str, float]], bool]] = [
            ("Oro", oro_ids, list(oro_extra_players or []), third_place),
            ("Plata", plata_ids, list(plata_extra_players or []), plata_third_place),
        ]
        seeded: list[list[list[Player]]] = []
        for label, ids, extras, want_third in brackets:
            players = [player_map[pid] for pid in ids]
            # External participants: score seeds as wins, rank defaults to last (999).
            for name, ext_score in extras:
                ext = Player(name=name)
                players.append(ext)
                player_map[ext.id] = ext
                scores[ext.id] = (float(ext_score), 0.0, 0.0, 0.0)
            if not self.team_mode and len(players) % 2 != 0:
                raise RuntimeError(
                    f"{label} bracket needs an even number of players to form teams (got {len(players)})"
                )
            teams = self._form_seeded_teams(
                players,
                scores=scores,
                player_rank=player_rank,
                player_group_index={pid: group_of[pid] for pid in ids},
                player_map=player_map,
            )
            if len(teams) < 2:
                raise RuntimeError(f"{label} bracket needs at least 2 teams (got {len(teams)})")
            if want_third:
                try:
                    validate_num_winners(len(teams), 1, True)
                except ValueError as exc:
                    raise ValueError(f"{label} bracket: {exc}") from exc
            seeded.append(teams)

        self._espejo = True
        self.playoff_bracket = EspejoSplitBracket(
            seeded[0],
            seeded[1],
            third_place=third_place,
            lower_third_place=plata_third_place,
        )
        self._phase = GPPhase.PLAYOFFS
        self.refill_playoff_courts()

    def _form_seeded_teams(
        self,
        advancing: list[Player],
        *,
        scores: dict[str, tuple[float, float, float, float]],
        player_rank: dict[str, int],
        player_group_index: dict[str, int],
        player_map: dict[str, Player],
        playoff_teams: list[list[str]] | None = None,
    ) -> list[list[Player]]:
        """Turn *advancing* players into a seeded list of bracket entries (best seed first).

        Seed key: best group rank, then wins, sets_diff, point_diff, points_for.
        Multiple groups use group-diversity seeding so Round-1 opponents come
        from different groups.  Individual mode pairs players with the fold
        method; team mode (or *playoff_teams*) uses entries as given.
        """

        def _seed_key(team: list[Player]) -> tuple[float, float, float, float, float]:
            """Sort key for bracket seeding (higher = better).

            Primary criterion: best group position (1st > 2nd > …).
            Tiebreakers: wins → sets_diff → point_diff → points_for.
            """
            combined = [scores.get(p.id, (0.0, 0.0, 0.0, 0.0)) for p in team]
            best_rank = min((player_rank.get(p.id, 999) for p in team), default=999)
            return (
                -float(best_rank),
                sum(c[0] for c in combined),
                sum(c[1] for c in combined),
                sum(c[2] for c in combined),
                sum(c[3] for c in combined),
            )

        def _team_group(team: list[Player]) -> int:
            """Return the group index of the first player in the team, or -1."""
            for p in team:
                if p.id in player_group_index:
                    return player_group_index[p.id]
            return -1

        if playoff_teams is not None:
            # Pre-composed teams override automatic pairing.
            teams = []
            for member_ids in playoff_teams:
                team_members = []
                for pid in member_ids:
                    if pid not in player_map:
                        raise KeyError(f"Player {pid} not found in tournament")
                    team_members.append(player_map[pid])
                teams.append(team_members)
            # Apply group-diversity seeding when multiple groups exist.
            if self.num_groups > 1:
                group_ids = [_team_group(t) for t in teams]
                teams = pairing_mod.seed_with_group_diversity(teams, group_ids, _seed_key)
            else:
                teams.sort(key=lambda t: tuple(-x for x in _seed_key(t)))
        elif self.team_mode:
            # In team mode each advancing entry IS a team already.
            # Build teams, then apply group-diversity seeding when multiple
            # groups exist so first-round opponents come from different groups.
            raw_teams = [[p] for p in advancing]
            if self.num_groups > 1:
                group_ids = [_team_group(t) for t in raw_teams]
                teams = pairing_mod.seed_with_group_diversity(raw_teams, group_ids, _seed_key)
            else:
                teams = sorted(raw_teams, key=lambda t: tuple(-x for x in _seed_key(t)))
        else:
            # Individual mode: form balanced teams of 2 using group-stage scores.
            if len(advancing) % 2 != 0:
                raise RuntimeError(f"Need an even number of advancing players to form teams (got {len(advancing)})")
            # form_playoff_teams uses a flat score for fold-pairing
            flat_scores = {pid: s[0] for pid, s in scores.items()}
            teams = pairing_mod.form_playoff_teams(advancing, flat_scores)
            # Apply group-diversity seeding when multiple groups exist.
            if self.num_groups > 1:
                group_ids = [_team_group(t) for t in teams]
                teams = pairing_mod.seed_with_group_diversity(teams, group_ids, _seed_key)
            else:
                # Sort formed teams by combined standings for proper bracket seeding.
                teams.sort(key=lambda t: tuple(-x for x in _seed_key(t)))
        return teams

    def playoff_matches(self) -> list[Match]:
        if self.playoff_bracket is None:
            return []
        return bracket_matches(self.playoff_bracket)

    def pending_playoff_matches(self) -> list[Match]:
        if self.playoff_bracket is None:
            return []
        pending = self.playoff_bracket.pending_matches()
        # Safety net: a match that became ready without a court gets one now.
        if self.courts and any(m.court is None and not live_courts.court_done(m) for m in pending):
            self.refill_playoff_courts()
        return pending

    def record_playoff_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
    ) -> None:
        if self.playoff_bracket is None:
            raise RuntimeError("Play‑offs have not started")
        m = wd.bracket_match(self.playoff_bracket, match_id)
        if m is not None and m.walkover:
            raise ValueError("This result is a walkover and cannot be edited")
        unwind = m is not None and wd.has_forfeits(self.withdrawals) and wd.winner_changes(m, score)
        snapshot = wd.snapshot_bracket(self.playoff_bracket) if unwind else None
        try:
            if unwind:
                wd.forget_walkovers(self.withdrawals, wd.unwind_downstream_walkovers(self.playoff_bracket, match_id))
            self.playoff_bracket.record_result(match_id, score, sets=sets)
        except Exception:
            if snapshot is not None:
                self.playoff_bracket = snapshot
            raise
        self.resolve_forfeits()

    def resolve_forfeits(self) -> list[Match]:
        """Create the walkovers owed by withdrawn bracket entries, then re-check the finish."""
        created: list[Match] = []
        if self.playoff_bracket is not None:
            created = wd.resolve_bracket_forfeits(self.playoff_bracket, self.withdrawals)
        self.refill_playoff_courts()
        # Finished only when the whole bracket is decided.  For Espejo the
        # bracket champion stays ``None`` until the consolation (Losers)
        # bracket is done as well, so the phase does not flip early.
        if self.playoff_bracket is not None and self.winners() is not None:
            self._phase = GPPhase.FINISHED
        return created

    def clear_playoff_result(self, match_id: str) -> None:
        """Revert a play-off match to unplayed (play-offs phase only).

        Walkovers that depend on the result are cleared first and recreated
        afterwards when still owed; a really played later match still blocks.
        """
        if self.playoff_bracket is None or self._phase != GPPhase.PLAYOFFS:
            raise MatchClearBlocked("Play-off results can only be cleared while the play-offs are running")
        m = wd.bracket_match(self.playoff_bracket, match_id)
        if m is not None and m.walkover:
            raise MatchClearBlocked("This result is a walkover; clear the match that fed it instead")
        if m is not None:
            # It goes back to the queue; its old court may be in use by now.
            m.court = None
            m.on_court = False
        if not wd.has_forfeits(self.withdrawals):
            self.playoff_bracket.clear_result(match_id)
            self.refill_playoff_courts()
            return
        snapshot = wd.snapshot_bracket(self.playoff_bracket)
        try:
            wd.forget_walkovers(self.withdrawals, wd.unwind_downstream_walkovers(self.playoff_bracket, match_id))
            self.playoff_bracket.clear_result(match_id)
        except Exception:
            self.playoff_bracket = snapshot
            raise
        self.resolve_forfeits()

    # ------------------------------------------------------------------ #
    # Withdrawals
    # ------------------------------------------------------------------ #

    @property
    def withdrawn_ids(self) -> set[str]:
        """Ids of entries / persons withdrawn during the group stage and still listed."""
        out: set[str] = set()
        for g in self.groups:
            out |= g.withdrawn_ids
        return out

    def _reject_withdrawn(self, ids: list[str]) -> None:
        withdrawn = self.withdrawn_ids
        bad = next((pid for pid in ids if pid in withdrawn), None)
        if bad is not None:
            name = next((p.name for p in self.players if p.id == bad), bad)
            raise RuntimeError(f"{name} has withdrawn and cannot play the play-offs")

    def withdrawal_record_for(self, person_id: str) -> wd.WithdrawalRecord | None:
        """The withdrawal covering *person_id* (an entry id or a team member), if any."""
        return next((r for r in self.withdrawals.values() if person_id in r.member_ids), None)

    def _group_entry_for(self, person_id: str) -> tuple[Group, str]:
        for g in self.groups:
            if any(p.id == person_id for p in g.players):
                return g, person_id
        for team_pid, members in (self.team_roster or {}).items():
            if person_id in members:
                for g in self.groups:
                    if any(p.id == team_pid for p in g.players):
                        return g, team_pid
        raise KeyError(f"Player {person_id} is not in any group")

    def _person_known(self, person_id: str) -> bool:
        if any(p.id == person_id for p in self.players):
            return True
        return any(person_id in members for members in (self.team_roster or {}).values())

    def plan_withdrawal(self, person_id: str) -> wd.WithdrawalPlan:
        """Dry run of :meth:`withdraw` (raises like it, never mutates)."""
        if self._phase == GPPhase.FINISHED:
            raise WithdrawalBlocked("The tournament is finished")
        if self.withdrawal_record_for(person_id) is not None:
            raise WithdrawalBlocked("This participant has already withdrawn")
        if self._phase == GPPhase.GROUPS:
            group, entry_id = self._group_entry_for(person_id)
            if self.team_mode:
                return wd.plan_group_team_withdrawal(group, entry_id, group.withdrawn_ids)
            return wd.plan_group_rotating_withdrawal(group, entry_id)
        if self._phase == GPPhase.PLAYOFFS and self.playoff_bracket is not None:
            team = wd.find_bracket_entry(self.playoff_bracket, person_id, self.team_roster)
            if team is None:
                if self._person_known(person_id):
                    raise WithdrawalBlocked("This participant is not in the play-offs")
                raise KeyError(f"Player {person_id} not found in tournament")
            return wd.plan_bracket_forfeit(self.playoff_bracket, team, self.withdrawals)
        raise WithdrawalBlocked("Withdrawals are not possible in this phase")

    def withdraw(
        self,
        person_id: str,
        *,
        template: wd.WalkoverTemplate | None = None,
        expected_kind: wd.WithdrawalKind | None = None,
        by: str | None = None,
        at: float | None = None,
    ) -> tuple[wd.WithdrawalRecord, list[Match]]:
        """Withdraw the entry of *person_id*; the case follows the phase and team mode.

        Returns the stored record and the walkovers created now.

        Raises:
            WithdrawalBlocked: finished, already withdrawn or eliminated, a score
                awaiting confirmation / disputed / under review, or the outcome
                differs from *expected_kind*.
            KeyError: unknown person.
        """
        at = time.time() if at is None else at
        plan = self.plan_withdrawal(person_id)
        if expected_kind is not None and plan.kind != expected_kind:
            raise WithdrawalBlocked("The withdrawal outcome changed; review it again")
        if plan.blockers:
            raise WithdrawalBlocked("Settle the pending, disputed or under-review scores first")
        members = wd.entry_member_ids(plan.entry, self.team_roster)
        if self._phase == GPPhase.GROUPS:
            group, entry_id = self._group_entry_for(person_id)
            if self.team_mode:
                record = wd.apply_group_team_withdrawal(
                    self.players, group, entry_id, group.withdrawn_ids, template, member_ids=members, by=by, at=at
                )
                created = [m for m in group.matches if m.id in set(record.walkover_match_ids)]
            else:
                record = wd.apply_group_rotating_withdrawal(group, entry_id, by=by, at=at)
                created = []
            self.withdrawals[record.entry_key] = record
            self.refill_group_courts()
            return record, created
        assert self.playoff_bracket is not None
        snapshot = wd.snapshot_bracket(self.playoff_bracket)
        try:
            record, created = wd.apply_bracket_forfeit(
                self.playoff_bracket, plan.entry, self.withdrawals, template, member_ids=members, by=by, at=at
            )
        except Exception:
            self.playoff_bracket = snapshot
            self.withdrawals.pop(plan.entry_key, None)
            raise
        self.resolve_forfeits()
        return record, created

    def undo_block_reason(self, entry_key: str) -> str | None:
        """Why the withdrawal *entry_key* cannot be undone now, or ``None`` when it can."""
        record = self.withdrawals.get(entry_key)
        if record is None:
            return "No such withdrawal"
        if record.kind == wd.WithdrawalKind.FORFEIT:
            return "Play-off withdrawals cannot be undone"
        if self._phase != GPPhase.GROUPS:
            return "Group withdrawals can only be undone during the group stage"
        keys = list(self.withdrawals)
        later = [self.withdrawals[k] for k in keys[keys.index(entry_key) + 1 :]]
        if any(r.group_name == record.group_name for r in later):
            return "Undo the later withdrawal in this group first"
        group = next((g for g in self.groups if g.name == record.group_name), None)
        if group is None:
            return "The group no longer exists"
        if [p.id for p in group.players] != record.roster_snapshot:
            return "The group roster changed since the withdrawal"
        if record.kind == wd.WithdrawalKind.EXCLUDE and group._round_count != record.round_count_at:
            return "A new round was generated since the withdrawal"
        return None

    def undo_withdrawal(self, entry_key: str, *, by: str | None = None, at: float | None = None) -> wd.WithdrawalRecord:
        """Reverse a group-stage withdrawal (G1 / G2).  Play-off forfeits cannot be undone."""
        if entry_key not in self.withdrawals:
            raise KeyError(f"Withdrawal {entry_key} not found")
        reason = self.undo_block_reason(entry_key)
        if reason is not None:
            raise WithdrawalBlocked(reason)
        record = self.withdrawals[entry_key]
        group = next(g for g in self.groups if g.name == record.group_name)
        if record.kind == wd.WithdrawalKind.EXCLUDE:
            wd.undo_group_rotating_withdrawal(group, record)
        else:
            wd.undo_group_team_withdrawal(self.players, group, record, by=by, at=at)
        del self.withdrawals[entry_key]
        self.refill_group_courts()
        return record

    def winners(self) -> list[list[Player]] | None:
        """All (equal) winners once the play-offs are fully decided, else ``None``."""
        bracket = self.playoff_bracket
        if bracket is None:
            return None
        if isinstance(bracket, SingleEliminationBracket):
            return bracket.winners()
        champ = bracket.champion()
        return [champ] if champ else None

    def champion(self) -> list[Player] | None:
        """Single winner (``None`` while undecided and always ``None`` with several winners)."""
        bracket = self.playoff_bracket
        if bracket is None:
            return None
        if isinstance(bracket, SingleEliminationBracket):
            w = bracket.winners()
            return w[0] if w and len(w) == 1 else None
        return bracket.champion()
