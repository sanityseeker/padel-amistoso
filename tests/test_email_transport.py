"""Email transports (Resend API, SMTP) and the failover between them."""

from __future__ import annotations

import asyncio
import json
import logging
from unittest.mock import AsyncMock, patch

import aiosmtplib
import httpx
import pytest

import backend.email as email_mod
from backend.email_transport import (
    EmailSendError,
    EmailTransport,
    FailoverSender,
    OutgoingEmail,
    ResendApiTransport,
    SendFailure,
    SmtpTransport,
    classify_resend_error,
    classify_smtp_error,
)

EMAIL = OutgoingEmail(
    to="player@example.com", subject="Hi", html_body="<p>x</p>", sender_name="Cup", reply_to="org@example.com"
)


class FakeTransport(EmailTransport):
    """Records calls; raises the queued errors in order, then succeeds."""

    def __init__(self, name: str, errors: list[SendFailure] | None = None) -> None:
        self.name = name
        self.errors = list(errors or [])
        self.calls = 0

    async def send(self, email: OutgoingEmail) -> None:
        self.calls += 1
        if self.errors:
            raise EmailSendError(self.errors.pop(0), f"{self.name} failed")


def _run(coro):
    return asyncio.run(coro)


# ── classification ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("status", "name", "message", "expected"),
    [
        # Names and messages from https://resend.com/docs/api-reference/errors
        (429, "daily_quota_exceeded", "You have exceeded your daily email sending quota.", SendFailure.QUOTA),
        (429, "monthly_quota_exceeded", "You have exceeded your monthly email sending quota.", SendFailure.QUOTA),
        (403, "email_above_quota", "The email was above quota when received.", SendFailure.QUOTA),
        (
            429,
            "rate_limit_exceeded",
            "Too many requests. Please limit the number of requests per second.",
            SendFailure.RATE_LIMITED,
        ),
        (
            400,
            "validation_error",
            "An error was found with one or more fields in the request.",
            SendFailure.INVALID_REQUEST,
        ),
        (
            422,
            "missing_required_field",
            "The request body is missing one or more required fields.",
            SendFailure.INVALID_REQUEST,
        ),
        (422, "validation_error", "Invalid `to` field.", SendFailure.RECIPIENT),
        (403, "validation_error", "The `domain.com` domain is not verified.", SendFailure.PROVIDER),
        (401, "missing_api_key", "Missing API Key", SendFailure.PROVIDER),
        (401, "validation_error", "API key is invalid", SendFailure.PROVIDER),
        (403, "suspended_api_key", "This API key is suspended", SendFailure.PROVIDER),
        (500, "application_error", "An unexpected error occurred.", SendFailure.PROVIDER),
        (503, "service_unavailable", "API is temporarily unavailable", SendFailure.PROVIDER),
    ],
)
def test_classify_resend_error(status: int, name: str, message: str, expected: SendFailure) -> None:
    assert classify_resend_error(status, name, message) is expected


# Replies recorded from the live Resend API on 2026-11-12.
LIVE_INVALID_TO = {
    "message": "Invalid `to` field. The email address needs to follow the `email@example.com` "
    "or `Name <email@example.com>` format.",
    "name": "validation_error",
    "statusCode": 422,
}
LIVE_BAD_KEY = {"message": "API key is invalid", "name": "validation_error", "statusCode": 401}


def test_live_invalid_to_is_recipient_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json=LIVE_INVALID_TO)

    with pytest.raises(EmailSendError) as info:
        _run(_resend(handler).send(EMAIL))
    assert info.value.failure is SendFailure.RECIPIENT


def test_live_bad_key_fails_over_and_pauses() -> None:
    sender = _sender()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json=LIVE_BAD_KEY)

    smtp = FakeTransport("smtp")
    assert _run(sender.send([_resend(handler), smtp], EMAIL)) == "smtp"
    assert sender.paused_until("resend-api") > 0


def test_live_strict_batch_rejection_isolates_bad_address() -> None:
    """Live: a batch with one invalid address is rejected whole with the single-send 422 body."""
    bad = "not-an-email"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/emails/batch":
            return httpx.Response(422, json=LIVE_INVALID_TO)
        if json.loads(request.content)["to"] == [bad]:
            return httpx.Response(422, json=LIVE_INVALID_TO)
        return httpx.Response(200, json={"id": "01a1cd64-536a-7c8d-80b6-f41cb5faf5c3"})

    emails = [EMAIL, OutgoingEmail(to=bad, subject="S", html_body="<p>b</p>")]
    smtp = FakeTransport("smtp")
    assert _run(_sender().send_many([_resend(handler), smtp], emails)) == ["resend-api", None]
    assert smtp.calls == 0


