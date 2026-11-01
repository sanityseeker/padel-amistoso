"""
Player payment tracking (phase 1): settings, lazy rows, status changes,
player self-report, lifecycle on removal/deletion/conversion, public payload
hygiene and the Player Hub listing.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

import backend.api.db as db_mod
from backend.api.payments_store import make_concept

FEE = {"fee_cents": 1500, "currency": "eur", "methods": [{"kind": "bizum", "value": "600123123"}]}


def _lobby(client: TestClient, headers: dict, name: str = "Summer Cup") -> str:
    r = client.post("/api/registrations", json={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _register(client: TestClient, rid: str, name: str, email: str = "") -> dict:
    body: dict = {"player_name": name}
    if email:
        body["email"] = email
    r = client.post(f"/api/registrations/{rid}/register", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _set_fee(client: TestClient, rid: str, headers: dict, **overrides) -> dict:
    r = client.patch(f"/api/registrations/{rid}/payment-settings", json={**FEE, **overrides}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _row(client: TestClient, rid: str, headers: dict, pid: str) -> dict:
    listing = client.get(f"/api/registrations/{rid}/payments", headers=headers).json()
    return next(r for r in listing["rows"] if r["player_id"] == pid)


def _db_row(pid: str) -> dict | None:
    with db_mod.get_db() as conn:
        row = conn.execute("SELECT * FROM registrant_payments WHERE player_id = ?", (pid,)).fetchone()
    return dict(row) if row else None


# ── Settings ────────────────────────────────────────────────────────────────


class TestSettings:
    def test_defaults_and_patch(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        r = client.get(f"/api/registrations/{rid}/payment-settings", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["fee_cents"] == 0
        assert r.json()["show_methods"] == "after_register"

        s = _set_fee(client, rid, auth_headers, due_at="2026-12-01")
        assert s["fee_cents"] == 1500
        assert s["currency"] == "EUR"  # normalised to upper case
        assert s["methods"][0]["kind"] == "bizum"
        # Partial patch keeps the untouched fields.
        r = client.patch(
            f"/api/registrations/{rid}/payment-settings", json={"instructions": "Pay by Friday"}, headers=auth_headers
        )
        assert r.json()["fee_cents"] == 1500
        assert r.json()["instructions"] == "Pay by Friday"
        assert r.json()["due_at"] == "2026-12-01"

    def test_requires_editor(self, client, alice_headers, bob_headers):
        rid = _lobby(client, alice_headers)
        assert client.get(f"/api/registrations/{rid}/payment-settings", headers=bob_headers).status_code == 403
        assert (
            client.patch(f"/api/registrations/{rid}/payment-settings", json=FEE, headers=bob_headers).status_code == 403
        )
        assert client.get(f"/api/registrations/{rid}/payment-settings").status_code == 401
        assert client.get(f"/api/registrations/{rid}/payments", headers=bob_headers).status_code == 403

    def test_invalid_method_kind_rejected(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        r = client.patch(
            f"/api/registrations/{rid}/payment-settings",
            json={"methods": [{"kind": "stripe", "value": "x"}]},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_tournament_settings_require_editor(self, client, alice_headers, bob_headers):
        rid = _lobby(client, alice_headers)
        for n in ("A", "B", "C", "D"):
            _register(client, rid, n)
        tid = client.post(
            f"/api/registrations/{rid}/convert", json={"tournament_type": "mexicano"}, headers=alice_headers
        ).json()["tournament_id"]
        assert client.get(f"/api/tournaments/{tid}/payment-settings", headers=bob_headers).status_code == 403
        r = client.patch(f"/api/tournaments/{tid}/payment-settings", json=FEE, headers=alice_headers)
        assert r.status_code == 200 and r.json()["fee_cents"] == 1500
        assert client.get(f"/api/tournaments/{tid}/payment-settings", headers=alice_headers).json()["fee_cents"] == 1500
        assert client.get("/api/tournaments/nope/payment-settings", headers=alice_headers).status_code == 404


# ── Listing + status changes ────────────────────────────────────────────────


class TestListing:
    def test_no_fee_means_no_rows(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _register(client, rid, "Ana")
        listing = client.get(f"/api/registrations/{rid}/payments", headers=auth_headers).json()
        assert listing["rows"] == []
        assert listing["summary"]["total"] == 0

    def test_synthesized_unpaid_rows(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        ana = _register(client, rid, "Ana Lopez")
        _register(client, rid, "Bob")
        _set_fee(client, rid, auth_headers)
        listing = client.get(f"/api/registrations/{rid}/payments", headers=auth_headers).json()
        assert listing["summary"] == {
            "total": 2,
            "paid": 0,
            "reported": 0,
            "unpaid": 2,
            "waived": 0,
            "refund_due": 0,
            "refunded": 0,
            "collected_cents": 0,
        }
        row = next(r for r in listing["rows"] if r["player_id"] == ana["player_id"])
        assert row["status"] == "unpaid"
        assert row["synthesized"] is True
        assert row["id"] is None
        assert row["amount_cents"] == 1500
        assert row["concept"] == make_concept("Summer Cup", "Ana Lopez") == "PADEL-SUMMERCUP-ANA"
        # Nothing written to the DB yet.
        assert _db_row(ana["player_id"]) is None

    def test_mark_paid_writes_row_and_event(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        ana = _register(client, rid, "Ana")
        _set_fee(client, rid, auth_headers)
        r = client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}",
            json={"status": "paid", "method": "cash"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "paid"
        assert r.json()["method"] == "cash"
        assert r.json()["updated_by"] == "admin"
        assert r.json()["synthesized"] is False
        db_row = _db_row(ana["player_id"])
        assert db_row is not None and db_row["status"] == "paid" and db_row["amount_cents"] == 1500
        with db_mod.get_db() as conn:
            events = conn.execute("SELECT * FROM payment_events WHERE payment_id = ?", (db_row["id"],)).fetchall()
        assert [(e["from_status"], e["to_status"], e["actor"]) for e in events] == [(None, "paid", "admin")]
        summary = client.get(f"/api/registrations/{rid}/payments", headers=auth_headers).json()["summary"]
        assert summary["paid"] == 1 and summary["collected_cents"] == 1500

        # A second change appends another event with from_status set.
        client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}",
            json={"status": "waived", "note": "volunteer"},
            headers=auth_headers,
        )
        with db_mod.get_db() as conn:
            events = conn.execute(
                "SELECT from_status, to_status, note FROM payment_events WHERE payment_id = ? ORDER BY id",
                (db_row["id"],),
            ).fetchall()
        assert [tuple(e) for e in events] == [(None, "paid", None), ("paid", "waived", "volunteer")]

    def test_amount_override(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        ana = _register(client, rid, "Ana")
        _set_fee(client, rid, auth_headers)
        r = client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}",
            json={"status": "paid", "amount_cents": 1000},
            headers=auth_headers,
        )
        assert r.json()["amount_cents"] == 1000
        assert (
            client.get(f"/api/registrations/{rid}/payments", headers=auth_headers).json()["summary"]["collected_cents"]
            == 1000
        )

    def test_unknown_player_404_and_bad_status_422(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        assert (
            client.patch(
                f"/api/registrations/{rid}/payments/zzz", json={"status": "paid"}, headers=auth_headers
            ).status_code
            == 404
        )
        ana = _register(client, rid, "Ana")
        assert (
            client.patch(
                f"/api/registrations/{rid}/payments/{ana['player_id']}", json={"status": "gone"}, headers=auth_headers
            ).status_code
            == 422
        )


# ── Player self-report ──────────────────────────────────────────────────────


class TestPlayerReport:
    def test_register_login_and_my_entry_carry_payment(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers, instructions="Bizum please")
        ana = _register(client, rid, "Ana")
        assert ana["payment"]["status"] == "unpaid"
        assert ana["payment"]["amount_cents"] == 1500
        assert ana["payment"]["concept"] == "PADEL-SUMMERCUP-ANA"
        assert ana["payment"]["methods"][0]["value"] == "600123123"
        login = client.post(f"/api/registrations/{rid}/player-login", json={"passphrase": ana["passphrase"]}).json()
        assert login["payment"]["instructions"] == "Bizum please"

    def test_no_fee_means_payment_null(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        ana = _register(client, rid, "Ana")
        assert ana["payment"] is None
        r = client.post(f"/api/registrations/{rid}/player-payment-report", json={"passphrase": ana["passphrase"]})
        assert r.status_code == 400

    def test_report_transitions_unpaid_to_reported(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana")
        r = client.post(
            f"/api/registrations/{rid}/player-payment-report",
            json={"passphrase": ana["passphrase"], "reference": "bizum 12:30", "method": "bizum"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "reported"
        assert r.json()["reference"] == "bizum 12:30"
        row = _row(client, rid, auth_headers, ana["player_id"])
        assert row["status"] == "reported" and row["method"] == "bizum" and row["updated_by"] == "player"
        # Token auth works too, and re-reporting is idempotent.
        r = client.post(f"/api/registrations/{rid}/player-payment-report", json={"token": ana["token"]})
        assert r.status_code == 200 and r.json()["status"] == "reported"
        # Bad credentials are rejected.
        assert (
            client.post(f"/api/registrations/{rid}/player-payment-report", json={"passphrase": "nope"}).status_code
            == 401
        )
        assert client.post(f"/api/registrations/{rid}/player-payment-report", json={}).status_code == 400

    def test_report_cannot_downgrade_paid(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana")
        client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        r = client.post(f"/api/registrations/{rid}/player-payment-report", json={"passphrase": ana["passphrase"]})
        assert r.status_code == 200
        assert r.json()["status"] == "paid"
        assert _db_row(ana["player_id"])["status"] == "paid"


# ── Lifecycle ───────────────────────────────────────────────────────────────


class TestLifecycle:
    def test_paid_becomes_refund_due_on_registrant_delete(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana")
        bob = _register(client, rid, "Bob")
        client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        client.patch(
            f"/api/registrations/{rid}/payments/{bob['player_id']}", json={"status": "unpaid"}, headers=auth_headers
        )
        assert _db_row(bob["player_id"]) is not None
        assert (
            client.delete(f"/api/registrations/{rid}/registrant/{ana['player_id']}", headers=auth_headers).status_code
            == 200
        )
        assert (
            client.delete(f"/api/registrations/{rid}/registrant/{bob['player_id']}", headers=auth_headers).status_code
            == 200
        )
        assert _db_row(ana["player_id"])["status"] == "refund_due"
        assert _db_row(bob["player_id"]) is None  # unpaid rows are dropped
        listing = client.get(f"/api/registrations/{rid}/payments", headers=auth_headers).json()
        assert listing["summary"]["refund_due"] == 1
        assert [r["player_id"] for r in listing["rows"]] == [ana["player_id"]]

    def test_paid_becomes_refund_due_on_player_cancel(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana")
        client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        assert (
            client.post(f"/api/registrations/{rid}/player-cancel", json={"passphrase": ana["passphrase"]}).status_code
            == 200
        )
        assert _db_row(ana["player_id"])["status"] == "refund_due"

    def test_paid_becomes_refund_due_on_lobby_delete(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana")
        bob = _register(client, rid, "Bob")
        cid = _register(client, rid, "Cid")
        client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        client.patch(
            f"/api/registrations/{rid}/payments/{bob['player_id']}", json={"status": "reported"}, headers=auth_headers
        )
        client.patch(
            f"/api/registrations/{rid}/payments/{cid['player_id']}", json={"status": "unpaid"}, headers=auth_headers
        )
        assert client.delete(f"/api/registrations/{rid}", headers=auth_headers).status_code == 200
        assert _db_row(ana["player_id"])["status"] == "refund_due"
        assert _db_row(bob["player_id"])["status"] == "reported"  # kept for the organizer to settle
        assert _db_row(cid["player_id"]) is None

    def test_conversion_carries_tournament_id_and_settings(self, client, auth_headers):
        rid = _lobby(client, auth_headers, name="Club Night")
        _set_fee(client, rid, auth_headers, instructions="IBAN below")
        players = {n: _register(client, rid, n) for n in ("Ana", "Bob", "Cid", "Dan")}
        client.patch(
            f"/api/registrations/{rid}/payments/{players['Ana']['player_id']}",
            json={"status": "paid"},
            headers=auth_headers,
        )
        r = client.post(f"/api/registrations/{rid}/convert", json={"tournament_type": "mexicano"}, headers=auth_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["tournament_id"]

        db_row = _db_row(players["Ana"]["player_id"])
        assert db_row["registration_id"] == rid and db_row["tournament_id"] == tid

        ts = client.get(f"/api/tournaments/{tid}/payment-settings", headers=auth_headers).json()
        assert ts["fee_cents"] == 1500 and ts["instructions"] == "IBAN below"

        t_listing = client.get(f"/api/tournaments/{tid}/payments", headers=auth_headers).json()
        assert t_listing["summary"]["total"] == 4 and t_listing["summary"]["paid"] == 1
        # Marking in the tournament view shows up in the lobby view (same row).
        r = client.patch(
            f"/api/tournaments/{tid}/payments/{players['Bob']['player_id']}",
            json={"status": "paid"},
            headers=auth_headers,
        )
        assert r.status_code == 200 and r.json()["status"] == "paid"
        assert _row(client, rid, auth_headers, players["Bob"]["player_id"])["status"] == "paid"
        bob_row = _db_row(players["Bob"]["player_id"])
        assert bob_row["registration_id"] == rid and bob_row["tournament_id"] == tid
        # And the lobby view writing after conversion links the tournament too.
        client.patch(
            f"/api/registrations/{rid}/payments/{players['Cid']['player_id']}",
            json={"status": "paid"},
            headers=auth_headers,
        )
        assert _db_row(players["Cid"]["player_id"])["tournament_id"] == tid
        assert client.get(f"/api/tournaments/{tid}/payments", headers=auth_headers).json()["summary"]["paid"] == 3


# ── Public payload hygiene ──────────────────────────────────────────────────


class TestPublicPayloads:
    def _setup(self, client, auth_headers, show_methods="after_register"):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers, show_methods=show_methods)
        ana = _register(client, rid, "Ana")
        client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        return rid, ana

    def test_public_lobby_has_no_per_player_payment_data(self, client, auth_headers):
        rid, _ = self._setup(client, auth_headers)
        pub = client.get(f"/api/registrations/{rid}/public").json()
        for p in pub["registrants"]:
            assert set(p.keys()) == {"player_id", "player_name"}
        # Fee info is shown but methods stay hidden until registered.
        assert pub["payment"]["fee_cents"] == 1500
        assert pub["payment"]["methods"] == []
        text = client.get(f"/api/registrations/{rid}/public").text
        for forbidden in ("600123123", "refund_due", '"paid"', "reported"):
            assert forbidden not in text

    def test_public_lobby_shows_methods_when_always(self, client, auth_headers):
        rid, _ = self._setup(client, auth_headers, show_methods="always")
        pub = client.get(f"/api/registrations/{rid}/public").json()
        assert pub["payment"]["methods"][0]["value"] == "600123123"

    def test_tournament_public_and_share_views_carry_nothing(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        players = {n: _register(client, rid, n) for n in ("Ana", "Bob", "Cid", "Dan")}
        tid = client.post(
            f"/api/registrations/{rid}/convert", json={"tournament_type": "mexicano"}, headers=auth_headers
        ).json()["tournament_id"]
        r = client.patch(
            f"/api/tournaments/{tid}/payments/{players['Ana']['player_id']}",
            json={"status": "paid"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        for path in (
            f"/api/tournaments/{tid}/public",
            f"/api/tournaments/{tid}/mex/status",
            f"/api/tournaments/{tid}/share/html",
        ):
            r = client.get(path)
            if r.status_code != 200:
                continue
            body = r.text.lower()
            assert "600123123" not in body
            assert "fee_cents" not in body
            assert "refund_due" not in body
            assert "payment" not in body


# ── Player Hub ──────────────────────────────────────────────────────────────


def _hub_login(client: TestClient, profile_id: str) -> dict:
    with db_mod.get_db() as conn:
        pp = conn.execute("SELECT passphrase FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()["passphrase"]
    r = client.post("/api/player-profile/login", json={"passphrase": pp})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class TestPlayerHub:
    def test_listing_and_report_for_linked_profile(self, client, auth_headers):
        rid = _lobby(client, auth_headers, name="Winter League")
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana Perez", email="ana@example.com")
        # Create a Hub profile from the participation passphrase (links the registrant).
        prof = client.post(
            "/api/player-profile",
            json={"name": "Ana Perez", "email": "ana@example.com", "participant_passphrase": ana["passphrase"]},
        )
        assert prof.status_code == 200, prof.text
        profile_id = prof.json()["profile"]["id"]
        headers = _hub_login(client, profile_id)

        rows = client.get("/api/player-profile/payments", headers=headers).json()
        assert len(rows) == 1
        row = rows[0]
        assert row["entity_type"] == "registration" and row["entity_id"] == rid
        assert row["status"] == "unpaid" and row["amount_cents"] == 1500
        assert row["concept"] == "PADEL-WINTERLEAGUE-ANA"
        assert row["key"] == f"r:{rid}:{ana['player_id']}"

        r = client.post(
            f"/api/player-profile/payments/{row['key']}/report", json={"reference": "done"}, headers=headers
        )
        assert r.status_code == 200, r.text
        assert r.json()[0]["status"] == "reported"
        assert _db_row(ana["player_id"])["status"] == "reported"

        # Once the organizer confirms, the Hub card empties.
        client.patch(
            f"/api/registrations/{rid}/payments/{ana['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        assert client.get("/api/player-profile/payments", headers=headers).json() == []

    def test_hub_rejects_foreign_keys_and_anonymous(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana", email="ana@example.com")
        bob = _register(client, rid, "Bob", email="bob@example.com")
        prof = client.post(
            "/api/player-profile",
            json={"name": "Ana", "email": "ana@example.com", "participant_passphrase": ana["passphrase"]},
        ).json()
        headers = _hub_login(client, prof["profile"]["id"])
        assert client.get("/api/player-profile/payments").status_code == 401
        r = client.post(f"/api/player-profile/payments/r:{rid}:{bob['player_id']}/report", headers=headers)
        assert r.status_code == 404
        assert client.post("/api/player-profile/payments/garbage/report", headers=headers).status_code == 400

    def test_converted_lobby_shows_once(self, client, auth_headers):
        rid = _lobby(client, auth_headers, name="Open")
        _set_fee(client, rid, auth_headers)
        players = {n: _register(client, rid, n, email=f"{n.lower()}@example.com") for n in ("Ana", "Bob", "Cid", "Dan")}
        prof = client.post(
            "/api/player-profile",
            json={"name": "Ana", "email": "ana@example.com", "participant_passphrase": players["Ana"]["passphrase"]},
        ).json()
        headers = _hub_login(client, prof["profile"]["id"])
        tid = client.post(
            f"/api/registrations/{rid}/convert", json={"tournament_type": "mexicano"}, headers=auth_headers
        ).json()["tournament_id"]
        rows = client.get("/api/player-profile/payments", headers=headers).json()
        assert [r["entity_type"] for r in rows] == ["tournament"]
        assert rows[0]["entity_id"] == tid


# ── Reminders ───────────────────────────────────────────────────────────────


class TestReminders:
    def test_remind_unpaid_requires_email_config(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        r = client.post(f"/api/registrations/{rid}/payments/remind-unpaid", headers=auth_headers)
        assert r.status_code == 400

    def test_remind_unpaid_filters_and_reports_unreachable(self, client, auth_headers, monkeypatch):
        import backend.api.routes_payments as rp

        monkeypatch.setattr(rp, "email_is_configured", lambda: True)
        sent: list[tuple[str, str, str]] = []

        async def _fake_send(jobs, es):
            sent.extend(jobs)
            return len(jobs), 0

        monkeypatch.setattr(rp, "_send_emails_bounded", _fake_send)

        rid = _lobby(client, auth_headers, name="Spring Cup")
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana", email="ana@example.com")
        _register(client, rid, "Bob")  # no email -> unreachable
        cid = _register(client, rid, "Cid", email="cid@example.com")
        client.patch(
            f"/api/registrations/{rid}/payments/{cid['player_id']}", json={"status": "paid"}, headers=auth_headers
        )

        r = client.post(f"/api/registrations/{rid}/payments/remind-unpaid", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert r.json()["sent"] == 1 and r.json()["unreachable"] == ["Bob"]
        assert [j[0] for j in sent] == ["ana@example.com"]
        body = sent[0][2]
        assert "15.00 EUR" in body and "600123123" in body and make_concept("Spring Cup", "Ana") in body
        # Custom message wins over the template.
        sent.clear()
        r = client.post(
            f"/api/registrations/{rid}/payments/remind-unpaid",
            json={"subject": "Reminder", "message": "Please pay today"},
            headers=auth_headers,
        )
        assert r.json()["sent"] == 1 and sent[0][1] == "Reminder" and "Please pay today" in sent[0][2]
        assert ana["player_id"]  # keep the fixture referenced
