"""Bracket schema themes: light/dark images and the CSS-variable SVG the pages insert inline."""

from __future__ import annotations

import html
import re

import pytest
from fastapi.testclient import TestClient

from backend.api.helpers import _build_match_labels
from backend.models import EliminationType, Player
from backend.tournaments import PlayoffTournament
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


# ── Label styling: bold scores in rows, muted losers ────────────────────────

_TEXT_RE = re.compile(r'<text style="([^"]*)"[^>]*>([^<]*)</text>')
MUTED = "var(--br-muted"
TEXT = "var(--br-text"


def _texts(svg: str) -> dict[str, list[str]]:
    """Text content -> the style strings of every ``<text>`` element with it."""
    out: dict[str, list[str]] = {}
    for style, content in _TEXT_RE.findall(svg):
        out.setdefault(html.unescape(content), []).append(style)
    return out


def _one(texts: dict[str, list[str]], content: str) -> str:
    assert len(texts[content]) == 1, f"{content!r} drawn {len(texts[content])} times"
    return texts[content][0]


def _final_labels(**over: object) -> dict[str, dict]:
    # 4 participants: semi-finals match_r0_p0/p1 feed the final match_r1_p0.
    base = {
        "team1": "Nik M & Pavel Zh",
        "team2": "Аля & Дарьяна",
        "score": "6-3  6-4",
        "score_sides": [["6", "6"], ["3", "4"]],
        "round": "Final",
    }
    return {"match_r1_p0": {**base, "walkover_loser": None, "loser_side": "team2", **over}}


def _css(labels: dict[str, dict] | None, **kw: object) -> dict[str, list[str]]:
    return _texts(render_playoff_schema(NAMES, theme="css", match_labels=labels, **kw).decode())


def test_scores_are_bold_names_are_regular_and_scores_follow_their_team() -> None:
    t = _css(_final_labels())
    assert len(t["6"]) == 2 and len(t["3"]) == 1 and len(t["4"]) == 1
    assert all("font-weight: 700" in s for key in ("6", "3", "4") for s in t[key])
    for name in ("Nik M &", "Pavel Zh", "Аля &", "Дарьяна"):
        assert "font-weight" not in _one(t, name)


def test_loser_names_and_scores_are_muted_winner_is_not() -> None:
    t = _css(_final_labels())
    for name in ("Nik M &", "Pavel Zh"):
        assert f"fill: {TEXT}" in _one(t, name)
    for name in ("Аля &", "Дарьяна"):  # Cyrillic doubles: both lines of the losing team
        style = _one(t, name)
        assert f"fill: {MUTED}" in style and "line-through" not in style
    assert all(f"fill: {TEXT}" in s for s in t["6"])  # winner's scores
    assert f"fill: {MUTED}" in _one(t, "3") and "font-weight: 700" in _one(t, "3")


def test_team1_loser_is_muted() -> None:
    t = _css(_final_labels(loser_side="team1", score_sides=[["3", "4"], ["6", "6"]]))
    assert f"fill: {MUTED}" in _one(t, "Nik M &")
    assert f"fill: {TEXT}" in _one(t, "Дарьяна")


def test_single_number_score_is_one_number_per_side() -> None:
    t = _css(_final_labels(score_sides=[["24"], ["8"]]))
    assert "font-weight: 700" in _one(t, "24") and "font-weight: 700" in _one(t, "8")


def test_walkover_loser_is_muted_struck_with_wo_on_its_row() -> None:
    labels = _final_labels(score="W/O", score_sides=[[], ["W/O"]], walkover_loser="team2")
    svg = render_playoff_schema(NAMES, theme="css", match_labels=labels).decode()
    plain = render_playoff_schema(NAMES, theme="css", match_labels=_final_labels(walkover_loser=None)).decode()
    t = _texts(svg)
    assert f"fill: {MUTED}" in _one(t, "Дарьяна")
    assert "font-weight: 700" in _one(t, "W/O")
    # One strike path per name line of the withdrawn side (two players, two lines).
    strikes = lambda s: len(re.findall(r"stroke: var\(--br-muted, #4a5a6e\); stroke-width: [\d.]+\"/>", s))  # noqa: E731
    assert strikes(svg) == strikes(plain) + 2


