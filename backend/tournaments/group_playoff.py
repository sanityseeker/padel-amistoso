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

from collections import defaultdict

from ..models import Court, GPPhase, Match, MatchStatus, Player
from .group_stage import Group, assign_courts, distribute_players_to_groups
from . import pairing as pairing_mod
from .playoff import DoubleEliminationBracket, SingleEliminationBracket


class GroupPlayoffTournament:
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

        self.groups: list[Group] = []
        self.playoff_bracket: SingleEliminationBracket | DoubleEliminationBracket | None = None

        self._phase: GPPhase = GPPhase.SETUP

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    @property
    def phase(self) -> GPPhase:
        return self._phase

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
                assign_courts(self.all_group_matches(), self.courts)
        self._phase = GPPhase.GROUPS

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
            assign_courts(new_matches, self.courts, court_offset=start_slot)
            for m in new_matches:
                m.slot_number += start_slot
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
        # Clear existing court assignments so assign_courts can reassign them.
        for m in self.all_group_matches():
            m.court = None
            m.slot_number = None
        self._assign_group_courts()
        if self.playoff_bracket is not None:
            all_po = self.playoff_bracket.all_matches()
            for m in all_po:
                m.court = None
                m.slot_number = None
            if all_po:
                assign_courts(all_po, self.courts)

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

        if new_matches and self.courts:
            max_slot = self._max_slot_number()
            start_slot = max_slot + 1 if max_slot >= 0 else 0
            assign_courts(new_matches, self.courts, court_offset=start_slot)
            for m in new_matches:
                if m.slot_number is not None:
                    m.slot_number += start_slot

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
        if not self.team_mode:
            assign_courts(self.all_group_matches(), self.courts)
            return

        # Team mode: partition by round_number and assign courts sequentially.
        rounds: defaultdict[int, list[Match]] = defaultdict(list)
        for m in self.all_group_matches():
            rounds[m.round_number].append(m)

        slot_offset = 0
        for rn in sorted(rounds):
            batch = rounds[rn]
            assign_courts(batch, self.courts, court_offset=slot_offset)
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
                    m.score = score
                    m.sets = sets
                    m.third_set_loss = third_set_loss
                    m.status = MatchStatus.COMPLETED
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
            for row in rows:
                ranked.append({**row, "group": group_name})
        ranked.sort(key=lambda r: (-r["wins"], -r["sets_diff"], -r["point_diff"], -r["points_for"]))
        return ranked

    def start_playoffs(
        self,
        advancing_player_ids: list[str] | None = None,
        extra_players: list[tuple[str, float]] | None = None,
        double_elimination: bool | None = None,
    ) -> None:
        """Seed the play‑off bracket from group results.

        In **individual mode** (``team_mode=False``), advancing players
        are paired into balanced teams of 2 using the fold method (best
        with worst, second-best with second-worst, etc.) based on their
        group-stage cumulative scores.  An even number of total
        advancing participants is required.

        In **team mode**, each advancing entry is already a team and
        enters the bracket directly.

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
        """
        if self._phase != GPPhase.GROUPS:
            raise RuntimeError("Must be in group phase to start play‑offs")
        if self.pending_group_matches():
            raise RuntimeError("All group matches must be completed first")

        if double_elimination is not None:
            self.double_elimination = double_elimination

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

        if self.team_mode:
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

        if self.double_elimination:
            self.playoff_bracket = DoubleEliminationBracket(teams, courts=self.courts)
        else:
            self.playoff_bracket = SingleEliminationBracket(teams)

        if self.courts:
            all_matches = (
                self.playoff_bracket.all_matches
                if isinstance(self.playoff_bracket, DoubleEliminationBracket)
                else self.playoff_bracket.matches
            )
            assign_courts(all_matches, self.courts)

        self._phase = GPPhase.PLAYOFFS

    def playoff_matches(self) -> list[Match]:
        if self.playoff_bracket is None:
            return []
        if isinstance(self.playoff_bracket, DoubleEliminationBracket):
            return self.playoff_bracket.all_matches
        return self.playoff_bracket.matches

    def pending_playoff_matches(self) -> list[Match]:
        if self.playoff_bracket is None:
            return []
        pending = self.playoff_bracket.pending_matches()
        # Lazy court assignment for matches that just became ready.
        # Offset slot numbers so newly assigned playoff slots come after
        # any already-completed or already-scheduled playoff slots.
        if self.courts:
            needs_court = [m for m in pending if m.court is None]
            if needs_court:
                existing_slots = [m.slot_number for m in self.playoff_matches() if m.slot_number is not None]
                start_slot = (max(existing_slots) + 1) if existing_slots else 0
                assign_courts(needs_court, self.courts, court_offset=start_slot)
                for m in needs_court:
                    if m.slot_number is not None:
                        m.slot_number += start_slot
        return pending

    def record_playoff_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
    ) -> None:
        if self.playoff_bracket is None:
            raise RuntimeError("Play‑offs have not started")
        self.playoff_bracket.record_result(match_id, score, sets=sets)

        # Check for champion
        champ = self.playoff_bracket.champion()
        if champ is not None:
            self._phase = GPPhase.FINISHED

    def champion(self) -> list[Player] | None:
        if self.playoff_bracket is None:
            return None
        return self.playoff_bracket.champion()
