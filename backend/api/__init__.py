"""
FastAPI application — REST API for padel tournament management.

Run with:
    uvicorn backend.api:app --reload --port 8000
"""

# ruff: noqa: E402  -- load_dotenv() must run before local imports that read env vars at module level
from __future__ import annotations

import json
import hashlib
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
from .state import persist_failed as _persist_failed
from .routes_admin_players import router as admin_players_router
from .routes_crud import router as crud_router
from .routes_gp import router as gp_router
from .routes_mex import router as mex_router
from .routes_player_auth import router as player_auth_router
from .routes_player_space import router as player_space_router
from .routes_playoff import router as playoff_router
from .routes_registration import router as registration_router
from .routes_schema import router as schema_router
from .routes_score_actions import router as score_actions_router
from .routes_share import router as share_router
from .routes_share import registration_share_router
from .routes_push import router as push_router
from .sse import router as sse_router
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
    from .push import init_push  # noqa: PLC0415

    init_push()
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
    _persist_failed.set(False)
    response = await call_next(request)
    if _persist_failed.get():
        response.headers["X-Persist-Warning"] = "true"
    return response


# Register routers
app.include_router(admin_players_router)
app.include_router(auth_router)
app.include_router(crud_router)
app.include_router(gp_router)
app.include_router(mex_router)
app.include_router(player_auth_router)
app.include_router(player_space_router)
app.include_router(playoff_router)
app.include_router(registration_router)
app.include_router(schema_router)
app.include_router(score_actions_router)
app.include_router(share_router)
app.include_router(registration_share_router)
app.include_router(push_router)
app.include_router(sse_router)

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


@lru_cache(maxsize=64)
def _content_etag(filename: str) -> str | None:
    """Return a quoted ETag derived from the content hash of a frontend file."""
    if filename.endswith((".png", ".ico")):
        data = _read_frontend_bytes(filename)
        if not data:
            return None
        return f'"e{hashlib.md5(data).hexdigest()[:12]}"'  # noqa: S324
    text = _read_frontend_text(filename)
    if not text:
        return None
    return f'"e{hashlib.md5(text.encode()).hexdigest()[:12]}"'  # noqa: S324


def _serve_js_file(filename: str, request: Request | None = None) -> Response:
    """Serve a JS file from the frontend directory with ETag-based caching."""
    etag = _content_etag(filename)
    if etag and request and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    headers: dict[str, str] = {"Cache-Control": "public, max-age=300, must-revalidate"}
    if etag:
        headers["ETag"] = etag
    return Response(content=_read_frontend_text(filename), media_type="application/javascript", headers=headers)


def _serve_css_file(filename: str, request: Request | None = None) -> Response:
    """Serve a CSS file from the frontend directory with ETag-based caching."""
    etag = _content_etag(filename)
    if etag and request and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    headers: dict[str, str] = {"Cache-Control": "public, max-age=300, must-revalidate"}
    if etag:
        headers["ETag"] = etag
    return Response(content=_read_frontend_text(filename), media_type="text/css", headers=headers)


def _serve_png_file(filename: str, request: Request | None = None) -> Response:
    """Serve a PNG file from the frontend directory with ETag-based caching."""
    etag = _content_etag(filename)
    if etag and request and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    headers: dict[str, str] = {"Cache-Control": "public, max-age=86400, must-revalidate"}
    if etag:
        headers["ETag"] = etag
    return Response(content=_read_frontend_bytes(filename), media_type="image/png", headers=headers)


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


@app.get("/t")
async def serve_tv_legacy_root() -> Response:
    return RedirectResponse(url="/tv", status_code=307)


@app.get("/t/{slug}")
async def serve_tv_legacy(slug: str) -> Response:
    return RedirectResponse(url=f"/tv/{slug}", status_code=307)


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


@app.get("/r")
async def serve_register_legacy_root() -> Response:
    return RedirectResponse(url="/register", status_code=307)


@app.get("/r/{slug}")
async def serve_register_legacy(slug: str) -> Response:
    return RedirectResponse(url=f"/register/{slug}", status_code=307)