def test_pending_match_has_no_scores_no_vs_and_nothing_muted() -> None:
    t = _css(_final_labels(score=None, score_sides=None, loser_side=None))
    assert "vs" not in t
    for name in ("Nik M &", "Pavel Zh", "Аля &", "Дарьяна"):
        assert f"fill: {TEXT}" in _one(t, name)
    assert not any("font-weight: 700" in s for key, styles in t.items() for s in styles if key.isdigit())


def test_no_loser_side_means_nothing_muted() -> None:
    t = _css(_final_labels(loser_side=None))
    for name in ("Nik M &", "Pavel Zh", "Аля &", "Дарьяна"):
        assert f"fill: {TEXT}" in _one(t, name)


def test_each_name_is_drawn_once() -> None:
    t = _css(_final_labels())
    for name in ("Nik M &", "Pavel Zh", "Аля &", "Дарьяна"):
        assert len(t[name]) == 1


def test_css_theme_output_is_stable_with_labels() -> None:
    labels = _final_labels()
    assert render_playoff_schema(NAMES, theme="css", match_labels=labels) == render_playoff_schema(
        NAMES, theme="css", match_labels=labels
    )


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_labelled_png_smoke(theme: str) -> None:
    labels = _final_labels(score="W/O", score_sides=[[], ["W/O"]], walkover_loser="team2")
    assert render_playoff_schema(NAMES, theme=theme, fmt="png", match_labels=labels)[:4] == b"\x89PNG"  # type: ignore[arg-type]


def test_long_names_are_cut_to_leave_room_for_scores() -> None:
    long = "Maximiliano Alejandro Fernandez-Gonzalez"
    t = _css(_final_labels(team1=long, score_sides=[["6", "6", "[10]"], ["3", "4", "[8]"]]))
    cut = [k for k in t if k.startswith("Maximil")]
    assert cut and all(len(k) < len(long) for k in cut)
    assert "[10]" in t and "[8]" in t


# ── _build_match_labels: loser_side ──────────────────────────────────────────


def _po(n: int, **kw: object) -> PlayoffTournament:
    return PlayoffTournament([[Player(name=f"P{i}", id=f"p{i}")] for i in range(n)], **kw)  # type: ignore[arg-type]


def test_loser_side_set_for_completed_none_for_pending() -> None:
    t = _po(4, third_place=True)
    first, second = t.bracket.pending_matches()
    t.record_result(first.id, (6, 2))
    labels = _build_match_labels(t.bracket)
    done = [v for v in labels.values() if v["score"]]
    assert [v["loser_side"] for v in done] == ["team2"]
    assert all(v["loser_side"] is None for v in labels.values() if not v["score"])
    t.record_result(second.id, (3, 6))
    labels = _build_match_labels(t.bracket)
    assert sorted(v["loser_side"] for v in labels.values() if v["score"]) == ["team1", "team2"]
    # The 3rd-place match key is present and pending, so None.
    assert labels["third_place"]["loser_side"] is None


def test_loser_side_on_third_place_and_final_after_play() -> None:
    t = _po(4, third_place=True)
    while t.bracket.pending_matches():
        t.record_result(t.bracket.pending_matches()[0].id, (6, 4))
    labels = _build_match_labels(t.bracket)
    assert labels["third_place"]["loser_side"] == "team2"
    assert labels["match_r1_p0"]["loser_side"] == "team2"


def test_loser_side_on_double_elim_grand_final() -> None:
    t = _po(4, double_elimination=True)
    while t.bracket.pending_matches():
        t.record_result(t.bracket.pending_matches()[0].id, (6, 4))
    gf = _build_match_labels(t.bracket)["grand_final"]
    assert gf["loser_side"] == "team2" and "loser_side" in gf


def test_loser_side_follows_sets_won_not_games() -> None:
    t = _po(2)
    m = t.bracket.pending_matches()[0]
    t.record_result(m.id, (1, 2))
    entry = next(iter(_build_match_labels(t.bracket).values()))
    assert entry["loser_side"] == "team1" and entry["loser"] == "P0"


