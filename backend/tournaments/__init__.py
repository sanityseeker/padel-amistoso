"""
Tournament logic subpackage.

Re-exports the main classes so callers can do:
    from backend.tournaments import GroupPlayoffTournament, MexicanoTournament
"""

from __future__ import annotations

from .group_playoff import GroupPlayoffTournament
from .group_stage import Group, assign_courts, distribute_players_to_groups
from .mexicano import MexicanoTournament
from .playoff import DoubleEliminationBracket, SingleEliminationBracket

__all__ = [
    "Group",
    "assign_courts",
    "distribute_players_to_groups",
    "GroupPlayoffTournament",
    "MexicanoTournament",
    "SingleEliminationBracket",
    "DoubleEliminationBracket",
]
