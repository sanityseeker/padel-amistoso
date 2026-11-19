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
from urllib.parse import quote, urlencode, urlparse

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from brotli_asgi import BrotliMiddleware

from . import state as _state_module
from .. import config
from ..auth import auth_router
from ..auth.store import user_store
from .db import init_db
from .elo_recalc import flush_elo_recalculation
from .state import persist_failed as _persist_failed
from .routes_admin_players import router as admin_players_router
from .routes_announcements import router as announcements_router
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
from .routes_player_cards import router as player_cards_router
from .routes_push import router as push_router
from .sse import router as sse_router
from .routes_withdrawals import router as withdrawals_router
from .routes_workspace import router as workspace_router
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
# - ``{slug}.amistoso.club`` + path ``/`` → the React club landing page if the slug resolves
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


def _is_page_path(path: str) -> bool:
    """True for an address a browser navigates to (an app page), not an API call or a static file."""
    if path.startswith(("/api/", "/admin-assets/")) or path == "/api":
        return False
    return "." not in path.rsplit("/", 1)[-1]


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


def _inject_head(html: str, snippet: str) -> str:
    """Insert ``snippet`` just before ``</head>`` (or at the start when the page has no head)."""
    if "</head>" in html:
        return html.replace("</head>", snippet + "</head>", 1)
    return snippet + html


def _serve_404_page(request: Request) -> HTMLResponse:
    """Return the 404 page with the host-aware home URL injected.

    The React shell renders the page (its ``*`` route) when a build exists, with the home URL in
    ``<meta name="amistoso-home">``; without a build it is a plain page with a home link.
    """
    home = escape(_home_url_for(request), quote=True)
    spa = _spa_index()
    if spa is not None:
        html = _inject_head(spa[0], f'<meta name="amistoso-home" content="{home}">')
        return HTMLResponse(content=html, status_code=404, headers={"Cache-Control": "no-cache"})
    html = f'<!doctype html><html lang="en"><body><h1>404 Not Found</h1><p><a href="{home}">Home</a></p></body></html>'
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
        # An unknown subdomain never serves a page of its own: the root is the
        # 404 page (pointing at the apex) and every other page address goes to
        # the same path on the apex, so a made-up club never looks like a club.
        # Static files and /api/* still answer, so the 404 page can load.
        path = request.url.path
        if request.method in ("GET", "HEAD") and path == "/":
            return _serve_404_page(request)
        if request.method in ("GET", "HEAD") and _is_page_path(path):
            target = f"{_request_scheme(request)}://{_apex_host(host)}{path}"
            if request.url.query:
                target += f"?{request.url.query}"
            return RedirectResponse(url=target, status_code=302)
        return await call_next(request)
    # Known club: the club page already is that club's event directory, so the
    # generic directories (/events and the old bare /tv, /register) go to
    # the root. Serve the club landing only on the root GET; let everything else
    # (API calls, /admin, /tv/{slug}, static assets) fall through to the apex
    # routes.
    if request.method == "GET" and request.url.path in _CLUB_DIRECTORY_PATHS:
        return RedirectResponse(url="/", status_code=302)
    if request.url.path != "/" or request.method != "GET":
        return await call_next(request)
    spa = _spa_index()
    if spa is not None:
        # The React shell renders the club landing page; the slug travels in a meta tag because the
        # configured domain (not a hostname guess) decided that this host is a club.
        html = _inject_head(spa[0], f'<meta name="amistoso-club" content="{escape(label, quote=True)}">')
        return Response(content=html, media_type="text/html", headers={"Cache-Control": "no-cache"})
    return _no_build_response()


# Register routers
app.include_router(admin_players_router)
app.include_router(announcements_router)
app.include_router(auth_router)
app.include_router(clubs_router)
app.include_router(public_events_router)
app.include_router(club_seasons_router)
app.include_router(communities_router)
app.include_router(crud_router)
app.include_router(gp_router)
app.include_router(mex_router)
app.include_router(player_auth_router)
app.include_router(player_cards_router)
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
app.include_router(withdrawals_router)
app.include_router(workspace_router)

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
ADMIN_BUILD_DIR = FRONTEND_DIR / "admin-app" / "dist"


