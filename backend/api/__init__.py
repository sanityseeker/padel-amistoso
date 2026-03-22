"""
FastAPI application — REST API for padel tournament management.

Run with:
    uvicorn backend.api:app --reload --port 8000
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from ..auth import auth_router
from ..auth.store import user_store
from .db import init_db
from .routes_crud import router as crud_router
from .routes_gp import router as gp_router
from .routes_mex import router as mex_router
from .routes_playoff import router as playoff_router
from .routes_schema import router as schema_router
from .state import (  # noqa: F401  — re-exported for tests
    _counter,
    _load_state,
    _tournaments,
)
from . import state as _state_module

# ────────────────────────────────────────────────────────────────────────────
# Lifespan — load persisted state on startup, release lock on shutdown
# ────────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    init_db()
    _load_state()
    user_store.load()
    user_store.bootstrap_default_admin()
    yield


# ────────────────────────────────────────────────────────────────────────────
# App setup
# ────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Padel Tournament Manager",
    version="0.2.0",
    description=(
        "REST API for organizing and managing padel tournaments. "
        "Supports Group+Playoff and Mexicano tournament formats with "
        "live TV displays, match recording, and bracket visualization."
    ),
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(crud_router)
app.include_router(gp_router)
app.include_router(mex_router)
app.include_router(playoff_router)
app.include_router(schema_router)

# ────────────────────────────────────────────────────────────────────────────
# Config endpoint
# ────────────────────────────────────────────────────────────────────────────


@app.get("/api/config")
async def get_config() -> dict:
    """Return application configuration for frontend."""
    return {"demo_mode": os.environ.get("DEMO_MODE", "").lower() in ("true", "1", "yes")}


@app.get("/api/version")
async def get_global_version() -> dict:
    """Return the global state version counter.

    Incremented on every mutation (tournament created, visibility changed,
    score recorded, etc.). Used by the TV picker to detect when to re-render.
    """
    return {"version": _state_module._state_version}


# ────────────────────────────────────────────────────────────────────────────
# Serve frontend
# ────────────────────────────────────────────────────────────────────────────

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


def _serve_js_file(filename: str) -> Response:
    """Serve a JS file from the frontend directory with the correct MIME type."""
    path = FRONTEND_DIR / filename
    content = path.read_text() if path.exists() else ""
    return Response(
        content=content, media_type="application/javascript", headers={"Cache-Control": "public, max-age=300"}
    )


def _serve_png_file(filename: str) -> Response:
    """Serve a PNG file from the frontend directory."""
    path = FRONTEND_DIR / filename
    content = path.read_bytes() if path.exists() else b""
    return Response(content=content, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/")
async def serve_frontend() -> Response:
    index = FRONTEND_DIR / "index.html"
    content = index.read_text() if index.exists() else "<h1>Frontend not found</h1>"
    return Response(content=content, media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/tv")
async def serve_tv() -> Response:
    page = FRONTEND_DIR / "public.html"
    content = page.read_text() if page.exists() else "<h1>TV page not found</h1>"
    return Response(content=content, media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/shared.js")
async def serve_shared_js() -> Response:
    """Serve the shared JS utilities used by index.html and public.html (TV view)."""
    return _serve_js_file("shared.js")


@app.get("/auth.js")
async def serve_auth_js() -> Response:
    """Serve the authentication module used by index.html."""
    return _serve_js_file("auth.js")


@app.get("/i18n.js")
async def serve_i18n_js() -> Response:
    """Serve the translation catalog used by the frontend i18n runtime."""
    return _serve_js_file("i18n.js")


@app.get("/manifest.json")
async def serve_manifest() -> Response:
    """Serve the PWA web app manifest."""
    path = FRONTEND_DIR / "manifest.json"
    content = path.read_text() if path.exists() else "{}"
    return Response(content=content, media_type="application/manifest+json")


@app.get("/service-worker.js")
async def serve_service_worker() -> Response:
    """Serve the PWA service worker."""
    path = FRONTEND_DIR / "service-worker.js"
    content = path.read_text() if path.exists() else ""
    return Response(content=content, media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/icon-192.png")
async def serve_icon_192() -> Response:
    """Serve the 192×192 PWA icon."""
    return _serve_png_file("icon-192.png")


@app.get("/icon-512.png")
async def serve_icon_512() -> Response:
    """Serve the 512×512 PWA icon."""
    return _serve_png_file("icon-512.png")


@app.get("/icon-512-maskable.png")
async def serve_icon_512_maskable() -> Response:
    """Serve the 512×512 maskable PWA icon."""
    return _serve_png_file("icon-512-maskable.png")