# ── Scaling: name size, data-text-pt, rounds trim ────────────────────────────


def _po_labels(n: int, double: bool = False) -> tuple[list[str], dict[str, dict]]:
    t = _po(n, double_elimination=double)
    br = t.bracket
    return [" & ".join(p.name for p in team) for team in br.original_teams], _build_match_labels(br)


def _name_px(svg: str) -> float:
    """Largest font size among the plain texts: the names (headers and stage labels are italic, scores bold)."""
    sizes = [
        float(size)
        for style, size in re.findall(r'<text style="([^"]*?font-size: ([\d.]+)px[^"]*)"', svg)
        if "italic" not in style and "font-weight" not in style
    ]
    return max(sizes)


def _viewbox(svg: str) -> tuple[float, float]:
    w, h = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg).groups()  # type: ignore[union-attr]
    return float(w), float(h)


def _text_pt(svg: str) -> float:
    return float(re.search(r'data-text-pt="([\d.]+)"', svg).group(1))  # type: ignore[union-attr]


@pytest.mark.parametrize("n", [4, 8, 16, 32])
def test_single_elim_name_size_is_constant(n: int) -> None:
    names, labels = _po_labels(n)
    svg = render_playoff_schema(names, theme="css", match_labels=labels).decode()
    assert abs(_text_pt(svg) - 14) <= 0.5
    # Names are drawn at that size (a few may be shrunk by up to 20% to fit).
    assert abs(_name_px(svg) - 14) <= 0.5


@pytest.mark.parametrize("n", [4, 8, 16, 32])
@pytest.mark.parametrize("side", ["winners", "losers"])
def test_double_elim_sides_name_size_is_constant(n: int, side: str) -> None:
    names, labels = _po_labels(n, double=True)
    svg = render_playoff_schema(names, EliminationType.DOUBLE, theme="css", match_labels=labels, side=side).decode()
    assert abs(_text_pt(svg) - 14) <= 0.5


def test_text_pt_scales_with_box_scale() -> None:
    names, labels = _po_labels(8)
    svg = render_playoff_schema(names, theme="css", match_labels=labels, box_scale=1.5).decode()
    assert abs(_text_pt(svg) - 21) <= 0.75


# Column step: a team box (2.3 units) plus a short gap (0.32 units), 93.6 pt per unit: about 245 pt.
COLUMN_STEP_PT = (2.3 + 0.32) * 93.6


def test_canvas_width_grows_per_round() -> None:
    widths = {}
    for n in (4, 8, 16, 32):
        names, labels = _po_labels(n)
        widths[n] = _viewbox(render_playoff_schema(names, theme="css", match_labels=labels).decode())[0]
    # 4 and 8 teams sit at the minimum canvas width; from 8 up each round adds one column step.
    for small, big in ((8, 16), (16, 32)):
        assert abs((widths[big] - widths[small]) - COLUMN_STEP_PT) <= COLUMN_STEP_PT * 0.1


# 16 teams, labelled, before the compact layout (fixed 1.8-unit boxes, spacing from the dropped
# participant column, 3.0-unit columns): the viewBox was 1209.6 x 2083.68 pt.
OLD_16_SINGLES_HEIGHT = 2083.68


def test_16_team_bracket_height_drops_substantially() -> None:
    names, labels = _po_labels(16)
    height = _viewbox(render_playoff_schema(names, theme="css", match_labels=labels).decode())[1]
    assert height < OLD_16_SINGLES_HEIGHT * 0.55
    doubles = _viewbox(_doubles_svg(16))[1]
    assert doubles < OLD_16_SINGLES_HEIGHT * 0.7


def _doubles_svg(n: int, **kw: object) -> str:
    t = PlayoffTournament([[Player(name=f"P{i} A", id=f"a{i}"), Player(name=f"P{i} B", id=f"b{i}")] for i in range(n)])
    br = t.bracket
    return render_playoff_schema(
        [" & ".join(p.name for p in team) for team in br.original_teams],
        theme="css",
        match_labels=_build_match_labels(br),
        **kw,  # type: ignore[arg-type]
    ).decode()