# Vite emits content-hashed files under a dedicated prefix, apart from the
# root-level PWA files (manifest, service worker, icons).
@app.get("/admin-assets/{asset_path:path}", include_in_schema=False)
async def serve_admin_asset(asset_path: str) -> Response:
    directory = (ADMIN_BUILD_DIR / "admin-assets").resolve()
    asset = (directory / asset_path).resolve()
    if not asset.is_relative_to(directory) or not asset.is_file():
        return Response(status_code=404)
    return FileResponse(asset, headers={"Cache-Control": "public, max-age=31536000, immutable"})


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


def _serve_png_file(filename: str, request: Request | None = None) -> Response:
    """Serve a PNG file from the frontend directory with ETag-based caching."""
    etag = _content_etag(filename)
    if etag and request and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    headers: dict[str, str] = {"Cache-Control": "public, max-age=86400, must-revalidate"}
    if etag:
        headers["ETag"] = etag
    return Response(content=_read_frontend_bytes(filename), media_type="image/png", headers=headers)


_NO_BUILD_HTML = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Torneos</title></head><body>'
    "<h1>The web app is not built</h1>"
    "<p>Run <code>npm ci &amp;&amp; npm run build</code> in <code>frontend/admin-app</code>, then reload.</p>"
    "</body></html>"
)


def _no_build_response() -> Response:
    """The page every SPA route serves when ``frontend/admin-app/dist`` is missing."""
    return Response(content=_NO_BUILD_HTML, media_type="text/html", headers={"Cache-Control": "no-cache"})


_HTML_OPEN_TAG_RE = re.compile(r"<html\b([^>]*)>", re.IGNORECASE)
_HTML_CLASS_ATTR_RE = re.compile(r"""\bclass\s*=\s*(["'])(.*?)\1""", re.IGNORECASE)
_spa_index_cache: dict[tuple[object, ...], tuple[str, str]] = {}

# The lazily loaded translation chunks, by language code (English is built in).
_LOCALE_ENTRIES = {"es": "src/locales/es.json", "ru": "src/locales/ru.json"}
# Picks the visitor's language exactly as frontend/admin-app/src/i18n.ts ``initialLanguage`` does
# (amistoso-lang, then the old padel-lang, then the browser language) and preloads that language's
# chunk, so its texts download alongside the entry chunk instead of after it. Read-only: i18n.ts
# migrates the old key itself.
_LANGUAGE_PRELOAD_SCRIPT = """<script>
      (function () {
        var files = __FILES__;
        var lang;
        try {
          var saved = localStorage.getItem('amistoso-lang');
          var old = localStorage.getItem('padel-lang');
          if (!saved && (old === 'en' || old === 'es')) lang = old;
          else if (saved === 'en' || saved === 'es' || saved === 'ru') lang = saved;
        } catch (_) {}
        if (!lang) {
          var b = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
          lang = b.indexOf('es') === 0 ? 'es' : b.indexOf('ru') === 0 ? 'ru' : 'en';
        }
        if (!files[lang]) return;
        var link = document.createElement('link');
        link.rel = 'modulepreload';
        link.crossOrigin = '';
        link.href = files[lang];
        document.head.appendChild(link);
      })();
    </script>
    """


def _locale_chunk_paths(manifest_path: Path) -> dict[str, str]:
    """Return ``{language: "/admin-assets/<chunk>.js"}`` for the lazy translation chunks in the build."""
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, ValueError):
        return {}
    paths: dict[str, str] = {}
    for language, source in _LOCALE_ENTRIES.items():
        entry = manifest.get(source)
        file = entry.get("file") if isinstance(entry, dict) else None
        if isinstance(file, str) and file.startswith("admin-assets/"):
            paths[language] = f"/{file}"
    return paths


def _inject_language_preload(html: str, chunks: dict[str, str]) -> str:
    """Insert the language-preload script before the first module script (or ``</head>``)."""
    if not chunks:
        return html
    # Escape "<" so no file name can close the script element.
    script = _LANGUAGE_PRELOAD_SCRIPT.replace("__FILES__", json.dumps(chunks).replace("<", "\\u003c"))
    for marker in ('<script type="module"', "</head>"):
        at = html.find(marker)
        if at != -1:
            return html[:at] + script + html[at:]
    return html


