"""
Tournament structure visualisation — block‑scheme generator.

Builds a **networkx** directed graph that represents the full tournament
flow (group stage → play‑off bracket) and renders it to a publication‑ready
image via **matplotlib**.

The module is intentionally *stateless*: you pass parameters describing
the tournament format and get back an image (PNG/SVG bytes or a saved
file).  This makes it easy to generate a "preview" before players are
even registered.

Usage
-----
>>> from backend.bracket_schema import render_schema
>>> png_bytes = render_schema(
...     group_sizes=[4, 4],
...     advance_per_group=2,
...     elimination=EliminationType.SINGLE,
... )
>>> Path("schema.png").write_bytes(png_bytes)
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import matplotlib

from ..models import BracketNodeKind, EliminationType

matplotlib.use("Agg")  # headless — no display needed
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import networkx as nx
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch

from ..tournaments.pairing import seed_with_group_diversity
from ..tournaments.playoff import DoubleEliminationBracket as _DEB

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _fig_to_bytes(
    fig: plt.Figure,
    *,
    fmt: Literal["png", "svg", "pdf"] = "png",
    dpi: int = 150,
) -> bytes:
    """Render a matplotlib Figure to bytes and close it."""
    buf = io.BytesIO()
    fig.savefig(
        buf,
        format=fmt,
        dpi=dpi,
        bbox_inches="tight",
        facecolor=fig.get_facecolor(),
        edgecolor="none",
    )
    plt.close(fig)
    buf.seek(0)
    return buf.read()


# ────────────────────────────────────────────────────────────────────────────
# Public API
# ────────────────────────────────────────────────────────────────────────────


def render_schema(
    group_sizes: list[int],
    advance_per_group: int = 2,
    elimination: EliminationType = EliminationType.SINGLE,
    *,
    title: str | None = None,
    fmt: Literal["png", "svg", "pdf"] = "png",
    dpi: int = 150,
    figsize: tuple[float, float] | None = None,
    box_scale: float = 1.0,
    line_width: float = 1.0,
    arrow_scale: float = 1.0,
    title_font_scale: float = 1.0,
    output_scale: float = 1.0,
    num_winners: int = 1,
    third_place: bool = False,
    theme: SchemaTheme = "light",
) -> bytes:
    """
    Generate a tournament block‑scheme and return it as image bytes.

    Parameters
    ----------
    group_sizes:
        Number of players in each group, e.g. ``[4, 4]`` for 2 groups of 4.
    advance_per_group:
        How many players advance from each group to the play‑offs.
    elimination:
        ``"single"`` or ``"double"`` elimination bracket.
    title:
        Optional title printed at the top of the diagram.
    fmt:
        Output image format (``"png"``, ``"svg"``, or ``"pdf"``).
    dpi:
        Resolution for raster formats.
    figsize:
        Explicit figure size ``(width, height)`` in inches.  If *None* the
        size is computed automatically from the bracket complexity.
    box_scale:
        Multiplier for node box dimensions (1.0 = default).
    line_width:
        Multiplier for edge/border line thickness (1.0 = default).
    arrow_scale:
        Multiplier for arrowhead size (1.0 = default).
    output_scale:
        Multiplier for final figure size (1.0 = default).
    theme:
        ``"light"`` / ``"dark"`` colours, or ``"css"`` for an SVG coloured by
        CSS variables (forces ``fmt="svg"``).

    Returns
    -------
    bytes
        The rendered image.
    """
    layout = _compute_layout(
        group_sizes, advance_per_group, elimination, num_winners=num_winners, third_place=third_place
    )
    return _render(
        layout,
        theme=theme,
        fmt=fmt,
        title=title,
        figsize=figsize,
        dpi=dpi,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
        title_font_scale=title_font_scale,
        output_scale=output_scale,
    )


def _render(layout: dict, *, theme: SchemaTheme, fmt: Literal["png", "svg", "pdf"], dpi: int, **draw: object) -> bytes:
    """Draw *layout* in *theme* and encode it; the "css" theme is always an SVG."""
    if theme == "css":
        fmt = "svg"
    with plt.rc_context(_rc(theme)):
        fig = _draw(layout, dpi=dpi, palette=_PALETTES[theme], **draw)  # type: ignore[arg-type]
        img = _fig_to_bytes(fig, fmt=fmt, dpi=dpi)
    if theme != "css":
        return img
    return _css_variables(img, getattr(fig, "amistoso_text_pt", None), layout.get("window"))


def _filter_layout_by_side(layout: dict, side: str) -> dict:
    """Return a copy of a DE layout containing only winners-side or losers-side nodes."""
    positions = layout["positions"]
    if side == "winners":
        keep = {n for n in positions if n.startswith("seed_") or n.startswith("w_r") or n == "grand_final"}
    else:
        keep = {n for n in positions if n.startswith("l_") or n == "grand_final"}
    G: nx.DiGraph = layout["graph"]
    # The combined layout interleaves winners and losers columns; one side alone
    # would keep the other side's columns as empty space.
    kept = _columns_by_stage(
        {n: p for n, p in positions.items() if n in keep},
        [st for st in layout["stages"] if any(n in keep for n in st.get("nodes", []))],
        layout["node_meta"],
        step=layout.get("col_step", 3.0),
        box_h=layout.get("box_h", 1.8),
        team_boxes=layout.get("team_boxes", False),
    )
    if side == "losers" and "grand_final" in kept:
        # Bring the grand final level with the losers final that feeds it.
        feeders = [n for n in G.predecessors("grand_final") if n in kept]
        if feeders:
            kept["grand_final"] = (kept["grand_final"][0], sum(kept[n][1] for n in feeders) / len(feeders))

    def stage_x(st: dict) -> float:
        xs = [kept[n][0] for n in st.get("nodes", []) if n in kept]
        return sum(xs) / len(xs) if xs else st["x"]

    return {
        "graph": G.subgraph(keep).copy(),
        "positions": kept,
        "node_meta": {n: m for n, m in layout["node_meta"].items() if n in keep},
        "stages": [
            {**s, "x": stage_x(s), "nodes": [n for n in s.get("nodes", []) if n in keep]}
            for s in layout["stages"]
            if any(n in keep for n in s.get("nodes", []))
        ],
        "elimination": layout.get("elimination"),
        "sided": True,
        "box_h": layout.get("box_h", 1.8),
        "col_step": layout.get("col_step", 3.0),
        "team_boxes": layout.get("team_boxes", False),
    }


def _window_layout(layout: dict, count: int, match_labels: dict[str, dict] | None) -> dict:
    """Keep a window of *count* consecutive round columns of a play-off layout.

    The window starts at the earliest round with an unfinished match (a match
    without a score; byes and walkovers are finished) and is clamped to end at
    the last round, so it slides forward as play advances.  A 3rd-place match
    stays with the final.  Nothing changes when there are *count* rounds or
    fewer.  The root gets ``data-rounds-from`` / ``-to`` / ``-total`` (1-based).

    Boxes keep their column; the vertical spread is compressed so the remaining
    rounds are not stretched over the height of the dropped ones.
    """
    stages = layout["stages"]
    rounds = [st for st in stages if st["name"] != "3rd Place"]
    if len(rounds) <= count:
        return layout
    labels = match_labels or {}
    start = next(
        (i for i, st in enumerate(rounds) if any(not labels.get(nid, {}).get("score") for nid in st["nodes"])),
        len(rounds) - 1,
    )
    start = min(start, len(rounds) - count)
    shown = rounds[start : start + count]
    kept_stages = [st for st in stages if st["name"] == "3rd Place" or st in shown]
    keep = {nid for st in kept_stages for nid in st.get("nodes", [])}
    positions = {nid: p for nid, p in layout["positions"].items() if nid in keep}
    # Compress y so the closest boxes of the first kept column sit at the usual spacing.
    first = sorted((positions[nid][1] for nid in shown[0]["nodes"] if nid in positions), reverse=True)
    gaps = [a - b for a, b in zip(first, first[1:], strict=False) if a - b > 1e-6]
    ys = [y for _x, y in positions.values()]
    mid = (max(ys) + min(ys)) / 2
    min_gap = layout.get("box_h", 1.8) + _ROW_GAP
    factor = min(1.0, min_gap / min(gaps)) if gaps else 1.0
    positions = {nid: (x, mid + (y - mid) * factor) for nid, (x, y) in positions.items()}
    columns: dict[float, list[str | None]] = {}
    for nid, (x, _y) in positions.items():
        columns.setdefault(round(x, 6), []).append(nid)
    for ids in columns.values():
        _enforce_min_spacing(positions, ids, min_gap=min_gap)
    return {
        **layout,
        "graph": layout["graph"].subgraph(keep).copy(),
        "positions": positions,
        "node_meta": {nid: m for nid, m in layout["node_meta"].items() if nid in keep},
        "stages": [{**st, "nodes": [nid for nid in st.get("nodes", []) if nid in keep]} for st in kept_stages],
        "window": (start + 1, start + count, len(rounds)),
    }


def render_playoff_schema(
    participant_names: list[str],
    elimination: EliminationType = EliminationType.SINGLE,
    *,
    match_labels: dict[str, dict] | None = None,
    title: str | None = None,
    side: str | None = None,
    fmt: Literal["png", "svg", "pdf"] = "png",
    dpi: int = 150,
    figsize: tuple[float, float] | None = None,
    box_scale: float = 1.0,
    line_width: float = 1.0,
    arrow_scale: float = 1.0,
    title_font_scale: float = 1.0,
    output_scale: float = 1.0,
    num_winners: int = 1,
    third_place: bool = False,
    theme: SchemaTheme = "light",
    window_rounds: int | None = None,
) -> bytes:
    """Generate a play-off bracket schema from participant names.

    *num_winners* truncates a single-elimination bracket (see
    :class:`SingleEliminationBracket`); *third_place* adds the 3rd-place match.
    *window_rounds* draws only N consecutive rounds (columns) of the bracket, or
    of each side of a double-elimination bracket, starting at the earliest round
    with an unfinished match (see :func:`_window_layout`).
    """
    if len(participant_names) < 2:
        raise ValueError("Need at least 2 participants")

    layout = _compute_playoff_layout(
        participant_names, elimination, match_labels=match_labels, num_winners=num_winners, third_place=third_place
    )
    if side and elimination == EliminationType.DOUBLE:
        layout = _filter_layout_by_side(layout, side)
    if window_rounds:
        layout = _window_layout(layout, window_rounds, match_labels)
    return _render(
        layout,
        theme=theme,
        fmt=fmt,
        title=title,
        figsize=figsize,
        dpi=dpi,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
        title_font_scale=title_font_scale,
        output_scale=output_scale,
    )


def build_graph(
    group_sizes: list[int],
    advance_per_group: int = 2,
    elimination: EliminationType = EliminationType.SINGLE,
) -> nx.DiGraph:
    """Return the raw networkx DiGraph (useful for tests / further processing)."""
    layout = _compute_layout(group_sizes, advance_per_group, elimination)
    return layout["graph"]


# ────────────────────────────────────────────────────────────────────────────
# Internal: compute layout  (graph + positions + metadata)
# ────────────────────────────────────────────────────────────────────────────

_ROUND_LABELS = {
    1: "Final",
    2: "Semi-Final",
    3: "Quarter-Final",
}


def _round_label(num_rounds: int, r: int) -> str:
    """Human label for round *r* (0-based) out of *num_rounds* total."""
    remaining = num_rounds - r
    return _ROUND_LABELS.get(remaining, f"Round of {2**remaining}")


def _team_lines(name: str | None, max_name: int = 24) -> list[str]:
    """A team name as label lines: one line per player ("Ana García &" / "Eva Gil")."""
    out: list[str] = []
    for part in (name or "TBD").split("\n"):
        players = part.split(" & ")
        out += [p + " &" for p in players[:-1]] + players[-1:]
    return [line if len(line) <= max_name else line[: max_name - 1] + "…" for line in out]


# Team boxes with names (data units; one unit is 72 pt high and 93.6 pt wide at the default size).
# A box is a header (the round name and a rule), then one row per name line, a divider between the teams
# and a little padding.  Rows are 0.25 units, which holds the 14 pt names; the box width leaves room for
# long single names plus a score column.  Neighbouring round columns are one box width plus a short gap.
_BOX_W = 2.3
_COL_GAP = 0.32
_COL_STEP = _BOX_W + _COL_GAP
_LINE_H = 0.25
_DIVIDER_H = 0.12
_HEADER_H = 0.5
_BOX_PAD = 0.1
_ROW_GAP = 0.35  # between boxes of one column, at the tightest
_PLAIN_BOX_H = 1.8  # the old fixed height; also what spacing formulas assume without team names
_PLAIN_COL_STEP = 3.0


_MATCH_KINDS = (
    BracketNodeKind.MATCH,
    BracketNodeKind.WINNERS_MATCH,
    BracketNodeKind.LOSERS_MATCH,
    BracketNodeKind.GRAND_FINAL,
)
_EMPTY_MATCH = {"team1": "TBD", "team2": "TBD", "score": None, "score_sides": None}


def _team_box_height(lines_per_team: int) -> float:
    """Height of a team box whose teams take *lines_per_team* name lines each."""
    return _HEADER_H + 2 * lines_per_team * _LINE_H + _DIVIDER_H + _BOX_PAD


def _label_box_height(match_labels: dict[str, dict] | None) -> float:
    """One box height for every team box of a bracket: the tallest team over all its matches."""
    if not match_labels:
        return _PLAIN_BOX_H
    lines = max(
        (len(_team_lines(md.get(side))) for md in match_labels.values() for side in ("team1", "team2")),
        default=1,
    )
    return _team_box_height(lines)


def _col_step(match_labels: dict[str, dict] | None) -> float:
    return _COL_STEP if match_labels else _PLAIN_COL_STEP


def _match_rows(data: dict, max_name: int = 24) -> dict:
    """The row layout of a match box: name lines per team, a style per name line, scores per team.

    Styles: ``name`` (winner or undecided), ``tbd`` (team not known yet: muted), ``loser`` (lost a
    scored match), ``walkover_loser`` (withdrew: muted and struck through).  ``scores`` holds each team's score parts, drawn right-aligned
    on the team's first line; a pending match has none.
    """
    lines = [_team_lines(data.get("team1"), max_name), _team_lines(data.get("team2"), max_name)]
    styles: list[list[str]] = []
    for side, team_lines in zip(("team1", "team2"), lines, strict=True):
        if data.get(side) == "TBD":
            style = "tbd"  # not known yet: muted
        elif data.get("walkover_loser") == side:
            style = "walkover_loser"
        elif data.get("loser_side") == side:
            style = "loser"
        else:
            style = "name"
        styles.append([style] * len(team_lines))
    sides = data.get("score_sides")
    if not sides and data.get("score"):
        sides = [[str(data["score"])], []]  # legacy single string
    return {"lines": lines, "styles": styles, "scores": [list(x) for x in sides] if sides else [[], []]}


def _strike_lines(data: dict, max_name: int = 24) -> list[int]:
    """Indices (over team 1's name lines, then team 2's) of the lines struck through: the withdrawn side's."""
    styles = [style for side in _match_rows(data, max_name)["styles"] for style in side]
    return [i for i, style in enumerate(styles) if style == "walkover_loser"]


