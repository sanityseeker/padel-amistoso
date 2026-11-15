"""Bracket schema themes: light/dark images and the CSS-variable SVG the pages insert inline."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.models import EliminationType
from backend.viz import render_playoff_schema, render_schema

NAMES = ["Nik M & Pavel Zh", "Аля & Дарьяна", "Evgeny L & Anton", "Roman L & Дарьяна"]


def test_css_theme_is_svg_with_variables_and_text() -> None:
    svg = render_playoff_schema(NAMES, theme="css", fmt="png").decode()
    assert svg.lstrip().startswith("<?xml") and "<svg" in svg
    # Colours are CSS variables with a light fallback, and no placeholder colour survives.
    assert "var(--br-surface, #fafbfc)" in svg
    assert "var(--br-text, #0d1520)" in svg
    assert "#0b0c0" not in svg.lower()
    # Text stays text, in the page's font, so Cyrillic names are real characters.
    assert "<text" in svg and "Дарьяна" in svg
    assert "var(--br-font" in svg
    assert "<metadata>" not in svg


def test_css_theme_output_is_stable() -> None:
    assert render_playoff_schema(NAMES, theme="css") == render_playoff_schema(NAMES, theme="css")


def test_light_and_dark_differ() -> None:
    light = render_playoff_schema(NAMES, theme="light", fmt="png")
    dark = render_playoff_schema(NAMES, theme="dark", fmt="png")
    assert light[:4] == dark[:4] == b"\x89PNG"
    assert light != dark


def test_group_schema_accepts_every_theme() -> None:
    for theme in ("light", "dark", "css"):
        assert render_schema([4, 4], 2, EliminationType.DOUBLE, theme=theme)


def test_css_theme_escapes_team_names() -> None:
    svg = render_playoff_schema(["<script>alert(1)</script>", "B & C", "D", "E"], theme="css").decode()
    assert "<script" not in svg
    assert "&lt;script&gt;" in svg


def test_preview_route_css_theme_returns_svg(client: TestClient) -> None:
    r = client.get("/api/schema/playoff-preview", params={"participants": 4, "fmt": "png", "theme": "css"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/svg+xml")
    assert "var(--br-" in r.text


def test_preview_route_dark_png(client: TestClient) -> None:
    light = client.get("/api/schema/preview", params={"group_sizes": "4,4", "fmt": "png"})
    dark = client.get("/api/schema/preview", params={"group_sizes": "4,4", "fmt": "png", "theme": "dark"})
    assert light.status_code == dark.status_code == 200
    assert dark.headers["content-type"] == "image/png"
    assert light.content != dark.content


def test_preview_route_rejects_unknown_theme(client: TestClient) -> None:
    r = client.get("/api/schema/playoff-preview", params={"participants": 4, "theme": "neon"})
    assert r.status_code == 422


def test_post_preview_dark(client: TestClient) -> None:
    r = client.post("/api/schema/preview", json={"group_sizes": [4, 4], "theme": "dark"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
