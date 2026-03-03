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
...     elimination="single",
... )
>>> Path("schema.png").write_bytes(png_bytes)
"""

from __future__ import annotations

import io
import math
from typing import Literal, Optional

import matplotlib

matplotlib.use("Agg")  # headless — no display needed
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import networkx as nx
from matplotlib.patches import FancyBboxPatch

# ────────────────────────────────────────────────────────────────────────────
# Public API
# ────────────────────────────────────────────────────────────────────────────


def render_schema(
    group_sizes: list[int],
    advance_per_group: int = 2,
    elimination: Literal["single", "double"] = "single",
    *,
    title: Optional[str] = None,
    fmt: Literal["png", "svg", "pdf"] = "png",
    dpi: int = 150,
    figsize: Optional[tuple[float, float]] = None,
    box_scale: float = 1.0,
    line_width: float = 1.0,
    arrow_scale: float = 1.0,
    title_font_scale: float = 1.0,
    output_scale: float = 1.0,
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

    Returns
    -------
    bytes
        The rendered image.
    """
    layout = _compute_layout(group_sizes, advance_per_group, elimination)
    fig = _draw(
        layout,
        title=title,
        figsize=figsize,
        dpi=dpi,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
        title_font_scale=title_font_scale,
        output_scale=output_scale,
    )
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


def render_playoff_schema(
    participant_names: list[str],
    elimination: Literal["single", "double"] = "single",
    *,
    match_labels: dict[str, dict] | None = None,
    title: Optional[str] = None,
    fmt: Literal["png", "svg", "pdf"] = "png",
    dpi: int = 150,
    figsize: Optional[tuple[float, float]] = None,
    box_scale: float = 1.0,
    line_width: float = 1.0,
    arrow_scale: float = 1.0,
    title_font_scale: float = 1.0,
    output_scale: float = 1.0,
) -> bytes:
    """Generate a play-off bracket schema from participant names."""
    if len(participant_names) < 2:
        raise ValueError("Need at least 2 participants")

    layout = _compute_playoff_layout(participant_names, elimination, match_labels=match_labels)
    fig = _draw(
        layout,
        title=title,
        figsize=figsize,
        dpi=dpi,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
        title_font_scale=title_font_scale,
        output_scale=output_scale,
    )
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