@app.get("/player")
async def serve_player() -> Response:
    return Response(
        content=_read_frontend_text("player.html") or "<h1>Player Hub not found</h1>",
        media_type="text/html",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/shared.js")
async def serve_shared_js(request: Request) -> Response:
    """Serve the shared JS utilities used by index.html and public.html (TV view)."""
    return _serve_js_file("shared.js", request)


@app.get("/auth.js")
async def serve_auth_js(request: Request) -> Response:
    """Serve the authentication module used by index.html."""
    return _serve_js_file("auth.js", request)


@app.get("/admin-utils.js")
async def serve_admin_utils_js(request: Request) -> Response:
    """Serve admin UI utilities (theme, language, schema helpers)."""
    return _serve_js_file("admin-utils.js", request)


@app.get("/admin-tournaments.js")
async def serve_admin_tournaments_js(request: Request) -> Response:
    """Serve admin tournament list and navigation logic."""
    return _serve_js_file("admin-tournaments.js", request)


@app.get("/admin-create.js")
async def serve_admin_create_js(request: Request) -> Response:
    """Serve admin tournament creation panel logic."""
    return _serve_js_file("admin-create.js", request)


@app.get("/admin-gp.js")
async def serve_admin_gp_js(request: Request) -> Response:
    """Serve Group+Playoff and Pure Playoff render logic and score actions."""
    return _serve_js_file("admin-gp.js", request)


@app.get("/admin-mex.js")
async def serve_admin_mex_js(request: Request) -> Response:
    """Serve Mexicano render logic, pairing proposals, and export helpers."""
    return _serve_js_file("admin-mex.js", request)


@app.get("/admin-player-codes.js")
async def serve_admin_player_codes_js(request: Request) -> Response:
    """Serve player codes panel and in-tournament player management."""
    return _serve_js_file("admin-player-codes.js", request)


@app.get("/admin-tv-email.js")
async def serve_admin_tv_email_js(request: Request) -> Response:
    """Serve TV display settings, email controls, and tournament alias/banner."""
    return _serve_js_file("admin-tv-email.js", request)


@app.get("/admin-registration.js")
async def serve_admin_registration_js(request: Request) -> Response:
    """Serve registration lobby management and answers panel."""
    return _serve_js_file("admin-registration.js", request)


@app.get("/admin-convert.js")
async def serve_admin_convert_js(request: Request) -> Response:
    """Serve convert-from-registration flow."""
    return _serve_js_file("admin-convert.js", request)


@app.get("/admin-collaborators.js")
async def serve_admin_collaborators_js(request: Request) -> Response:
    """Serve collaborator management for tournaments and registrations."""
    return _serve_js_file("admin-collaborators.js", request)


@app.get("/admin-players.js")
async def serve_admin_players_js(request: Request) -> Response:
    """Serve Player Hub admin management."""
    return _serve_js_file("admin-players.js", request)


@app.get("/tv.js")
async def serve_tv_js(request: Request) -> Response:
    """Serve the TV view JavaScript for public.html."""
    return _serve_js_file("tv.js", request)


@app.get("/admin.css")
async def serve_admin_css(request: Request) -> Response:
    """Serve the admin panel stylesheet for index.html."""
    return _serve_css_file("admin.css", request)


@app.get("/tv.css")
async def serve_tv_css(request: Request) -> Response:
    """Serve the TV view stylesheet for public.html."""
    return _serve_css_file("tv.css", request)


@app.get("/register.js")
async def serve_register_js(request: Request) -> Response:
    """Serve the registration page JavaScript."""
    return _serve_js_file("register.js", request)


@app.get("/register.css")
async def serve_register_css(request: Request) -> Response:
    """Serve the registration page stylesheet."""
    return _serve_css_file("register.css", request)


@app.get("/player.js")
async def serve_player_js(request: Request) -> Response:
    """Serve the Player Hub JavaScript."""
    return _serve_js_file("player.js", request)


@app.get("/player.css")
async def serve_player_css(request: Request) -> Response:
    """Serve the Player Hub stylesheet."""
    return _serve_css_file("player.css", request)


@app.get("/i18n.js")
async def serve_i18n_js(request: Request) -> Response:
    """Serve the translation catalog used by the frontend i18n runtime."""
    return _serve_js_file("i18n.js", request)


@app.get("/manifest.json")
async def serve_manifest(request: Request) -> Response:
    """Serve the PWA web app manifest."""
    etag = _content_etag("manifest.json")
    if etag and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    headers: dict[str, str] = {"Cache-Control": "public, max-age=300, must-revalidate"}
    if etag:
        headers["ETag"] = etag
    return Response(
        content=_read_frontend_text("manifest.json") or "{}",
        media_type="application/manifest+json",
        headers=headers,
    )


@app.get("/service-worker.js")
async def serve_service_worker(request: Request) -> Response:
    """Serve the PWA service worker."""
    return _serve_js_file("service-worker.js", request)


@app.get("/icon-192.png")
async def serve_icon_192(request: Request) -> Response:
    """Serve the 192×192 PWA icon."""
    return _serve_png_file("icon-192.png", request)


@app.get("/icon-512.png")
async def serve_icon_512(request: Request) -> Response:
    """Serve the 512×512 PWA icon."""
    return _serve_png_file("icon-512.png", request)


@app.get("/icon-512-maskable.png")
async def serve_icon_512_maskable(request: Request) -> Response:
    """Serve the 512×512 maskable PWA icon."""
    return _serve_png_file("icon-512-maskable.png", request)


@app.get("/favicon.ico")
async def serve_favicon() -> RedirectResponse:
    """Redirect legacy favicon requests to the 192×192 PNG icon."""
    return RedirectResponse(url="/icon-192.png", status_code=301)


@app.get("/404.png")
async def serve_404_image(request: Request) -> Response:
    """Serve the 404 error illustration."""
    return _serve_png_file("404.png", request)


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
