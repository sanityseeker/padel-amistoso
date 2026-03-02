"""
Bracket schema / visualisation routes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..viz import render_schema
from .schemas import SchemaPreviewRequest

router = APIRouter(prefix="/api/schema", tags=["schema"])


@router.get("/preview")
async def schema_preview(
    group_sizes: str = Query(
        ...,
        description="Comma-separated group sizes, e.g. '4,4' for two groups of 4",
    ),
    advance_per_group: int = Query(2, ge=1),
    elimination: Literal["single", "double"] = Query("single"),
    title: str | None = Query(None),
    fmt: Literal["png", "svg", "pdf"] = Query("png"),
    box_scale: float = Query(1.0, ge=0.3, le=3.0),
    line_width: float = Query(1.0, ge=0.3, le=5.0),
    arrow_scale: float = Query(1.0, ge=0.3, le=5.0),
):
    """
    Generate a tournament block-scheme preview image.

    Example:
        GET /api/schema/preview?group_sizes=4,4&advance_per_group=2&elimination=single
    """
    try:
        sizes = [int(x.strip()) for x in group_sizes.split(",")]
        if not sizes or any(s < 2 for s in sizes):
            raise ValueError
    except ValueError:
        raise HTTPException(400, "group_sizes must be comma-separated integers ≥ 2")

    img = render_schema(
        group_sizes=sizes,
        advance_per_group=advance_per_group,
        elimination=elimination,
        title=title,
        fmt=fmt,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
    )

    media = {"png": "image/png", "svg": "image/svg+xml", "pdf": "application/pdf"}
    return Response(content=img, media_type=media[fmt])


@router.post("/preview")
async def schema_preview_post(req: SchemaPreviewRequest):
    """POST variant — accepts a JSON body instead of query params."""
    img = render_schema(
        group_sizes=req.group_sizes,
        advance_per_group=req.advance_per_group,
        elimination=req.elimination,
        title=req.title,
        fmt="png",
        box_scale=req.box_scale,
        line_width=req.line_width,
        arrow_scale=req.arrow_scale,
    )

    return Response(content=img, media_type="image/png")
