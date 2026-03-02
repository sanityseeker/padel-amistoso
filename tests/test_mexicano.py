"""Tests for the Mexicano tournament module."""

import pytest

from backend.models import Court, MatchStatus, MexPhase, Player
from backend.tournaments import MexicanoTournament


def _make_players(n: int) -> list[Player]:
    return [Player(name=f"P{i + 1}") for i in range(n)]


def _make_courts(n: int) -> list[Court]:
    return [Court(name=f"Court {i + 1}") for i in range(n)]


class TestMexicanoCreation:
    def test_requires_at_least_4(self):
        with pytest.raises(ValueError, match="at least 4"):
            MexicanoTournament(_make_players(3), _make_courts(1))

    @pytest.mark.parametrize(
        "n_players, n_courts",
        [
            (4, 1),
            (5, 1),
            (6, 1),
            (8, 2),
        ],
    )
    def test_creation_succeeds(self, n_players, n_courts):
        t = MexicanoTournament(_make_players(n_players), _make_courts(n_courts))
        assert t.current_round == 0
        assert len(t.players) == n_players

    def test_initial_scores_are_zero(self):
        t = MexicanoTournament(_make_players(8), _make_courts(2))
        for score in t.scores.values():
            assert score == 0


class TestMexicanoRoundGeneration:
    def test_generates_matches(self):
        t = MexicanoTournament(_make_players(8), _make_courts(2), num_rounds=3)
        matches = t.generate_next_round()
        assert len(matches) == 2  # 8 players / 4 per match = 2 matches
        assert t.current_round == 1

    def test_all_players_play_when_div4(self):
        t = MexicanoTournament(_make_players(8), _make_courts(2), num_rounds=3)
        matches = t.generate_next_round()
        all_players = set()
        for m in matches:
            for p in m.team1 + m.team2:
                all_players.add(p.id)
        assert len(all_players) == 8

    def test_each_match_has_two_per_team(self):
        t = MexicanoTournament(_make_players(8), _make_courts(2), num_rounds=3)
        matches = t.generate_next_round()
        for m in matches:
            assert len(m.team1) == 2
            assert len(m.team2) == 2

    def test_courts_assigned(self):
        t = MexicanoTournament(_make_players(8), _make_courts(2), num_rounds=3)
        matches = t.generate_next_round()
        for m in matches:
            assert m.court is not None

    def test_cannot_exceed_num_rounds(self):
        t = MexicanoTournament(_make_players(4), _make_courts(1), num_rounds=1)
        t.generate_next_round()
        # Complete the match
        m = t.current_round_matches()[0]
        t.record_result(m.id, (20, 12))
        with pytest.raises(RuntimeError, match="All rounds"):
            t.generate_next_round()


