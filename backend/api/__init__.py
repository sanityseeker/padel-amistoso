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
from fastapi.responses import HTMLResponse, Response

from ..auth import auth_router
from ..auth.store import user_store
from .routes_crud import router as crud_router
from .routes_gp import router as gp_router
from .routes_mex import router as mex_router
from .routes_schema import router as schema_router
from .state import (  # noqa: F401  — re-exported for tests
    _counter,
    _load_state,
    _release_lock,
    _tournaments,
)

# ────────────────────────────────────────────────────────────────────────────
# Lifespan — load persisted state on startup, release lock on shutdown
# ────────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    _load_state()
    user_store.load()
    user_store.bootstrap_default_admin()
    yield
    _release_lock()


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
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(crud_router)
app.include_router(gp_router)
app.include_router(mex_router)
app.include_router(schema_router)

# ────────────────────────────────────────────────────────────────────────────
# Config endpoint
# ────────────────────────────────────────────────────────────────────────────


@app.get("/api/config")
async def get_config() -> dict:
    """Return application configuration for frontend."""
    return {"demo_mode": os.environ.get("DEMO_MODE", "").lower() in ("true", "1", "yes")}


# ────────────────────────────────────────────────────────────────────────────
# Serve frontend
# ────────────────────────────────────────────────────────────────────────────

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


def _serve_js_file(filename: str) -> Response:
    """Serve a JS file from the frontend directory with the correct MIME type."""
    path = FRONTEND_DIR / filename
    content = path.read_text() if path.exists() else ""
    return Response(content=content, media_type="application/javascript")


@app.get("/", response_class=HTMLResponse)
async def serve_frontend() -> str:
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return index.read_text()
    return "<h1>Frontend not found</h1>"


@app.get("/tv", response_class=HTMLResponse)
async def serve_tv() -> str:
    page = FRONTEND_DIR / "public.html"
    if page.exists():
        return page.read_text()
    return "<h1>TV page not found</h1>"


@app.get("/shared.js")
async def serve_shared_js() -> Response:
    """Serve the shared JS utilities used by index.html and tv.html."""
    return _serve_js_file("shared.js")


@app.get("/auth.js")
async def serve_auth_js() -> Response:
    """Serve the authentication module used by index.html."""
    return _serve_js_file("auth.js")


@app.get("/i18n.js")
async def serve_i18n_js() -> Response:
    """Serve the translation catalog used by the frontend i18n runtime."""
    return _serve_js_file("i18n.js")