def _apply_match_data(meta: dict, data: dict) -> None:
    """Mark a node as a team box and attach its rows (see :func:`_match_rows`)."""
    rows = _match_rows(data)
    # The plain text of the box (names and score); the box itself is drawn from ``rows``.
    score = data.get("score") or "vs"
    meta["label"] = "\n".join([*rows["lines"][0], str(score), *rows["lines"][1]])
    meta["rows"] = rows
    meta["has_teams"] = True


def _next_power_of_two(n: int) -> int:
    if n <= 1:
        return 1
    return 1 << (n - 1).bit_length()


def _compute_layout(
    group_sizes: list[int],
    advance_per_group: int,
    elimination: str,
    *,
    num_winners: int = 1,
    third_place: bool = False,
) -> dict:
    """
    Build the full layout dict used by the renderer.

    Returns a dict with keys:
        graph          – nx.DiGraph
        positions      – {node_id: (x, y)}
        node_meta      – {node_id: {label, kind, ...}}
        stages         – ordered list of dicts describing each stage column
        elimination    – "single" or "double"
    """
    G = nx.DiGraph()
    positions: dict[str, tuple[float, float]] = {}
    node_meta: dict[str, dict] = {}
    stages: list[dict] = []

    num_groups = len(group_sizes)
    total_advancing = num_groups * advance_per_group

    # ── Stage 0: Groups ─────────────────────────────────────────────────
    x_groups = 0.0
    group_nodes: list[str] = []

    # Vertical spacing for groups
    group_height = 1.4
    total_group_height = num_groups * group_height
    y_group_start = total_group_height / 2 - group_height / 2

    for gi in range(num_groups):
        gid = f"group_{gi}"
        label = f"Group {chr(65 + gi)}\n({group_sizes[gi]} players)"
        G.add_node(gid)
        node_meta[gid] = {"label": label, "kind": BracketNodeKind.GROUP, "stage": 0, "group": gi}
        positions[gid] = (x_groups, y_group_start - gi * group_height)
        group_nodes.append(gid)

    stages.append({"name": "Group Stage", "x": x_groups, "nodes": list(group_nodes)})

    # ── Stage 1: Advancement slots ──────────────────────────────────────
    # One node per advancing player to show the flow from group → bracket.
    #
    # Plain strength ordering: rank 0 across all groups, then rank 1, etc.
    # The bracket builder applies _make_seed_order() on top of this to
    # guarantee correct cross-group matchups (strongest-vs-weakest,
    # same-group players on opposite sides of the bracket).
    x_advance = 2.5
    total_slots = total_advancing
    slot_spacing = max(0.7, total_group_height / max(total_slots, 1))
    y_adv_start = (total_slots - 1) * slot_spacing / 2

    # Build the seeded order: list of (group_index, rank_within_group).
    # Rank-interleaved: A1,B1,C1,A2,B2,C2,… so same-rank teams are adjacent.
    seeded_order: list[tuple[int, int]] = []
    for ai in range(advance_per_group):
        for gi in range(num_groups):
            seeded_order.append((gi, ai))

    # For >2 groups, permute within slots to avoid same-group R1/effective-R1
    # matchups in the bracket preview.
    if num_groups > 2:
        group_ids = [gi for gi, _ai in seeded_order]
        seeded_order = seed_with_group_diversity(
            seeded_order,
            group_ids,
            score_key=lambda t: -t[1],
        )

    advance_nodes: list[str] = []
    for slot_idx, (gi, ai) in enumerate(seeded_order):
        aid = f"adv_g{gi}_r{ai}"
        rank = ai + 1
        label = f"#{rank} Grp {chr(65 + gi)}"
        G.add_node(aid)
        node_meta[aid] = {"label": label, "kind": BracketNodeKind.ADVANCE, "stage": 1, "group": gi}
        positions[aid] = (x_advance, y_adv_start - slot_idx * slot_spacing)
        advance_nodes.append(aid)
        # Edge from group to advancing slot
        G.add_edge(f"group_{gi}", aid)

    stages.append({"name": "Advance", "x": x_advance, "nodes": list(advance_nodes)})

    # ── Stage 2+: Play‑off bracket ─────────────────────────────────────
    if elimination == EliminationType.SINGLE:
        _build_single_elim_bracket(
            G,
            positions,
            node_meta,
            stages,
            advance_nodes,
            total_advancing,
            x_start=5.0,
            slot_spacing=slot_spacing,
            num_winners=num_winners,
            third_place=third_place,
        )
    else:
        _build_double_elim_bracket(
            G,
            positions,
            node_meta,
            stages,
            advance_nodes,
            total_advancing,
            x_start=5.0,
            slot_spacing=slot_spacing,
        )

    return {
        "graph": G,
        "positions": positions,
        "node_meta": node_meta,
        "stages": stages,
        "elimination": elimination,
    }


