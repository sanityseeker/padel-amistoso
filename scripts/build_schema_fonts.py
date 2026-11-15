#!/usr/bin/env python3
"""Build the static Onest TTFs in backend/viz/fonts/ from the app's variable woff2 files.

The bracket renderer (backend/viz/bracket_schema.py) draws with these. One family per unicode subset;
matplotlib falls back from one to the next. Run after `npm ci` in frontend/admin-app:

    uv run python scripts/build_schema_fonts.py
"""

from __future__ import annotations

from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = Path("frontend/admin-app/node_modules/@fontsource-variable/onest/files")
DST = Path("backend/viz/fonts")
SUBSETS = {
    "latin": "Onest",
    "latin-ext": "Onest LatinExt",
    "cyrillic": "Onest Cyrillic",
    "cyrillic-ext": "Onest CyrillicExt",
}
for subset, family in SUBSETS.items():
    for wght, style in ((400, "Regular"), (700, "Bold")):
        f = instancer.instantiateVariableFont(TTFont(SRC / f"onest-{subset}-wght-normal.woff2"), {"wght": wght})
        f.flavor = None
        name = f["name"]
        for rec in list(name.names):
            ids = (rec.platformID, rec.platEncID, rec.langID)
            if rec.nameID in (1, 16):
                name.setName(family, rec.nameID, *ids)
            elif rec.nameID in (2, 17):
                name.setName(style, rec.nameID, *ids)
            elif rec.nameID in (4, 6):
                name.setName(
                    f"{family} {style}" if rec.nameID == 4 else f"{family.replace(' ', '')}-{style}", rec.nameID, *ids
                )
        f["OS/2"].usWeightClass = wght
        f.save(DST / f"{family.replace(' ', '')}-{style}.ttf")