def _mark_demo_instance(html: str) -> str:
    """Add the ``demo-instance`` class to the first ``<html>`` tag, whatever its attribute order."""

    def _inject(match: re.Match[str]) -> str:
        attrs = match.group(1)
        existing = _HTML_CLASS_ATTR_RE.search(attrs)
        if existing is None:
            return f'<html{attrs} class="demo-instance">'
        if "demo-instance" in existing.group(2).split():
            return match.group(0)
        quote_char = existing.group(1)
        replacement = f"class={quote_char}{existing.group(2)} demo-instance{quote_char}"
        return f"<html{attrs[: existing.start()]}{replacement}{attrs[existing.end() :]}>"

    return _HTML_OPEN_TAG_RE.sub(_inject, html, count=1)


def _spa_index() -> tuple[str, str] | None:
    """Return ``(html, etag)`` for the built React shell, or ``None`` when no build exists.

    The result is cached per process and invalidated when the file changes, so a
    redeploy (or a test rewriting the file) is picked up without a restart.
    """
    index = ADMIN_BUILD_DIR / "index.html"
    manifest = ADMIN_BUILD_DIR / ".vite" / "manifest.json"
    try:
        stat = index.stat()
    except OSError:
        return None
    try:
        manifest_stat = manifest.stat()
        manifest_key: tuple[int, int] | None = (manifest_stat.st_mtime_ns, manifest_stat.st_size)
    except OSError:
        manifest_key = None
    key = (str(index), stat.st_mtime_ns, stat.st_size, manifest_key, bool(config.DEMO_INSTANCE))
    cached = _spa_index_cache.get(key)
    if cached is None:
        html = _inject_language_preload(index.read_text(), _locale_chunk_paths(manifest))
        if config.DEMO_INSTANCE:
            html = _mark_demo_instance(html)
        etag = f'"s{hashlib.sha256(html.encode()).hexdigest()[:16]}"'
        _spa_index_cache.clear()
        cached = _spa_index_cache[key] = (html, etag)
    return cached


def _spa_response(request: Request) -> Response:
    """Serve the React shell for any SPA path (no-cache + ETag, demo class injected).

    Without a Vite build this is the "frontend not built" notice.
    """
    spa = _spa_index()
    if spa is None:
        return _no_build_response()
    html, etag = spa
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=html, media_type="text/html", headers=headers)


@app.get("/")
@app.get("/admin")
async def serve_frontend(request: Request) -> Response:
    # The React shell also serves the demo instance: its login page has the one-click sandbox start.
    return _spa_response(request)


@app.get("/admin/{rest:path}", include_in_schema=False)
async def serve_admin_spa(rest: str, request: Request) -> Response:
    """Deep links into the React admin (``/admin/t/<id>``, ``/admin/clubs`` ...)."""
    return _spa_response(request)


def _redirect_to_events(request: Request) -> RedirectResponse:
    """302 to the public Events directory, preserving the query string."""
    target = "/events"
    if request.url.query:
        target += f"?{request.url.query}"
    return RedirectResponse(url=target, status_code=302)


@app.get("/events")
async def serve_events(request: Request) -> Response:
    """Public Events directory (tournaments + open sign-ups across all clubs)."""
    # Preserve old /tv?tid= and /events?t= links after moving the directory
    # to React. Tournament views continue to use their dedicated public route.
    slug = request.query_params.get("tid") or request.query_params.get("t")
    if slug:
        params = [(key, value) for key, value in request.query_params.multi_items() if key not in {"tid", "t"}]
        target = f"/tv/{quote(slug, safe='')}"
        if params:
            target += "?" + urlencode(params)
        return RedirectResponse(url=target, status_code=302)
    return _spa_response(request)


@app.get("/events/{rest:path}", include_in_schema=False)
async def serve_events_spa(rest: str, request: Request) -> Response:
    """Client-side routes under ``/events``."""
    return _spa_response(request)


@app.get("/tv")
async def serve_tv_root(request: Request) -> Response:
    """The bare TV picker merged into /events — keep old links working."""
    return _redirect_to_events(request)


@app.get("/tv/{rest:path}", include_in_schema=False)
async def serve_tv(rest: str, request: Request) -> Response:
    """Spectator / TV view (the React shell)."""
    if not rest.strip("/"):
        return _redirect_to_events(request)
    return _spa_response(request)


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


@app.get("/register/{rest:path}", include_in_schema=False)
async def serve_register_alias(rest: str, request: Request) -> Response:
    """Public sign-up (the React shell)."""
    if not rest.strip("/"):
        return _redirect_to_events(request)
    return _spa_response(request)