def _compute_playoff_layout(
    participant_names: list[str],
    elimination: str,
    *,
    match_labels: dict[str, dict] | None = None,
    num_winners: int = 1,
    third_place: bool = False,
) -> dict:
    """Build a bracket-only layout from named participants."""
    G = nx.DiGraph()
    positions: dict[str, tuple[float, float]] = {}
    node_meta: dict[str, dict] = {}
    stages: list[dict] = []

    x_participants = 0.0
    # Use wider slot spacing when team names will be rendered inside boxes
    box_h = _label_box_height(match_labels)
    # With team names a first-round match sits one box height plus a small gap below the last (two
    # participants per match); without them the spacing is the older looser one.
    slot_spacing = (box_h + _ROW_GAP) / 2 if match_labels else (1.2 if elimination == EliminationType.DOUBLE else 0.9)
    y_start = (len(participant_names) - 1) * slot_spacing / 2

    participant_nodes: list[str] = []
    for idx, name in enumerate(participant_names):
        node_id = f"seed_{idx}"
        G.add_node(node_id)
        node_meta[node_id] = {
            "label": name,
            "kind": BracketNodeKind.ADVANCE,
            "stage": 0,
        }
        positions[node_id] = (x_participants, y_start - idx * slot_spacing)
        participant_nodes.append(node_id)

    stages.append({"name": "Participants", "x": x_participants, "nodes": list(participant_nodes)})

    if elimination == EliminationType.SINGLE:
        _build_single_elim_bracket(
            G,
            positions,
            node_meta,
            stages,
            participant_nodes,
            len(participant_names),
            x_start=2.5,
            slot_spacing=slot_spacing,
            match_labels=match_labels,
            num_winners=num_winners,
            third_place=third_place,
        )
    else:
        _build_double_elim_bracket(
            G,
            positions,
            node_meta,
            stages,
            participant_nodes,
            len(participant_names),
            x_start=2.5,
            slot_spacing=slot_spacing,
            match_labels=match_labels,
        )

    if match_labels:
        # Every match box of a bracket with names has the same rows; a match not drawn up yet is TBD.
        for meta in node_meta.values():
            if meta.get("kind") in _MATCH_KINDS and not meta.get("has_teams"):
                _apply_match_data(meta, _EMPTY_MATCH)
        if elimination == EliminationType.DOUBLE:
            _label_sources(G, positions, node_meta, match_labels)
        _drop_participant_column(G, positions, node_meta, stages)

    return {
        "graph": G,
        "positions": positions,
        "node_meta": node_meta,
        "stages": stages,
        "elimination": elimination,
        "box_h": box_h,
        "col_step": _col_step(match_labels),
        "team_boxes": bool(match_labels),
    }


def _produced_name(u: str, relation: str, match_labels: dict[str, dict]) -> str | None:
    """The team a finished match *u* hands on: its winner (``win``) or its loser (``loss``)."""
    md = match_labels.get(u) or {}
    side = md.get("loser_side")
    if side not in ("team1", "team2"):
        return None
    loser, winner = (md.get("team1"), md.get("team2")) if side == "team1" else (md.get("team2"), md.get("team1"))
    return loser if relation == "loss" else winner


def _label_sources(G: nx.DiGraph, positions: dict, node_meta: dict, match_labels: dict[str, dict]) -> None:
    """Fill the unknown (TBD) teams of a double-elimination bracket from the matches that feed it.

    The feeders are read from the graph (top one first); a feeder whose team is already in the box
    fills that slot, the others fill the TBD slots in order.  A finished feeder hands over its
    winner or loser by name, in full colour, before the engine places the team.  An unfinished one
    gives a muted label ("Loser of WR1 M2") in the losers bracket; elsewhere the slot stays TBD.
    """
    for nid, meta in node_meta.items():
        kind = meta.get("kind")
        if kind not in (BracketNodeKind.LOSERS_MATCH, BracketNodeKind.WINNERS_MATCH, BracketNodeKind.GRAND_FINAL):
            continue
        if "rows" not in meta:
            continue
        rows = meta["rows"]
        data = match_labels.get(nid, {})
        names = [data.get("team1", "TBD"), data.get("team2", "TBD")]
        feeders = sorted(
            (u for u in G.predecessors(nid) if u in positions and node_meta.get(u, {}).get("code")),
            key=lambda u: -positions[u][1],
        )
        free = [
            u for u in feeders if _produced_name(u, G.edges[u, nid].get("relation", "win"), match_labels) not in names
        ]
        for slot, name in enumerate(names):
            if name != "TBD" or not free:
                continue
            u = free.pop(0)
            relation = G.edges[u, nid].get("relation", "win")
            known = _produced_name(u, relation, match_labels)
            if known:
                rows["lines"][slot] = _team_lines(known)
                rows["styles"][slot] = ["name"] * len(rows["lines"][slot])
            elif kind == BracketNodeKind.LOSERS_MATCH:
                verb = "Loser" if relation == "loss" else "Winner"
                rows["lines"][slot] = [f"{verb} of {node_meta[u]['code']}"]
                rows["styles"][slot] = ["tbd"]


def _drop_participant_column(G: nx.DiGraph, positions: dict, node_meta: dict, stages: list) -> None:
    """Remove the participants column when the match boxes already name the teams.

    A live bracket shows both teams inside each first-round box, so the column
    only repeats them and costs a column of width.  A team with a first-round
    bye keeps a box: its BYE marker takes the team's name.  Nothing changes
    unless every participant is accounted for that way.
    """
    seeds = [n for n in G.nodes if n.startswith("seed_")]
    for seed in seeds:
        for succ in G.successors(seed):
            meta = node_meta.get(succ, {})
            if not (meta.get("has_teams") or meta.get("kind") == BracketNodeKind.BYE):
                return
    for seed in seeds:
        for succ in list(G.successors(seed)):
            if node_meta[succ].get("kind") == BracketNodeKind.BYE:
                node_meta[succ] = {
                    **node_meta[succ],
                    "label": "\n".join(_team_lines(node_meta[seed]["label"])),
                    "kind": BracketNodeKind.ADVANCE,
                    "bye_team": True,
                }
        G.remove_node(seed)
        positions.pop(seed, None)
        node_meta.pop(seed, None)
    stages[:] = [st for st in stages if st.get("name") != "Participants"]
    byes = [n for n in G.nodes if n.startswith("bye_") and node_meta[n].get("kind") == BracketNodeKind.ADVANCE]
    if byes and stages:
        # The teams with a bye share the first round's column.
        stages[0] = {**stages[0], "nodes": [*stages[0].get("nodes", []), *byes]}


def _columns_by_stage(
    positions: dict,
    stages: list[dict],
    node_meta: dict,
    step: float = 3.0,
    box_h: float = 1.8,
    team_boxes: bool = False,
) -> dict:
    """One column per stage (round), in stage order, with no empty columns between.

    The double-elimination layout staggers matches of one round across several
    x positions; one side drawn alone reads better with a column per round.
    Boxes that end up too close in a column are spread apart vertically.
    """
    column: dict[str, int] = {}
    for i, st in enumerate(stages):
        for n in st.get("nodes", []):
            if n in positions:
                column.setdefault(n, i)
    # Nodes in no stage keep their left-to-right order after the stage columns.
    leftovers = sorted({round(p[0], 6) for n, p in positions.items() if n not in column})
    for n, (x, _y) in positions.items():
        if n not in column:
            column[n] = len(stages) + leftovers.index(round(x, 6))
    out = {n: (column[n] * step, y) for n, (_x, y) in positions.items()}
    for i in set(column.values()):
        ids: list[str | None] = [n for n in out if column[n] == i]
        gap = box_h + _ROW_GAP if team_boxes or any(node_meta.get(n, {}).get("has_teams") for n in ids if n) else 1.2
        _enforce_min_spacing(out, ids, min_gap=gap)
    return out


def _enforce_min_spacing(
    positions: dict[str, tuple[float, float]],
    node_ids: list[str | None],
    min_gap: float = 1.2,
) -> None:
    """Spread nodes apart vertically so no two are closer than *min_gap*.

    Operates in-place on *positions*.  Only considers non-None entries in
    *node_ids* that actually exist in *positions*.
    """
    real = [nid for nid in node_ids if nid and nid in positions]
    if len(real) < 2:
        return
    # Sort by current y (top-to-bottom)
    real.sort(key=lambda nid: -positions[nid][1])
    # Compute centroid so we re-centre afterwards
    centroid = sum(positions[nid][1] for nid in real) / len(real)
    # Make sure gaps are at least min_gap
    ys = [positions[real[0]][1]]
    for i in range(1, len(real)):
        prev_y = ys[-1]
        cur_y = positions[real[i]][1]
        if prev_y - cur_y < min_gap:
            cur_y = prev_y - min_gap
        ys.append(cur_y)
    # Re-centre around original centroid
    new_centroid = sum(ys) / len(ys)
    shift = centroid - new_centroid
    for nid, y in zip(real, ys):
        x = positions[nid][0]
        positions[nid] = (x, y + shift)


