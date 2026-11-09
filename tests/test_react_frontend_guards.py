"""Source-level guards for the React SPA, which holds two independent sessions in one runtime."""

import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "frontend" / "admin-app" / "src"


def test_player_api_never_reads_the_admin_token() -> None:
    source = (SRC / "player" / "api.ts").read_text()
    assert "padel-auth-token" not in source
    assert "TOKEN_KEY" not in source


def test_admin_api_never_reads_the_player_token() -> None:
    source = (SRC / "api.ts").read_text()
    assert "padel-player-profile" not in source


def test_public_events_api_is_anonymous() -> None:
    source = (SRC / "events" / "api.ts").read_text()
    assert "padel-auth-token" not in source
    assert "credentials: 'omit'" in source


def test_admin_logout_only_removes_admin_queries() -> None:
    source = (SRC / "auth.tsx").read_text()
    assert "client.clear()" not in source
    assert "queryKey: ['admin']" in source


def test_every_react_ui_string_has_a_spanish_translation() -> None:
    import importlib.util

    script = Path(__file__).resolve().parent.parent / "scripts" / "check_react_i18n.py"
    spec = importlib.util.spec_from_file_location("check_react_i18n", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.missing_keys() == []


def _i18n_checker():
    import importlib.util

    script = Path(__file__).resolve().parent.parent / "scripts" / "check_react_i18n.py"
    spec = importlib.util.spec_from_file_location("check_react_i18n", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_russian_catalog_is_complete_and_keeps_placeholders() -> None:
    # fallbackLng hides gaps at runtime, so a missing key would silently show English.
    checker = _i18n_checker()
    assert checker.missing_keys("ru") == []
    assert checker.placeholder_mismatches("ru") == []
    assert checker.placeholder_mismatches("es") == []
    assert checker.incomplete_plurals("ru") == []


def test_info_guide_russian_matches_english_keys_and_html() -> None:
    source = (SRC / "features" / "info" / "catalog.ts").read_text()
    en = source[source.index("  en: {\n") : source.index("  es: {\n")]
    ru = source[source.index("  ru: {\n") :]
    entry = re.compile(r"^\s+(txt_\w+):\s*'((?:[^'\\]|\\.)*)'", re.M)
    english, russian = dict(entry.findall(en)), dict(entry.findall(ru))
    assert english.keys() == russian.keys()
    tags = re.compile(r"</?\w+[^>]*>")
    assert [k for k in english if sorted(tags.findall(english[k])) != sorted(tags.findall(russian[k]))] == []


def test_score_and_registration_errors_are_translated() -> None:
    # The client translates an API error by its exact English text, so editing a detail breaks it.
    import ast
    import json

    root = SRC.parents[2]
    details: set[str] = set()
    for name in ("routes_score_actions.py", "routes_registration.py"):
        for node in ast.walk(ast.parse((root / "backend" / "api" / name).read_text())):
            if (
                isinstance(node, ast.Call)
                and getattr(node.func, "id", getattr(node.func, "attr", "")) == "HTTPException"
            ):
                values = [k.value for k in node.keywords if k.arg == "detail"] + list(node.args[1:2])
                details |= {v.value for v in values if isinstance(v, ast.Constant) and isinstance(v.value, str)}
    assert details
    for locale in ("es", "ru"):
        catalog = json.loads((SRC / "locales" / f"{locale}.json").read_text())
        assert sorted(details - catalog.keys()) == []


def test_round_labels_cover_the_engine_names() -> None:
    source = (SRC / "roundLabel.ts").read_text()
    root = SRC.parents[2]
    engine = (root / "backend" / "tournaments" / "playoff.py").read_text()
    for label in ("Semi-Final", "Quarter-Final", "Grand Final", "Super Final", "3rd Place"):
        assert label in engine
        assert f"tx('{label}')" in source


# ---- CSS budget (Phase 7) ----------------------------------------------------------------------
# Styling lives in the Mantine theme (src/theme) and in CSS modules next to their components. The only
# global stylesheets are src/app.css and the player-codes print sheet, and together they stay small.

GLOBAL_CSS_LINE_BUDGET = 80
MANTINE_SELECTOR = re.compile(r"(?<![\w-])\.mantine-[A-Za-z]")


def _global_css_files() -> list[Path]:
    return sorted(
        path
        for path in SRC.rglob("*.css")
        # Modules are scoped; src/theme holds the theme's own sheets (fonts, component variants).
        if not path.name.endswith(".module.css") and "theme" not in path.relative_to(SRC).parts
    )


def test_global_css_stays_within_budget() -> None:
    files = _global_css_files()
    assert files, "expected src/app.css"
    lines = sum(len(path.read_text().splitlines()) for path in files)
    names = ", ".join(str(p.relative_to(SRC)) for p in files)
    assert lines <= GLOBAL_CSS_LINE_BUDGET, (
        f"global CSS is {lines} lines ({names}); the budget is {GLOBAL_CSS_LINE_BUDGET}. "
        "Move rules into the theme (src/theme) or a CSS module."
    )


def test_no_mantine_class_selectors_outside_the_theme() -> None:
    offenders = [
        f"{path.relative_to(SRC)}:{number}"
        for path in SRC.rglob("*")
        if path.suffix in {".css", ".ts", ".tsx"} and "theme" not in path.relative_to(SRC).parts
        for number, line in enumerate(path.read_text().splitlines(), start=1)
        if MANTINE_SELECTOR.search(line)
    ]
    assert offenders == [], f"`.mantine-*` selectors belong in src/theme only: {offenders}"


# ---- No links to the old interface -------------------------------------------------------------
# The vanilla pages are still served under /legacy/* (and as the no-build fallback), but nothing in
# the React app may send a user there: no href, redirect target, menu item, command or help text.
# No exceptions are needed today. If one is ever justified, add the file to LEGACY_PATH_EXCEPTIONS
# with the reason, so the exception is visible in review.

LEGACY_PATH = re.compile(r"/legacy(?![\w-]*\.)(?=[/\"'`?#\s)]|$)|/legacy-(?:admin|events|player)\b")
LEGACY_PATH_EXCEPTIONS: dict[str, str] = {}


def test_react_app_never_links_to_the_legacy_interface() -> None:
    offenders = [
        f"{rel}:{number}: {line.strip()}"
        for path in SRC.rglob("*")
        if path.suffix in {".ts", ".tsx", ".json", ".css"}
        for rel in [str(path.relative_to(SRC))]
        if rel not in LEGACY_PATH_EXCEPTIONS
        for number, line in enumerate(path.read_text().splitlines(), start=1)
        if LEGACY_PATH.search(line)
    ]
    assert offenders == [], f"the React app must not link to the old interface: {offenders}"


def test_pwa_manifest_and_service_worker_do_not_point_at_legacy_pages() -> None:
    frontend = SRC.parent.parent
    for name in ("manifest.json", "service-worker.js"):
        assert "/legacy" not in (frontend / name).read_text(), name