def build_graph(
    group_sizes: list[int],
    advance_per_group: int = 2,
    elimination: Literal["single", "double"] = "single",
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


def _label_from_match_data(data: dict, max_name: int = 16) -> str:
    """Format team names (and optional score) as a compact multiline node label."""

    def trunc(s: str) -> str:
        return s if len(s) <= max_name else s[: max_name - 1] + "…"

    t1 = trunc(data.get("team1") or "TBD")
    t2 = trunc(data.get("team2") or "TBD")
    score = data.get("score")
    if score:
        return f"{t1}\n{score}\n{t2}"
    return f"{t1}\nvs\n{t2}"


def _next_power_of_two(n: int) -> int:
    if n <= 1:
        return 1
    return 1 << (n - 1).bit_length()


def _compute_layout(
    group_sizes: list[int],
    advance_per_group: int,
    elimination: str,
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
        node_meta[gid] = {"label": label, "kind": "group", "stage": 0, "group": gi}
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

    # Build the seeded order: list of (group_index, rank_within_group)
    seeded_order: list[tuple[int, int]] = []
    for ai in range(advance_per_group):
        for gi in range(num_groups):
            seeded_order.append((gi, ai))

    advance_nodes: list[str] = []
    for slot_idx, (gi, ai) in enumerate(seeded_order):
        aid = f"adv_g{gi}_r{ai}"
        rank = ai + 1
        label = f"#{rank} Grp {chr(65 + gi)}"
        G.add_node(aid)
        node_meta[aid] = {"label": label, "kind": "advance", "stage": 1, "group": gi}
        positions[aid] = (x_advance, y_adv_start - slot_idx * slot_spacing)
        advance_nodes.append(aid)
        # Edge from group to advancing slot
        G.add_edge(f"group_{gi}", aid)

    stages.append({"name": "Advance", "x": x_advance, "nodes": list(advance_nodes)})

    # ── Stage 2+: Play‑off bracket ─────────────────────────────────────
    if elimination == "single":
        _build_single_elim_bracket(
            G,
            positions,
            node_meta,
            stages,
            advance_nodes,
            total_advancing,
            x_start=5.0,
            slot_spacing=slot_spacing,
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
) -> dict:
    """Build a bracket-only layout from named participants."""
    G = nx.DiGraph()
    positions: dict[str, tuple[float, float]] = {}
    node_meta: dict[str, dict] = {}
    stages: list[dict] = []

    x_participants = 0.0
    # Use wider slot spacing when team names will be rendered inside boxes
    slot_spacing = 1.6 if match_labels else 0.9
    y_start = (len(participant_names) - 1) * slot_spacing / 2

    participant_nodes: list[str] = []
    for idx, name in enumerate(participant_names):
        node_id = f"seed_{idx}"
        G.add_node(node_id)
        node_meta[node_id] = {
            "label": name,
            "kind": "advance",
            "stage": 0,
        }
        positions[node_id] = (x_participants, y_start - idx * slot_spacing)
        participant_nodes.append(node_id)

    stages.append({"name": "Participants", "x": x_participants, "nodes": list(participant_nodes)})

    if elimination == "single":
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

    return {
        "graph": G,
        "positions": positions,
        "node_meta": node_meta,
        "stages": stages,
        "elimination": elimination,
    }


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
):
    bracket_size = _next_power_of_two(n_teams)
    num_rounds = int(math.log2(bracket_size)) if bracket_size > 1 else 1

    # Apply standard tournament seeding (1-vs-N, 2-vs-N-1, …) so that
    # same-group players land on opposite sides of the bracket.
    seed_order = _make_seed_order(bracket_size)
    prev_round_nodes: list[Optional[str]] = [
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

    for r in range(num_rounds):
        round_label = _round_label(num_rounds, r)
        round_nodes: list[Optional[str]] = []
        x_round = x_start + r * 3.0
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
                node_meta[bye_id] = {"label": "BYE", "kind": "bye", "stage": 2 + r}
                positions[bye_id] = (x_round, y_mid)
                G.add_edge(n1, bye_id)
                round_nodes.append(bye_id)  # bye feeds into next round
                continue
            if r == 0 and n1 is None and n2 is not None:
                bye_id = f"bye_r0_p{p_idx}"
                G.add_node(bye_id)
                node_meta[bye_id] = {"label": "BYE", "kind": "bye", "stage": 2 + r}
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
                "kind": "match",
                "stage": 2 + r,
                "round": round_label,
                "round_header": round_label,
            }
            # Overlay actual team names + score if available
            md = (match_labels or {}).get(mid)
            if md:
                node_meta[mid]["label"] = _label_from_match_data(md)
                node_meta[mid]["has_teams"] = True
            positions[mid] = (x_round, y_mid)

            # Edges from feeders
            # Advance/bye nodes connect with neutral; prior matches with win
            # (the winner of that match advances here).
            for feeder in (n1, n2):
                if feeder is not None:
                    feeder_kind = node_meta.get(feeder, {}).get("kind", "")
                    rel = "neutral" if feeder_kind in ("advance", "bye") else "win"
                    G.add_edge(feeder, mid, relation=rel)

            round_nodes.append(mid)

        # Ensure match nodes in this round don't overlap
        _enforce_min_spacing(positions, round_nodes, min_gap=1.8 if match_labels else 1.2)

        stage_nodes = [n for n in round_nodes if n and n.startswith("match_")]
        if stage_nodes:
            stages.append({"name": round_label, "x": x_round, "nodes": stage_nodes})

        prev_round_nodes = round_nodes


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
      - Grand Final + potential reset
    """
    bracket_size = _next_power_of_two(n_teams)
    num_rounds_w = int(math.log2(bracket_size)) if bracket_size > 1 else 1

    # Apply standard tournament seeding.
    seed_order = _make_seed_order(bracket_size)
    w_prev: list[Optional[str]] = [advance_nodes[seed_idx] if seed_idx < n_teams else None for seed_idx in seed_order]

    # ── Reorder advance-node y-positions to match bracket slot order ─────
    y_pool = sorted((positions[n][1] for n in advance_nodes), reverse=True)
    y_idx = 0
    for bracket_slot in range(bracket_size):
        si = seed_order[bracket_slot]
        if si < n_teams:
            nid = advance_nodes[si]
            positions[nid] = (positions[nid][0], y_pool[y_idx])
            y_idx += 1

    x_round = x_start

    w_match_nodes_per_round: list[list[str]] = []

    for r in range(num_rounds_w):
        x_round = x_start + r * 3.0
        num_pairs = len(w_prev) // 2
        w_curr: list[Optional[str]] = []
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
            node_meta[mid] = {"label": label, "kind": "winners_match", "stage": 2 + r, "round_header": round_name}
            # Overlay actual team names + score if available
            md = (match_labels or {}).get(mid)
            if md:
                node_meta[mid]["label"] = _label_from_match_data(md)
                node_meta[mid]["has_teams"] = True
            positions[mid] = (x_round, y_mid)

            for feeder in (n1, n2):
                if feeder:
                    feeder_kind = node_meta.get(feeder, {}).get("kind", "")
                    rel = "neutral" if feeder_kind in ("advance", "bye") else "win"
                    G.add_edge(feeder, mid, relation=rel)
            w_curr.append(mid)
            round_match_nodes.append(mid)

        w_match_nodes_per_round.append(round_match_nodes)
        stage_nodes = [n for n in w_curr if n and n.startswith("w_")]
        if stage_nodes:
            stages.append({"name": f"Winners R{r + 1}", "x": x_round, "nodes": stage_nodes})
        w_prev = w_curr

    winners_final_node = w_prev[0] if w_prev else None

    # ── Losers bracket ──────────────────────────────────────────────────
    # Standard double-elimination: losers bracket has 2*(W_rounds-1)
    # total rounds.  When byes reduce the W-R1 pool, a later drop-in
    # round may have *more* droppers than losers-bracket survivors.  In
    # that case the excess droppers play each other first (reduction
    # round) before being merged with existing survivors.
    num_losers_rounds = max(1, 2 * (num_rounds_w - 1))

    # Place losers well below the lowest node in the winners region.
    lowest_winners_y = min(
        positions[n][1]
        for n in positions
        if node_meta.get(n, {}).get("kind") in ("winners_match", "advance", "group", "bye")
    )
    losers_gap = 2.0
    y_losers_top = lowest_winners_y - losers_gap

    # Seed initial losers pool from W-R1 match nodes.
    l_prev: list[str | None] = []
    if w_match_nodes_per_round:
        w_r0 = w_match_nodes_per_round[0]
        l_prev = list(w_r0) + [None] * (bracket_size // 2 - len(w_r0))

    losers_stage_offset = 2 + num_rounds_w

    # Pre-compute losers x-positions: midpoints between winners columns.
    w_xs = [x_start + r * 3.0 for r in range(num_rounds_w)]
    losers_x_slots: list[float] = []
    for i in range(len(w_xs) - 1):
        losers_x_slots.append((w_xs[i] + w_xs[i + 1]) / 2)
    w_step = 3.0
    while len(losers_x_slots) < num_losers_rounds:
        last = losers_x_slots[-1] if losers_x_slots else x_start + w_step / 2
        losers_x_slots.append(last + w_step)

    lr_idx = 0  # running losers-round counter (for node IDs & x-slots)
    _losers_match_global_idx = 0  # sequential index matching bracket.losers_matches order

    # Running vertical cursor: each "dropper" match (both feeders from
    # the winners bracket) gets the next slot so that independent losers
    # branches sit at distinct y-levels — prevents later skip-edges from
    # passing through intermediate cells.
    _y_losers_cursor = y_losers_top
    _LOSERS_STACK_GAP = 1.6

    def _do_losers_round(pool: list[str | None]) -> list[str | None]:
        """Pair entries in *pool* into losers-bracket matches.

        Increments the outer ``lr_idx`` and returns a list of survivors
        (match-node IDs or pass-through nodes for byes).

        Y-positioning strategy:
        * If both feeders are already in the losers region → centre
          between them (natural convergence).
        * If one feeder is in the losers region → use that feeder's y
          (the other feeder is a winners dropper above the region).
        * If neither feeder is in the losers region (both are winners
          drop-downs) → use a global stacking cursor so each such match
          gets a unique y slot, preventing edge-through-cell collisions.
        """
        nonlocal lr_idx, _y_losers_cursor, _losers_match_global_idx
        round_num = lr_idx + 1
        round_name = f"Losers R{round_num}"
        x_lr = (
            losers_x_slots[lr_idx]
            if lr_idx < len(losers_x_slots)
            else (losers_x_slots[-1] + w_step if losers_x_slots else x_start + w_step / 2)
        )

        num_pairs = len(pool) // 2
        if num_pairs == 0:
            lr_idx += 1
            return list(pool)

        curr: list[str | None] = []
        match_nodes: list[str] = []

        for p_idx in range(num_pairs):
            n1 = pool[2 * p_idx] if 2 * p_idx < len(pool) else None
            n2 = pool[2 * p_idx + 1] if 2 * p_idx + 1 < len(pool) else None
            mid = f"l_r{lr_idx}_p{p_idx}"

            if n1 is None and n2 is None:
                curr.append(None)
                continue
            if n1 is not None and n2 is None:
                curr.append(n1)
                continue
            if n1 is None and n2 is not None:
                curr.append(n2)
                continue

            # Determine which feeders are already in the losers region.
            eps = 0.01  # small tolerance for float comparison
            n1_y = positions.get(n1, (0, 0))[1]
            n2_y = positions.get(n2, (0, 0))[1]
            n1_in_losers = n1_y <= y_losers_top + eps
            n2_in_losers = n2_y <= y_losers_top + eps

            if n1_in_losers and n2_in_losers:
                # Both in losers region → centre between them.
                y_mid = (n1_y + n2_y) / 2
            elif n1_in_losers:
                y_mid = n1_y
            elif n2_in_losers:
                y_mid = n2_y
            else:
                # Both from winners → assign next stacking slot.
                y_mid = _y_losers_cursor
                _y_losers_cursor -= _LOSERS_STACK_GAP

            label = f"Match {p_idx + 1}" if num_pairs > 1 else ""
            G.add_node(mid)
            node_meta[mid] = {
                "label": label,
                "kind": "losers_match",
                "stage": losers_stage_offset + lr_idx,
                "round_header": round_name,
            }
            # Overlay actual team names + score if available
            md = (match_labels or {}).get(f"l_{_losers_match_global_idx}")
            if md:
                node_meta[mid]["label"] = _label_from_match_data(md)
                node_meta[mid]["has_teams"] = True
            _losers_match_global_idx += 1
            positions[mid] = (x_lr, y_mid)

            if n1:
                G.add_edge(n1, mid, relation="win")
            if n2:
                G.add_edge(n2, mid, relation="win")
            curr.append(mid)
            match_nodes.append(mid)

        # Handle odd trailing entry
        if len(pool) % 2 == 1:
            curr.append(pool[-1])

        _enforce_min_spacing(positions, curr)
        if match_nodes:
            stages.append({"name": round_name, "x": x_lr, "nodes": match_nodes})
        lr_idx += 1
        return curr

    def _interleave_pools(
        a: list[str | None],
        b: list[str | None],
    ) -> list[str | None]:
        """Interleave two pools, padding the shorter with ``None``."""
        max_len = max(len(a), len(b))
        merged: list[str | None] = []
        for i in range(max_len):
            merged.append(a[i] if i < len(a) else None)
            merged.append(b[i] if i < len(b) else None)
        return merged

    # LR-0: initial reduction (W-R1 losers play each other) ─────────
    l_prev = _do_losers_round(l_prev)

    # Subsequent rounds: driven by drops from each winners round ────
    for wr in range(1, num_rounds_w):
        if wr >= len(w_match_nodes_per_round):
            break
        droppers: list[str | None] = list(w_match_nodes_per_round[wr])

        ns = sum(1 for x in l_prev if x is not None)
        nd = sum(1 for x in droppers if x is not None)

        if nd > ns:
            # More droppers than survivors — droppers play each other
            # first (reduction), then merge with existing survivors.
            dropper_survivors = _do_losers_round(droppers)
            merged = _interleave_pools(l_prev, dropper_survivors)
            l_prev = _do_losers_round(merged)
        elif nd < ns:
            # Fewer droppers — reduce survivors first, then merge.
            l_prev = _do_losers_round(l_prev)
            merged = _interleave_pools(l_prev, droppers)
            l_prev = _do_losers_round(merged)
        else:
            # Counts match — direct merge.
            merged = _interleave_pools(l_prev, droppers)
            l_prev = _do_losers_round(merged)

    losers_final_node = l_prev[0] if l_prev else None

    # ── Mark loss edges: winners matches → losers bracket ───────────────
    # Every winners match has two outcomes: the winner advances in the
    # winners bracket (already "win"), the loser drops to the losers
    # bracket (mark as "loss").
    for r_nodes in w_match_nodes_per_round:
        for wn in r_nodes:
            for succ in list(G.successors(wn)):
                succ_kind = node_meta.get(succ, {}).get("kind", "")
                if succ_kind == "losers_match":
                    G.edges[wn, succ]["relation"] = "loss"

    # ── Grand Final ─────────────────────────────────────────────────────
    x_gf = max(positions[n][0] for n in G.nodes() if n in positions) + 3.0
    y_gf = 0.0
    gf_id = "grand_final"
    G.add_node(gf_id)
    gf_meta: dict = {"label": "", "kind": "grand_final", "stage": 90, "round_header": "Grand Final"}
    gf_md = (match_labels or {}).get("grand_final")
    if gf_md:
        gf_meta["label"] = _label_from_match_data(gf_md)
        gf_meta["has_teams"] = True
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

# Colour palette (kind → facecolor, edgecolor, text colour)
_STYLE: dict[str, dict] = {
    "group": {"fc": "#4A90D9", "ec": "#2C5F8A", "tc": "white"},
    "advance": {"fc": "#E8E8E8", "ec": "#999999", "tc": "#333333"},
    "bye": {"fc": "#F5F5F5", "ec": "#CCCCCC", "tc": "#999999"},
    "match": {"fc": "#F5A623", "ec": "#C47D10", "tc": "white"},
    "winners_match": {"fc": "#F5A623", "ec": "#C47D10", "tc": "white"},
    "losers_match": {"fc": "#D07050", "ec": "#A04830", "tc": "white"},
    "losers_block": {"fc": "#D04545", "ec": "#992D2D", "tc": "white"},
    "grand_final": {"fc": "#8B5CF6", "ec": "#6D3FCC", "tc": "white"},
    "gf_reset": {"fc": "#8B5CF6", "ec": "#6D3FCC", "tc": "white"},
    "champion": {"fc": "#FFD700", "ec": "#B8960F", "tc": "#333333"},
}

# Edge styles by relation type
_EDGE_STYLE: dict[str, dict] = {
    "win": {"color": "#5A9E6F", "lw": 1.8, "linestyle": "solid"},  # muted green
    "loss": {"color": "#C07060", "lw": 1.4, "linestyle": "dashed"},  # muted red
    "neutral": {"color": "#888888", "lw": 1.5, "linestyle": "solid"},  # grey
}

# Soft per-group colours — cycle if there are more groups than entries.
_GROUP_COLOURS: list[dict[str, str]] = [
    {"fc": "#5B9BD5", "ec": "#3A6FA0", "tc": "white"},  # soft blue
    {"fc": "#70AD47", "ec": "#4E7A31", "tc": "white"},  # soft green
    {"fc": "#ED7D31", "ec": "#B85D1A", "tc": "white"},  # soft orange
    {"fc": "#A47FC4", "ec": "#7A5A9A", "tc": "white"},  # soft purple
    {"fc": "#E06B6B", "ec": "#B04848", "tc": "white"},  # soft red
    {"fc": "#4DBFBF", "ec": "#338A8A", "tc": "white"},  # soft teal
]

# Lighter tints of the same hues for advance nodes.
_GROUP_ADVANCE_COLOURS: list[dict[str, str]] = [
    {"fc": "#D0E2F3", "ec": "#5B9BD5", "tc": "#2B4F73"},  # light blue
    {"fc": "#DAE9CE", "ec": "#70AD47", "tc": "#3A5C24"},  # light green
    {"fc": "#FBE0CB", "ec": "#ED7D31", "tc": "#7A3F12"},  # light orange
    {"fc": "#E5D6F0", "ec": "#A47FC4", "tc": "#553D6B"},  # light purple
    {"fc": "#F5D3D3", "ec": "#E06B6B", "tc": "#6E2E2E"},  # light red
    {"fc": "#D1F0F0", "ec": "#4DBFBF", "tc": "#265D5D"},  # light teal
]


# Soft per-round colours for playoff match nodes.
_ROUND_COLOURS: dict[str, dict[str, str]] = {
    "Quarter-Final": {"fc": "#E8924F", "ec": "#B56B2E", "tc": "white"},  # warm amber
    "Semi-Final": {"fc": "#5CA8C8", "ec": "#3D7A96", "tc": "white"},  # slate blue
    "Final": {"fc": "#D4A843", "ec": "#A07E2A", "tc": "white"},  # muted gold
}


def _group_style(group_index: int) -> dict[str, str]:
    """Return the colour style for a group node by index."""
    return _GROUP_COLOURS[group_index % len(_GROUP_COLOURS)]


def _advance_style(group_index: int) -> dict[str, str]:
    """Return the colour style for an advance node by group index."""
    return _GROUP_ADVANCE_COLOURS[group_index % len(_GROUP_ADVANCE_COLOURS)]


def _draw(
    layout: dict,
    *,
    title: Optional[str],
    figsize: Optional[tuple[float, float]],
    dpi: int,
    box_scale: float = 1.0,
    line_width: float = 1.0,
    arrow_scale: float = 1.0,
    title_font_scale: float = 1.0,
    output_scale: float = 1.0,
) -> plt.Figure:
    """Render the layout dict to a matplotlib Figure."""
    G = layout["graph"]
    positions = layout["positions"]
    node_meta = layout["node_meta"]
    stages = layout["stages"]

    if not positions:
        fig, ax = plt.subplots(figsize=(4, 2))
        ax.text(0.5, 0.5, "No data", ha="center", va="center", fontsize=14)
        ax.axis("off")
        return fig

    # Auto figure size
    xs = [p[0] for p in positions.values()]
    ys = [p[1] for p in positions.values()]
    x_span = max(xs) - min(xs) + 4
    y_span = max(ys) - min(ys) + 4
    if figsize is None:
        figsize = (max(12, x_span * 1.3), max(6, y_span * 1.1))
    figsize = (max(4.0, figsize[0] * output_scale), max(3.0, figsize[1] * output_scale))

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    fig.set_facecolor("#FAFAFA")
    ax.set_facecolor("#FAFAFA")
    ax.axis("off")

    if title:
        ax.set_title(title, fontsize=16, fontweight="bold", pad=20)

    def _node_box_size(kind: str) -> tuple[float, float]:
        """Box size in data units for a given node kind."""
        if kind in ("group", "losers_block"):
            return 1.8 * box_scale, 0.9 * box_scale
        if kind == "champion":
            return 1.8 * box_scale, 0.7 * box_scale
        if kind in ("grand_final", "gf_reset"):
            return 1.8 * box_scale, 0.7 * box_scale
        if kind == "advance":
            return 1.3 * box_scale, 0.5 * box_scale
        if kind == "bye":
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

    node_sizes: dict[str, tuple[float, float]] = {}
    for nid in G.nodes():
        meta = node_meta.get(nid, {})
        kind = meta.get("kind", "match")
        bw, bh = _node_box_size(kind)
        if meta.get("has_teams"):
            # Taller & slightly wider box to fit 3-line team display
            bh = 1.8 * box_scale
            bw = max(bw, 2.1 * box_scale)
        node_sizes[nid] = (bw, bh)

    # ── Draw edges ──────────────────────────────────────────────────────
    _base_arrow_ms = 15 * arrow_scale
    for u, v, edata in G.edges(data=True):
        if u not in positions or v not in positions:
            continue
        x0, y0 = positions[u]
        x1, y1 = positions[v]
        bw0, bh0 = node_sizes.get(u, _node_box_size("match"))
        bw1, bh1 = node_sizes.get(v, _node_box_size("match"))
        dx, dy = x1 - x0, y1 - y0

        sx, sy = _edge_center_anchor(x0, y0, bw0, bh0, dx, dy)
        tx, ty = _edge_center_anchor(x1, y1, bw1, bh1, -dx, -dy)

        rel = edata.get("relation", "neutral")
        es = _EDGE_STYLE.get(rel, _EDGE_STYLE["neutral"])
        edge_lw = es["lw"] * line_width
        arrow = mpatches.FancyArrowPatch(
            (sx, sy),
            (tx, ty),
            arrowstyle="-|>,head_length=0.6,head_width=0.3",
            mutation_scale=_base_arrow_ms,
            linewidth=edge_lw,
            linestyle=es["linestyle"],
            color=es["color"],
            connectionstyle="arc3,rad=0.05",
            zorder=2,
        )
        ax.add_patch(arrow)
        ax.plot(sx, sy, "o", color=es["color"], markersize=_base_arrow_ms * 0.25, zorder=5)

    # ── Draw nodes ──────────────────────────────────────────────────────
    for nid in G.nodes():
        if nid not in positions:
            continue
        meta = node_meta.get(nid, {})
        kind = meta.get("kind", "match")
        label = meta.get("label", nid)
        gi = meta.get("group")
        rnd = meta.get("round")
        if kind == "group" and gi is not None:
            style = _group_style(gi)
        elif kind == "advance" and gi is not None:
            style = _advance_style(gi)
        elif kind == "match" and rnd and rnd in _ROUND_COLOURS:
            style = _ROUND_COLOURS[rnd]
        else:
            style = _STYLE.get(kind, _STYLE["match"])

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

        fontsize = (7 if kind == "bye" else (8 if kind == "advance" else 9)) * box_scale
        round_header = meta.get("round_header", "")
        header_fs = 8 * box_scale * title_font_scale
        if round_header and meta.get("has_teams"):
            # 3-line: italic round header, separator, team names + score
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
            # Team names + score in the main body
            ax.text(
                x,
                y - 0.05 * box_scale,
                label,
                ha="center",
                va="center",
                fontsize=9 * box_scale,
                fontweight="bold",
                color=style["tc"],
                zorder=4,
            )
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
                    fontsize=7 * box_scale,
                    fontweight="bold",
                    color=style["tc"],
                    zorder=4,
                )
        else:
            ax.text(
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

    # ── Stage column labels (top) ───────────────────────────────────────
    y_top = max(p[1] for p in positions.values()) + 1.5
    seen_x: set[float] = set()
    for stage in stages:
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
            fontsize=10,
            fontstyle="italic",
            color="#555555",
        )

    # Adjust limits
    margin = 2.0
    ax.set_xlim(min(xs) - margin, max(xs) + margin)
    ax.set_ylim(min(ys) - margin, y_top + 1.0)

    fig.tight_layout()
    return fig
