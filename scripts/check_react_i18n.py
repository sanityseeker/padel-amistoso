#!/usr/bin/env python3
"""Fail when the React catalogs are incomplete or their placeholders do not match the English key.

Usage: ``python scripts/check_react_i18n.py`` (exit status 1 and a list on failure).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "frontend" / "admin-app" / "src"
CALL = re.compile(r"""\btx?\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)""")
PLACEHOLDER = re.compile(r"\{\w+\}")
PLURAL_SUFFIXES = ("_one", "_few", "_many", "_other")
LOCALES = ("es", "ru")
# Keys read through i18next `context`, which used_keys() cannot see. Spanish falls back to the plain key.
RU_CONTEXT_KEYS = (
    "Score_action",
    "Open_status",
    "Round_knockout",
    "L_bracket",
    "W_bracket",
    "PF_games",
    "PA_games",
    "Diff_games",
    "Points for_games",
    "Points against_games",
    "Point difference_games",
)


def used_keys() -> set[str]:
    keys: set[str] = set()
    for path in [*SRC.rglob("*.ts"), *SRC.rglob("*.tsx")]:
        for match in CALL.finditer(path.read_text()):
            raw = next(group for group in match.groups() if group is not None)
            keys.add(raw.replace("\\n", "\n").replace("\\'", "'").replace('\\"', '"'))
    return keys


def _catalog(locale: str) -> dict[str, str]:
    return json.loads((SRC / "locales" / f"{locale}.json").read_text())


def missing_keys(locale: str = "es") -> list[str]:
    catalog = _catalog(locale)
    required = used_keys()
    if locale != "es":
        required |= set(_catalog("es")) | set(RU_CONTEXT_KEYS)
    return sorted(key for key in required if key not in catalog)


def _source_of(key: str) -> str:
    """The English text a key stands for: context keys carry a suffix after the text."""
    for context in ("_games", "_knockout", "_action", "_status", "_bracket"):
        if key.endswith(context):
            return key.removesuffix(context)
    return key


def placeholder_mismatches(locale: str) -> list[str]:
    return sorted(
        key
        for key, value in _catalog(locale).items()
        if sorted(PLACEHOLDER.findall(_source_of(key))) != sorted(PLACEHOLDER.findall(value))
    )


def incomplete_plurals(locale: str) -> list[str]:
    catalog = _catalog(locale)
    stems = {k.rsplit("_", 1)[0] for k in catalog if k.endswith(PLURAL_SUFFIXES)}
    return sorted(stem for stem in stems if any(stem + s not in catalog for s in PLURAL_SUFFIXES))


def main() -> int:
    failed = False
    for locale in LOCALES:
        problems = [
            *(f"missing {locale}.json entry: {key!r}" for key in missing_keys(locale)),
            *(f"placeholder mismatch in {locale}.json: {key!r}" for key in placeholder_mismatches(locale)),
            *(
                f"incomplete plural set in {locale}.json: {key!r}"
                for key in incomplete_plurals(locale)
                if locale == "ru"
            ),
        ]
        for problem in problems:
            print(problem)
        failed = failed or bool(problems)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
