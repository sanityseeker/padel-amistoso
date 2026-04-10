"""
Server-Sent Events (SSE) support.

Provides a lightweight pub/sub mechanism so that tournament mutations
(scores, phase changes, etc.) can be **pushed** to connected clients
instead of requiring them to poll.

Two event channels are maintained:

* **Per-tournament** — keyed by tournament ID.  The TV display and the
  admin panel subscribe here to learn when data changes.
* **Global** — a single channel that fires on every state mutation.  The
  TV tournament picker subscribes here to detect new/deleted tournaments.

Design goals
------------
- Zero dependencies beyond ``asyncio`` and FastAPI's ``StreamingResponse``
- Graceful degradation: if the client doesn't support SSE or the
  connection drops, the existing polling endpoints remain available as
  a fallback.
- All subscriptions automatically clean up when the client disconnects.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from . import state as _state_module

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sse"])

# ────────────────────────────────────────────────────────────────────────────
# Subscriber registry
# ────────────────────────────────────────────────────────────────────────────

# Each entry is a set of asyncio.Queue instances — one per connected client.
_tournament_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
_global_subscribers: set[asyncio.Queue] = set()

# Heartbeat interval (seconds) — keeps proxies (Cloudflare, Render, etc.)
# from closing idle connections.
_HEARTBEAT_INTERVAL_SECS = 25


def notify_tournament(tid: str) -> None:
    """Push a version-changed event to all subscribers of *tid*.

    Called from ``_save_tournament()`` after the version counter is bumped.
    Safe to call from sync code — it does not ``await`` anything.
    """
    version = _state_module._tournament_versions.get(tid, 0)
    payload = json.dumps({"tid": tid, "version": version})
    for q in _tournament_subscribers.get(tid, set()).copy():
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass  # slow client — skip this event, they'll get the next one


def notify_global() -> None:
    """Push a state-version-changed event to all global subscribers.

    Called from ``_save_tournament()`` and ``_delete_tournament()``.
    """
    version = _state_module._state_version
    payload = json.dumps({"version": version})
    for q in _global_subscribers.copy():
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


# ────────────────────────────────────────────────────────────────────────────
# SSE generators
# ────────────────────────────────────────────────────────────────────────────


async def _event_stream(
    queue: asyncio.Queue,
    subscribers: set[asyncio.Queue],
    request: Request,
    initial_data: str | None = None,
):
    """Yield SSE-formatted text from *queue* until the client disconnects.

    *subscribers* is the set that *queue* was added to — used to remove the
    queue on cleanup.

    If *initial_data* is provided it is sent immediately so the client has
    a current snapshot without waiting for the next mutation.
    """
    try:
        # Send initial snapshot so the client starts with the right version.
        if initial_data is not None:
            yield f"data: {initial_data}\n\n"

        while True:
            # Wait for a notification, but wake up periodically to send a
            # heartbeat comment (keeps reverse-proxies happy).
            try:
                data = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_INTERVAL_SECS)
                yield f"data: {data}\n\n"
            except asyncio.TimeoutError:
                # SSE comment line — the browser ignores it, but it resets
                # the proxy idle timer.
                yield ": heartbeat\n\n"

            # Detect client disconnect (works with Starlette's disconnect
            # detection which sets this when the socket closes).
            if await request.is_disconnected():
                break
    except asyncio.CancelledError:
        pass
    finally:
        subscribers.discard(queue)


# ────────────────────────────────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────────────────────────────────


@router.get("/api/tournaments/{tid}/events")
async def tournament_events(tid: str, request: Request) -> StreamingResponse:
    """SSE stream that pushes ``{tid, version}`` on every tournament mutation.

    The TV display and admin panel subscribe here instead of polling
    ``/{tid}/version`` every few seconds.

    On connection the current version is sent immediately so the client
    can compare it with its local copy and decide whether to fetch new data.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=32)
    _tournament_subscribers[tid].add(queue)

    # Send the current version right away.
    version = _state_module._tournament_versions.get(tid, 0)
    initial = json.dumps({"tid": tid, "version": version})

    return StreamingResponse(
        _event_stream(queue, _tournament_subscribers[tid], request, initial_data=initial),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx: disable response buffering
        },
    )


@router.get("/api/events")
async def global_events(request: Request) -> StreamingResponse:
    """SSE stream that pushes ``{version}`` on every global state mutation.

    The TV tournament picker subscribes here instead of polling ``/api/version``.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=32)
    _global_subscribers.add(queue)

    version = _state_module._state_version
    initial = json.dumps({"version": version})

    return StreamingResponse(
        _event_stream(queue, _global_subscribers, request, initial_data=initial),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
