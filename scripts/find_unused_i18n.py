#!/usr/bin/env python3
"""List i18n keys in frontend/i18n.js that no frontend file references.

A key counts as used when its name appears anywhere in frontend/*.js (other
than i18n.js) or frontend/*.html — as a literal `t('txt_…')` argument, a
`data-i18n*` attribute, or a string piece. Keys built dynamically by
concatenation (e.g. ``'txt_club_status_' + status``) are matched by their
longest literal prefix: pass ``--prefix txt_club_status_`` to whitelist such
families. Also reports keys present in only one language.

Usage: python scripts/find_unused_i18n.py [--prefix PREFIX ...]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"


def _catalog_keys(src: str) -> tuple[set[str], set[str]]:
    """Return (en_keys, es_keys) from the I18N_MESSAGES literal."""
    en_start = src.index("  en: {")
    es_start = src.index("  es: {")
    end = src.index("\n};", es_start)
    key_re = re.compile(r'^\s{4}"([^"]+)":', re.M)
    en = set(key_re.findall(src[en_start:es_start]))
    es = set(key_re.findall(src[es_start:end]))
    return en, es


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--prefix", action="append", default=[], help="treat keys with this prefix as used")
    args = parser.parse_args()

    i18n_src = (FRONTEND / "i18n.js").read_text(encoding="utf-8")
    en, es = _catalog_keys(i18n_src)
    corpus = "\n".join(
        p.read_text(encoding="utf-8")
        for p in sorted(FRONTEND.glob("*.js")) + sorted(FRONTEND.glob("*.html"))
        if p.name != "i18n.js"
    )
    unused = sorted(k for k in en | es if k not in corpus and not any(k.startswith(pfx) for pfx in args.prefix))
    only_en = sorted(en - es)
    only_es = sorted(es - en)

    for key in unused:
        print(f"unused: {key}")
    for key in only_en:
        print(f"en-only: {key}")
    for key in only_es:
        print(f"es-only: {key}")
    print(f"{len(unused)} unused, {len(only_en)} en-only, {len(only_es)} es-only ({len(en)} keys)", file=sys.stderr)
    return 1 if (unused or only_en or only_es) else 0


if __name__ == "__main__":
    raise SystemExit(main())
