"""
Email transports and failover.

A transport sends one ``OutgoingEmail`` and raises ``EmailSendError`` with a
``SendFailure`` category when it cannot. ``FailoverSender`` tries a list of
transports in order:

* ``RECIPIENT`` — the address was refused; another transport would refuse it
  too, so the send stops.
* ``RATE_LIMITED`` — a short burst limit; the next transport takes this email,
  the failing one stays in rotation.
* ``QUOTA`` / ``PROVIDER`` — the transport is paused for a cooldown (long for
  quota, short otherwise) and the next one takes over. After the cooldown it is
  tried again, so the app goes back to the primary by itself.

Cooldown state is in memory and per process, which matches the app's
one-process-per-data-directory model.
"""

from __future__ import annotations

import asyncio
import enum
import logging
import time
from abc import ABC, abstractmethod
from email.message import EmailMessage
from email.utils import formataddr

import aiosmtplib
import httpx
from pydantic import BaseModel, SecretStr

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
RESEND_BATCH_URL = "https://api.resend.com/emails/batch"

# Words in an error that mean the sending allowance is used up.
_QUOTA_WORDS = ("quota", "daily", "monthly")


class SendFailure(enum.Enum):
    """How a failed send must be handled."""

    RECIPIENT = "recipient"
    # The provider rejected the request content (Resend 400/422). Not a reason to
    # pause the provider; a batch with this error is resent one email at a time.
    INVALID_REQUEST = "invalid_request"
    RATE_LIMITED = "rate_limited"
    QUOTA = "quota"
    PROVIDER = "provider"


class EmailSendError(Exception):
    """A transport could not send. ``detail`` must never contain credentials."""

    def __init__(self, failure: SendFailure, detail: str) -> None:
        super().__init__(detail)
        self.failure = failure
        self.detail = detail


class OutgoingEmail(BaseModel):
    """Transport-independent email. Each transport adds its own From address."""

    to: str
    subject: str
    html_body: str
    sender_name: str = ""
    reply_to: str = ""


def _from_header(email: OutgoingEmail, from_addr: str) -> str:
    return formataddr((email.sender_name, from_addr)) if email.sender_name else from_addr


class EmailTransport(ABC):
    """One way to deliver email (an HTTP API, an SMTP relay, ...)."""

    name: str
    # Most emails one ``send_batch`` call takes; 0 means the transport has no batch API.
    batch_limit: int = 0

    @abstractmethod
    async def send(self, email: OutgoingEmail) -> None:
        """Send ``email`` or raise ``EmailSendError``."""

    async def send_batch(self, emails: list[OutgoingEmail]) -> list[SendFailure | None]:
        """Send up to ``batch_limit`` emails in one request.

        Returns one entry per email: ``None`` when it was accepted, else why it
        was refused. Raises ``EmailSendError`` when the whole request failed.
        """
        raise NotImplementedError(f"{self.name} has no batch API")


# ────────────────────────────────────────────────────────────────────────────
# Resend HTTP API
# ────────────────────────────────────────────────────────────────────────────


def classify_resend_error(status: int, name: str, message: str) -> SendFailure:
    """Map a Resend API error (HTTP status + error ``name``) to a failure category.

    Based on https://resend.com/docs/api-reference/errors: 429 ``daily_quota_exceeded``
    / ``monthly_quota_exceeded`` / ``rate_limit_exceeded``, 403 ``email_above_quota``,
    400 ``validation_error`` and 422 ``missing_required_field`` / ``invalid_parameter``
    for bad request content, 401/403 for key and domain problems, 5xx for outages.
    """
    text = f"{name} {message}".lower()
    if "quota" in text or name in ("daily_quota_exceeded", "monthly_quota_exceeded"):
        return SendFailure.QUOTA
    if status == 429:
        return SendFailure.RATE_LIMITED
    if status in (400, 422):
        if "`to`" in text or "to field" in text:
            return SendFailure.RECIPIENT
        return SendFailure.INVALID_REQUEST
    return SendFailure.PROVIDER