def _boxes(svg: str) -> list[tuple[float, float, float, float]]:
    """Team boxes and other node boxes: filled paths with the 2 pt node outline."""
    out = []
    for d, style in re.findall(r'<path d="([^"]*)"[^>]*style="([^"]*)"', svg):
        if "stroke-width: 2" in style and "fill: var(" in style:
            nums = [float(x) for x in re.findall(r"-?\d+\.?\d*", d)]
            xs, ys = nums[0::2], nums[1::2]
            out.append((min(xs), min(ys), max(xs), max(ys)))
    return out


def _overlaps(boxes: list[tuple[float, float, float, float]]) -> int:
    return sum(
        a[0] < b[2] - 1 and b[0] < a[2] - 1 and a[1] < b[3] - 1 and b[1] < a[3] - 1
        for i, a in enumerate(boxes)
        for b in boxes[i + 1 :]
    )


def _play(t: PlayoffTournament, count: int) -> None:
    for i in range(count):
        pending = t.bracket.pending_matches()
        if not pending:
            return
        t.record_result(pending[0].id, (6, 2) if i % 2 == 0 else (3, 6))


@pytest.mark.parametrize("n", [4, 8, 16, 32])
@pytest.mark.parametrize("doubles", [False, True])
def test_boxes_do_not_overlap_and_text_stays_inside(n: int, doubles: bool) -> None:
    team = (
        (lambda i: [Player(name=f"P{i} A", id=f"a{i}"), Player(name=f"P{i} B", id=f"b{i}")])
        if doubles
        else (lambda i: [Player(name=f"Player {i}", id=f"p{i}")])
    )
    t = PlayoffTournament([team(i) for i in range(n)])
    _play(t, n // 2 + 1)
    br = t.bracket
    svg = render_playoff_schema(
        [" & ".join(p.name for p in tm) for tm in br.original_teams], theme="css", match_labels=_build_match_labels(br)
    ).decode()
    boxes = _boxes(svg)
    assert len(boxes) >= n - 1
    assert _overlaps(boxes) == 0
    _assert_texts_inside(svg, boxes)


def _assert_texts_inside(svg: str, boxes: list[tuple[float, float, float, float]]) -> None:
    from matplotlib import font_manager, rc_context

    from backend.viz import bracket_schema as bs

    with rc_context(bs._rc("css")):
        for style, x, y, content in re.findall(
            r'<text style="([^"]*)" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)</text>', svg
        ):
            if "italic" in style:  # round headers and stage labels
                continue
            size = float(re.search(r"font-size: ([\d.]+)px", style).group(1))  # type: ignore[union-attr]
            weight = "bold" if "font-weight: 700" in style else "normal"
            fx, fy = float(x), float(y)
            width = bs.plt.matplotlib.textpath.text_to_path.get_text_width_height_descent(
                html.unescape(content), font_manager.FontProperties(size=size, weight=weight), False
            )[0]
            anchor = re.search(r"text-anchor: (\w+)", style)
            kind = anchor.group(1) if anchor else "start"
            x0 = fx - width if kind == "end" else fx - width / 2 if kind == "middle" else fx
            x1 = x0 + width
            hit = [b for b in boxes if b[0] - 0.5 <= x0 and x1 <= b[2] + 0.5 and b[1] <= fy <= b[3]]
            assert hit, f"{content!r} at x {x0:.0f}-{x1:.0f}, baseline {fy:.0f} is outside every box"


def test_double_elimination_sides_do_not_overlap() -> None:
    for side in ("winners", "losers"):
        for double_n in (8, 16):
            names, labels = _po_labels(double_n, double=True)
            svg = render_playoff_schema(
                names, EliminationType.DOUBLE, theme="css", match_labels=labels, side=side
            ).decode()
            assert _overlaps(_boxes(svg)) == 0


def test_combined_double_elimination_boxes_do_not_overlap() -> None:
    names, labels = _po_labels(16, double=True)
    svg = render_playoff_schema(names, EliminationType.DOUBLE, theme="css", match_labels=labels).decode()
    assert _overlaps(_boxes(svg)) == 0


def test_singles_boxes_are_shorter_than_doubles_boxes() -> None:
    names, labels = _po_labels(8)
    singles = _boxes(render_playoff_schema(names, theme="css", match_labels=labels).decode())
    doubles = _boxes(_doubles_svg(8))
    height = lambda boxes: max(b[3] - b[1] for b in boxes)  # noqa: E731
    assert height(singles) < height(doubles) * 0.8
    # One height per bracket: every team box of a bracket has the same height.
    assert len({round(b[3] - b[1], 1) for b in doubles}) == 1


def test_output_scale_doubles_viewbox_keeps_text_ratio() -> None:
    names, labels = _po_labels(8)
    one = render_playoff_schema(names, theme="css", match_labels=labels).decode()
    two = render_playoff_schema(names, theme="css", match_labels=labels, output_scale=2).decode()
    w1, h1 = _viewbox(one)
    w2, h2 = _viewbox(two)
    assert abs(w2 / w1 - 2) < 0.02 and abs(h2 / h1 - 2) < 0.02
    assert abs(_text_pt(two) / _text_pt(one) - 2) < 0.05


def test_preview_route_keeps_data_text_pt(client: TestClient) -> None:
    r = client.get("/api/schema/playoff-preview", params={"participants": 8, "theme": "css"})
    assert r.status_code == 200 and _text_pt(r.text) > 0


def _play_round_one(t: PlayoffTournament) -> None:
    for m in list(t.bracket.pending_matches()):
        if m.round_number == 1:
            t.record_result(m.id, (6, 2))


def _window_svg(t: PlayoffTournament, count: int = 3, **kw: object) -> str:
    br = t.bracket
    return render_playoff_schema(
        [" & ".join(p.name for p in team) for team in br.original_teams],
        theme="css",
        match_labels=_build_match_labels(br),
        window_rounds=count,
        **kw,  # type: ignore[arg-type]
    ).decode()


def test_window_starts_at_the_first_unfinished_round_and_slides() -> None:
    t = _po(16)
    full = render_playoff_schema(*_po_labels(16)[:1], theme="css", match_labels=_po_labels(16)[1]).decode()
    svg = _window_svg(t)
    # Round 1 unfinished: round 1 to the semi-final.
    assert "Round of 16" in svg and "Quarter-Final" in svg and "Semi-Final" in svg
    assert ">Final<" not in svg
    assert 'data-rounds-from="1"' in svg and 'data-rounds-to="3"' in svg and 'data-rounds-total="4"' in svg
    assert _viewbox(svg)[0] < _viewbox(full)[0]
    # Round 1 done: quarter-final to the final.
    _play_round_one(t)
    svg = _window_svg(t)
    assert "Round of 16" not in svg and "Quarter-Final" in svg and ">Final<" in svg
    assert 'data-rounds-from="2"' in svg and 'data-rounds-to="4"' in svg
    # Everything finished: clamped to the last three.
    while t.bracket.pending_matches():
        t.record_result(t.bracket.pending_matches()[0].id, (6, 2))
    assert 'data-rounds-from="2"' in _window_svg(t)


def test_window_is_a_noop_for_small_brackets_and_default_render() -> None:
    names, labels = _po_labels(8)
    full = render_playoff_schema(names, theme="css", match_labels=labels)
    assert render_playoff_schema(names, theme="css", match_labels=labels, window_rounds=3) == full
    assert render_playoff_schema(names, theme="css", match_labels=labels, window_rounds=None) == full
    assert b"data-rounds" not in full


def test_window_double_elim_sides_and_third_place() -> None:
    names, labels = _po_labels(16, double=True)
    for side in ("winners", "losers"):
        full = render_playoff_schema(names, EliminationType.DOUBLE, theme="css", match_labels=labels, side=side)
        cut = render_playoff_schema(
            names, EliminationType.DOUBLE, theme="css", match_labels=labels, side=side, window_rounds=3
        )
        assert _viewbox(cut.decode())[0] < _viewbox(full.decode())[0]
        assert 'data-rounds-from="1"' in cut.decode()
    t = _po(16, third_place=True)
    _play_round_one(t)
    for m in list(t.bracket.pending_matches()):
        if m.round_number == 2:
            t.record_result(m.id, (6, 2))
    svg = _window_svg(t, 2, third_place=True)
    assert "3rd Place" in svg and "Semi-Final" in svg and "Quarter-Final" not in svg


def test_rounds_query_on_the_tournament_route(client: TestClient, auth_headers: dict) -> None:
    body = {"participant_names": [f"P{i}" for i in range(16)], "court_names": ["C1"]}
    r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
    assert r.status_code == 200, r.text
    base = f"/api/tournaments/{r.json()['id']}/po/playoffs-schema?theme=css"
    full = client.get(base)
    cut = client.get(f"{base}&rounds=window:3")
    assert full.status_code == cut.status_code == 200
    assert ">Final<" in full.text and ">Final<" not in cut.text  # round 1 unfinished: round 1 to the semi-final
    assert 'data-text-pt="' in cut.text
    assert 'data-rounds-from="1"' in cut.text
    assert client.get(f"{base}&rounds=window:3").content == cut.content
    for bad in ("window:0", "window:x", "last:3", "3"):
        assert client.get(f"{base}&rounds={bad}").status_code == 422


def _texts_in_box(svg: str, box: tuple[float, float, float, float]) -> list[str]:
    found = []
    for style, x, y, content in re.findall(r'<text style="([^"]*)" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)</text>', svg):
        if box[0] <= float(x) <= box[2] and box[1] <= float(y) <= box[3]:
            found.append(html.unescape(content))
    return found


def test_team_brackets_have_no_column_headers_but_titles_stay_in_the_boxes() -> None:
    names, labels = _po_labels(8)
    svg = render_playoff_schema(names, theme="css", match_labels=labels).decode()
    boxes = _boxes(svg)
    # Every round-name text sits inside a box: one per quarter-final box, no column labels above.
    for title, count in (("Quarter-Final", 4), ("Semi-Final", 2), ("Final", 1)):
        assert svg.count(f">{title}<") == count
    for style, x, y, content in re.findall(r'<text style="([^"]*)" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)</text>', svg):
        if content in ("Quarter-Final", "Semi-Final", "Final"):
            assert any(b[0] <= float(x) <= b[2] and b[1] <= float(y) <= b[3] for b in boxes), content
    # The topmost box starts close to the top edge (a small margin, no header band).
    assert min(b[1] for b in boxes) < 40
    # Boxes without team names (the preview) keep their column headers.
    preview = render_playoff_schema(["A", "B", "C", "D", "E", "F", "G", "H"], theme="css").decode()
    assert any(h in preview for h in (">Quarter-Final<",))


def test_third_place_title_is_inside_its_box() -> None:
    t = _po(8, third_place=True)
    br = t.bracket
    svg = render_playoff_schema(
        [p.name for team in br.original_teams for p in team],
        theme="css",
        match_labels=_build_match_labels(br),
        third_place=True,
    ).decode()
    assert svg.count(">3rd Place<") == 1
    assert any("3rd Place" in _texts_in_box(svg, box) for box in _boxes(svg))
    assert _overlaps(_boxes(svg)) == 0


# ── Undecided matches: every box has two rows ─────────────────────────────────


def _de_round_one_played_svg(side: str | None) -> str:
    t = _po(8, double_elimination=True)
    for m in [m for m in t.bracket.pending_matches() if m.round_number == 1]:
        t.record_result(m.id, (6, 2))
    br = t.bracket
    return render_playoff_schema(
        [p.name for team in br.original_teams for p in team],
        EliminationType.DOUBLE,
        theme="css",
        match_labels=_build_match_labels(br),
        side=side,
    ).decode()


def _row_texts(svg: str, box: tuple[float, float, float, float]) -> list[tuple[str, str]]:
    """(content, style) of the name/source rows in *box*: not the italic title, not a bold score."""
    out = []
    for style, x, y, content in re.findall(r'<text style="([^"]*)" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)</text>', svg):
        if box[0] <= float(x) <= box[2] and box[1] <= float(y) <= box[3] and "italic" not in style:
            if "font-weight: 700" not in style:
                out.append((html.unescape(content), style))
    return out


@pytest.mark.parametrize("side", [None, "winners", "losers"])
def test_every_match_box_has_two_rows_when_little_is_played(side: str | None) -> None:
    svg = _de_round_one_played_svg(side)
    boxes = _boxes(svg)
    assert boxes
    for box in boxes:
        assert len(_row_texts(svg, box)) >= 2
    assert _overlaps(boxes) == 0
    _assert_texts_inside(svg, boxes)


def test_no_match_n_placeholder_in_team_brackets() -> None:
    for side in (None, "winners", "losers"):
        svg = _de_round_one_played_svg(side)
        assert not re.search(r">Match \d+<", svg)
    # The preview, with no team names, keeps its look.
    preview = render_playoff_schema([str(i) for i in range(8)], EliminationType.DOUBLE, theme="css").decode()
    assert re.search(r">Match \d+<", preview)


def test_source_labels_and_tbd_are_muted() -> None:
    svg = _de_round_one_played_svg("losers")
    texts = _texts(svg)
    sources = [k for k in texts if k.startswith(("Loser of ", "Winner of "))]
    assert "Loser of WR2 M1" in sources and "Winner of LR1 M1" in sources
    for key in sources + ["TBD"]:
        assert all(f"fill: {MUTED}" in s and "font-weight" not in s for s in texts[key]), key
    # The match number is in the box title.
    assert "Losers R2 · M1" in texts


def test_known_team_in_a_later_slot_keeps_its_name() -> None:
    svg = _de_round_one_played_svg("winners")
    texts = _texts(svg)
    assert "TBD" in texts  # later winners-bracket slots
    t = _css(_final_labels(team2="TBD", score=None, score_sides=None, loser_side=None))
    assert f"fill: {TEXT}" in _one(t, "Nik M &")
    assert all(f"fill: {MUTED}" in style for style in t["TBD"])


# ── Labels follow results ────────────────────────────────────────────────────


def _de8_after(*steps: str) -> tuple[PlayoffTournament, str]:
    """An 8-team double elimination with round 1 played, then the first pending match of each given round."""
    t = _po(8, double_elimination=True)
    for m in [m for m in t.bracket.pending_matches() if m.round_number == 1 and m.round_label == "Winners R1"]:
        t.record_result(m.id, (6, 2))
    for label in steps:
        m = next(m for m in t.bracket.pending_matches() if m.round_label == label)
        t.record_result(m.id, (6, 2))
    br = t.bracket
    svg = render_playoff_schema(
        [p.name for team in br.original_teams for p in team],
        EliminationType.DOUBLE,
        theme="css",
        match_labels=_build_match_labels(br),
        side="losers",
    ).decode()
    return t, svg


def test_finished_losers_match_hands_its_winner_to_the_next_slot_by_name() -> None:
    t, before = _de8_after()
    assert "Winner of LR1 M1" in before and "Winner of LR1 M2" in before
    t, svg = _de8_after("Losers R1")
    played = next(m for m in t.bracket.losers_matches if m.round_label == "Losers R1" and m.score)
    winner = played.winner_team[0].name
    texts = _texts(svg)
    assert "Winner of LR1 M1" not in texts
    assert "Winner of LR1 M2" in texts  # the other one is still unfinished: muted label
    assert f"fill: {MUTED}" in texts["Winner of LR1 M2"][0]
    # The winner's name is in the losers-R1 box and again, in full colour, in the next round's slot.
    assert len(texts[winner]) == 2
    assert all(f"fill: {TEXT}" in style or f"fill: {MUTED}" in style for style in texts[winner])
    assert any(f"fill: {TEXT}" in style for style in texts[winner][1:])


def test_finished_winners_match_hands_its_loser_to_the_losers_slot() -> None:
    t, svg = _de8_after("Winners R2")
    played = next(m for m in t.bracket.winners_matches if m.round_label == "Winners R2" and m.score)
    loser = played.loser_team[0].name
    texts = _texts(svg)
    assert "Loser of WR2 M1" not in texts and "Loser of WR2 M2" in texts
    assert any(f"fill: {TEXT}" in style for style in texts[loser])
