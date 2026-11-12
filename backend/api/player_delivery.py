"""
Deliver organizer sends to tournament players by push, email or both.

A tournament's ``delivery`` setting (see :class:`TournamentEmailSettings`) picks the channel:

- ``email``: email only, as before.
- ``push_first``: a push notification to players who turned notifications on for this
  tournament, email to the rest.
- ``both``: push to subscribers and email to everyone with an address.

The server cannot see whether a player installed the app. A push subscription is the signal:
the player turned notifications on in the Player Hub or on the TV page.

Login codes are never sent by push: a player needs them before they can subscribe.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from fastapi import HTTPException
from pydantic import BaseModel

from ..email import _tx, is_valid_email, send_email
from ..email import is_configured as email_is_configured
from .push import is_push_available, send_push_to_players, subscribed_player_ids
from .schemas import TournamentEmailSettings

# Push services reject payloads over about 4 KB after encryption; organizer messages can be
# 2000 characters (up to 4 KB of Cyrillic), so the notification body is cut short.
PUSH_BODY_MAX = 400


class DeliveryCounts(BaseModel):
    """What a bulk send did. ``sent`` and ``failed`` count emails, ``pushed`` push notifications."""

    sent: int = 0
    pushed: int = 0
    skipped: int = 0
    failed: int = 0


def ensure_can_send(es: TournamentEmailSettings) -> None:
    """Raise 400 when the tournament's delivery mode has no working channel on this server."""
    if email_is_configured():
        return
    if es.delivery != "email" and is_push_available():
        return
    raise HTTPException(400, "Email is not configured on this server")


def any_channel_configured() -> bool:
    """Cheap pre-check before the tournament is loaded: is either channel set up at all?"""
    return email_is_configured() or is_push_available()


def _clip(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= PUSH_BODY_MAX else text[: PUSH_BODY_MAX - 1].rstrip() + "…"


@dataclass
class PlayerDelivery:
    """Send one bulk message to many players of one tournament, choosing the channel per player."""

    tid: str
    data: dict
    es: TournamentEmailSettings
    counts: DeliveryCounts = field(default_factory=DeliveryCounts)

    def __post_init__(self) -> None:
        self._email_on = email_is_configured()
        self._push_ids: set[str] = (
            subscribed_player_ids(self.tid) if self.es.delivery != "email" and is_push_available() else set()
        )

    def reachable(self, pid: str, email: str) -> bool:
        """Return ``True`` when this player can get the message on some channel."""
        return pid in self._push_ids or (self._email_on and bool(email) and is_valid_email(email))

    async def deliver(
        self,
        pid: str,
        email: str,
        *,
        render_email: Callable[[], tuple[str, str]],
        push_body: Callable[[], str],
        tag: str,
        subject: str | None = None,
    ) -> None:
        """Send to one player by the channels the delivery mode picks, and count the result.

        ``render_email`` returns ``(subject, html)``; ``subject`` overrides its subject.
        """
        has_email = self._email_on and bool(email) and is_valid_email(email)
        use_push = pid in self._push_ids
        use_email = has_email and (self.es.delivery != "push_first" or not use_push)
        if not use_push and not use_email:
            self.counts.skipped += 1
            return
        if use_push:
            alias = self.data.get("alias")
            send_push_to_players(
                tournament_id=self.tid,
                player_ids={pid},
                title=self.data.get("name", "Tournament"),
                body=_clip(push_body()),
                url=f"/tv/{alias or self.tid}",
                tag=tag,
            )
            self.counts.pushed += 1
        if use_email:
            rendered_subject, body = render_email()
            ok = await send_email(
                email,
                subject or rendered_subject,
                body,
                sender_name=self.es.sender_name,
                reply_to=self.es.reply_to,
            )
            if ok:
                self.counts.sent += 1
            else:
                self.counts.failed += 1


# ────────────────────────────────────────────────────────────────────────────
# Push texts (the email renderers live in backend/email.py)
# ────────────────────────────────────────────────────────────────────────────


def push_started(lang: str) -> str:
    return _tx(
        lang,
        "The tournament has started. Tap to see your matches.",
        "El torneo ha comenzado. Toca para ver tus partidos.",
        "Турнир начат. Нажмите, чтобы открыть свои матчи.",
    )


def push_results(lang: str, rank: int, total: int) -> str:
    return _tx(
        lang,
        f"Final results are in: you finished {rank} of {total}.",
        f"Resultados finales: terminaste en el puesto {rank} de {total}.",
        f"Итоги турнира: ваше место {rank} из {total}.",
    )


def push_next_round(lang: str, round_number: int, matches_info: list[dict]) -> str:
    """One line per match: opponents and court, or who a bye team waits for."""
    parts: list[str] = []
    for m in matches_info:
        if m.get("bye"):
            waiting = m.get("waiting_for", "")
            parts.append(
                _tx(lang, f"Next opponent: {waiting}", f"Próximo rival: {waiting}", f"Следующий соперник: {waiting}")
                if waiting
                else _tx(
                    lang,
                    "Your next opponent is to be determined",
                    "Tu próximo rival está por definirse",
                    "Следующий соперник пока не определён",
                )
            )
            continue
        text = f"vs {m.get('opponents', '')}"
        if m.get("teammates"):
            text = _tx(
                lang,
                f"With {m['teammates']} vs {m['opponents']}",
                f"Con {m['teammates']} vs {m['opponents']}",
                f"Партнёр: {m['teammates']}, соперники: {m['opponents']}",
            )
        if m.get("court"):
            text += _tx(lang, f", court {m['court']}", f", cancha {m['court']}", f", корт {m['court']}")
        parts.append(text)
    labels = {m.get("round_label", "") for m in matches_info}
    label = labels.pop() if len(labels) == 1 else ""
    label = label or _tx(lang, f"Round {round_number}", f"Ronda {round_number}", f"Раунд {round_number}")
    return f"{label}: " + "; ".join(parts)