def test_classify_smtp_errors() -> None:
    bad_rcpt = aiosmtplib.SMTPRecipientRefused(550, "No such user", "x@example.com")
    assert classify_smtp_error(aiosmtplib.SMTPRecipientsRefused([bad_rcpt])) is SendFailure.RECIPIENT
    assert classify_smtp_error(aiosmtplib.SMTPDataError(550, "Daily sending quota exceeded")) is SendFailure.QUOTA
    assert classify_smtp_error(aiosmtplib.SMTPAuthenticationError(535, "bad creds")) is SendFailure.PROVIDER
    assert classify_smtp_error(OSError("connection refused")) is SendFailure.PROVIDER
    temp_rcpt = aiosmtplib.SMTPRecipientRefused(451, "try later", "x@example.com")
    assert classify_smtp_error(aiosmtplib.SMTPRecipientsRefused([temp_rcpt])) is SendFailure.PROVIDER


# ── Resend API transport ───────────────────────────────────────────────────


def _resend(handler) -> ResendApiTransport:
    return ResendApiTransport(
        "re_secret_key", "noreply@club.example", timeout=5, http_transport=httpx.MockTransport(handler)
    )


def test_resend_sends_expected_payload() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "abc"})

    _run(_resend(handler).send(EMAIL))
    body = json.loads(seen[0].content)
    assert seen[0].headers["Authorization"] == "Bearer re_secret_key"
    assert body["to"] == ["player@example.com"]
    assert body["reply_to"] == "org@example.com"
    assert "Cup" in body["from"] and "noreply@club.example" in body["from"]


def test_resend_quota_error_is_classified() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"name": "daily_quota_exceeded", "message": "daily quota"})

    with pytest.raises(EmailSendError) as info:
        _run(_resend(handler).send(EMAIL))
    assert info.value.failure is SendFailure.QUOTA
    assert "re_secret_key" not in info.value.detail


def test_resend_network_error_is_provider_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    with pytest.raises(EmailSendError) as info:
        _run(_resend(handler).send(EMAIL))
    assert info.value.failure is SendFailure.PROVIDER


# ── SMTP transport ─────────────────────────────────────────────────────────


def test_smtp_uses_own_from_and_keeps_reply_to() -> None:
    t = SmtpTransport(
        host="smtp.gmail.com", port=587, user="me@gmail.com", password="app-pass",
        from_addr="me@gmail.com", use_tls=True, timeout=5,
    )  # fmt: skip
    with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
        _run(t.send(EMAIL))
    msg = mock_send.call_args[0][0]
    assert "me@gmail.com" in msg["From"]
    assert msg["Reply-To"] == "org@example.com"
    assert mock_send.call_args.kwargs["start_tls"] is True


# ── failover ───────────────────────────────────────────────────────────────


def _sender() -> FailoverSender:
    return FailoverSender(quota_cooldown_s=3600, error_cooldown_s=300)


def test_primary_ok_backup_not_called() -> None:
    primary, backup = FakeTransport("resend-api"), FakeTransport("smtp")
    assert _run(_sender().send([primary, backup], EMAIL)) == "resend-api"
    assert backup.calls == 0


def test_quota_fails_over_and_pauses_primary() -> None:
    sender = _sender()
    primary, backup = FakeTransport("resend-api", [SendFailure.QUOTA]), FakeTransport("smtp")
    assert _run(sender.send([primary, backup], EMAIL)) == "smtp"
    # Next email goes straight to the backup while the primary is paused.
    assert _run(sender.send([primary, backup], EMAIL)) == "smtp"
    assert primary.calls == 1


def test_primary_retried_after_cooldown() -> None:
    sender = _sender()
    primary, backup = FakeTransport("resend-api", [SendFailure.PROVIDER]), FakeTransport("smtp")
    with patch("backend.email_transport.time.monotonic", return_value=1000.0):
        _run(sender.send([primary, backup], EMAIL))
    assert sender.paused_until("resend-api") == 1300.0
    with patch("backend.email_transport.time.monotonic", return_value=1301.0):
        assert _run(sender.send([primary, backup], EMAIL)) == "resend-api"
    assert sender.paused_until("resend-api") == 0.0


def test_quota_cooldown_is_longer() -> None:
    sender = _sender()
    with patch("backend.email_transport.time.monotonic", return_value=0.0):
        _run(sender.send([FakeTransport("resend-api", [SendFailure.QUOTA]), FakeTransport("smtp")], EMAIL))
    assert sender.paused_until("resend-api") == 3600.0


