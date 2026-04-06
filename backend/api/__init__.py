"""
FastAPI application — REST API for padel tournament management.

Run with:
    uvicorn backend.api:app --reload --port 8000
"""

# ruff: noqa: E402  -- load_dotenv() must run before local imports that read env vars at module level
from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from . import state as _state_module
from ..auth import auth_router
from ..auth.store import user_store
from .db import init_db
from .routes_crud import router as crud_router
from .routes_gp import router as gp_router
from .routes_mex import router as mex_router
from .routes_player_auth import router as player_auth_router
from .routes_playoff import router as playoff_router
from .routes_registration import router as registration_router
from .routes_schema import router as schema_router
from .routes_share import router as share_router
from .routes_share import registration_share_router
from .state import (  # noqa: F401  — re-exported for tests
    _counter,
    _load_state,
    _tournaments,
)

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
    version="1.0.0",
    description=(
        "REST API for organizing and managing padel tournaments. "
        "Supports Group+Playoff and Mexicano tournament formats with "
        "live TV displays, match recording, and bracket visualization."
    ),
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:8000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:8000").split(",") if o.strip()
]
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_from_header(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return None


@app.middleware("http")
async def csrf_origin_protection(request: Request, call_next):
    """Block cross-site browser writes by validating Origin/Referer.

    - Only applies to unsafe API methods.
    - Requests without Origin/Referer are allowed (CLI clients, tests).
    - Browser requests with mismatched origin are rejected.
    """
    if request.method in _UNSAFE_METHODS and request.url.path.startswith("/api/"):
        origin = _origin_from_header(request.headers.get("origin"))
        referer_origin = _origin_from_header(request.headers.get("referer"))
        source_origin = origin or referer_origin
        if source_origin is not None and source_origin not in _ALLOWED_ORIGINS:
            return JSONResponse(status_code=403, content={"detail": "CSRF validation failed"})
    return await call_next(request)


# Register routers
app.include_router(auth_router)
app.include_router(crud_router)
app.include_router(gp_router)
app.include_router(mex_router)
app.include_router(player_auth_router)
app.include_router(playoff_router)
app.include_router(registration_router)
app.include_router(schema_router)
app.include_router(share_router)
app.include_router(registration_share_router)

# ────────────────────────────────────────────────────────────────────────────
# Config endpoint
# ────────────────────────────────────────────────────────────────────────────


@app.get("/api/config")
async def get_config(response: Response) -> dict:
    """Return application configuration for frontend."""
    response.headers["Cache-Control"] = "public, max-age=60"
    return {"demo_mode": os.environ.get("DEMO_MODE", "").lower() in ("true", "1", "yes")}


@app.get("/api/version")
async def get_global_version(request: Request) -> Response:
    """Return the global state version counter.

    Incremented on every mutation (tournament created, visibility changed,
    score recorded, etc.). Used by the TV picker to detect when to re-render.
    Supports conditional GET via ETag / If-None-Match.
    """
    v = _state_module._state_version
    etag = f'"v{v}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)
    return Response(
        content=json.dumps({"version": v}),
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, no-cache, max-age=0, must-revalidate"},
    )


# ────────────────────────────────────────────────────────────────────────────
# Serve frontend
# ────────────────────────────────────────────────────────────────────────────

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


@lru_cache(maxsize=32)
def _read_frontend_text(filename: str) -> str:
    """Read a frontend text file, caching the result for the process lifetime."""
    path = FRONTEND_DIR / filename
    return path.read_text() if path.exists() else ""


@lru_cache(maxsize=16)
def _read_frontend_bytes(filename: str) -> bytes:
    """Read a frontend binary file, caching the result for the process lifetime."""
    path = FRONTEND_DIR / filename
    return path.read_bytes() if path.exists() else b""


def _serve_js_file(filename: str) -> Response:
    """Serve a JS file from the frontend directory with the correct MIME type."""
    return Response(
        content=_read_frontend_text(filename),
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=300"},
    )


def _serve_css_file(filename: str) -> Response:
    """Serve a CSS file from the frontend directory with the correct MIME type."""
    return Response(
        content=_read_frontend_text(filename),
        media_type="text/css",
        headers={"Cache-Control": "public, max-age=300"},
    )


def _serve_png_file(filename: str) -> Response:
    """Serve a PNG file from the frontend directory."""
    return Response(
        content=_read_frontend_bytes(filename),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/")
async def serve_frontend() -> Response:
    return Response(
        content=_read_frontend_text("index.html") or "<h1>Frontend not found</h1>",
        media_type="text/html",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/tv")
@app.get("/tv/{slug}")
async def serve_tv(slug: str | None = None) -> Response:
    return Response(
        content=_read_frontend_text("public.html") or "<h1>TV page not found</h1>",
        media_type="text/html",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/register")
async def serve_register() -> Response:
    return Response(
        content=_read_frontend_text("register.html") or "<h1>Registration page not found</h1>",
        media_type="text/html",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/register/{alias}")
async def serve_register_alias(alias: str) -> Response:
    return Response(
        content=_read_frontend_text("register.html") or "<h1>Registration page not found</h1>",
        media_type="text/html",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/shared.js")
async def serve_shared_js() -> Response:
    """Serve the shared JS utilities used by index.html and public.html (TV view)."""
    return _serve_js_file("shared.js")


@app.get("/auth.js")
async def serve_auth_js() -> Response:
    """Serve the authentication module used by index.html."""
    return _serve_js_file("auth.js")


@app.get("/admin.js")
async def serve_admin_js() -> Response:
    """Serve the admin panel JavaScript for index.html."""
    return _serve_js_file("admin.js")


@app.get("/tv.js")
async def serve_tv_js() -> Response:
    """Serve the TV view JavaScript for public.html."""
    return _serve_js_file("tv.js")


@app.get("/admin.css")
async def serve_admin_css() -> Response:
    """Serve the admin panel stylesheet for index.html."""
    return _serve_css_file("admin.css")


@app.get("/tv.css")
async def serve_tv_css() -> Response:
    """Serve the TV view stylesheet for public.html."""
    return _serve_css_file("tv.css")


@app.get("/register.js")
async def serve_register_js() -> Response:
    """Serve the registration page JavaScript."""
    return _serve_js_file("register.js")


@app.get("/register.css")
async def serve_register_css() -> Response:
    """Serve the registration page stylesheet."""
    return _serve_css_file("register.css")


@app.get("/i18n.js")
async def serve_i18n_js() -> Response:
    """Serve the translation catalog used by the frontend i18n runtime."""
    return _serve_js_file("i18n.js")


@app.get("/manifest.json")
async def serve_manifest() -> Response:
    """Serve the PWA web app manifest."""
    return Response(
        content=_read_frontend_text("manifest.json") or "{}",
        media_type="application/manifest+json",
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/service-worker.js")
async def serve_service_worker() -> Response:
    """Serve the PWA service worker."""
    return Response(
        content=_read_frontend_text("service-worker.js"),
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


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


@app.get("/favicon.ico")
async def serve_favicon() -> RedirectResponse:
    """Redirect legacy favicon requests to the 192×192 PNG icon."""
    return RedirectResponse(url="/icon-192.png", status_code=301)


@app.get("/404.png")
async def serve_404_image() -> Response:
    """Serve the 404 error illustration."""
    return _serve_png_file("404.png")


# ────────────────────────────────────────────────────────────────────────────
# Catch-all — any unmatched non-API path gets the custom 404 page
# Must be registered last so it never shadows real routes.
# ────────────────────────────────────────────────────────────────────────────


def _serve_404_page() -> HTMLResponse:
    """Return the 404 HTML page with HTTP 404 status."""
    return HTMLResponse(
        content=_read_frontend_text("404.html") or "<h1>404 Not Found</h1>",
        status_code=404,
    )


@app.get("/{path:path}")
async def catch_all(path: str, request: Request) -> Response:
    """Serve the custom 404 page for every unmatched frontend path."""
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    return _serve_404_page()