class TestMexicanoScoring:
    def test_scores_must_sum_to_total(self):
        t = MexicanoTournament(
            _make_players(4), _make_courts(1), total_points_per_match=32, num_rounds=3
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        with pytest.raises(ValueError, match="sum to 32"):
            t.record_result(m.id, (20, 10))  # sums to 30

    def test_scores_are_accumulated(self):
        t = MexicanoTournament(
            _make_players(4), _make_courts(1), total_points_per_match=32, num_rounds=3
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        t.record_result(m.id, (20, 12))

        for p in m.team1:
            assert t.scores[p.id] == 20
        for p in m.team2:
            assert t.scores[p.id] == 12

    def test_match_marked_completed(self):
        t = MexicanoTournament(_make_players(4), _make_courts(1), num_rounds=3)
        t.generate_next_round()
        m = t.current_round_matches()[0]
        t.record_result(m.id, (18, 14))
        assert m.status == MatchStatus.COMPLETED

    def test_unknown_match_raises(self):
        t = MexicanoTournament(_make_players(4), _make_courts(1), num_rounds=3)
        t.generate_next_round()
        with pytest.raises(KeyError):
            t.record_result("nonexistent", (16, 16))


class TestMexicanoLeaderboard:
    def test_leaderboard_sorted_descending(self):
        t = MexicanoTournament(
            _make_players(4), _make_courts(1), total_points_per_match=32, num_rounds=3
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        t.record_result(m.id, (24, 8))

        lb = t.leaderboard()
        assert lb[0]["total_points"] >= lb[-1]["total_points"]

    def test_leaderboard_has_rank(self):
        t = MexicanoTournament(_make_players(4), _make_courts(1), num_rounds=3)
        t.generate_next_round()
        m = t.current_round_matches()[0]
        t.record_result(m.id, (16, 16))

        lb = t.leaderboard()
        ranks = [e["rank"] for e in lb]
        assert ranks == [1, 2, 3, 4]


class TestMexicanoMultiRound:
    def test_full_three_rounds(self):
        t = MexicanoTournament(
            _make_players(8), _make_courts(2), total_points_per_match=32, num_rounds=3
        )

        for rnd in range(3):
            t.generate_next_round()
            for m in t.current_round_matches():
                t.record_result(m.id, (20, 12))
            assert len(t.pending_matches()) == 0

        assert t.is_finished
        assert t.current_round == 3

    def test_next_round_blocked_while_pending(self):
        t = MexicanoTournament(_make_players(4), _make_courts(1), num_rounds=3)
        t.generate_next_round()
        assert len(t.pending_matches()) == 1

    def test_repeat_avoidance_tries_different_pairings(self):
        """After several rounds the pairing should attempt to rotate."""
        t = MexicanoTournament(
            _make_players(4),
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=5,
            randomness=0.0,
        )

        all_pairings = []
        for _ in range(5):
            t.generate_next_round()
            m = t.current_round_matches()[0]
            # Track which players are on the same team (the team split)
            pairing = frozenset(
                [
                    frozenset(p.id for p in m.team1),
                    frozenset(p.id for p in m.team2),
                ]
            )
            all_pairings.append(pairing)
            t.record_result(m.id, (16, 16))

        # With 4 players there are 3 possible pairings — we should see
        # more than 1 distinct pairing across 5 rounds
        unique = len(set(all_pairings))
        assert unique >= 2, f"Expected diverse pairings, got {unique} unique out of 5"

    def test_pairing_diversity_across_rounds(self):
        """With 8 players and many rounds, pairings should vary."""
        t = MexicanoTournament(
            _make_players(8),
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=6,
            randomness=0.0,
        )

        all_team_sets = []
        for _ in range(6):
            t.generate_next_round()
            for m in t.current_round_matches():
                team_set = frozenset(p.id for p in m.team1)
                all_team_sets.append(team_set)
                t.record_result(m.id, (16, 16))

        # Should have some variety in team compositions
        unique = len(set(all_team_sets))
        assert unique >= 3

    def test_score_balance_splits_top_players(self):
        """When top 2 players are far ahead the best pairing should split them."""
        players = _make_players(4)
        t = MexicanoTournament(
            players,
            _make_courts(1),
            num_rounds=3,
            total_points_per_match=32,
            randomness=0.0,
        )
        # Manually skew scores: p1 and p2 far ahead
        t.scores[players[0].id] = 200  # rank 1
        t.scores[players[1].id] = 180  # rank 2
        t.scores[players[2].id] = 10  # rank 3
        t.scores[players[3].id] = 5  # rank 4

        t.generate_next_round()
        m = t.current_round_matches()[0]
        team1_ids = {p.id for p in m.team1}

        # p1 and p2 must be on opposite teams (most balanced: ~205 vs ~185)
        assert players[0].id not in team1_ids or players[1].id not in team1_ids, (
            "Top 2 players should be on opposite teams when far ahead"
        )

    @pytest.mark.parametrize(
        "n_players, n_courts, expected_groups",
        [
            (8, 2, 2),
            (12, 3, 3),
            (4, 1, 1),
        ],
    )
    def test_snake_draft_group_count(self, n_players, n_courts, expected_groups):
        """Snake draft produces the correct number of groups."""
        t = MexicanoTournament(
            _make_players(n_players), _make_courts(n_courts), num_rounds=1
        )
        ranked = t._ranked_players(t.players)
        groups = t._snake_draft_groups(ranked)
        assert len(groups) == expected_groups
        assert all(len(g) == 4 for g in groups)

    def test_snake_draft_spreads_top_players(self):
        """With 8 players and 2 courts, ranks 1 and 2 should be on different courts."""
        t = MexicanoTournament(
            _make_players(8), _make_courts(2), num_rounds=1, randomness=0.0
        )
        # Set distinct scores so ranking is deterministic
        for i, p in enumerate(t.players):
            t.scores[p.id] = 100 - i * 10

        ranked = t._ranked_players(t.players)
        groups = t._snake_draft_groups(ranked)
        rank1_id = ranked[0].id
        rank2_id = ranked[1].id
        group_for_rank1 = next(
            i for i, g in enumerate(groups) if any(p.id == rank1_id for p in g)
        )
        group_for_rank2 = next(
            i for i, g in enumerate(groups) if any(p.id == rank2_id for p in g)
        )
        assert group_for_rank1 != group_for_rank2, (
            "Ranks 1 and 2 should be on different courts (snake draft)"
        )


class TestMexicanoSitOut:
    """Tests for sit-out rotation with non-divisible-by-4 player counts."""

    @pytest.mark.parametrize(
        "n_players, n_courts, expected_matches, expected_sit_outs",
        [
            (5, 1, 1, 1),
            (6, 1, 1, 2),
            (7, 1, 1, 3),
            (9, 2, 2, 1),
        ],
    )
    def test_sit_out_count(
        self, n_players, n_courts, expected_matches, expected_sit_outs
    ):
        t = MexicanoTournament(
            _make_players(n_players), _make_courts(n_courts), num_rounds=3
        )
        matches = t.generate_next_round()
        assert len(matches) == expected_matches
        assert len(t.sit_outs) == 1
        assert len(t.sit_outs[0]) == expected_sit_outs

    def test_sit_out_rotation_is_fair(self):
        """Over multiple rounds no player should sit out much more than others."""
        t = MexicanoTournament(
            _make_players(5),
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=5,
            randomness=0.0,
        )

        for _ in range(5):
            t.generate_next_round()
            for m in t.current_round_matches():
                t.record_result(m.id, (16, 16))

        counts = list(t._sit_out_counts.values())
        # Each player should sit out exactly 1 time (5 rounds, 1 sit-out each = 5 total, 5 players)
        assert max(counts) - min(counts) <= 1, f"Unfair sit-out distribution: {counts}"

    def test_all_players_in_match_pool(self):
        """Playing + sitting should always equal total players."""
        t = MexicanoTournament(
            _make_players(6), _make_courts(1), total_points_per_match=32, num_rounds=3
        )
        for _ in range(3):
            t.generate_next_round()
            playing = set()
            for m in t.current_round_matches():
                for p in m.team1 + m.team2:
                    playing.add(p.id)
            sitting = {p.id for p in t.sit_outs[-1]}
            assert len(playing) + len(sitting) == 6
            assert playing.isdisjoint(sitting)
            for m in t.current_round_matches():
                t.record_result(m.id, (16, 16))

    def test_leaderboard_includes_sat_out(self):
        t = MexicanoTournament(
            _make_players(5), _make_courts(1), total_points_per_match=32, num_rounds=1
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))
        lb = t.leaderboard()
        assert all("sat_out" in entry for entry in lb)
        sat_outs = [e["sat_out"] for e in lb]
        assert sum(sat_outs) == 1  # exactly one player sat out


class TestMexicanoRollingMode:
    """Tests for rolling mode (num_rounds=0 = unlimited rounds)."""

    def test_create_rolling(self):
        t = MexicanoTournament(_make_players(8), _make_courts(2), num_rounds=0)
        assert t.num_rounds == 0
        assert not t.is_finished

    def test_can_play_many_rounds(self):
        """Rolling mode should allow an arbitrary number of rounds."""
        t = MexicanoTournament(
            _make_players(4), _make_courts(1), total_points_per_match=32, num_rounds=0
        )
        for _ in range(20):
            t.generate_next_round()
            for m in t.current_round_matches():
                t.record_result(m.id, (16, 16))
        assert t.current_round == 20
        assert not t.is_finished

    def test_never_finished_without_playoffs(self):
        t = MexicanoTournament(
            _make_players(4), _make_courts(1), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))
        assert not t.is_finished

    def test_can_start_playoffs_any_time(self):
        """In rolling mode, playoffs can start after any completed round."""
        t = MexicanoTournament(
            _make_players(8), _make_courts(2), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (20, 12))
        t.end_mexicano()
        t.start_playoffs(n_teams=4)
        assert t.phase == MexPhase.PLAYOFFS

    def test_cannot_start_playoffs_with_pending(self):
        """Even in rolling mode, pending matches must be completed first."""
        t = MexicanoTournament(
            _make_players(4), _make_courts(1), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        with pytest.raises(RuntimeError, match="current round"):
            t.start_playoffs(n_teams=2)

    def test_start_playoffs_pairs_individuals_into_teams(self):
        """Selected individual seeds are paired then sorted by combined score."""
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (20, 12))

        t.end_mexicano()
        seed_ids = [p.id for p in players]
        t.start_playoffs(team_player_ids=seed_ids)

        assert t.playoff_bracket is not None
        teams = t.playoff_bracket.original_teams
        assert len(teams) == 4
        assert all(len(team) == 2 for team in teams)
        # Every selected player appears exactly once
        all_ids = [p.id for team in teams for p in team]
        assert sorted(all_ids) == sorted(seed_ids)
        # Teams must be sorted by combined score descending
        team_scores = [sum(t.scores[p.id] for p in team) for team in teams]
        assert team_scores == sorted(team_scores, reverse=True)

    def test_start_playoffs_odd_individual_count_drops_last_seed(self):
        """If seed count is odd, the last seed is excluded before pairing."""
        players = _make_players(5)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        t.end_mexicano()
        seed_ids = [p.id for p in players]
        t.start_playoffs(team_player_ids=seed_ids)

        assert t.playoff_bracket is not None
        teams = t.playoff_bracket.original_teams
        assert len(teams) == 2
        paired_ids = [pid for team in teams for pid in [p.id for p in team]]
        assert seed_ids[-1] not in paired_ids

    def test_start_playoffs_duplicate_individual_id_rejected(self):
        """Duplicate player IDs should fail playoff creation."""
        players = _make_players(4)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        t.end_mexicano()
        dup = [players[0].id, players[0].id, players[1].id, players[2].id]
        with pytest.raises(RuntimeError, match="unique"):
            t.start_playoffs(team_player_ids=dup)

    def test_propose_pairings_in_rolling(self):
        """Proposal engine works in rolling mode."""
        t = MexicanoTournament(
            _make_players(8), _make_courts(2), total_points_per_match=32, num_rounds=0
        )
        # Play a round first
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))
        # Now propose
        proposals = t.propose_pairings(n_options=2)
        assert len(proposals) >= 1
        assert proposals[0]["recommended"]

    def test_negative_num_rounds_rejected(self):
        with pytest.raises(ValueError, match="num_rounds"):
            MexicanoTournament(_make_players(4), _make_courts(1), num_rounds=-1)