def test_rate_limit_fails_over_without_pause() -> None:
    sender = _sender()
    primary, backup = FakeTransport("resend-api", [SendFailure.RATE_LIMITED]), FakeTransport("smtp")
    assert _run(sender.send([primary, backup], EMAIL)) == "smtp"
    assert sender.paused_until("resend-api") == 0.0


def test_recipient_error_does_not_fail_over() -> None:
    sender = _sender()
    primary, backup = FakeTransport("resend-api", [SendFailure.RECIPIENT]), FakeTransport("smtp")
    assert _run(sender.send([primary, backup], EMAIL)) is None
    assert backup.calls == 0
    assert sender.paused_until("resend-api") == 0.0


def test_all_fail_returns_none() -> None:
    primary = FakeTransport("resend-api", [SendFailure.PROVIDER])
    backup = FakeTransport("smtp", [SendFailure.PROVIDER])
    assert _run(_sender().send([primary, backup], EMAIL)) is None


def test_all_paused_still_tries() -> None:
    sender = _sender()
    primary = FakeTransport("resend-api", [SendFailure.PROVIDER])
    backup = FakeTransport("smtp", [SendFailure.PROVIDER])
    _run(sender.send([primary, backup], EMAIL))
    assert _run(sender.send([primary, backup], EMAIL)) == "resend-api"


def test_single_transport_is_never_paused() -> None:
    sender = _sender()
    only = FakeTransport("smtp", [SendFailure.PROVIDER])
    assert _run(sender.send([only], EMAIL)) is None
    assert sender.paused_until("smtp") == 0.0


# ── wiring in backend.email ────────────────────────────────────────────────


