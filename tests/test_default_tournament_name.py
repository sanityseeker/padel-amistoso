"""Auto-generated tournament names must name the sport they are for."""

from __future__ import annotations

import pytest

from backend.api.schemas import (
    CreateGroupPlayoffRequest,
    CreateMexicanoRequest,
    CreatePlayoffRequest,
    RegistrationCreate,
)

FOUR_PLAYERS = ["A", "B", "C", "D"]


@pytest.mark.parametrize(
    ("factory", "kwargs", "expected"),
    [
        (CreateGroupPlayoffRequest, {"player_names": ["A", "B"]}, "My Padel Tournament"),
        (
            CreateGroupPlayoffRequest,
            {"player_names": ["A", "B"], "sport": "tennis"},
            "My Tennis Tournament",
        ),
        (CreateMexicanoRequest, {"player_names": FOUR_PLAYERS, "sport": "tennis"}, "My Tennis Mexicano"),
        (
            CreatePlayoffRequest,
            {"participant_names": ["A", "B"], "name": "   ", "sport": "tennis"},
            "My Tennis Play-off",
        ),
        (RegistrationCreate, {"sport": "tennis"}, "My Tennis Tournament"),
        (RegistrationCreate, {"sport": "padel"}, "My Padel Tournament"),
    ],
)
def test_missing_or_blank_name_uses_sport(factory: type, kwargs: dict, expected: str) -> None:
    assert factory(**kwargs).name == expected


def test_explicit_name_is_kept() -> None:
    assert CreateMexicanoRequest(player_names=FOUR_PLAYERS, sport="tennis", name="Liga").name == "Liga"
    assert RegistrationCreate(name="Liga", sport="tennis").name == "Liga"
