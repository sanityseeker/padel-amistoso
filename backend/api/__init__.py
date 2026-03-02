"""
FastAPI application — REST API for padel tournament management.

Run with:
    uvicorn backend.api:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

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
async def _lifespan(app: FastAPI):
    _load_state()
    yield
    _release_lock()


# ────────────────────────────────────────────────────────────────────────────
# App setup
# ────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Padel Tournament Manager", version="0.2.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(crud_router)
app.include_router(gp_router)
app.include_router(mex_router)
app.include_router(schema_router)

# ────────────────────────────────────────────────────────────────────────────
# Serve frontend
# ────────────────────────────────────────────────────────────────────────────

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
API_PLAYGROUND_DIR = Path(__file__).resolve().parent.parent.parent / "api-playground"


@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return index.read_text()
    return "<h1>Frontend not found</h1>"


@app.get("/api-playground", response_class=HTMLResponse)
async def serve_api_playground():
    index = API_PLAYGROUND_DIR / "index.html"
    if index.exists():
        return index.read_text()
    return "<h1>API playground not found</h1>"