def test_transport_chain_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(email_mod, "RESEND_API_KEY", "re_key")
    monkeypatch.setattr(email_mod, "RESEND_FROM", "noreply@club.example")
    monkeypatch.setattr(email_mod, "SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setattr(email_mod, "SMTP_FROM", "me@gmail.com")
    assert [t.name for t in email_mod._transports()] == ["resend-api", "smtp"]
    assert email_mod.is_configured()


def test_resend_alone_is_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(email_mod, "RESEND_API_KEY", "re_key")
    monkeypatch.setattr(email_mod, "SMTP_FROM", "noreply@club.example")  # RESEND_FROM falls back to it
    assert [t.name for t in email_mod._transports()] == ["resend-api"]


def test_send_email_falls_back_to_smtp(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setattr(email_mod, "RESEND_API_KEY", "re_secret_key")
    monkeypatch.setattr(email_mod, "RESEND_FROM", "noreply@club.example")
    monkeypatch.setattr(email_mod, "SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setattr(email_mod, "SMTP_FROM", "me@gmail.com")
    monkeypatch.setattr(email_mod, "SMTP_PASS", "gmail-app-pass")

    async def quota(self, email):
        raise EmailSendError(SendFailure.QUOTA, "HTTP 429 daily_quota_exceeded: quota")

    monkeypatch.setattr(ResendApiTransport, "send", quota)
    caplog.set_level(logging.INFO)
    with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
        assert _run(email_mod.send_email("p@example.com", "S", "<p>b</p>")) is True
    assert mock_send.call_args.kwargs["hostname"] == "smtp.gmail.com"
    assert "re_secret_key" not in caplog.text
    assert "gmail-app-pass" not in caplog.text


# ── batch sending ──────────────────────────────────────────────────────────


class FakeBatchTransport(FakeTransport):
    """Batch-capable fake: ``batch_error`` fails whole requests, ``item_failures`` maps index -> failure."""

    def __init__(
        self,
        name: str,
        *,
        batch_limit: int = 100,
        batch_error: SendFailure | None = None,
        item_failures: dict[int, SendFailure] | None = None,
    ) -> None:
        super().__init__(name)
        self.batch_limit = batch_limit
        self.batch_error = batch_error
        self.item_failures = item_failures or {}
        self.batches: list[list[str]] = []

    async def send_batch(self, emails: list[OutgoingEmail]) -> list[SendFailure | None]:
        self.batches.append([e.to for e in emails])
        if self.batch_error is not None:
            raise EmailSendError(self.batch_error, "batch failed")
        return [self.item_failures.get(int(e.to.split("@")[0][1:])) for e in emails]


def _emails(n: int) -> list[OutgoingEmail]:
    return [OutgoingEmail(to=f"p{i}@example.com", subject="S", html_body="<p>b</p>") for i in range(n)]


def test_resend_batch_payload() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": [{"id": "a"}, {"id": "b"}]})  # documented success shape

    outcomes = _run(_resend(handler).send_batch(_emails(2)))
    assert str(seen[0].url) == "https://api.resend.com/emails/batch"
    assert [item["to"] for item in json.loads(seen[0].content)] == [["p0@example.com"], ["p1@example.com"]]
    assert outcomes == [None, None]


def test_rejected_batch_is_resent_one_by_one_through_same_transport() -> None:
    """Strict batch: one bad email rejects the request; the others still go via Resend."""
    sender = _sender()
    single_sends: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/emails/batch":
            return httpx.Response(422, json={"name": "validation_error", "message": "Invalid `to` field."})
        to = json.loads(request.content)["to"][0]
        single_sends.append(to)
        if to == "p1@example.com":
            return httpx.Response(422, json={"name": "validation_error", "message": "Invalid `to` field."})
        return httpx.Response(200, json={"id": "x"})

    api, smtp = _resend(handler), FakeTransport("smtp")
    results = _run(sender.send_many([api, smtp], _emails(3)))
    assert results == ["resend-api", None, "resend-api"]
    assert sorted(single_sends) == ["p0@example.com", "p1@example.com", "p2@example.com"]
    assert smtp.calls == 0
    assert sender.paused_until("resend-api") == 0.0


def test_resend_batch_quota_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"name": "daily_quota_exceeded", "message": "quota"})

    with pytest.raises(EmailSendError) as info:
        _run(_resend(handler).send_batch(_emails(3)))
    assert info.value.failure is SendFailure.QUOTA


def test_send_many_uses_batch() -> None:
    api, smtp = FakeBatchTransport("resend-api"), FakeTransport("smtp")
    assert _run(_sender().send_many([api, smtp], _emails(3))) == ["resend-api"] * 3
    assert len(api.batches) == 1
    assert smtp.calls == 0


def test_send_many_chunks_by_batch_limit() -> None:
    api = FakeBatchTransport("resend-api", batch_limit=2)
    _run(_sender().send_many([api], _emails(5)))
    assert [len(b) for b in api.batches] == [2, 2, 1]


def test_batch_quota_falls_back_to_smtp_and_pauses() -> None:
    sender = _sender()
    api = FakeBatchTransport("resend-api", batch_error=SendFailure.QUOTA)
    smtp = FakeTransport("smtp")
    assert _run(sender.send_many([api, smtp], _emails(3))) == ["smtp"] * 3
    assert smtp.calls == 3
    assert sender.paused_until("resend-api") > 0
    # While paused, the next bulk send skips the API completely.
    _run(sender.send_many([api, smtp], _emails(2)))
    assert len(api.batches) == 1


def test_batch_quota_midway_sends_rest_via_smtp() -> None:
    sender = _sender()
    api = FakeBatchTransport("resend-api", batch_limit=2)
    smtp = FakeTransport("smtp")
    calls = {"n": 0}
    original = api.send_batch

    async def second_fails(emails):
        calls["n"] += 1
        if calls["n"] == 2:
            raise EmailSendError(SendFailure.QUOTA, "quota")
        return await original(emails)

    api.send_batch = second_fails
    assert _run(sender.send_many([api, smtp], _emails(5))) == ["resend-api"] * 2 + ["smtp"] * 3


def test_batch_item_failures() -> None:
    api = FakeBatchTransport("resend-api", item_failures={1: SendFailure.RECIPIENT, 2: SendFailure.PROVIDER})
    smtp = FakeTransport("smtp")
    results = _run(_sender().send_many([api, smtp], _emails(3)))
    # p1 was refused as a bad address (not retried); p2 is retried through SMTP.
    assert results == ["resend-api", None, "smtp"]
    assert smtp.calls == 1


def test_send_many_without_batch_transport_sends_one_by_one() -> None:
    smtp = FakeTransport("smtp")
    assert _run(_sender().send_many([smtp], _emails(4))) == ["smtp"] * 4
    assert smtp.calls == 4


def test_send_many_batch_only_and_failing_returns_none() -> None:
    api = FakeBatchTransport("resend-api", batch_error=SendFailure.PROVIDER)
    assert _run(_sender().send_many([api], _emails(2))) == [None, None]


def test_send_emails_wiring(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(email_mod, "RESEND_API_KEY", "re_key")
    monkeypatch.setattr(email_mod, "RESEND_FROM", "noreply@club.example")

    async def batch(self, emails):
        return [None] * len(emails)

    monkeypatch.setattr(ResendApiTransport, "send_batch", batch)
    assert _run(email_mod.send_emails(_emails(3))) == [True, True, True]


def test_send_emails_not_configured() -> None:
    assert _run(email_mod.send_emails(_emails(2))) == [False, False]