class ResendApiTransport(EmailTransport):
    """Resend's HTTPS API (port 443, so it also works where SMTP ports are blocked)."""

    def __init__(
        self,
        api_key: str,
        from_addr: str,
        *,
        timeout: float,
        name: str = "resend-api",
        http_transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.name = name
        self._api_key = SecretStr(api_key)
        self._from_addr = from_addr
        self._timeout = timeout
        self._http_transport = http_transport  # tests inject httpx.MockTransport

    batch_limit = 100  # Resend's /emails/batch maximum

    def _payload(self, email: OutgoingEmail) -> dict[str, object]:
        payload: dict[str, object] = {
            "from": _from_header(email, self._from_addr),
            "to": [email.to],
            "subject": email.subject,
            "html": email.html_body,
        }
        if email.reply_to:
            payload["reply_to"] = email.reply_to
        return payload

    async def _post(self, url: str, payload: object, extra_headers: dict[str, str] | None = None) -> object:
        """POST to Resend; return the decoded JSON body or raise ``EmailSendError``."""
        headers = {"Authorization": f"Bearer {self._api_key.get_secret_value()}", **(extra_headers or {})}
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._http_transport) as client:
                resp = await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise EmailSendError(SendFailure.PROVIDER, f"{type(exc).__name__}: {exc}") from exc
        try:
            body = resp.json()
        except ValueError:
            body = {}
        if resp.status_code < 300:
            return body
        name = str(body.get("name", "")) if isinstance(body, dict) else ""
        message = str(body.get("message", "")) if isinstance(body, dict) else resp.text[:200]
        failure = classify_resend_error(resp.status_code, name, message)
        raise EmailSendError(failure, f"HTTP {resp.status_code} {name}: {message}".strip())

    async def send(self, email: OutgoingEmail) -> None:
        await self._post(RESEND_API_URL, self._payload(email))

    async def send_batch(self, emails: list[OutgoingEmail]) -> list[SendFailure | None]:
        # The documented batch is all-or-nothing: 200 with one ``data`` entry per
        # email (same order), or an error for the whole request. The caller
        # resends an INVALID_REQUEST/RECIPIENT batch one email at a time.
        body = await self._post(RESEND_BATCH_URL, [self._payload(e) for e in emails])
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list) or len(data) != len(emails):
            logger.warning(
                "Resend batch reply has %s entries for %d emails; counting all as sent",
                len(data) if isinstance(data, list) else "no",
                len(emails),
            )
        return [None] * len(emails)


# ────────────────────────────────────────────────────────────────────────────
# SMTP
# ────────────────────────────────────────────────────────────────────────────


def classify_smtp_error(exc: BaseException) -> SendFailure:
    """Map an aiosmtplib / network error to a failure category."""
    text = describe_smtp_error(exc).lower()
    if any(w in text for w in _QUOTA_WORDS):
        return SendFailure.QUOTA
    refused: list[aiosmtplib.SMTPRecipientRefused] = []
    if isinstance(exc, aiosmtplib.SMTPRecipientsRefused):
        refused = exc.recipients
    elif isinstance(exc, aiosmtplib.SMTPRecipientRefused):
        refused = [exc]
    if refused and all(500 <= r.code < 600 for r in refused):
        return SendFailure.RECIPIENT
    return SendFailure.PROVIDER


def describe_smtp_error(exc: BaseException) -> str:
    """Short, credential-free description of an SMTP error."""
    if isinstance(exc, aiosmtplib.SMTPRecipientsRefused):
        return "; ".join(f"{r.code} {r.message}" for r in exc.recipients) or "recipients refused"
    if isinstance(exc, aiosmtplib.SMTPResponseException):
        return f"{exc.code} {exc.message}"
    return f"{type(exc).__name__}: {exc}"


