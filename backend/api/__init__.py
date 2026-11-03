"""
FastAPI application — REST API for padel tournament management.

Run with:
    uvicorn backend.api:app --reload --port 8000
"""

# ruff: noqa: E402  -- load_dotenv() must run before local imports that read env vars at module level
from __future__ import annotations

import asyncio
import json
import hashlib
import os
import re
from contextlib import asynccontextmanager
from functools import lru_cache
from html import escape
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from brotli_asgi import BrotliMiddleware

from . import state as _state_module
from .. import config
from ..auth import auth_router
from ..auth.store import user_store
from .db import init_db
from .elo_recalc import flush_elo_recalculation
from .state import persist_failed as _persist_failed
from .routes_admin_players import router as admin_players_router
from .routes_clubs import public_events_router
from .routes_clubs import router as clubs_router
from .routes_communities import router as communities_router
from .routes_seasons import club_seasons_router, router as seasons_router
from .routes_crud import router as crud_router
from .routes_gp import router as gp_router
from .routes_mex import router as mex_router
from .routes_player_auth import router as player_auth_router
from .routes_player_space import router as player_space_router
from .routes_playoff import router as playoff_router
from .routes_payments import router as payments_router
from .routes_registration import router as registration_router
from .routes_schema import router as schema_router
from .routes_score_actions import router as score_actions_router
from .routes_share import router as share_router
from .routes_share import registration_share_router
from .routes_push import router as push_router
from .sse import router as sse_router
from .state import (  # noqa: F401  — re-exported for tests
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
    from .backup import start_backup_scheduler  # noqa: PLC0415

    start_backup_scheduler()
    if config.DEMO_INSTANCE:
        from .demo_cleanup import start_demo_purge_scheduler  # noqa: PLC0415

        start_demo_purge_scheduler()
    yield
    # ── Shutdown cleanup ──
    from .backup import shutdown_backup_scheduler  # noqa: PLC0415
    from .demo_cleanup import shutdown_demo_purge_scheduler  # noqa: PLC0415
    from .push import shutdown_push  # noqa: PLC0415
    from .sse import shutdown as shutdown_sse  # noqa: PLC0415

    shutdown_backup_scheduler()
    shutdown_demo_purge_scheduler()
    shutdown_sse()
    shutdown_push()


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

_AMISTOSO_DOMAIN = os.environ.get("AMISTOSO_DOMAIN", "").strip().lower()


def _amistoso_origin_regex() -> str | None:
    """Return a regex matching ``http(s)://{anything}.{AMISTOSO_DOMAIN}`` or its apex."""
    if not _AMISTOSO_DOMAIN:
        return None
    escaped = _AMISTOSO_DOMAIN.replace(".", r"\.")
    # Optional subdomain label, then the domain, optional explicit port.
    return rf"^https?://([a-z0-9-]+\.)*{escaped}(:\d+)?$"


_CORS_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:8000").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=_amistoso_origin_regex(),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compress text responses (JS/CSS/HTML/JSON) on the fly. Brotli when the client
# accepts it (`Accept-Encoding: br`), gzip otherwise (gzip_fallback=True). This
# is the single biggest page-load win for the ~1.4 MB of uncompressed JS: quality
# 4 is a good speed/ratio balance for per-request compression, and minimum_size
# skips responses too small to benefit. Vary: Accept-Encoding is set by the
# middleware so shared caches store per-encoding variants correctly.
app.add_middleware(BrotliMiddleware, quality=4, minimum_size=500)

_ALLOWED_ORIGINS = list(_CORS_ORIGINS)
_AMISTOSO_ORIGIN_RE = None
if _AMISTOSO_DOMAIN:
    _AMISTOSO_ORIGIN_RE = re.compile(_amistoso_origin_regex() or "")
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_from_header(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return None


def _origin_is_allowed(origin: str) -> bool:
    if origin in _ALLOWED_ORIGINS:
        return True
    if _AMISTOSO_ORIGIN_RE is not None and _AMISTOSO_ORIGIN_RE.match(origin):
        return True
    return False


@app.middleware("http")
async def csrf_origin_protection(request: Request, call_next):
    """Block cross-site browser writes by validating Origin/Referer.

    - Only applies to unsafe API methods.
    - Requests without Origin/Referer are allowed (CLI clients, tests).
    - Browser requests with mismatched origin are rejected.
    - Same-origin requests (Origin host == Host header) are always allowed.
    - Any ``*.{AMISTOSO_DOMAIN}`` origin is accepted when the env var is set.
    """
    if request.method in _UNSAFE_METHODS and request.url.path.startswith("/api/"):
        origin = _origin_from_header(request.headers.get("origin"))
        referer_origin = _origin_from_header(request.headers.get("referer"))
        source_origin = origin or referer_origin
        if source_origin is not None and not _origin_is_allowed(source_origin):
            # Same-origin: the request's Origin host matches the Host header
            # the server is replying on. This covers any subdomain a user
            # legitimately reaches the app through, regardless of env config.
            host_header = (request.headers.get("host") or "").lower()
            source_host = urlparse(source_origin).netloc.lower()
            if not host_header or source_host != host_header:
                return JSONResponse(status_code=403, content={"detail": "CSRF validation failed"})
    _persist_failed.set(False)
    response = await call_next(request)
    if _persist_failed.get():
        response.headers["X-Persist-Warning"] = "true"
    # The demo instance is a throwaway sandbox: keep its pages out of search
    # indexes so visitors land on the core site, not the practice copy.
    if config.DEMO_INSTANCE and response.headers.get("content-type", "").startswith("text/html"):
        response.headers["X-Robots-Tag"] = "noindex"
    return response


@app.middleware("http")
async def flush_elo_after_request(request: Request, call_next):
    """Recalculate ELO for any Hub link changes the request made, before responding.

    Link/unlink/merge code only calls ``elo_recalc.mark_elo_dirty`` (it may be
    sync, deep in a helper); this awaits the replay so the response — and the
    page the client reloads next — already shows the new ratings.  A no-op
    when nothing was marked.
    """
    response = await call_next(request)
    await flush_elo_recalculation()
    return response


# ────────────────────────────────────────────────────────────────────────────
# Subdomain routing middleware
# ────────────────────────────────────────────────────────────────────────────
#
# When the request arrives for ``{label}.{AMISTOSO_DOMAIN}``:
#
# - ``admin.amistoso.club``   → 301 redirect to the apex (admin lives at ``/``)
# - ``{slug}.amistoso.club`` + path ``/`` → ``club.html`` if the slug resolves
#
# - ``{slug}.amistoso.club`` + ``/events`` (or bare ``/tv`` / ``/register``)
#   → 302 to ``/`` — the club page already is that club's event directory
#
# All other paths (``/api/*``, ``/tv/{slug}``, ``/register/{alias}``, static
# assets, …) are left untouched so they keep working from any subdomain.

_SUBDOMAIN_RESERVED: frozenset[str] = frozenset(
    {"admin", "tv", "player", "register", "api", "www", "app", "mail", "ftp", "static", "assets", "demo"}
)
_SLUG_LABEL_RE = re.compile(r"^[a-z0-9-]{2,30}$")
# Public directory paths that collapse onto the club page on a club subdomain.
_CLUB_DIRECTORY_PATHS: frozenset[str] = frozenset({"/events", "/tv", "/register"})


def _extract_subdomain_label(host: str) -> str | None:
    """Return the leftmost label of ``host`` if it looks like a club subdomain.

    When ``AMISTOSO_DOMAIN`` is configured, only hosts ending with that suffix
    are considered (strict mode); multi-level prefixes return ``"__invalid__"``
    so the caller can redirect them to the apex.

    When ``AMISTOSO_DOMAIN`` is **not** set, fall back to a heuristic that
    mirrors the frontend's ``getClubSubdomain()``: any host with 3+ parts
    (and not a bare IP or localhost) yields its leftmost label. This makes
    wildcard CNAME setups (``* → onrender.com``) work out of the box without
    requiring extra deployment configuration.
    """
    if not host:
        return None
    h = host.split(":")[0].lower()
    if not h or h == "localhost":
        return None
    # Bare IPv4 / IPv6 → never a subdomain.
    if re.match(r"^\d+\.\d+\.\d+\.\d+$", h) or ":" in h or h.startswith("["):
        return None
    if _AMISTOSO_DOMAIN:
        if h == _AMISTOSO_DOMAIN or not h.endswith("." + _AMISTOSO_DOMAIN):
            return None
        label = h[: -(len(_AMISTOSO_DOMAIN) + 1)]
        if "." in label:
            # Multi-level (e.g. ``foo.bar.amistoso.club``) — treat as invalid.
            return "__invalid__"
        return label or None
    # Heuristic mode: require apex.tld at minimum (e.g. ``slug.example.com``)
    # or ``slug.localhost`` for local dev via /etc/hosts.
    parts = h.split(".")
    is_localhost_child = len(parts) >= 2 and parts[-1] == "localhost"
    if len(parts) < 3 and not is_localhost_child:
        return None
    label = parts[0]
    if not label or not _SLUG_LABEL_RE.match(label):
        return None
    return label


def _request_scheme(request: Request) -> str:
    """Scheme the visitor used, honouring the reverse proxy's forwarded header."""
    return request.headers.get("x-forwarded-proto", request.url.scheme) or "https"


def _apex_host(host: str) -> str:
    """Return the platform (apex) host for ``host``.

    Strict mode (``AMISTOSO_DOMAIN`` set) always answers with the configured
    domain. Heuristic mode strips the leftmost label only when it looks like a
    club subdomain — a two-part host such as ``example.com`` is already the apex.
    """
    h = (host or "").strip()
    if _AMISTOSO_DOMAIN:
        port = h.split(":")[1] if ":" in h and not h.startswith("[") else ""
        return f"{_AMISTOSO_DOMAIN}:{port}" if port else _AMISTOSO_DOMAIN
    label = _extract_subdomain_label(h)
    if label is None or label == "__invalid__" or label in _SUBDOMAIN_RESERVED:
        return h
    return h.split(".", 1)[1]


def _home_url_for(request: Request) -> str:
    """Where "go home" should send a visitor who hit an error page on this host.

    - Known club subdomain → that club's landing page (stay on the club).
    - Unknown club subdomain → the platform apex.
    - Apex / reserved / plain host → the root of the host they are already on.
    """
    host = request.headers.get("host", "")
    if not host:
        return "/"
    if getattr(request.state, "club_subdomain", None):
        return f"{_request_scheme(request)}://{host}/"
    return f"{_request_scheme(request)}://{_apex_host(host)}/"


def _serve_404_page(request: Request) -> HTMLResponse:
    """Return the custom 404 page with the host-aware home URL injected."""
    html = _read_frontend_text("404.html") or "<h1>404 Not Found</h1>"
    html = html.replace("__HOME_URL__", escape(_home_url_for(request), quote=True))
    return HTMLResponse(content=html, status_code=404, headers={"Cache-Control": "no-cache"})


@app.middleware("http")
async def subdomain_router(request: Request, call_next):
    """Handle ``admin.`` redirects and ``{slug}.`` landing pages."""
    host = request.headers.get("host", "")
    label = _extract_subdomain_label(host)
    if label is None:
        return await call_next(request)
    if label == "__invalid__":
        # Multi-level subdomains can never be a valid club slug. Redirect straight
        # to the apex — the backend knows the correct home URL, so we don't need
        # the JS split-on-dot heuristic at all.
        scheme = request.headers.get("x-forwarded-proto", request.url.scheme) or "https"
        port = request.url.port
        apex = f"{_AMISTOSO_DOMAIN}:{port}" if port else _AMISTOSO_DOMAIN
        return RedirectResponse(url=f"{scheme}://{apex}/", status_code=302)
    if label in _SUBDOMAIN_RESERVED:
        return await call_next(request)
    if config.DEMO_INSTANCE:
        # Club subdomains are a core-instance feature. On the demo instance a
        # club landing page would leak sandbox data under a shareable hostname,
        # so send visitors back to the apex and refuse everything else.
        if request.url.path == "/" and request.method == "GET":
            scheme = request.headers.get("x-forwarded-proto", request.url.scheme) or "https"
            apex_host = host.split(":")[0][len(label) + 1 :]
            port = request.url.port
            apex = f"{apex_host}:{port}" if port else apex_host
            return RedirectResponse(url=f"{scheme}://{apex}/", status_code=302)
        return JSONResponse(status_code=404, content={"detail": "Club subdomains are not available in demo mode"})
    # Resolve the label as a club slug. Unknown subdomains 404 entirely so we
    # don't leak the apex content under arbitrary hostnames.
    from .db import get_db  # noqa: PLC0415

    def _resolve_slug():
        with get_db() as conn:
            return conn.execute("SELECT id FROM clubs WHERE slug = ?", (label,)).fetchone()

    # Off the event loop: this middleware runs on every request to a club
    # subdomain (assets and API calls included), so a blocking read here
    # would stall all concurrent requests.
    row = await asyncio.to_thread(_resolve_slug)
    # Remember what the host resolved to so downstream handlers (the 404
    # catch-all in particular) can pick the right "home" for this visitor.
    request.state.club_subdomain = label if row is not None else None
    if row is None:
        # Only the root path is intercepted: every other path (assets, /api/*,
        # /tv, /register, …) falls through to the apex routes, so the 404 page
        # can load its assets and shared links keep working from any hostname.
        if request.url.path != "/" or request.method != "GET":
            return await call_next(request)
        return _serve_404_page(request)
    # Known club: the club page already is that club's event directory, so the
    # generic directories (/events and the legacy bare /tv, /register) go to
    # the root. Serve club.html only on the root GET; let everything else
    # (API calls, /admin, /tv/{slug}, static assets) fall through to the apex
    # routes.
    if request.method == "GET" and request.url.path in _CLUB_DIRECTORY_PATHS:
        return RedirectResponse(url="/", status_code=302)
    if request.url.path != "/" or request.method != "GET":
        return await call_next(request)
    return Response(
        content=_read_frontend_text("club.html") or "<h1>Club page not found</h1>",
        media_type="text/html",
        headers={"Cache-Control": "no-cache"},
    )


# Register routers
app.include_router(admin_players_router)
app.include_router(auth_router)
app.include_router(clubs_router)
app.include_router(public_events_router)
app.include_router(club_seasons_router)
app.include_router(communities_router)
app.include_router(crud_router)
app.include_router(gp_router)
app.include_router(mex_router)
app.include_router(player_auth_router)
app.include_router(player_space_router)
app.include_router(playoff_router)
app.include_router(payments_router)
app.include_router(registration_router)
app.include_router(schema_router)
app.include_router(score_actions_router)
app.include_router(share_router)
app.include_router(registration_share_router)
app.include_router(push_router)
app.include_router(seasons_router)
app.include_router(sse_router)

# ────────────────────────────────────────────────────────────────────────────
# Config endpoint
# ────────────────────────────────────────────────────────────────────────────


def _demo_ttl_days() -> int | float:
    """Return ``DEMO_TTL_DAYS`` as an int when whole (``3`` rather than ``3.0``)."""
    days = float(config.DEMO_TTL_DAYS)
    return int(days) if days.is_integer() else days


@app.get("/api/config")
async def get_config(request: Request, response: Response) -> dict:
    """Return application configuration for frontend."""
    response.headers["Cache-Control"] = "public, max-age=60"
    host = request.headers.get("host", "")
    return {
        "apex_origin": f"{_request_scheme(request)}://{_apex_host(host)}" if host else None,
        "demo_mode": os.environ.get("DEMO_MODE", "").lower() in ("true", "1", "yes"),
        "demo_instance": config.DEMO_INSTANCE,
        "demo_url": config.DEMO_URL,
        "demo_ttl_days": _demo_ttl_days(),
        "amistoso_domain": _AMISTOSO_DOMAIN or None,
    }


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
@lru_cache(maxsize=64)
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


def _html_page(filename: str, fallback: str) -> Response:
    """Serve a frontend HTML page uncached.

    On the demo instance the root ``<html>`` element gets a ``demo-instance``
    class so CSS can hide core-only surfaces (communities, clubs) from the
    first paint, without waiting for ``/api/config``.
    """
    content = _read_frontend_text(filename) or fallback
    if config.DEMO_INSTANCE:
        content = content.replace('<html lang="en">', '<html lang="en" class="demo-instance">', 1)
    return Response(content=content, media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/")
@app.get("/admin")
async def serve_frontend() -> Response:
    return _html_page("index.html", "<h1>Frontend not found</h1>")


def _redirect_to_events(request: Request) -> RedirectResponse:
    """302 to the public Events directory, preserving the query string."""
    target = "/events"
    if request.url.query:
        target += f"?{request.url.query}"
    return RedirectResponse(url=target, status_code=302)


@app.get("/events")
async def serve_events() -> Response:
    """Public Events directory (tournaments + open sign-ups across all clubs)."""
    return _html_page("public.html", "<h1>Events page not found</h1>")


@app.get("/tv")
async def serve_tv_root(request: Request) -> Response:
    """The bare TV picker merged into /events — keep old links working."""
    return _redirect_to_events(request)


@app.get("/tv/{slug}")
async def serve_tv(slug: str) -> Response:
    return _html_page("public.html", "<h1>TV page not found</h1>")


@app.get("/t")
async def serve_tv_legacy_root() -> Response:
    return RedirectResponse(url="/tv", status_code=307)


@app.get("/t/{slug}")
async def serve_tv_legacy(slug: str) -> Response:
    return RedirectResponse(url=f"/tv/{slug}", status_code=307)


@app.get("/register")
async def serve_register(request: Request) -> Response:
    """The bare registration directory merged into /events — keep old links working."""
    return _redirect_to_events(request)


@app.get("/register/{alias}")
async def serve_register_alias(alias: str) -> Response:
    return _html_page("register.html", "<h1>Registration page not found</h1>")


@app.get("/r")
async def serve_register_legacy_root() -> Response:
    return RedirectResponse(url="/register", status_code=307)


@app.get("/r/{slug}")
async def serve_register_legacy(slug: str) -> Response:
    return RedirectResponse(url=f"/register/{slug}", status_code=307)


@app.get("/player")
async def serve_player() -> Response:
    return _html_page("player.html", "<h1>Player Hub not found</h1>")


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


@app.get("/admin-settings-panel.js")
async def serve_admin_settings_panel_js(request: Request) -> Response:
    """Serve the unified per-tournament Settings card orchestrator."""
    return _serve_js_file("admin-settings-panel.js", request)


@app.get("/admin-lobby-settings-panel.js")
async def serve_admin_lobby_settings_panel_js(request: Request) -> Response:
    """Serve the unified per-lobby (registration) Settings card orchestrator."""
    return _serve_js_file("admin-lobby-settings-panel.js", request)


@app.get("/admin-payments.js")
async def serve_admin_payments_js(request: Request) -> Response:
    """Serve the shared payments panel island (lobbies + tournaments)."""
    return _serve_js_file("admin-payments.js", request)


@app.get("/admin-players.js")
async def serve_admin_players_js(request: Request) -> Response:
    """Serve Player Hub admin management."""
    return _serve_js_file("admin-players.js", request)


@app.get("/admin-communities.js")
async def serve_admin_communities_js(request: Request) -> Response:
    """Serve community management panel."""
    return _serve_js_file("admin-communities.js", request)


@app.get("/admin-clubs.js")
async def serve_admin_clubs_js(request: Request) -> Response:
    """Serve club & season management panel."""
    return _serve_js_file("admin-clubs.js", request)


@app.get("/admin-clubs-settings-panel.js")
async def serve_admin_clubs_settings_panel_js(request: Request) -> Response:
    """Serve the unified per-club Settings card orchestrator."""
    return _serve_js_file("admin-clubs-settings-panel.js", request)


@app.get("/admin-subdomain-context.js")
async def serve_admin_subdomain_context_js(request: Request) -> Response:
    """Serve the admin subdomain context banner script."""
    return _serve_js_file("admin-subdomain-context.js", request)


@app.get("/club.js")
async def serve_club_js(request: Request) -> Response:
    """Serve the per-club public landing-page JavaScript."""
    return _serve_js_file("club.js", request)


@app.get("/theme.css")
async def serve_theme_css(request: Request) -> Response:
    """Serve the shared design-token stylesheet loaded before all other sheets."""
    return _serve_css_file("theme.css", request)


@app.get("/club.css")
async def serve_club_css(request: Request) -> Response:
    """Serve the per-club public landing-page stylesheet."""
    return _serve_css_file("club.css", request)


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


@app.get("/icon-192-maskable.png")
async def serve_icon_192_maskable(request: Request) -> Response:
    """Serve the 192×192 maskable PWA icon."""
    return _serve_png_file("icon-192-maskable.png", request)


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


@app.get("/{path:path}")
async def catch_all(path: str, request: Request) -> Response:
    """Serve the custom 404 page for every unmatched frontend path."""
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    return _serve_404_page(request)