# ────────────────────────────────────────────────────────────────────────────
# Single‑elimination bracket builder
# ────────────────────────────────────────────────────────────────────────────


def _build_single_elim_bracket(
    G: nx.DiGraph,
    positions: dict,
    node_meta: dict,
    stages: list,
    advance_nodes: list[str],
    n_teams: int,
    x_start: float,
    slot_spacing: float,
    match_labels: dict[str, dict] | None = None,
    num_winners: int = 1,
    third_place: bool = False,
):
    col_step = _col_step(match_labels)
    box_h = _label_box_height(match_labels)
    bracket_size = _next_power_of_two(n_teams)
    full_depth = int(math.log2(bracket_size)) if bracket_size > 1 else 1
    # Truncated brackets stop early (N=3 stops after the semi-finals); labels keep the full depth.
    cut = 1 if num_winners == 3 else int(math.log2(num_winners)) if num_winners > 1 else 0
    num_rounds = max(1, full_depth - cut)

    # Apply standard tournament seeding (1-vs-N, 2-vs-N-1, …) so that
    # same-group players land on opposite sides of the bracket.
    seed_order = _make_seed_order(bracket_size)
    prev_round_nodes: list[str | None] = [
        advance_nodes[seed_idx] if seed_idx < n_teams else None for seed_idx in seed_order
    ]

    # ── Reorder advance-node y-positions to match bracket slot order ─────
    # This makes edges from advance → round-1 go straight across,
    # eliminating visual crossings.
    y_pool = sorted((positions[n][1] for n in advance_nodes), reverse=True)
    y_idx = 0
    for bracket_slot in range(bracket_size):
        si = seed_order[bracket_slot]
        if si < n_teams:
            nid = advance_nodes[si]
            positions[nid] = (positions[nid][0], y_pool[y_idx])
            y_idx += 1

    semi_round_nodes: list[str] = []
    for r in range(num_rounds):
        round_label = _round_label(full_depth, r)
        round_nodes: list[str | None] = []
        x_round = x_start + r * col_step
        num_pairs = len(prev_round_nodes) // 2

        # Vertical placement: centre each match between its two feeder nodes
        for p_idx in range(num_pairs):
            n1 = prev_round_nodes[2 * p_idx]
            n2 = prev_round_nodes[2 * p_idx + 1]

            mid = f"match_r{r}_p{p_idx}"

            # Determine y from feeder positions (or fall back to even spacing)
            y1 = positions[n1][1] if n1 and n1 in positions else None
            y2 = positions[n2][1] if n2 and n2 in positions else None
            if y1 is not None and y2 is not None:
                y_mid = (y1 + y2) / 2
            elif y1 is not None:
                y_mid = y1
            elif y2 is not None:
                y_mid = y2
            else:
                y_mid = 0

            # Handle byes in the first round
            if r == 0 and n1 is not None and n2 is None:
                # Bye — route through a bye marker so the graph stays linear
                bye_id = f"bye_r0_p{p_idx}"
                G.add_node(bye_id)
                node_meta[bye_id] = {"label": "BYE", "kind": BracketNodeKind.BYE, "stage": 2 + r}
                positions[bye_id] = (x_round, y_mid)
                G.add_edge(n1, bye_id)
                round_nodes.append(bye_id)  # bye feeds into next round
                continue
            if r == 0 and n1 is None and n2 is not None:
                bye_id = f"bye_r0_p{p_idx}"
                G.add_node(bye_id)
                node_meta[bye_id] = {"label": "BYE", "kind": BracketNodeKind.BYE, "stage": 2 + r}
                positions[bye_id] = (x_round, y_mid)
                G.add_edge(n2, bye_id)
                round_nodes.append(bye_id)  # bye feeds into next round
                continue
            if r == 0 and n1 is None and n2 is None:
                round_nodes.append(None)
                continue

            # Create match node
            label = f"Match {p_idx + 1}" if num_pairs > 1 else ""
            G.add_node(mid)
            node_meta[mid] = {
                "label": label,
                "kind": BracketNodeKind.MATCH,
                "stage": 2 + r,
                "round": round_label,
                "round_header": round_label,
            }
            # Overlay actual team names + score if available
            md = (match_labels or {}).get(mid)
            if md:
                _apply_match_data(node_meta[mid], md)
            positions[mid] = (x_round, y_mid)

            # Edges from feeders
            # Advance/bye nodes connect with neutral; prior matches with win
            # (the winner of that match advances here).
            for feeder in (n1, n2):
                if feeder is not None:
                    feeder_kind = node_meta.get(feeder, {}).get("kind", "")
                    rel = "neutral" if feeder_kind in (BracketNodeKind.ADVANCE, BracketNodeKind.BYE) else "win"
                    G.add_edge(feeder, mid, relation=rel)

            round_nodes.append(mid)

        # Ensure match nodes in this round don't overlap
        _enforce_min_spacing(positions, round_nodes, min_gap=box_h + _ROW_GAP if match_labels else 1.2)

        stage_nodes = [n for n in round_nodes if n and n.startswith("match_")]
        if stage_nodes:
            stages.append({"name": round_label, "x": x_round, "nodes": stage_nodes})

        prev_round_nodes = round_nodes
        if third_place and r == full_depth - 2:
            semi_round_nodes = [n for n in round_nodes if n and n.startswith("match_")]

    # ── Optional 3rd-place match: fed by the semi-final losers ──────────
    if third_place and full_depth >= 2 and len(semi_round_nodes) == 2:
        tp_id = "third_place"
        x_tp = x_start + (full_depth - 1) * col_step
        y_tp = min(positions[n][1] for n in semi_round_nodes) - slot_spacing * 1.5
        # Keep it clear of the final that sits at the same x.
        final_id = f"match_r{full_depth - 1}_p0"
        if final_id in positions:
            y_tp = min(y_tp, positions[final_id][1] - slot_spacing * 2.0)
        G.add_node(tp_id)
        node_meta[tp_id] = {
            "label": "3rd Place",
            "kind": BracketNodeKind.MATCH,
            "stage": 2 + full_depth - 1,
            "round": "3rd Place",
            "round_header": "3rd Place",
        }
        md = (match_labels or {}).get(tp_id)
        if md:
            _apply_match_data(node_meta[tp_id], md)
        positions[tp_id] = (x_tp, y_tp)
        for semi in semi_round_nodes:
            G.add_edge(semi, tp_id, relation="loss")
        stages.append({"name": "3rd Place", "x": x_tp, "nodes": [tp_id]})


