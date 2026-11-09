#!/usr/bin/env python3
"""Fail when the Russian catalog breaks the controlled-Russian rules in docs/i18n/controlled-russian.md.

Usage: ``python scripts/check_ru_style.py`` (exit status 1 and a list on failure; long texts only warn).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "frontend" / "admin-app" / "src" / "locales" / "ru.json"
GLOSSARY = ROOT / "scripts" / "ru_glossary.json"
PLACEHOLDER = re.compile(r"\{\w+\}")
WORD = re.compile(r"[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*")
LATIN = re.compile(r"[A-Za-z]")
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
CAPITAL_YOU = re.compile(r"(?<![.!?:] )(?<!^)\b(?:Вы|Ваш\w*|Вас|Вам)\b")
MAX_WORDS = 20
# Words the glossary forbids for one concept but which are correct for another; review by hand.
AMBIGUOUS = {
    "игра", "встреча", "партия", "раунд", "круг", "тур", "пропуск", "простой", "ожидание", "поле",
    "ключ", "запись", "результат", "оценка", "сила", "уровень", "лига", "разряд", "снят", "сид",
    "док", "дока", "очередь", "пин", "отметить", "указать", "передать", "закончить", "окончить",
    "пароль", "админ", "администратор", "менеджер", "исключить", "послать", "направить", "поменять",
    "дерево", "кодовая фраза", "1/2 финала", "матч за третье место",
}  # fmt: skip
# Allowed uses of the fragments above do not need listing; this is for other deliberate exceptions.
ALLOWED: set[tuple[str, str]] = {("Annul results and withdraw", "аннулировать")}


def _has_fragment(text: str, fragment: str) -> bool:
    return re.search(rf"(?<![А-Яа-яЁёA-Za-z]){re.escape(fragment)}", text, re.I) is not None


def forbidden_terms(glossary: dict) -> list[str]:
    terms = [t for entry in glossary["concepts"] + glossary["verbs"] for t in entry["forbidden"]]
    terms += glossary["forbidden_bureaucratic"] + glossary["forbidden_anglicisms"]
    return sorted({t for t in terms if t.lower() not in AMBIGUOUS})


def problems_in(key: str, value: str, glossary: dict, forbidden: list[str]) -> list[str]:
    plain = PLACEHOLDER.sub("", value)
    found: list[str] = []
    for word in WORD.findall(plain):
        # QR-код and push-уведомление are fine: only a single part may not mix scripts.
        if any(LATIN.search(part) and CYRILLIC.search(part) for part in word.split("-")):
            found.append(f"mixed-script word {word!r}")
    for item in glossary["yo_words"]:
        if "note" not in item and re.search(rf"(?<![А-Яа-яЁё]){item['wrong']}(?![А-Яа-яЁё])", plain, re.I):
            found.append(f"needs ё: {item['wrong']!r} → {item['right']!r}")
    if '"' in plain:
        found.append("straight double quote; use « »")
    if "..." in plain:
        found.append("three dots; use …")
    if CAPITAL_YOU.search(plain):
        found.append("capital Вы or Ваш inside a sentence")
    for term in forbidden:
        if _has_fragment(plain, term) and (key, term) not in ALLOWED:
            found.append(f"forbidden term {term!r}")
    return found


def main() -> int:
    catalog: dict[str, str] = json.loads(CATALOG.read_text())
    glossary = json.loads(GLOSSARY.read_text())
    forbidden = forbidden_terms(glossary)
    failed = False
    for key, value in catalog.items():
        for problem in problems_in(key, value, glossary, forbidden):
            print(f"{problem}: {key!r} = {value!r}")
            failed = True
        longest = max(len(s.split()) for s in re.split(r"(?<=[.!?])\s+", value))
        if longest > MAX_WORDS:
            print(f"warning: sentence over {MAX_WORDS} words: {key!r}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