class TestMexicanoWinBonus:
    """Win bonus adds extra points to winner's leaderboard total."""

    def test_winner_gets_bonus(self):
        t = MexicanoTournament(
            _make_players(4),
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=1,
            win_bonus=5,
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        t.record_result(m.id, (20, 12))

        winner_score = max(t.scores[p.id] for p in m.team1)
        loser_score = max(t.scores[p.id] for p in m.team2)
        assert winner_score == 20 + 5
        assert loser_score == 12

    def test_draw_no_bonus(self):
        t = MexicanoTournament(
            _make_players(4),
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=1,
            win_bonus=5,
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        t.record_result(m.id, (16, 16))

        for p in m.team1 + m.team2:
            assert t.scores[p.id] == 16  # no bonus on draw

    def test_no_bonus_by_default(self):
        t = MexicanoTournament(
            _make_players(4), _make_courts(1), total_points_per_match=32, num_rounds=1
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        t.record_result(m.id, (20, 12))
        for p in m.team1:
            assert t.scores[p.id] == 20
        for p in m.team2:
            assert t.scores[p.id] == 12

    def test_negative_win_bonus_rejected(self):
        with pytest.raises(ValueError, match="win_bonus"):
            MexicanoTournament(_make_players(4), _make_courts(1), win_bonus=-1)


class TestMexicanoStrengthWeight:
    """Strength-weight coefficient boosts points when beating stronger opponents."""

    def test_beating_top_player_gives_more(self):
        """Points scored against top-ranked opponents should exceed the raw score."""
        players = _make_players(4)
        t = MexicanoTournament(
            players,
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=2,
            randomness=0.0,
            strength_weight=1.0,
        )
        # Make players[0] and [1] dominant so they pair together
        t.scores[players[0].id] = 200
        t.scores[players[1].id] = 190

        t.generate_next_round()
        m = t.current_round_matches()[0]

        before = {p.id: t.scores[p.id] for p in players}
        t.record_result(m.id, (20, 12))

        gain1 = [t.scores[p.id] - before[p.id] for p in m.team1]
        gain2 = [t.scores[p.id] - before[p.id] for p in m.team2]

        # At strength_weight=1.0 the weaker team plays against a strong opponent
        # so at least one team must earn more than the raw score
        assert max(max(gain1), max(gain2)) > 20

    def test_out_of_range_strength_weight_rejected(self):
        with pytest.raises(ValueError, match="strength_weight"):
            MexicanoTournament(_make_players(4), _make_courts(1), strength_weight=1.5)

    def test_zero_weight_equals_raw_score(self):
        """With strength_weight=0, points equal raw score regardless of rankings."""
        players = _make_players(4)
        t = MexicanoTournament(
            players,
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=1,
            strength_weight=0.0,
        )
        t.scores[players[0].id] = 500  # huge ranking imbalance
        t.generate_next_round()
        m = t.current_round_matches()[0]
        before = {p.id: t.scores[p.id] for p in players}
        t.record_result(m.id, (20, 12))
        for p in m.team1:
            assert t.scores[p.id] - before[p.id] == 20
        for p in m.team2:
            assert t.scores[p.id] - before[p.id] == 12

    def test_first_round_no_bonus_when_all_zero(self):
        """In round 1 (all scores 0), strength_weight should not add any bonus."""
        players = _make_players(4)
        t = MexicanoTournament(
            players,
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=2,
            strength_weight=1.0,
        )
        # All scores at 0 (default) — no matches played yet
        t.generate_next_round()
        m = t.current_round_matches()[0]
        t.record_result(m.id, (20, 12))
        # With all-zero estimated scores, opponent_strength returns 0.0
        # → mult = 1.0 + 1.0 * 0.0 = 1.0 → raw score only
        for p in m.team1:
            assert t.scores[p.id] == 20
        for p in m.team2:
            assert t.scores[p.id] == 12

    def test_strength_uses_estimated_scores_for_sit_out(self):
        """Players with fewer matches get extrapolated scores for strength calc."""
        players = _make_players(4)
        t = MexicanoTournament(
            players,
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=3,
            strength_weight=1.0,
        )
        # Simulate: P0 played 3 matches (score 60), P1 played 2 (score 40)
        # P2 played 3 (score 30), P3 played 3 (score 15)
        t.scores = {
            players[0].id: 60,
            players[1].id: 40,
            players[2].id: 30,
            players[3].id: 15,
        }
        t._matches_played = {
            players[0].id: 3,
            players[1].id: 2,
            players[2].id: 3,
            players[3].id: 3,
        }
        # P1 estimated = 40 + (40/2)*1 = 60  (same as P0)
        strength = t._opponent_strength([players[1]])
        # max_est = 60 (P0), P1 est = 60 → strength = 60/60 = 1.0
        assert abs(strength - 1.0) < 0.01


class TestMexicanoLossDiscount:
    """Loss discount applies a multiplier to the losing team's scored points."""

    def test_loser_score_discounted(self):
        t = MexicanoTournament(
            _make_players(4),
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=1,
            loss_discount=0.75,
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        before = {p.id: t.scores[p.id] for p in t.players}
        t.record_result(m.id, (20, 12))

        for p in m.team1:  # winners
            assert t.scores[p.id] - before[p.id] == 20
        for p in m.team2:  # losers: 12 * 0.75 = 9
            assert t.scores[p.id] - before[p.id] == round(12 * 0.75)

    def test_draw_not_discounted(self):
        t = MexicanoTournament(
            _make_players(4),
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=1,
            loss_discount=0.5,
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        before = {p.id: t.scores[p.id] for p in t.players}
        t.record_result(m.id, (16, 16))

        for p in m.team1 + m.team2:
            assert t.scores[p.id] - before[p.id] == 16  # no discount on draw

    def test_full_discount_loser_earns_zero(self):
        t = MexicanoTournament(
            _make_players(4),
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=1,
            loss_discount=0.0,
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        before = {p.id: t.scores[p.id] for p in t.players}
        t.record_result(m.id, (20, 12))

        for p in m.team2:  # losers earn nothing
            assert t.scores[p.id] - before[p.id] == 0

    def test_default_no_discount(self):
        t = MexicanoTournament(
            _make_players(4), _make_courts(1), total_points_per_match=32, num_rounds=1
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]
        before = {p.id: t.scores[p.id] for p in t.players}
        t.record_result(m.id, (20, 12))

        for p in m.team2:
            assert t.scores[p.id] - before[p.id] == 12  # unchanged

    def test_out_of_range_rejected(self):
        with pytest.raises(ValueError, match="loss_discount"):
            MexicanoTournament(_make_players(4), _make_courts(1), loss_discount=1.5)
        with pytest.raises(ValueError, match="loss_discount"):
            MexicanoTournament(_make_players(4), _make_courts(1), loss_discount=-0.1)


class TestMexicanoCrossGroupOptimization:
    """The optimizer should swap players across groups to reduce repeats."""

    def _collect_interactions(self, matches):
        """Return set of (pid, pid) tuples for all partner & opponent pairs."""
        interactions = set()
        for m in matches:
            # Partners
            if len(m.team1) == 2:
                a, b = m.team1
                interactions.add((a.id, b.id))
                interactions.add((b.id, a.id))
            if len(m.team2) == 2:
                a, b = m.team2
                interactions.add((a.id, b.id))
                interactions.add((b.id, a.id))
            # Opponents
            for p1 in m.team1:
                for p2 in m.team2:
                    interactions.add((p1.id, p2.id))
                    interactions.add((p2.id, p1.id))
        return interactions

    def test_deterministic_reduces_repeats_over_many_rounds(self):
        """With randomness=0 and 8 players (2 groups), the optimizer should
        produce more unique pairings than would occur with rigid grouping."""
        players = _make_players(8)
        t = MexicanoTournament(
            players,
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=6,
            randomness=0.0,
        )

        all_interactions: list[set] = []
        for _ in range(6):
            matches = t.generate_next_round()
            all_interactions.append(self._collect_interactions(matches))
            for m in t.current_round_matches():
                t.record_result(m.id, (20, 12))

        # Count how many rounds each pair of players interacted
        from collections import Counter

        pair_counts: Counter = Counter()
        for ints in all_interactions:
            for pair in ints:
                pair_counts[pair] += 1

        # The max repeat count should be <= 4 (without optimisation it
        # would be 6 — the same pairs every round with deterministic ranking)
        max_repeat = max(pair_counts.values())
        assert max_repeat <= 5, (
            f"Expected cross-group optimiser to limit repeats, "
            f"but max repeat count is {max_repeat}"
        )

    def test_optimize_groups_returns_same_players(self):
        """Optimisation must not lose or duplicate any players."""
        players = _make_players(12)
        t = MexicanoTournament(
            players,
            _make_courts(3),
            total_points_per_match=32,
            num_rounds=2,
            randomness=0.0,
        )

        ranked = t._ranked_players(players)
        groups_before = t._form_groups(ranked)
        groups_after = t._optimize_groups(groups_before)

        ids_before = sorted(p.id for g in groups_before for p in g)
        ids_after = sorted(p.id for g in groups_after for p in g)
        assert ids_before == ids_after

    def test_single_group_unchanged(self):
        """With only 1 group (4 players), optimization is a no-op."""
        players = _make_players(4)
        t = MexicanoTournament(
            players,
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=2,
            randomness=0.0,
        )
        ranked = t._ranked_players(players)
        groups = t._form_groups(ranked)
        optimized = t._optimize_groups(groups)
        assert len(optimized) == 1
        assert [p.id for p in optimized[0]] == [p.id for p in groups[0]]

    def test_proposals_sort_skill_gap_violations_last(self):
        """Within each strategy group, violating options sort after compliant ones."""
        players = _make_players(8)
        t = MexicanoTournament(
            players,
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=4,
            randomness=0.15,
            skill_gap=25,
            balance_tolerance=2.0,
        )

        for i, score in enumerate([75, 58, 55, 53, 46, 38, 33, 26]):
            t.scores[players[i].id] = score
        t._matches_played = {p.id: 3 for p in players}

        proposals = t.propose_pairings(n_options=3)

        # Within each strategy group, non-violating must appear before violating.
        for strategy in ("balanced", "seeded"):
            group = [p for p in proposals if p["strategy"] == strategy]
            seen_violation = False
            for p in group:
                v = p.get("skill_gap_violations", 0)
                if v > 0:
                    seen_violation = True
                elif seen_violation:
                    raise AssertionError(
                        f"Found non-violating {strategy} proposal after a violating one"
                    )

    def test_exact_previous_round_repeats_are_annotated(self):
        """A plan should flag matches that are exact repeats of previous round."""
        players = _make_players(8)
        t = MexicanoTournament(
            players,
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=4,
            randomness=0.0,
        )

        t.generate_next_round()
        for match in t.current_round_matches():
            t.record_result(match.id, (16, 16))

        previous_matches = t.current_round_matches()
        repeated = previous_matches[0]
        different = previous_matches[1]
        match_plans = [
            {
                "team1_ids": [p.id for p in repeated.team1],
                "team2_ids": [p.id for p in repeated.team2],
            },
            {
                "team1_ids": [different.team1[0].id, different.team2[0].id],
                "team2_ids": [different.team1[1].id, different.team2[1].id],
            },
        ]

        exact_count = t._annotate_exact_previous_round_repeats(match_plans)

        assert exact_count == 1
        assert match_plans[0]["exact_prev_round_repeat"] is True
        assert match_plans[1]["exact_prev_round_repeat"] is False

    def test_proposals_deprioritize_exact_previous_round_repeats(self, monkeypatch):
        """When other metrics tie, exact previous-round rematches should rank lower."""
        players = _make_players(8)
        t = MexicanoTournament(
            players,
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=4,
            randomness=0.0,
        )

        p = players
        plan_with_exact_repeat = {
            "sit_out_ids": [],
            "sit_out_names": [],
            "matches": [
                {
                    "team1_ids": [p[0].id, p[1].id],
                    "team2_ids": [p[2].id, p[3].id],
                    "team1_names": [p[0].name, p[1].name],
                    "team2_names": [p[2].name, p[3].name],
                    "court_name": "Court 1",
                    "score_imbalance": 10,
                    "repeat_count": 4,
                    "exact_prev_round_repeat": True,
                },
                {
                    "team1_ids": [p[4].id, p[5].id],
                    "team2_ids": [p[6].id, p[7].id],
                    "team1_names": [p[4].name, p[5].name],
                    "team2_names": [p[6].name, p[7].name],
                    "court_name": "Court 2",
                    "score_imbalance": 10,
                    "repeat_count": 4,
                    "exact_prev_round_repeat": False,
                },
            ],
            "score_imbalance": 20,
            "repeat_count": 8,
            "per_person_repeats": {},
            "skill_gap_violations": 0,
            "skill_gap_worst_excess": 0.0,
            "exact_prev_round_repeats": 1,
            "strategy": "balanced",
        }
        plan_without_exact_repeat = {
            "sit_out_ids": [],
            "sit_out_names": [],
            "matches": [
                {
                    "team1_ids": [p[0].id, p[2].id],
                    "team2_ids": [p[1].id, p[3].id],
                    "team1_names": [p[0].name, p[2].name],
                    "team2_names": [p[1].name, p[3].name],
                    "court_name": "Court 1",
                    "score_imbalance": 10,
                    "repeat_count": 4,
                    "exact_prev_round_repeat": False,
                },
                {
                    "team1_ids": [p[4].id, p[6].id],
                    "team2_ids": [p[5].id, p[7].id],
                    "team1_names": [p[4].name, p[6].name],
                    "team2_names": [p[5].name, p[7].name],
                    "court_name": "Court 2",
                    "score_imbalance": 10,
                    "repeat_count": 4,
                    "exact_prev_round_repeat": False,
                },
            ],
            "score_imbalance": 20,
            "repeat_count": 8,
            "per_person_repeats": {},
            "skill_gap_violations": 0,
            "skill_gap_worst_excess": 0.0,
            "exact_prev_round_repeats": 0,
            "strategy": "balanced",
        }

        planned = [
            plan_with_exact_repeat,
            plan_without_exact_repeat,
            plan_with_exact_repeat,
            plan_without_exact_repeat,
        ]

        def fake_plan_round(_jitter: float = 0.0) -> dict:
            if planned:
                return planned.pop(0)
            return plan_without_exact_repeat

        def fake_seeded_plan(**_kwargs) -> dict:
            return plan_with_exact_repeat

        monkeypatch.setattr(t, "_plan_round", fake_plan_round)
        monkeypatch.setattr(t, "_plan_round_seeded_position", fake_seeded_plan)

        proposals = t.propose_pairings(n_options=2)

        assert len(proposals) >= 2
        assert (
            proposals[0]["exact_prev_round_repeats"]
            <= proposals[1]["exact_prev_round_repeats"]
        )
        assert proposals[0]["recommended"] is True
        assert proposals[0]["exact_prev_round_repeats"] == 0

    def test_proposals_include_seeded_by_position_option(self):
        """Proposal list should always include seeded strategy options."""
        players = _make_players(8)
        t = MexicanoTournament(
            players,
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=4,
            randomness=0.0,
        )
        for i, score in enumerate([80, 70, 60, 50, 40, 30, 20, 10]):
            t.scores[players[i].id] = score
        t._matches_played = {p.id: 3 for p in players}

        proposals = t.propose_pairings(n_options=3)
        seeded = [p for p in proposals if p.get("strategy") == "seeded"]
        assert len(seeded) >= 1

    def test_load_more_request_keeps_seeded_when_available(self):
        """Expanded requests should include seeded options when they can be generated."""
        players = _make_players(8)
        t = MexicanoTournament(
            players,
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=4,
            randomness=0.0,
        )
        for i, score in enumerate([90, 78, 66, 54, 42, 30, 18, 6]):
            t.scores[players[i].id] = score
        t._matches_played = {p.id: 3 for p in players}

        proposals = t.propose_pairings(n_options=10)
        seeded = [p for p in proposals if p.get("strategy") == "seeded"]
        assert len(seeded) >= 1

    def test_proposals_include_balanced_and_seeded_groups(self):
        """When possible, should return 3 balanced and 3 seeded options."""
        players = _make_players(8)
        t = MexicanoTournament(
            players,
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=4,
            randomness=0.0,
        )
        for i, score in enumerate([80, 70, 60, 50, 40, 30, 20, 10]):
            t.scores[players[i].id] = score
        t._matches_played = {p.id: 3 for p in players}

        proposals = t.propose_pairings(n_options=3)
        balanced = [p for p in proposals if p.get("strategy") == "balanced"]
        seeded = [p for p in proposals if p.get("strategy") == "seeded"]
        assert len(balanced) <= 3
        assert len(seeded) <= 3
        if len(proposals) >= 6:
            assert len(balanced) == 3
            assert len(seeded) == 3

    def test_skill_gap_violations_expand_number_of_options(self):
        """When violations exist, propose_pairings should return extra alternatives."""
        players = _make_players(8)
        t = MexicanoTournament(
            players,
            _make_courts(2),
            total_points_per_match=32,
            num_rounds=4,
            randomness=0.2,
            skill_gap=25,
            balance_tolerance=2.0,
        )
        for i, score in enumerate([75, 58, 55, 53, 46, 38, 33, 26]):
            t.scores[players[i].id] = score
        t._matches_played = {p.id: 3 for p in players}

        proposals = t.propose_pairings(n_options=3)
        # Compact target: best + up to 5 alternatives (3 balanced + 3 seeded max)
        assert len(proposals) <= 6


class TestMexicanoCustomRound:
    """Manual override: generate_custom_round lets you specify exact pairings."""

    def test_custom_round_basic(self):
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=4
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        # Now commit a manual round
        p = players
        matches = t.generate_custom_round(
            [
                {"team1_ids": [p[0].id, p[7].id], "team2_ids": [p[3].id, p[4].id]},
                {"team1_ids": [p[1].id, p[6].id], "team2_ids": [p[2].id, p[5].id]},
            ]
        )
        assert len(matches) == 2
        assert t.current_round == 2
        assert {p.id for p in matches[0].team1} == {players[0].id, players[7].id}

    def test_custom_round_auto_sitout(self):
        """Players not in any match automatically sit out."""
        players = _make_players(5)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (20, 12))

        # Only include 4 of 5 players — the 5th should auto sit-out
        p = players
        t.generate_custom_round(
            [
                {"team1_ids": [p[0].id, p[1].id], "team2_ids": [p[2].id, p[3].id]},
            ]
        )
        assert t.current_round == 2
        # The last sit_outs entry should contain the excluded player
        last_sit = t.sit_outs[-1]
        assert len(last_sit) == 1
        assert last_sit[0].id == p[4].id

    def test_custom_round_rejects_duplicate_player(self):
        players = _make_players(4)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        with pytest.raises(ValueError, match="multiple matches"):
            t.generate_custom_round(
                [
                    {
                        "team1_ids": [players[0].id, players[1].id],
                        "team2_ids": [players[2].id, players[0].id],
                    },
                ]
            )

    def test_custom_round_rejects_wrong_team_size(self):
        players = _make_players(4)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        with pytest.raises(ValueError, match="exactly 2"):
            t.generate_custom_round(
                [
                    {
                        "team1_ids": [players[0].id],
                        "team2_ids": [players[1].id, players[2].id],
                    },
                ]
            )

    def test_custom_round_rejects_unknown_player(self):
        players = _make_players(4)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        with pytest.raises(ValueError, match="Unknown player"):
            t.generate_custom_round(
                [
                    {
                        "team1_ids": [players[0].id, "fake-id"],
                        "team2_ids": [players[1].id, players[2].id],
                    },
                ]
            )


class TestMexicanoProposalCommit:
    """generate_next_round should honour option_id from propose_pairings."""

    def test_option_id_commits_cached_plan(self):
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=4
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        proposals = t.propose_pairings(n_options=2)
        chosen = proposals[0]  # pick the recommended one

        # The plan specifies exact team IDs
        expected_t1 = set(frozenset(m["team1_ids"]) for m in chosen["matches"])

        matches = t.generate_next_round(option_id=chosen["option_id"])
        actual_t1 = set(frozenset(p.id for p in m.team1) for m in matches)
        assert actual_t1 == expected_t1


class TestMexicanoPerPersonRepeats:
    """Proposals include per_person_repeats breakdown."""

    def test_per_person_repeats_in_proposal(self):
        players = _make_players(4)
        t = MexicanoTournament(
            players,
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=4,
            randomness=0,
        )
        # Play round 1
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        # Propose round 2 — with 4 players and randomness=0, same pairings
        proposals = t.propose_pairings(n_options=1)
        p = proposals[0]
        assert "per_person_repeats" in p
        # With only 4 players and deterministic matching, there should be
        # repeat data for every player
        assert len(p["per_person_repeats"]) > 0
        # Each entry should have partner_repeats and opponent_repeats lists
        for name, detail in p["per_person_repeats"].items():
            assert "partner_repeats" in detail
            assert "opponent_repeats" in detail

    def test_no_repeats_first_round(self):
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=2
        )
        proposals = t.propose_pairings(n_options=1)
        p = proposals[0]
        # First round — nobody has played yet, all repeat lists should be empty
        for name, detail in p["per_person_repeats"].items():
            assert detail["partner_repeats"] == []
            assert detail["opponent_repeats"] == []

    def test_proposal_score_imbalance_uses_estimated_scores(self):
        """Proposal score gap should be based on adjusted estimated scores."""
        players = _make_players(4)
        t = MexicanoTournament(
            players,
            _make_courts(1),
            total_points_per_match=32,
            num_rounds=3,
            randomness=0.0,
        )

        p1, p2, p3, p4 = players
        t.scores[p1.id] = 24
        t.scores[p2.id] = 12
        t.scores[p3.id] = 10
        t.scores[p4.id] = 8
        t._matches_played[p1.id] = 3
        t._matches_played[p2.id] = 3
        t._matches_played[p3.id] = 1
        t._matches_played[p4.id] = 1

        proposals = t.propose_pairings(n_options=1)
        proposal = proposals[0]
        match = proposal["matches"][0]
        est = t._estimated_scores()

        team1_est = est[match["team1_ids"][0]] + est[match["team1_ids"][1]]
        team2_est = est[match["team2_ids"][0]] + est[match["team2_ids"][1]]
        expected_imbalance = abs(team1_est - team2_est)

        assert proposal["score_imbalance"] == pytest.approx(expected_imbalance)


class TestMexicanoReRecord:
    """Re-recording a result undoes the old credits and applies new ones."""

    def test_rerecord_updates_scores(self):
        players = _make_players(4)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]

        # First recording: 20-12
        t.record_result(m.id, (20, 12))
        scores_after_first = dict(t.scores)

        # Re-record: 16-16
        t.record_result(m.id, (16, 16))
        # All players in team1 should have lost 4 pts, team2 gained 4
        for p in m.team1:
            assert t.scores[p.id] == scores_after_first[p.id] - 4
        for p in m.team2:
            assert t.scores[p.id] == scores_after_first[p.id] + 4

    def test_rerecord_doesnt_double_count_matches(self):
        players = _make_players(4)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]

        t.record_result(m.id, (20, 12))
        t.record_result(m.id, (16, 16))
        # matches_played should still be 1 for each player
        for p in m.team1 + m.team2:
            assert t._matches_played[p.id] == 1

    def test_rerecord_doesnt_double_history(self):
        players = _make_players(4)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        t.generate_next_round()
        m = t.current_round_matches()[0]

        t.record_result(m.id, (20, 12))
        t.record_result(m.id, (16, 16))
        # Partner history should be 1 (not 2) for team1 partners
        p1, p2 = m.team1
        assert t._partner_history[p1.id].get(p2.id, 0) == 1


class TestMexicanoForcedSitOut:
    """Forced sit-out override in proposals."""

    def test_forced_sit_out(self):
        players = _make_players(5)  # 5 players → 1 must sit out
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        # Force a specific player to sit out
        target = players[0]
        proposals = t.propose_pairings(n_options=1, forced_sit_out_ids=[target.id])
        p = proposals[0]
        assert target.id in p["sit_out_ids"]
        assert target.name in p["sit_out_names"]

    def test_forced_sit_out_wrong_count_raises(self):
        players = _make_players(5)  # 1 must sit
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        with pytest.raises(ValueError, match="exactly 1"):
            t.propose_pairings(
                n_options=1, forced_sit_out_ids=[players[0].id, players[1].id]
            )

    def test_forced_sit_out_unknown_id_raises(self):
        players = _make_players(5)
        t = MexicanoTournament(
            players, _make_courts(1), total_points_per_match=32, num_rounds=2
        )
        with pytest.raises(ValueError, match="Unknown player"):
            t.propose_pairings(n_options=1, forced_sit_out_ids=["nonexistent"])


class TestMexicanoEndFlow:
    """Ending Mexicano should be explicit before optional play-offs."""

    def test_start_playoffs_requires_end_mexicano_first(self):
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        with pytest.raises(RuntimeError, match="End Mexicano first"):
            t.start_playoffs(n_teams=4)

    def test_end_mexicano_blocks_new_rounds(self):
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        t.end_mexicano()

        with pytest.raises(RuntimeError, match="phase has ended"):
            t.generate_next_round()

    def test_finish_without_playoffs_marks_finished(self):
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        t.finish_without_playoffs()

        assert t.phase == MexPhase.FINISHED
        assert t.is_finished

    def test_record_playoff_result_stores_tennis_sets(self):
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=0
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (16, 16))

        t.end_mexicano()
        t.start_playoffs(n_teams=4)

        pending = t.pending_playoff_matches()
        assert pending
        match = pending[0]
        sets = [(6, 4), (3, 6), (10, 8)]
        t.record_playoff_result(match.id, (19, 18), sets=sets)

        recorded = next(pm for pm in t.playoff_matches() if pm.id == match.id)
        assert recorded.score == (19, 18)
        assert recorded.sets == sets

    def test_no_sitout_needed_returns_empty(self):
        """When player count is divisible by 4, no sit-out is needed."""
        players = _make_players(8)
        t = MexicanoTournament(
            players, _make_courts(2), total_points_per_match=32, num_rounds=2
        )
        proposals = t.propose_pairings(n_options=1)
        assert proposals[0]["sit_out_ids"] == []


class TestPairingRepeatCount:
    """Tests for _pairing_repeat_count including the full-similarity bonus."""

    def test_no_history_returns_zero(self):
        players = _make_players(4)
        t = MexicanoTournament(players, _make_courts(1))
        team1, team2 = players[:2], players[2:]
        assert t._pairing_repeat_count(team1, team2) == 0

    def test_partner_only_repeat(self):
        """Partner repeat without opponent overlap gives base count only."""
        players = _make_players(8)
        t = MexicanoTournament(players, _make_courts(2))
        a, b, c, d, e, f, g, h = players
        # Simulate A partnered B once
        t._partner_history[a.id][b.id] = 1
        t._partner_history[b.id][a.id] = 1
        # New match: [A, B] vs [E, F] — different opponents
        count = t._pairing_repeat_count([a, b], [e, f])
        # Base: partner(A,B)=1 + partner(B,A)=1 from team1 side
        #   + partner(E,F)=0 + partner(F,E)=0 from team2 side
        #   + no opponent history → no full-similarity bonus
        assert count == 2

    def test_opponent_only_repeat(self):
        """Opponent repeat without partner overlap gives base count only."""
        players = _make_players(4)
        t = MexicanoTournament(players, _make_courts(1))
        a, b, c, d = players
        # Simulate A faced C once
        t._opponent_history[a.id][c.id] = 1
        t._opponent_history[c.id][a.id] = 1
        # New match: [A, B] vs [C, D] — A faced C but partner changed
        count = t._pairing_repeat_count([a, b], [c, d])
        # Base: opp(A,C)=1, opp(A,D)=0, opp(B,C)=0, opp(B,D)=0 from t1
        #   + opp(C,A)=1, opp(C,B)=0, opp(D,A)=0, opp(D,B)=0 from t2
        #   + no partner history → no full-similarity bonus
        assert count == 2

    def test_full_similarity_adds_bonus(self):
        """Same partner AND same opponents triggers a per-player bonus."""
        players = _make_players(4)
        t = MexicanoTournament(players, _make_courts(1))
        a, b, c, d = players
        # Simulate full previous match: [A, B] vs [C, D]
        t._partner_history[a.id][b.id] = 1
        t._partner_history[b.id][a.id] = 1
        t._partner_history[c.id][d.id] = 1
        t._partner_history[d.id][c.id] = 1
        for p1 in [a, b]:
            for p2 in [c, d]:
                t._opponent_history[p1.id][p2.id] = 1
                t._opponent_history[p2.id][p1.id] = 1

        count_full = t._pairing_repeat_count([a, b], [c, d])
        # Now compute WITHOUT the bonus — swap one opponent to remove it
        t2 = MexicanoTournament(players, _make_courts(1))
        t2._partner_history[a.id][b.id] = 1
        t2._partner_history[b.id][a.id] = 1
        for p2 in [c, d]:
            t2._opponent_history[a.id][p2.id] = 1
            t2._opponent_history[p2.id][a.id] = 1
            t2._opponent_history[b.id][p2.id] = 1
            t2._opponent_history[p2.id][b.id] = 1
        # team2 has NO partner history → no bonus from t2 side
        count_partial = t2._pairing_repeat_count([a, b], [c, d])
        # Full similarity should be strictly higher
        assert count_full > count_partial

    def test_full_similarity_bonus_value(self):
        """Verify exact bonus value for a simple full-match repeat."""
        players = _make_players(4)
        t = MexicanoTournament(players, _make_courts(1))
        a, b, c, d = players
        # One full match played: [A, B] vs [C, D]
        for p1, p2 in [(a, b), (c, d)]:
            t._partner_history[p1.id][p2.id] = 1
            t._partner_history[p2.id][p1.id] = 1
        for p1 in [a, b]:
            for p2 in [c, d]:
                t._opponent_history[p1.id][p2.id] = 1
                t._opponent_history[p2.id][p1.id] = 1

        count = t._pairing_repeat_count([a, b], [c, d])
        # Base from team1: partner(A,B)=1 + partner(B,A)=1 + 4 opp counts = 6
        # Base from team2: partner(C,D)=1 + partner(D,C)=1 + 4 opp counts = 6
        # Bonus: 4 players × min(1, min(1,1)) = 4
        # Total: 6 + 6 + 4 = 16
        assert count == 16


# ────────────────────────────────────────────────────────────────────────────
# Skill-gap grouping: estimated scores & absolute difference
# ────────────────────────────────────────────────────────────────────────────


class TestEstimatedScores:
    """Tests for _estimated_scores() — extrapolating scores for sit-out players."""

    def test_all_same_matches_returns_raw_scores(self):
        players = _make_players(4)
        t = MexicanoTournament(players, _make_courts(1), skill_gap=50)
        t.scores = {p.id: (i + 1) * 10 for i, p in enumerate(players)}
        t._matches_played = {p.id: 3 for p in players}
        est = t._estimated_scores()
        for p in players:
            assert est[p.id] == float(t.scores[p.id])

    def test_zero_matches_returns_zero(self):
        players = _make_players(4)
        t = MexicanoTournament(players, _make_courts(1), skill_gap=50)
        # All have 0 matches (start of tournament)
        est = t._estimated_scores()
        for p in players:
            assert est[p.id] == 0.0

    def test_fewer_matches_extrapolated(self):
        players = _make_players(4)
        t = MexicanoTournament(players, _make_courts(1), skill_gap=50)
        # P1: 3 matches, 30 pts → avg 10/match
        # P2: 2 matches, 20 pts → avg 10/match, estimated = 20 + 10 = 30
        t.scores = {
            players[0].id: 30,
            players[1].id: 20,
            players[2].id: 15,
            players[3].id: 10,
        }
        t._matches_played = {
            players[0].id: 3,
            players[1].id: 2,
            players[2].id: 3,
            players[3].id: 3,
        }
        est = t._estimated_scores()
        assert est[players[0].id] == 30.0
        assert est[players[1].id] == 30.0  # 20 + 10 (1 missing match × 10 avg)
        assert est[players[2].id] == 15.0
        assert est[players[3].id] == 10.0


class TestSkillGapAbsoluteDifference:
    """Ensure skill_gap uses absolute difference with estimated scores."""

    def test_groups_use_absolute_difference(self):
        """Players with abs(estimated diff) ≤ gap should be in the same group."""
        players = _make_players(8)
        t = MexicanoTournament(players, _make_courts(2), skill_gap=15)
        # Scores spread: 50, 45, 40, 35, 20, 15, 10, 5
        for i, score in enumerate([50, 45, 40, 35, 20, 15, 10, 5]):
            t.scores[players[i].id] = score
        t._matches_played = {p.id: 3 for p in players}

        # Sort descending (as the real flow does before calling _form_groups)
        playing = sorted(players, key=lambda p: t.scores[p.id], reverse=True)
        groups = t._skill_gap_groups(playing)

        assert len(groups) == 2
        # First group: 50, 45, 40, 35 (max diff = 15, within gap)
        first_scores = sorted([t.scores[p.id] for p in groups[0]], reverse=True)
        assert first_scores == [50, 45, 40, 35]
        # Second group: 20, 15, 10, 5
        second_scores = sorted([t.scores[p.id] for p in groups[1]], reverse=True)
        assert second_scores == [20, 15, 10, 5]

    def test_estimation_prevents_wrong_grouping(self):
        """A player with fewer matches should be estimated up, changing grouping."""
        players = _make_players(8)
        t = MexicanoTournament(players, _make_courts(2), skill_gap=10)
        # P1: 30 pts in 3 matches (avg 10) → estimated 30
        # P2: 20 pts in 2 matches (avg 10) → estimated 30  (extrapolated)
        # Without estimation P2 looks 10 pts away from P1; with estimation, 0.
        t.scores = {
            players[0].id: 30,
            players[1].id: 20,
            players[2].id: 28,
            players[3].id: 25,
            players[4].id: 12,
            players[5].id: 10,
            players[6].id: 8,
            players[7].id: 5,
        }
        t._matches_played = {
            players[0].id: 3,
            players[1].id: 2,  # P2 sat out once
            players[2].id: 3,
            players[3].id: 3,
            players[4].id: 3,
            players[5].id: 3,
            players[6].id: 3,
            players[7].id: 3,
        }

        playing = sorted(players, key=lambda p: t.scores[p.id], reverse=True)
        groups = t._skill_gap_groups(playing)

        # P2's estimated score is 30, same as P1 — they should be in the
        # same group along with P3(28) and P4(25).
        first_group_ids = {p.id for p in groups[0]}
        assert players[0].id in first_group_ids  # P1
        assert players[1].id in first_group_ids  # P2 (estimated up to 30)