@app.get("/club/{rest:path}", include_in_schema=False)
async def serve_club_path(rest: str, request: Request) -> Response:
    """Club landing page by path (``/club/<slug>``), for hosts without subdomains."""
    if not rest.strip("/"):
        return _redirect_to_events(request)
    return _spa_response(request)


@app.get("/r")
async def serve_register_legacy_root() -> Response:
    return RedirectResponse(url="/register", status_code=307)


@app.get("/r/{slug}")
async def serve_register_legacy(slug: str) -> Response:
    return RedirectResponse(url=f"/register/{slug}", status_code=307)


@app.get("/player")
async def serve_player(request: Request) -> Response:
    # The Player Hub is a core-site feature: demo-instance visitors go to Events.
    if config.DEMO_INSTANCE:
        return _redirect_to_events(request)
    return _spa_response(request)


@app.get("/player/{rest:path}", include_in_schema=False)
async def serve_player_spa(rest: str, request: Request) -> Response:
    """Client-side routes under ``/player``."""
    if config.DEMO_INSTANCE:
        return _redirect_to_events(request)
    return _spa_response(request)


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


_SW_CACHE_NAME_RE = re.compile(r"const CACHE_NAME = '(amistoso-v\d+)';")
_SW_ASSETS_PLACEHOLDER = "/*__SPA_ASSETS__*/"
_sw_cache: dict[tuple[object, ...], tuple[str, str]] = {}


# Heavy lazy chunks that most visits never open (charts, the long Info guide). They are not precached;
# the service worker still caches them the first time they are fetched.
_SPA_LAZY_PREFIXES = (
    "admin-assets/EloChart-",
    "admin-assets/PlayerSparkline-",
    "admin-assets/AreaGradient-",
    "admin-assets/InfoPage-",
    "admin-assets/ru-",
)


def _spa_asset_paths() -> list[str]:
    """Return the ``/admin-assets/*`` files of the Vite build to precache (entry, CSS, shell chunks)."""
    manifest_path = ADMIN_BUILD_DIR / ".vite" / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, ValueError):
        return []
    paths: set[str] = set()
    for entry in manifest.values():
        if not isinstance(entry, dict):
            continue
        files = [entry.get("file"), *entry.get("css", []), *entry.get("assets", [])]
        for file in files:
            if isinstance(file, str) and file.startswith("admin-assets/") and not file.startswith(_SPA_LAZY_PREFIXES):
                paths.add(f"/{file}")
    return sorted(paths)


def _render_service_worker() -> tuple[str, str]:
    """Return ``(source, etag)`` of the service worker, templated with the current SPA build.

    The cache name gets a hash of the built ``index.html`` (so every new build installs
    a fresh cache) and the asset placeholder becomes the JSON list of hashed SPA files to
    precache. Without a build the worker is served with a plain cache name and no assets.
    Cached per process, keyed on the build files' mtimes.
    """
    index = ADMIN_BUILD_DIR / "index.html"
    manifest = ADMIN_BUILD_DIR / ".vite" / "manifest.json"
    key: tuple[object, ...] = (str(ADMIN_BUILD_DIR),)
    for path in (index, manifest):
        try:
            stat = path.stat()
            key += (stat.st_mtime_ns, stat.st_size)
        except OSError:
            key += (None, None)
    cached = _sw_cache.get(key)
    if cached is not None:
        return cached
    source = _read_frontend_text("service-worker.js")
    assets: list[str] = []
    if index.is_file():
        build_hash = hashlib.sha256(index.read_bytes()).hexdigest()[:10]
        source = _SW_CACHE_NAME_RE.sub(lambda m: f"const CACHE_NAME = '{m.group(1)}-{build_hash}';", source, count=1)
        assets = _spa_asset_paths()
    source = source.replace(_SW_ASSETS_PLACEHOLDER, ", ".join(json.dumps(asset) for asset in assets))
    etag = f'"w{hashlib.sha256(source.encode()).hexdigest()[:12]}"'
    _sw_cache.clear()
    _sw_cache[key] = (source, etag)
    return source, etag


@app.get("/service-worker.js")
async def serve_service_worker(request: Request) -> Response:
    """Serve the PWA service worker, templated with the React build's cache name and assets."""
    source, etag = _render_service_worker()
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(
        content=source,
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=300, must-revalidate", "ETag": etag},
    )


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