def _make_seed_order(n: int) -> list[int]:
    """Standard tournament bracket seeding.

    Returns a list of length *n* where ``result[position] = seed_index``.
    Ensures strongest-vs-weakest matchups and that top seeds are placed
    on opposite sides of the bracket (e.g. seeds 1 & 2 can only meet in
    the final).

    For *n* = 4 → [0, 3, 1, 2]  (SF1: 1v4, SF2: 2v3)
    For *n* = 8 → [0, 7, 3, 4, 1, 6, 2, 5]
    """
    if n == 1:
        return [0]
    prev = _make_seed_order(n // 2)
    result: list[int] = []
    for s in prev:
        result.append(s)
        result.append(n - 1 - s)
    return result


# ────────────────────────────────────────────────────────────────────────────
# Double‑elimination bracket builder
# ────────────────────────────────────────────────────────────────────────────


def _build_double_elim_bracket(
    G: nx.DiGraph,
    positions: dict,
    node_meta: dict,
    stages: list,
    advance_nodes: list[str],
    n_teams: int,
    x_start: float,
    slot_spacing: float,
    match_labels: dict[str, dict] | None = None,
):
    """
    Build a double-elimination bracket layout.

    The diagram shows:
      - Winners bracket (upper half)
      - Losers bracket (lower half)
      - Single Grand Final
    """
    col_step = _col_step(match_labels)
    box_h = _label_box_height(match_labels)
    bracket_size = _next_power_of_two(n_teams)
    num_rounds_w = int(math.log2(bracket_size)) if bracket_size > 1 else 1

    # Apply standard tournament seeding.
    seed_order = _make_seed_order(bracket_size)
    w_prev: list[str | None] = [advance_nodes[seed_idx] if seed_idx < n_teams else None for seed_idx in seed_order]

    # ── Reorder advance-node y-positions to match bracket slot order ─────
    y_pool = sorted((positions[n][1] for n in advance_nodes), reverse=True)
    y_idx = 0
    for bracket_slot in range(bracket_size):
        si = seed_order[bracket_slot]
        if si < n_teams:
            nid = advance_nodes[si]
            positions[nid] = (positions[nid][0], y_pool[y_idx])
            y_idx += 1

    # The dense DE layout puts the losers rounds in columns between the winners rounds, so the winners
    # step is wider than a single-elimination one.
    _W_STEP = 4.0 if not match_labels else 1.5 * col_step

    x_round = x_start

    w_match_nodes_per_round: list[list[str]] = []

    for r in range(num_rounds_w):
        x_round = x_start + r * _W_STEP
        num_pairs = len(w_prev) // 2
        w_curr: list[str | None] = []
        round_match_nodes: list[str] = []

        for p_idx in range(num_pairs):
            n1 = w_prev[2 * p_idx]
            n2 = w_prev[2 * p_idx + 1]
            mid = f"w_r{r}_p{p_idx}"

            y1 = positions[n1][1] if n1 and n1 in positions else None
            y2 = positions[n2][1] if n2 and n2 in positions else None
            if y1 is not None and y2 is not None:
                y_mid = (y1 + y2) / 2
            elif y1 is not None:
                y_mid = y1
            elif y2 is not None:
                y_mid = y2
            else:
                y_mid = 0

            # Handle byes
            if r == 0 and n1 is not None and n2 is None:
                w_curr.append(n1)
                continue
            if r == 0 and n1 is None and n2 is not None:
                w_curr.append(n2)
                continue
            if r == 0 and n1 is None and n2 is None:
                w_curr.append(None)
                continue

            round_name = f"Winners R{r + 1}"
            label = f"Match {p_idx + 1}" if num_pairs > 1 else ""
            G.add_node(mid)
            node_meta[mid] = {
                "label": label,
                "kind": BracketNodeKind.WINNERS_MATCH,
                "stage": 2 + r,
                "round_header": round_name + (f" · M{p_idx + 1}" if match_labels and num_pairs > 1 else ""),
                "code": f"WR{r + 1}" + (f" M{p_idx + 1}" if num_pairs > 1 else ""),
            }
            # Overlay actual team names + score if available
            md = (match_labels or {}).get(mid)
            if md:
                _apply_match_data(node_meta[mid], md)
            positions[mid] = (x_round, y_mid)

            for feeder in (n1, n2):
                if feeder:
                    feeder_kind = node_meta.get(feeder, {}).get("kind", "")
                    rel = "neutral" if feeder_kind in (BracketNodeKind.ADVANCE, BracketNodeKind.BYE) else "win"
                    G.add_edge(feeder, mid, relation=rel)
            w_curr.append(mid)
            round_match_nodes.append(mid)

        w_match_nodes_per_round.append(round_match_nodes)
        stage_nodes = [n for n in w_curr if n and n.startswith("w_")]
        if stage_nodes:
            stages.append({"name": f"Winners R{r + 1}", "x": x_round, "nodes": stage_nodes})
        w_prev = w_curr

    winners_final_node = w_prev[0] if w_prev else None

    # ── Losers bracket (topology-driven) ───────────────────────────────
    # The bracket topology is obtained from the same engine that runs the
    # actual tournament, so the viz is always structurally consistent with
    # playoff.py — no duplicate pairing logic needed.
    topo = _DEB.for_preview(n_teams).topology()

    # Reverse map: topo_match_id → [(from_id, to_slot, is_loser)]
    edges_to: dict[str, list[tuple[str, int, bool]]] = {}
    for _edge in topo.advancement_edges:
        edges_to.setdefault(_edge.to_id, []).append((_edge.from_id, _edge.to_slot, _edge.is_loser))

    # Map topo match IDs → already-created viz node IDs for WR matches.
    id_to_viz: dict[str, str | None] = {}
    for _r, _wr_round in enumerate(topo.winners_rounds):
        for _mref in _wr_round:
            _vn = f"w_r{_r}_p{_mref.pair_index}"
            id_to_viz[_mref.id] = _vn if _vn in positions else None
    id_to_viz[topo.grand_final.id] = "grand_final"  # created in the next section

    # Place losers well below the lowest node in the winners region.
    lowest_winners_y = min(
        positions[n][1]
        for n in positions
        if node_meta.get(n, {}).get("kind")
        in (BracketNodeKind.WINNERS_MATCH, BracketNodeKind.ADVANCE, BracketNodeKind.GROUP, BracketNodeKind.BYE)
    )
    losers_gap = box_h + (1.6 if match_labels else 1.2)
    y_losers_top = lowest_winners_y - losers_gap
    losers_stage_offset = 2 + num_rounds_w

    # Pre-compute LR round x-positions: midpoints between winners columns.
    w_xs = [x_start + _r * _W_STEP for _r in range(num_rounds_w)]
    w_step = _W_STEP
    losers_x_slots: list[float] = []
    for _i in range(len(w_xs) - 1):
        losers_x_slots.append((w_xs[_i] + w_xs[_i + 1]) / 2)
    for _ in range(len(topo.losers_rounds) - len(losers_x_slots)):
        _last_x = losers_x_slots[-1] if losers_x_slots else x_start + w_step / 2
        losers_x_slots.append(_last_x + w_step)

    # Stacking cursor: when both feeders are in the winners region, assign
    # distinct y-slots to prevent edges from passing through other cells.
    _y_losers_cursor = y_losers_top
    _LOSERS_STACK_GAP = box_h + 0.4

    losers_idx_to_node: dict[int, str] = {}  # global_idx → viz node ID
    global_idx = 0  # sequential index of real (non-bye) LR matches
    losers_final_node: str | None = None

    for _lr_round_idx, _lr_round in enumerate(topo.losers_rounds):
        _round_num = _lr_round_idx + 1
        _round_name = f"Losers R{_round_num}"
        _x_lr = (
            losers_x_slots[_lr_round_idx]
            if _lr_round_idx < len(losers_x_slots)
            else (losers_x_slots[-1] + w_step if losers_x_slots else x_start + w_step / 2)
        )
        _round_nodes: list[str] = []

        for _mref in _lr_round:
            _feeders = edges_to.get(_mref.id, [])

            # A LR match with fewer than 2 incoming edges is a bye slot —
            # skip it.  Both _build_match_labels and this loop skip byes,
            # keeping global_idx aligned with the l_{idx} keys in match_labels.
            if len(_feeders) < 2:
                id_to_viz[_mref.id] = None
                continue

            # Resolve feeder viz nodes and their y-positions.
            _feeder_vns = [id_to_viz.get(_fid) for _fid, _, _ in _feeders]
            _feeder_ys = [positions[_fv][1] for _fv in _feeder_vns if _fv and _fv in positions]
            _feeder_in_losers = [
                positions[_fv][1] <= y_losers_top + 0.01 for _fv in _feeder_vns if _fv and _fv in positions
            ]

            # x/y placement depends on whether feeders come from the winners or
            # losers bracket.
            _feeder_xs = [positions[_fv][0] for _fv in _feeder_vns if _fv and _fv in positions]
            _all_from_winners = bool(_feeder_ys) and not any(_feeder_in_losers)

            if len(_feeder_ys) == 2:
                if all(_feeder_in_losers):
                    _y_mid = (_feeder_ys[0] + _feeder_ys[1]) / 2
                    _x_eff = _x_lr
                elif any(_feeder_in_losers):
                    _y_mid = _feeder_ys[_feeder_in_losers.index(True)]
                    _x_eff = _x_lr
                else:
                    # Both feeders are in the winners bracket.  The stacking cursor
                    # accumulated from earlier WR-drop rounds places this node far
                    # below its WR sources, making it appear disconnected.  Instead,
                    # anchor y just below the WR feeder midpoint (clamped into the
                    # LR zone) so the drop arrows stay short and visible.
                    _wf_y_mid = (_feeder_ys[0] + _feeder_ys[1]) / 2
                    _y_mid = min(y_losers_top - _LOSERS_STACK_GAP * 0.25, _wf_y_mid - losers_gap)
                    # Snap x to the midpoint between the WR source column and the
                    # sequential LR slot so the drop edge stays a moderate diagonal
                    # rather than a long nearly-horizontal line.
                    _x_eff = (max(_feeder_xs) + _x_lr) / 2 if _feeder_xs else _x_lr
            elif _feeder_ys:
                _y_mid = _feeder_ys[0]
                _x_eff = _x_lr
            else:
                _y_mid = _y_losers_cursor
                _y_losers_cursor -= _LOSERS_STACK_GAP
                _x_eff = _x_lr

            _mid = f"l_{global_idx}"
            _label = f"Match {_mref.pair_index + 1}" if len(_lr_round) > 1 else ""
            G.add_node(_mid)
            node_meta[_mid] = {
                "label": _label,
                "kind": BracketNodeKind.LOSERS_MATCH,
                "stage": losers_stage_offset + _lr_round_idx,
                "round_header": _round_name
                + (f" · M{_mref.pair_index + 1}" if match_labels and len(_lr_round) > 1 else ""),
                "code": f"LR{_round_num}" + (f" M{_mref.pair_index + 1}" if len(_lr_round) > 1 else ""),
            }
            _md = (match_labels or {}).get(f"l_{global_idx}")
            if _md:
                _apply_match_data(node_meta[_mid], _md)
            positions[_mid] = (_x_eff, _y_mid)
            id_to_viz[_mref.id] = _mid
            losers_idx_to_node[global_idx] = _mid
            _round_nodes.append(_mid)
            losers_final_node = _mid
            global_idx += 1

        if _round_nodes:
            _enforce_min_spacing(positions, _round_nodes, min_gap=box_h + _ROW_GAP)
            if match_labels:
                # Spreading and re-centring a round must not lift it into the winners region.
                _overshoot = max(positions[n][1] for n in _round_nodes) - (y_losers_top + box_h / 2)
                if _overshoot > 0:
                    for n in _round_nodes:
                        positions[n] = (positions[n][0], positions[n][1] - _overshoot)
            # Use the actual x of the round's nodes as the column header position
            # (may differ from _x_lr when nodes were x-snapped to WR source columns).
            _stage_x = sum(positions[n][0] for n in _round_nodes) / len(_round_nodes)
            stages.append({"name": _round_name, "x": _stage_x, "nodes": _round_nodes})

    # Add topology-driven edges between bracket matches.
    # WR→WR winner edges are already added by the winners loop above, so skip them.
    #
    # Some LR matches are bye slots (only 1 real feeder) and are skipped in the
    # viz layout — id_to_viz maps their topo ID to None.  We resolve those through
    # the topology's winner-forward chain so the edges that *should* skip over a
    # bye are drawn directly to the first real viz node downstream.
    _winner_forward: dict[str, str] = {}
    for _e in topo.advancement_edges:
        if not _e.is_loser:
            _winner_forward[_e.from_id] = _e.to_id

    def _resolve_viz(topo_id: str) -> str | None:
        """Follow winner paths through skipped bye matches to find a real viz node."""
        _seen: set[str] = set()
        _curr: str | None = topo_id
        while _curr and _curr not in _seen:
            _vn = id_to_viz.get(_curr)
            if _vn is not None:
                return _vn
            _seen.add(_curr)
            _curr = _winner_forward.get(_curr)
        return None

    for _edge in topo.advancement_edges:
        _from_viz = id_to_viz.get(_edge.from_id)
        if not _from_viz or _from_viz not in positions:
            continue
        _to_viz = _resolve_viz(_edge.to_id)
        if not _to_viz or _to_viz not in positions:
            continue
        if node_meta.get(_to_viz, {}).get("kind") == BracketNodeKind.WINNERS_MATCH:
            continue  # WR→WR edges already created by winners loop
        _relation = "loss" if _edge.is_loser else "win"
        if G.has_edge(_from_viz, _to_viz):
            G.edges[_from_viz, _to_viz]["relation"] = _relation
        else:
            G.add_edge(_from_viz, _to_viz, relation=_relation)

    # ── Data-driven loss-edge rewiring ──────────────────────────────────
    # The structural loss edges above are determined by bracket position,
    # but the game engine uses a FIFO queue so the actual losers-bracket
    # match-ups depend on match completion order.  When match_labels
    # carry ``loser`` info we can trace each winners-match loser to the
    # specific losers-bracket match where they actually appear and
    # redraw the loss edge accordingly.
    if match_labels and losers_idx_to_node:
        # Map team name → first losers-bracket node they appear in.
        team_first_losers: dict[str, str] = {}
        for idx in sorted(losers_idx_to_node):
            nid = losers_idx_to_node[idx]
            md = match_labels.get(f"l_{idx}")
            if md:
                for tk in ("team1", "team2"):
                    tn = md.get(tk)
                    if tn and tn != "TBD" and tn not in team_first_losers:
                        team_first_losers[tn] = nid

        if team_first_losers:
            for r_nodes in w_match_nodes_per_round:
                for wn in r_nodes:
                    wn_md = match_labels.get(wn)
                    if not wn_md or not wn_md.get("loser"):
                        continue
                    loser_name = wn_md["loser"]
                    target = team_first_losers.get(loser_name)
                    if target is None:
                        continue
                    # Remove structural loss edge(s) from this winners match.
                    for succ in list(G.successors(wn)):
                        if G.edges[wn, succ].get("relation") == "loss":
                            G.remove_edge(wn, succ)
                    # Add correct loss edge.
                    if G.has_edge(wn, target):
                        G.edges[wn, target]["relation"] = "loss"
                    else:
                        G.add_edge(wn, target, relation="loss")

    # ── Grand Final ─────────────────────────────────────────────────────
    x_gf = max(positions[n][0] for n in G.nodes() if n in positions) + col_step
    y_gf = 0.0
    gf_id = "grand_final"
    G.add_node(gf_id)
    gf_meta: dict = {"label": "", "kind": BracketNodeKind.GRAND_FINAL, "stage": 90, "round_header": "Grand Final"}
    gf_md = (match_labels or {}).get("grand_final")
    if gf_md:
        _apply_match_data(gf_meta, gf_md)
    node_meta[gf_id] = gf_meta
    positions[gf_id] = (x_gf, y_gf)

    if winners_final_node:
        G.add_edge(winners_final_node, gf_id, relation="win")
    if losers_final_node:
        G.add_edge(losers_final_node, gf_id, relation="win")

    stages.append({"name": "Grand Final", "x": x_gf, "nodes": [gf_id]})


# ────────────────────────────────────────────────────────────────────────────
# Renderer
# ────────────────────────────────────────────────────────────────────────────

# Themes: "light" and "dark" draw the app's own colours ("Hardcourt Nights", see
# frontend/admin-app/src/theme/palette.ts) into the image. "css" draws an SVG whose colours are CSS
# variables (``var(--br-<role>, <light colour>)``), so a page that inserts the SVG into its HTML
# restyles it with its own theme; the fallbacks keep it readable when it is opened on its own.
SchemaTheme = Literal["light", "dark", "css"]


@dataclass(frozen=True)
class _Palette:
    bg: str
    surface: str
    border: str
    text: str
    muted: str
    accent: str
    loss: str
    gold: str
    on_gold: str


_PALETTES: dict[str, _Palette] = {
    "light": _Palette(
        bg="#eff2f6",
        surface="#fafbfc",
        border="#bfc9d8",
        text="#0d1520",
        muted="#4a5a6e",
        accent="#1a5fa3",
        loss="#c0301e",
        gold="#b89000",
        on_gold="#0d1520",
    ),
    "dark": _Palette(
        bg="#07101c",
        surface="#0e1c2e",
        border="#2a3f5a",
        text="#e4ecf5",
        muted="#8ea6be",
        accent="#2e8ad4",
        loss="#ef4444",
        gold="#d4a800",
        on_gold="#07101c",
    ),
    # Placeholder colours, replaced by CSS variables after drawing (see ``_css_variables``).
    "css": _Palette(
        bg="#0b0c01",
        surface="#0b0c02",
        border="#0b0c03",
        text="#0b0c04",
        muted="#0b0c05",
        accent="#0b0c06",
        loss="#0b0c07",
        gold="#0b0c08",
        on_gold="#0b0c09",
    ),
}

# Group colours stay fixed in every theme: white text on a mid-tone fill reads on light and dark.
_GROUP_COLOURS: list[dict[str, str]] = [
    {"fc": "#5B9BD5", "ec": "#3A6FA0", "tc": "white"},  # soft blue
    {"fc": "#70AD47", "ec": "#4E7A31", "tc": "white"},  # soft green
    {"fc": "#ED7D31", "ec": "#B85D1A", "tc": "white"},  # soft orange
    {"fc": "#A47FC4", "ec": "#7A5A9A", "tc": "white"},  # soft purple
    {"fc": "#E06B6B", "ec": "#B04848", "tc": "white"},  # soft red
    {"fc": "#4DBFBF", "ec": "#338A8A", "tc": "white"},  # soft teal
]


def _node_styles(p: _Palette) -> dict[str, dict[str, str]]:
    """Node kind → facecolor, edgecolor, text colour. Matches are cards; the edge marks the kind."""
    card = {"fc": p.surface, "ec": p.border, "tc": p.text}
    return {
        BracketNodeKind.GROUP: {"fc": p.accent, "ec": p.accent, "tc": "white"},
        BracketNodeKind.ADVANCE: card,
        BracketNodeKind.BYE: {"fc": p.bg, "ec": p.border, "tc": p.muted},
        BracketNodeKind.MATCH: card,
        BracketNodeKind.WINNERS_MATCH: card,
        BracketNodeKind.LOSERS_MATCH: {**card, "ec": p.loss},
        BracketNodeKind.LOSERS_BLOCK: {**card, "ec": p.loss},
        BracketNodeKind.GRAND_FINAL: {**card, "ec": p.gold},
        BracketNodeKind.CHAMPION: {"fc": p.gold, "ec": p.gold, "tc": p.on_gold},
    }


def _round_styles(p: _Palette) -> dict[str, dict[str, str]]:
    """Per-round overrides for play-off match nodes: the Final gets a gold edge."""
    return {"Final": {"fc": p.surface, "ec": p.gold, "tc": p.text}}


def _edge_styles(p: _Palette) -> dict[str, dict]:
    """Edge styles by relation type."""
    return {
        "win": {"color": p.accent, "lw": 1.8, "linestyle": "solid"},
        "loss": {"color": p.loss, "lw": 1.6, "linestyle": (0, (5, 3))},
        "neutral": {"color": p.muted, "lw": 1.4, "linestyle": "solid"},
    }


def _group_style(group_index: int) -> dict[str, str]:
    """Return the colour style for a group node by index."""
    return _GROUP_COLOURS[group_index % len(_GROUP_COLOURS)]


def _advance_style(group_index: int, p: _Palette) -> dict[str, str]:
    """An advance node is a card edged in its group's colour."""
    return {"fc": p.surface, "ec": _group_style(group_index)["fc"], "tc": p.text}


# ── Font ────────────────────────────────────────────────────────────────────
# Onest, the app's body face, built by scripts/build_schema_fonts.py: one family per unicode subset,
# so matplotlib falls back from Latin to Cyrillic per glyph. An SVG for the "css" theme names
# ``var(--br-font)`` instead, so the page's own font draws the text.
_FONT_DIR = Path(__file__).parent / "fonts"
_FONT_FAMILIES = ["Onest", "Onest LatinExt", "Onest Cyrillic", "Onest CyrillicExt", "DejaVu Sans"]
_fonts_registered = False


def _register_fonts() -> None:
    global _fonts_registered
    if _fonts_registered:
        return
    for path in sorted(_FONT_DIR.glob("*.ttf")):
        font_manager.fontManager.addfont(str(path))
    _fonts_registered = True


def _rc(theme: SchemaTheme) -> dict:
    """matplotlib settings for one render; applied with ``plt.rc_context`` so nothing leaks."""
    _register_fonts()
    rc: dict = {"font.family": _FONT_FAMILIES}
    if theme == "css":
        rc["svg.fonttype"] = "none"  # keep text as <text>, so the page font and colours apply
        rc["svg.hashsalt"] = "amistoso-bracket"  # stable element ids, so equal brackets give equal bytes
    return rc


def _css_variables(svg: bytes, text_pt: float | None = None, window: tuple[int, int, int] | None = None) -> bytes:
    """Replace the "css" theme's placeholder colours and font with CSS variables (light fallbacks).

    *text_pt* (the name font size in viewBox units) goes onto the root as ``data-text-pt``,
    so the page can keep names above a minimum on-screen size.  *window* is
    ``(first, last, total)`` round numbers of a trimmed bracket (``data-rounds-*``).
    """
    text = svg.decode()
    attrs = f'data-text-pt="{text_pt:.2f}" ' if text_pt is not None else ""
    if window:
        attrs += f'data-rounds-from="{window[0]}" data-rounds-to="{window[1]}" data-rounds-total="{window[2]}" '
    if attrs:
        text = text.replace("<svg ", f"<svg {attrs}", 1)
    light = _PALETTES["light"]
    for role, placeholder in vars(_PALETTES["css"]).items():
        var = f"var(--br-{role.replace('_', '-')}, {getattr(light, role)})"
        text = re.sub(re.escape(placeholder), var, text, flags=re.IGNORECASE)
    text = re.sub(r"font-family:[^;\"]*", "font-family: var(--br-font, 'Onest', sans-serif)", text)
    # The <metadata> block only carries a creation timestamp; dropping it keeps the bytes stable.
    text = re.sub(r"<metadata>.*?</metadata>\s*", "", text, flags=re.DOTALL)
    return text.encode()


def _draw(
    layout: dict,
    *,
    title: str | None,
    figsize: tuple[float, float] | None,
    dpi: int,
    box_scale: float = 1.0,
    line_width: float = 1.0,
    arrow_scale: float = 1.0,
    title_font_scale: float = 1.0,
    output_scale: float = 1.0,
    palette: _Palette = _PALETTES["light"],
) -> plt.Figure:
    """Render the layout dict to a matplotlib Figure."""
    node_styles = _node_styles(palette)
    round_styles = _round_styles(palette)
    edge_styles = _edge_styles(palette)
    G = layout["graph"]
    positions = layout["positions"]
    node_meta = layout["node_meta"]
    stages = layout["stages"]

    if not positions:
        fig, ax = plt.subplots(figsize=(4, 2))
        fig.set_facecolor(palette.bg)
        ax.text(0.5, 0.5, "No data", ha="center", va="center", fontsize=14, color=palette.muted)
        ax.axis("off")
        return fig

    # Auto figure size
    xs = [p[0] for p in positions.values()]
    ys = [p[1] for p in positions.values()]
    x_span = max(xs) - min(xs) + 4
    y_span = max(ys) - min(ys) + 4
    team_boxes = bool(layout.get("team_boxes"))
    half_box = layout.get("box_h", _PLAIN_BOX_H) * box_scale / 2
    if team_boxes:
        y_span = max(ys) - min(ys) + 2 * half_box + 0.75  # the height of the limits below
    # One side of a double bracket has the column density of a single bracket.
    _is_double = layout.get("elimination") == EliminationType.DOUBLE and not layout.get("sided")
    if figsize is None:
        # Minimum canvas sizes only for boxes without names; a bracket with names is as big as its
        # content, so the names keep one size at every bracket size.
        floor_w, floor_h = (0, 0) if team_boxes else ((16, 10) if _is_double else (12, 6))
        if _is_double:
            figsize = (max(floor_w, x_span * 1.55), max(floor_h, y_span * 1.35))
        else:
            figsize = (max(floor_w, x_span * 1.3), max(floor_h, y_span * 1.1))
    figsize = (max(4.0, figsize[0] * output_scale), max(3.0, figsize[1] * output_scale))

    # Box text is sized to the boxes: points per data unit, relative to the
    # 1.3 in (x) / 1.0 in (y) per unit the automatic figure size gives.  A
    # figure stretched to its minimum size, or scaled by ``output_scale``,
    # keeps the same text-to-box ratio.
    margin = 2.0
    x_lim = (min(xs) - margin, max(xs) + margin)
    if team_boxes:
        # No column headers: the margins are a small border around the boxes.
        y_top = max(ys) + half_box + 0.3
        y_lim = (min(ys) - half_box - 0.3, y_top + 0.15)
    else:
        y_top = max(ys) + 1.5
        y_lim = (min(ys) - margin, y_top + 1.0)
    text_k = box_scale * min(
        figsize[0] / (x_lim[1] - x_lim[0]) / 1.3,
        figsize[1] / (y_lim[1] - y_lim[0]) / 1.0,
    )

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    fig.set_facecolor(palette.bg)
    ax.set_facecolor(palette.bg)
    ax.axis("off")

    if title:
        ax.set_title(title, fontsize=16, fontweight="bold", pad=20, color=palette.text)

    def _node_box_size(kind: str) -> tuple[float, float]:
        """Box size in data units for a given node kind."""
        if kind in (BracketNodeKind.GROUP, BracketNodeKind.LOSERS_BLOCK):
            return 1.8 * box_scale, 0.9 * box_scale
        if kind == BracketNodeKind.CHAMPION:
            return 1.8 * box_scale, 0.7 * box_scale
        if kind == BracketNodeKind.GRAND_FINAL:
            return 1.8 * box_scale, 0.7 * box_scale
        if kind == BracketNodeKind.ADVANCE:
            return 1.3 * box_scale, 0.5 * box_scale
        if kind == BracketNodeKind.BYE:
            return 0.9 * box_scale, 0.4 * box_scale
        return 1.6 * box_scale, 0.85 * box_scale

    def _edge_center_anchor(
        cx: float,
        cy: float,
        bw: float,
        bh: float,
        dx: float,
        dy: float,
    ) -> tuple[float, float]:
        """Anchor at the center of the box edge facing (dx, dy)."""
        if abs(dx) < 1e-9 and abs(dy) < 1e-9:
            return cx, cy
        if abs(dx) >= abs(dy):
            return cx + (bw / 2 if dx > 0 else -bw / 2), cy
        return cx, cy + (bh / 2 if dy > 0 else -bh / 2)

    team_box_h = layout.get("box_h", _PLAIN_BOX_H)
    node_sizes: dict[str, tuple[float, float]] = {}
    for nid in G.nodes():
        meta = node_meta.get(nid, {})
        kind = meta.get("kind", BracketNodeKind.MATCH)
        bw, bh = _node_box_size(kind)
        if meta.get("has_teams"):
            # One height for every team box of the bracket (see _label_box_height).
            bh = team_box_h * box_scale
            bw = _BOX_W * box_scale
        elif meta.get("bye_team"):
            # A team with a bye, in the first-round column next to the match boxes.
            bw, bh = _BOX_W * box_scale, 1.0 * box_scale
        node_sizes[nid] = (bw, bh)

    # ── Draw edges ──────────────────────────────────────────────────────
    _base_arrow_ms = 15 * arrow_scale
    for u, v, edata in G.edges(data=True):
        if u not in positions or v not in positions:
            continue
        x0, y0 = positions[u]
        x1, y1 = positions[v]
        bw0, bh0 = node_sizes.get(u, _node_box_size(BracketNodeKind.MATCH))
        bw1, bh1 = node_sizes.get(v, _node_box_size(BracketNodeKind.MATCH))
        dx, dy = x1 - x0, y1 - y0

        sx, sy = _edge_center_anchor(x0, y0, bw0, bh0, dx, dy)
        tx, ty = _edge_center_anchor(x1, y1, bw1, bh1, -dx, -dy)

        rel = edata.get("relation", "neutral")
        es = edge_styles.get(rel, edge_styles["neutral"])
        edge_lw = es["lw"] * line_width
        # Loss edges arc downward (negative rad) so they visually separate from
        # win/neutral edges; the curvature increases with line distance so that
        # multiple parallel loss edges fan out and are individually traceable.
        _dx = abs(tx - sx)
        _dy = abs(ty - sy)
        _dist = max(0.5, (_dx**2 + _dy**2) ** 0.5)
        if rel == "loss":
            _rad = -(0.12 + min(0.18, _dist * 0.018))
        elif rel == "win":
            _rad = 0.06
        else:
            _rad = 0.04
        arrow = mpatches.FancyArrowPatch(
            (sx, sy),
            (tx, ty),
            arrowstyle="-|>,head_length=0.6,head_width=0.3",
            mutation_scale=_base_arrow_ms,
            linewidth=edge_lw,
            linestyle=es["linestyle"],
            color=es["color"],
            connectionstyle=f"arc3,rad={_rad}",
            zorder=2,
        )
        ax.add_patch(arrow)
        ax.plot(sx, sy, "o", color=es["color"], markersize=_base_arrow_ms * 0.25, zorder=5)

    # ── Draw nodes ──────────────────────────────────────────────────────
    row_jobs: list[tuple[float, float, float, float, dict, str]] = []
    fit_jobs: list[tuple[object, float, float, float, float]] = []
    for nid in G.nodes():
        if nid not in positions:
            continue
        meta = node_meta.get(nid, {})
        kind = meta.get("kind", BracketNodeKind.MATCH)
        label = meta.get("label", nid)
        gi = meta.get("group")
        rnd = meta.get("round")
        if kind == BracketNodeKind.GROUP and gi is not None:
            style = _group_style(gi)
        elif kind == BracketNodeKind.ADVANCE and gi is not None:
            style = _advance_style(gi, palette)
        elif kind == BracketNodeKind.MATCH and rnd and rnd in round_styles:
            style = round_styles[rnd]
        else:
            style = node_styles.get(kind, node_styles[BracketNodeKind.MATCH])

        x, y = positions[nid]

        # Box dimensions depend on kind (scaled by box_scale)
        bw, bh = node_sizes.get(nid, _node_box_size(kind))

        box = FancyBboxPatch(
            (x - bw / 2, y - bh / 2),
            bw,
            bh,
            boxstyle="round,pad=0.1",
            facecolor=style["fc"],
            edgecolor=style["ec"],
            linewidth=2 * line_width,
            zorder=3,
        )
        ax.add_patch(box)

        label_txt = None
        fontsize = (8 if kind == BracketNodeKind.BYE else (9 if kind == BracketNodeKind.ADVANCE else 10)) * text_k
        if meta.get("bye_team"):
            fontsize = 13 * text_k
        round_header = meta.get("round_header", "")
        header_fs = 10 * text_k * title_font_scale
        if round_header and meta.get("has_teams"):
            # Italic round header and a rule; the team rows are drawn after tight_layout (_draw_rows).
            ax.text(
                x,
                y + bh / 2 - 0.13 * box_scale,
                round_header,
                ha="center",
                va="top",
                fontsize=header_fs,
                fontstyle="italic",
                color=style["tc"],
                alpha=0.85,
                zorder=4,
            )
            ax.plot(
                [x - bw / 2 + 0.15, x + bw / 2 - 0.15],
                [y + bh / 2 - 0.38 * box_scale, y + bh / 2 - 0.38 * box_scale],
                color=style["tc"],
                alpha=0.25,
                linewidth=0.6,
                zorder=4,
            )
            row_jobs.append((x, y, bw, bh, meta["rows"], style["tc"]))
        elif round_header:
            # 2-line: italic round header at top, optional match label below
            ax.text(
                x,
                y + bh / 2 - 0.13 * box_scale,
                round_header,
                ha="center",
                va="top",
                fontsize=header_fs,
                fontstyle="italic",
                color=style["tc"],
                alpha=0.85,
                zorder=4,
            )
            if label:
                ax.plot(
                    [x - bw / 2 + 0.15, x + bw / 2 - 0.15],
                    [y + bh / 2 - 0.38 * box_scale, y + bh / 2 - 0.38 * box_scale],
                    color=style["tc"],
                    alpha=0.25,
                    linewidth=0.6,
                    zorder=4,
                )
                ax.text(
                    x,
                    y - 0.05 * box_scale,
                    label,
                    ha="center",
                    va="center",
                    fontsize=10 * text_k,
                    fontweight="bold",
                    color=style["tc"],
                    zorder=4,
                )
        else:
            label_txt = ax.text(
                x,
                y,
                label,
                ha="center",
                va="center",
                fontsize=fontsize,
                fontweight="bold",
                color=style["tc"],
                zorder=4,
            )
        if label_txt is not None and kind == BracketNodeKind.ADVANCE:
            fit_jobs.append((label_txt, x, y, bw, bh, True))

    # ── Stage column labels (top) ───────────────────────────────────────
    # Boxes with team names carry their round name inside, so those brackets have no column labels.
    seen_x: set[float] = set()
    for stage in stages if not team_boxes else []:
        sx = stage["x"]
        if sx in seen_x:
            continue
        seen_x.add(sx)
        ax.text(
            sx,
            y_top,
            stage["name"],
            ha="center",
            va="bottom",
            fontsize=12 * text_k / box_scale,
            fontstyle="italic",
            color=palette.muted,
        )

    ax.set_xlim(*x_lim)
    ax.set_ylim(*y_lim)

    fig.tight_layout()
    _fit_labels(fig, ax, fit_jobs)
    _draw_rows(fig, ax, row_jobs, palette, text_k, box_scale)
    # Name size in viewBox units (points), for the page's minimum-text-size rule.
    fig.amistoso_text_pt = 14 * text_k  # type: ignore[attr-defined]
    return fig


def _fit_labels(fig: plt.Figure, ax: plt.Axes, jobs: list[tuple]) -> None:
    """Keep each label inside its box: shrink, then wrap at " & ", then truncate.

    A job is ``(text, x, y, box_w, box_h)`` plus an optional ``wrap`` flag
    (default True); without wrapping, only shrinking and truncation apply.

    Measured with the renderer after ``tight_layout`` so the check holds for
    any figure size, dpi and ``box_scale``.
    """
    if not jobs:
        return
    renderer = fig.canvas.get_renderer()
    for txt, x, y, bw, bh, *rest in jobs:
        wrap = rest[0] if rest else True
        (px0, py0), (px1, py1) = ax.transData.transform([(x - bw / 2, y - bh / 2), (x + bw / 2, y + bh / 2)])
        max_w, max_h = px1 - px0, py1 - py0

        def fits() -> bool:
            bb = txt.get_window_extent(renderer)
            return bb.width <= max_w and bb.height <= max_h

        if fits():
            continue
        full = txt.get_text()
        min_size = txt.get_fontsize() * 0.8
        txt.set_fontsize(min_size)
        if fits():
            continue
        if wrap and " & " in full:
            txt.set_text(full.replace(" & ", " &\n", 1))
            if fits():
                continue
        lines = txt.get_text().split("\n")
        if wrap and txt.get_window_extent(renderer).height > max_h:
            lines = [full]
        props = txt.get_fontproperties()

        def line_w(s: str) -> float:
            return renderer.get_text_width_height_descent(s, props, ismath=False)[0]

        for i, line in enumerate(lines):
            while len(line) > 2 and line_w(line) > max_w:
                line = line[:-2].rstrip() + "…"
            lines[i] = line
        txt.set_text("\n".join(lines))


def _draw_rows(
    fig: plt.Figure,
    ax: plt.Axes,
    jobs: list[tuple[float, float, float, float, dict, str]],
    palette: _Palette,
    text_k: float,
    box_scale: float,
) -> None:
    """Draw the rows of every team box: names left, each team's scores right in bold.

    A job is ``(x, y, box_w, box_h, rows, text colour)`` (rows from :func:`_match_rows`).  Names are
    cut with "..." to fit what the score column leaves, never shrunk, so every name stays at the
    bracket's name size.  Drawn after ``tight_layout`` so the measuring holds for any figure size,
    dpi and ``box_scale``.  Losers are muted; a withdrawn side's names are struck through
    (matplotlib text has no strikethrough, so the line is drawn from the measured width).
    """
    if not jobs:
        return
    renderer = fig.canvas.get_renderer()
    size = 14 * text_k
    font_px = size * fig.dpi / 72
    bold = font_manager.FontProperties(weight="bold", size=size)
    regular = font_manager.FontProperties(weight="normal", size=size)

    def width_data(text: str, props: font_manager.FontProperties) -> float:
        px = renderer.get_text_width_height_descent(text, props, ismath=False)[0]
        (x0, _), (x1, _) = ax.transData.inverted().transform([(0, 0), (px, 0)])
        return x1 - x0

    inv = ax.transData.inverted()

    def baseline_y(centre: float) -> float:
        """Data y of the baseline that puts the capitals of a line on *centre*."""
        return inv.transform((0, ax.transData.transform((0, centre))[1] - 0.35 * font_px))[1]

    pitch = _LINE_H * box_scale
    for x, y, bw, bh, rows, colour in jobs:
        left = x - bw / 2 + 0.12 * box_scale
        right = x + bw / 2 - 0.12 * box_scale
        names1, names2 = rows["lines"]
        top = y + bh / 2 - _HEADER_H * box_scale
        bottom = y - bh / 2 + 0.5 * _BOX_PAD * box_scale
        used = (len(names1) + len(names2)) * pitch + _DIVIDER_H * box_scale
        block_top = top - max(0.0, (top - bottom - used) / 2)
        # Score columns: as wide as the widest part, shared by both teams of this box.
        scores = rows["scores"]
        cols = max(len(scores[0]), len(scores[1]))
        col_w = max((width_data(t, bold) for team in scores for t in team), default=0.0) + 0.1 * box_scale
        name_w = right - left - (cols * col_w + 0.15 * box_scale if cols else 0.0)
        team_top = block_top
        for k, names in enumerate(rows["lines"]):
            for i, (name, style) in enumerate(zip(names, rows["styles"][k], strict=True)):
                while len(name) > 2 and width_data(name, regular) > name_w:
                    name = name[:-2].rstrip() + "…"
                base = baseline_y(team_top - (i + 0.5) * pitch)
                muted = style != "name"
                ax.text(
                    left,
                    base,
                    name,
                    ha="left",
                    va="baseline",
                    fontsize=size,
                    fontweight="normal",
                    color=palette.muted if muted else colour,
                    zorder=4,
                )
                if style == "walkover_loser":
                    strike = inv.transform((0, ax.transData.transform((0, base))[1] + 0.27 * font_px))[1]
                    w = width_data(name, regular)
                    pad = 0.08 * font_px * (inv.transform((1, 0))[0] - inv.transform((0, 0))[0])
                    ax.plot(
                        [left - pad, left + w + pad],
                        [strike, strike],
                        color=palette.muted,
                        linewidth=max(0.8, size * 0.09),
                        solid_capstyle="butt",
                        zorder=5,
                    )
            # The team's scores sit on its first line, each part right-aligned in its column.
            base = baseline_y(team_top - 0.5 * pitch)
            for c, part in enumerate(rows["scores"][k]):
                ax.text(
                    right - (cols - 1 - c) * col_w,
                    base,
                    part,
                    ha="right",
                    va="baseline",
                    fontsize=size,
                    fontweight="bold",
                    color=palette.muted if rows["styles"][k][0] != "name" else colour,
                    zorder=4,
                )
            team_top -= len(names) * pitch
            if k == 0:
                divider = team_top - _DIVIDER_H * box_scale / 2
                ax.plot([left, right], [divider, divider], color=colour, alpha=0.25, linewidth=0.6, zorder=4)
                team_top -= _DIVIDER_H * box_scale