class SmtpTransport(EmailTransport):
    """Any SMTP relay (Gmail, Resend SMTP, a local MTA, ...), with STARTTLS."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        user: str | None,
        password: str | None,
        from_addr: str,
        use_tls: bool,
        timeout: float,
        name: str = "smtp",
    ) -> None:
        self.name = name
        self._host = host
        self._port = port
        self._user = user
        self._password = SecretStr(password) if password else None
        self._from_addr = from_addr
        self._use_tls = use_tls
        self._timeout = timeout

    def build_message(self, email: OutgoingEmail) -> EmailMessage:
        msg = EmailMessage()
        msg["From"] = _from_header(email, self._from_addr)
        msg["To"] = email.to
        msg["Subject"] = email.subject
        if email.reply_to:
            msg["Reply-To"] = email.reply_to
        msg.set_content(email.html_body, subtype="html")
        return msg

    async def send(self, email: OutgoingEmail) -> None:
        try:
            await aiosmtplib.send(
                self.build_message(email),
                hostname=self._host,
                port=self._port,
                username=self._user,
                password=self._password.get_secret_value() if self._password else None,
                start_tls=self._use_tls,
                timeout=self._timeout,
            )
        except Exception as exc:  # aiosmtplib errors, OSError, timeouts
            raise EmailSendError(classify_smtp_error(exc), describe_smtp_error(exc)) from exc


# ────────────────────────────────────────────────────────────────────────────
# Failover
# ────────────────────────────────────────────────────────────────────────────


class FailoverSender:
    """Send through the first healthy transport; pause transports that fail on the provider side."""

    def __init__(self, *, quota_cooldown_s: float, error_cooldown_s: float) -> None:
        self.quota_cooldown_s = quota_cooldown_s
        self.error_cooldown_s = error_cooldown_s
        self._paused_until: dict[str, float] = {}

    def reset(self) -> None:
        self._paused_until.clear()

    def paused_until(self, name: str) -> float:
        return self._paused_until.get(name, 0.0)

    def _active(self, transports: list[EmailTransport]) -> list[EmailTransport]:
        now = time.monotonic()
        active = [t for t in transports if self._paused_until.get(t.name, 0.0) <= now]
        return active or list(transports)  # everything paused: trying beats dropping the email

    def _on_failure(self, transport: EmailTransport, failure: SendFailure, transport_count: int) -> None:
        """Pause a transport after a quota or provider error, when there is another one to use."""
        if failure in (SendFailure.QUOTA, SendFailure.PROVIDER) and transport_count > 1:
            cooldown = self.quota_cooldown_s if failure is SendFailure.QUOTA else self.error_cooldown_s
            self._paused_until[transport.name] = time.monotonic() + cooldown
            logger.warning("Email transport %s paused for %.0f s", transport.name, cooldown)

    def _on_success(self, transport: EmailTransport) -> None:
        if self._paused_until.pop(transport.name, None) is not None:
            logger.info("Email transport %s is working again", transport.name)

    async def send(self, transports: list[EmailTransport], email: OutgoingEmail) -> str | None:
        """Return the name of the transport that sent ``email``, or ``None`` when none did."""
        active = self._active(transports)
        for index, transport in enumerate(active):
            has_next = index < len(active) - 1
            try:
                await transport.send(email)
            except EmailSendError as exc:
                logger.warning(
                    "Email to %s failed via %s (%s): %s%s",
                    email.to,
                    transport.name,
                    exc.failure.value,
                    exc.detail,
                    " — trying next transport" if has_next and exc.failure is not SendFailure.RECIPIENT else "",
                )
                if exc.failure is SendFailure.RECIPIENT:
                    return None
                self._on_failure(transport, exc.failure, len(transports))
                continue
            except Exception:
                logger.exception("Unexpected error sending email to %s via %s", email.to, transport.name)
                continue
            self._on_success(transport)
            logger.info("Email sent to %s via %s (subject=%r)", email.to, transport.name, email.subject)
            return transport.name

        logger.error("Failed to send email to %s: no transport accepted it", email.to)
        return None

    async def send_many(
        self, transports: list[EmailTransport], emails: list[OutgoingEmail], *, concurrency: int = 2
    ) -> list[str | None]:
        """Send many emails; return, per email, the transport that sent it or ``None``.

        A transport with a batch API takes the emails in chunks. Emails it does
        not accept (whole-request failure, or per-email non-recipient errors)
        move on to the next transports, which send them one by one with
        ``concurrency`` parallel sends.
        """
        results: list[str | None] = [None] * len(emails)
        pending = list(range(len(emails)))
        active = self._active(transports)
        for index, transport in enumerate(active):
            if not pending:
                break
            if transport.batch_limit:
                pending = await self._send_batches(transport, emails, pending, results, len(transports), concurrency)
                continue
            # No batch API: per-email failover over this and the remaining transports.
            rest = active[index:]
            semaphore = asyncio.Semaphore(max(1, concurrency))

            async def _one(i: int) -> None:
                async with semaphore:
                    results[i] = await self.send(rest, emails[i])

            await asyncio.gather(*(_one(i) for i in pending))
            return results

        for i in pending:
            logger.error("Failed to send email to %s: no transport accepted it", emails[i].to)
        return results

    async def _send_batches(
        self,
        transport: EmailTransport,
        emails: list[OutgoingEmail],
        pending: list[int],
        results: list[str | None],
        transport_count: int,
        concurrency: int,
    ) -> list[int]:
        """Send ``pending`` through ``transport`` in batches; return the indices still to send."""
        left: list[int] = []
        for start in range(0, len(pending), transport.batch_limit):
            chunk = pending[start : start + transport.batch_limit]
            try:
                outcomes = await transport.send_batch([emails[i] for i in chunk])
            except EmailSendError as exc:
                logger.warning(
                    "Batch of %d emails failed via %s (%s): %s",
                    len(chunk),
                    transport.name,
                    exc.failure.value,
                    exc.detail,
                )
                if exc.failure in (SendFailure.INVALID_REQUEST, SendFailure.RECIPIENT):
                    # One bad email rejects the whole batch: resend this chunk one
                    # by one through the same transport to isolate it.
                    left += await self._send_singly(transport, emails, chunk, results, concurrency)
                    continue
                self._on_failure(transport, exc.failure, transport_count)
                return left + pending[start:]
            except Exception:
                logger.exception("Unexpected error sending a batch via %s", transport.name)
                return left + pending[start:]
            self._on_success(transport)
            for i, outcome in zip(chunk, outcomes, strict=True):
                if outcome is None:
                    results[i] = transport.name
                elif outcome is not SendFailure.RECIPIENT:
                    left.append(i)
            accepted = sum(1 for o in outcomes if o is None)
            logger.info("Batch sent via %s: %d of %d accepted", transport.name, accepted, len(chunk))
        return left

    async def _send_singly(
        self,
        transport: EmailTransport,
        emails: list[OutgoingEmail],
        chunk: list[int],
        results: list[str | None],
        concurrency: int,
    ) -> list[int]:
        """Send ``chunk`` one by one through ``transport`` only; return the indices it did not take.

        Recipient refusals are final. Emails that fail for another reason are
        returned for the next transport; the transport is not paused here,
        because the batch failure was about content, not the provider.
        """
        left: list[int] = []
        semaphore = asyncio.Semaphore(max(1, concurrency))

        async def _one(i: int) -> None:
            async with semaphore:
                try:
                    await transport.send(emails[i])
                except EmailSendError as exc:
                    logger.warning(
                        "Email to %s failed via %s (%s): %s",
                        emails[i].to,
                        transport.name,
                        exc.failure.value,
                        exc.detail,
                    )
                    if exc.failure is not SendFailure.RECIPIENT:
                        left.append(i)
                    return
                except Exception:
                    logger.exception("Unexpected error sending email to %s via %s", emails[i].to, transport.name)
                    left.append(i)
                    return
                results[i] = transport.name

        await asyncio.gather(*(_one(i) for i in chunk))
        return sorted(left)
