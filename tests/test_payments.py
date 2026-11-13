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


# ── Reporting for other players ─────────────────────────────────────────────


def _report(client: TestClient, rid: str, who: dict, **extra):
    return client.post(f"/api/registrations/{rid}/player-payment-report", json={"token": who["token"], **extra})


def _teammates(client: TestClient, rid: str, who: dict):
    return client.post(f"/api/registrations/{rid}/player-payment-teammates", json={"token": who["token"]})


class TestReportForOthers:
    def _lobby_with_players(self, client, auth_headers, name="Pairs"):
        rid = _lobby(client, auth_headers, name=name)
        _set_fee(client, rid, auth_headers)
        players = {n: _register(client, rid, n, email=f"{n.lower()}@example.com") for n in ("Ana", "Bob", "Cid")}
        return rid, players

    def test_lobby_happy_path(self, client, auth_headers):
        rid, p = self._lobby_with_players(client, auth_headers)
        r = _report(client, rid, p["Ana"], reference="ref 1", also_for=[p["Bob"]["player_id"], p["Cid"]["player_id"]])
        assert r.status_code == 200, r.text
        for name in ("Ana", "Bob", "Cid"):
            assert _row(client, rid, auth_headers, p[name]["player_id"])["status"] == "reported"
        bob = _row(client, rid, auth_headers, p["Bob"]["player_id"])
        assert bob["note"] == "Paid by Ana" and bob["reference"] == "ref 1"
        assert _row(client, rid, auth_headers, p["Ana"]["player_id"])["note"] is None
        events = client.get(f"/api/registrations/{rid}/payments", headers=auth_headers)
        assert events.status_code == 200
        with db_mod.get_db() as conn:
            ev = conn.execute(
                "SELECT e.actor, e.to_status, e.note FROM payment_events e JOIN registrant_payments r "
                "ON r.id = e.payment_id WHERE r.player_id = ?",
                (p["Bob"]["player_id"],),
            ).fetchall()
        assert [(e["actor"], e["to_status"], e["note"]) for e in ev] == [("player:Ana", "reported", "Paid by Ana")]

    def test_ineligible_ids_rejected_without_writes(self, client, auth_headers):
        rid, p = self._lobby_with_players(client, auth_headers)
        client.patch(
            f"/api/registrations/{rid}/payments/{p['Cid']['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        for bad in (p["Cid"]["player_id"], p["Ana"]["player_id"], "nobody"):
            r = _report(client, rid, p["Ana"], also_for=[p["Bob"]["player_id"], bad])
            assert r.status_code == 400, (bad, r.text)
        assert _db_row(p["Ana"]["player_id"]) is None
        assert _db_row(p["Bob"]["player_id"]) is None
        assert _db_row(p["Cid"]["player_id"])["status"] == "paid"

    def test_reported_player_not_listed_or_accepted(self, client, auth_headers):
        rid, p = self._lobby_with_players(client, auth_headers)
        assert _report(client, rid, p["Bob"]).status_code == 200
        assert _report(client, rid, p["Ana"], also_for=[p["Bob"]["player_id"]]).status_code == 400

    def test_other_event_rejected(self, client, auth_headers):
        rid, p = self._lobby_with_players(client, auth_headers)
        rid2, q = self._lobby_with_players(client, auth_headers, name="Other")
        r = _report(client, rid, p["Ana"], also_for=[q["Bob"]["player_id"]])
        assert r.status_code == 400
        assert _db_row(q["Bob"]["player_id"]) is None

    def test_list_excludes_reporter_and_settled_and_hides_contact_data(self, client, auth_headers):
        rid, p = self._lobby_with_players(client, auth_headers)
        client.patch(
            f"/api/registrations/{rid}/payments/{p['Cid']['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        r = _teammates(client, rid, p["Ana"])
        assert r.status_code == 200, r.text
        assert r.json() == [{"player_id": p["Bob"]["player_id"], "player_name": "Bob"}]
        assert "example.com" not in r.text
        assert _teammates(client, rid, {"token": "wrong"}).status_code == 401
        assert client.post(f"/api/registrations/{rid}/player-payment-teammates", json={}).status_code in (400, 422)

    def test_no_fee_lists_nobody(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        ana = _register(client, rid, "Ana")
        _register(client, rid, "Bob")
        assert _teammates(client, rid, ana).json() == []

    def test_old_callers_unchanged(self, client, auth_headers):
        rid, p = self._lobby_with_players(client, auth_headers)
        r = _report(client, rid, p["Ana"], reference="solo")
        assert r.status_code == 200 and r.json()["status"] == "reported"
        assert _db_row(p["Bob"]["player_id"]) is None
        assert _row(client, rid, auth_headers, p["Ana"]["player_id"])["reference"] == "solo"

    def test_too_many_ids_rejected(self, client, auth_headers):
        rid, p = self._lobby_with_players(client, auth_headers)
        r = _report(client, rid, p["Ana"], also_for=[f"x{i}" for i in range(51)])
        assert r.status_code == 422

    def test_hub_tournament_flow(self, client, auth_headers):
        rid = _lobby(client, auth_headers, name="Hub Cup")
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
        key = f"t:{tid}:{players['Ana']['player_id']}"
        client.patch(
            f"/api/tournaments/{tid}/payments/{players['Dan']['player_id']}",
            json={"status": "paid"},
            headers=auth_headers,
        )

        listed = client.get(f"/api/player-profile/payments/{key}/teammates", headers=headers)
        assert listed.status_code == 200, listed.text
        assert {t["player_name"] for t in listed.json()} == {"Bob", "Cid"}
        assert all(set(t) == {"player_id", "player_name"} for t in listed.json())
        assert client.get(f"/api/player-profile/payments/{key}/teammates").status_code == 401

        bad = client.post(
            f"/api/player-profile/payments/{key}/report",
            json={"also_for": [players["Dan"]["player_id"]]},
            headers=headers,
        )
        assert bad.status_code == 400
        assert _db_row(players["Ana"]["player_id"]) is None

        ok = client.post(
            f"/api/player-profile/payments/{key}/report",
            json={"reference": "hub", "also_for": [players["Bob"]["player_id"]]},
            headers=headers,
        )
        assert ok.status_code == 200, ok.text
        assert _db_row(players["Ana"]["player_id"])["status"] == "reported"
        bob = _db_row(players["Bob"]["player_id"])
        assert bob["status"] == "reported" and bob["note"] == "Paid by Ana" and bob["reference"] == "hub"
        assert _db_row(players["Cid"]["player_id"]) is None


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


# ── Participant filter ──────────────────────────────────────────────────────


class TestParticipantFilterScope:
    """Only registrants passing the lobby's participant filter owe the fee."""

    QUESTIONS = [{"key": "level", "label": "Level", "type": "choice", "required": False, "choices": ["A", "B"]}]

    def _filtered_lobby(self, client, auth_headers):
        r = client.post(
            "/api/registrations", json={"name": "Level Cup", "questions": self.QUESTIONS}, headers=auth_headers
        )
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        _set_fee(client, rid, auth_headers)
        players = {}
        for name, level in (("Ana", "A"), ("Bob", "B"), ("Cid", "A")):
            r = client.post(
                f"/api/registrations/{rid}/register",
                json={"player_name": name, "email": f"{name.lower()}@example.com", "answers": {"level": level}},
            )
            assert r.status_code == 200, r.text
            players[name] = r.json()
        r = client.patch(
            f"/api/registrations/{rid}",
            json={"participant_filter": [{"key": "level", "op": "any_of", "values": ["A"]}]},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        return rid, players

    def test_listing_and_reminders_skip_ineligible(self, client, auth_headers, monkeypatch):
        rid, p = self._filtered_lobby(client, auth_headers)
        listing = client.get(f"/api/registrations/{rid}/payments", headers=auth_headers).json()
        assert {r["player_name"] for r in listing["rows"]} == {"Ana", "Cid"}
        assert listing["summary"]["total"] == 2

        import backend.api.routes_payments as rp

        monkeypatch.setattr(rp, "email_is_configured", lambda: True)
        sent: list = []

        async def _fake_send(jobs, es):
            sent.extend(jobs)
            return len(jobs), 0

        monkeypatch.setattr(rp, "_send_emails_bounded", _fake_send)
        r = client.post(f"/api/registrations/{rid}/payments/remind-unpaid", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert sorted(j[0] for j in sent) == ["ana@example.com", "cid@example.com"]

    def test_ineligible_player_sees_no_fee_and_cannot_be_paid_for(self, client, auth_headers):
        rid, p = self._filtered_lobby(client, auth_headers)
        bob = client.post(f"/api/registrations/{rid}/player-login", json={"token": p["Bob"]["token"]}).json()
        assert bob["payment"] is None
        ana = client.post(f"/api/registrations/{rid}/player-login", json={"token": p["Ana"]["token"]}).json()
        assert ana["payment"]["status"] == "unpaid"
        assert [t["player_name"] for t in _teammates(client, rid, p["Ana"]).json()] == ["Cid"]
        r = _report(client, rid, p["Ana"], also_for=[p["Bob"]["player_id"]])
        assert r.status_code == 400
        assert _db_row(p["Bob"]["player_id"]) is None

    def test_reported_payment_of_ineligible_player_stays_listed(self, client, auth_headers):
        rid, p = self._filtered_lobby(client, auth_headers)
        client.patch(
            f"/api/registrations/{rid}/payments/{p['Ana']['player_id']}", json={"status": "paid"}, headers=auth_headers
        )
        # Ana drops out of the filter after paying: the organizer still sees the money.
        client.patch(
            f"/api/registrations/{rid}",
            json={"participant_filter": [{"key": "level", "op": "any_of", "values": ["B"]}]},
            headers=auth_headers,
        )
        listing = client.get(f"/api/registrations/{rid}/payments", headers=auth_headers).json()
        assert {(r["player_name"], r["status"]) for r in listing["rows"]} == {("Bob", "unpaid"), ("Ana", "paid")}

    def test_hub_hides_lobby_fee_for_ineligible_profile(self, client, auth_headers):
        rid, p = self._filtered_lobby(client, auth_headers)
        prof = client.post(
            "/api/player-profile",
            json={"name": "Bob", "email": "bob@example.com", "participant_passphrase": p["Bob"]["passphrase"]},
        )
        assert prof.status_code == 200, prof.text
        headers = _hub_login(client, prof.json()["profile"]["id"])
        assert client.get("/api/player-profile/payments", headers=headers).json() == []


# ── Tournament player (player JWT) ──────────────────────────────────────────

NAMES4 = ("Ana", "Bob", "Cid", "Dan")


def _player_jwt(client: TestClient, tid: str, who: dict) -> dict:
    r = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": who["passphrase"]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _mark(client: TestClient, headers: dict, path: str, pid: str, status: str) -> None:
    r = client.patch(f"{path}/payments/{pid}", json={"status": status}, headers=headers)
    assert r.status_code == 200, r.text


def _converted(client: TestClient, headers: dict, *, fee: bool = True, names=NAMES4, name: str = "Open Night"):
    rid = _lobby(client, headers, name=name)
    if fee:
        _set_fee(client, rid, headers)
    players = {n: _register(client, rid, n, email=f"{n.lower()}@example.com") for n in names}
    r = client.post(
        f"/api/registrations/{rid}/convert",
        json={"tournament_type": "mexicano", "player_names": list(names)},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return rid, r.json()["tournament_id"], players


def _hub_for(client: TestClient, who: dict, name: str) -> dict:
    prof = client.post(
        "/api/player-profile",
        json={"name": name, "email": f"{name.lower()}@example.com", "participant_passphrase": who["passphrase"]},
    )
    assert prof.status_code == 200, prof.text
    return _hub_login(client, prof.json()["profile"]["id"])


class TestTournamentPlayerPayment:
    def _get(self, client, tid, headers):
        return client.get(f"/api/tournaments/{tid}/player/payment", headers=headers)

    def _report(self, client, tid, headers, **body):
        return client.post(f"/api/tournaments/{tid}/player/payment/report", json=body, headers=headers)

    def test_reads_own_row_including_paid(self, client, auth_headers):
        rid, tid, players = _converted(client, auth_headers)
        _mark(client, auth_headers, f"/api/registrations/{rid}", players["Ana"]["player_id"], "paid")
        ana = _player_jwt(client, tid, players["Ana"])
        body = self._get(client, tid, ana).json()
        assert body["status"] == "paid" and body["amount_cents"] == 1500
        assert body["concept"] == "PADEL-OPENNIGHT-ANA"
        bob = _player_jwt(client, tid, players["Bob"])
        assert self._get(client, tid, bob).json()["status"] == "unpaid"

    def test_report_shows_in_lobby_tournament_and_hub(self, client, auth_headers):
        rid, tid, players = _converted(client, auth_headers)
        hub = _hub_for(client, players["Ana"], "Ana")
        ana = _player_jwt(client, tid, players["Ana"])
        r = self._report(client, tid, ana, reference="ref-1", method="bizum")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "reported" and r.json()["reference"] == "ref-1"
        pid = players["Ana"]["player_id"]
        assert _row(client, rid, auth_headers, pid)["status"] == "reported"
        t_rows = client.get(f"/api/tournaments/{tid}/payments", headers=auth_headers).json()["rows"]
        assert next(x for x in t_rows if x["player_id"] == pid)["status"] == "reported"
        hub_rows = client.get("/api/player-profile/payments", headers=hub).json()
        assert [(x["entity_id"], x["status"]) for x in hub_rows] == [(tid, "reported")]

    def test_paid_row_never_downgraded(self, client, auth_headers):
        rid, tid, players = _converted(client, auth_headers)
        pid = players["Ana"]["player_id"]
        _mark(client, auth_headers, f"/api/registrations/{rid}", pid, "paid")
        ana = _player_jwt(client, tid, players["Ana"])
        r = self._report(client, tid, ana)
        assert r.status_code == 200 and r.json()["status"] == "paid"
        assert _db_row(pid)["status"] == "paid"

    def test_also_for_teammate(self, client, auth_headers):
        _rid, tid, players = _converted(client, auth_headers)
        ana = _player_jwt(client, tid, players["Ana"])
        mates = client.get(f"/api/tournaments/{tid}/player/payment/teammates", headers=ana).json()
        assert {m["player_name"] for m in mates} == {"Bob", "Cid", "Dan"}
        assert all(set(m) == {"player_id", "player_name"} for m in mates)
        bob_id = players["Bob"]["player_id"]
        assert self._report(client, tid, ana, also_for=[bob_id]).status_code == 200
        assert _db_row(bob_id)["status"] == "reported"
        mates = client.get(f"/api/tournaments/{tid}/player/payment/teammates", headers=ana).json()
        assert bob_id not in {m["player_id"] for m in mates}
        assert self._report(client, tid, ana, also_for=["nobody"]).status_code == 400

    def test_auth_rules(self, client, auth_headers):
        _rid, tid, players = _converted(client, auth_headers)
        _rid2, tid2, players2 = _converted(client, auth_headers, name="Other")
        url = f"/api/tournaments/{tid}/player/payment"
        for method, path in (("get", url), ("get", url + "/teammates"), ("post", url + "/report")):
            assert getattr(client, method)(path).status_code == 401
            assert getattr(client, method)(path, headers=auth_headers).status_code == 401  # admin JWT
        foreign = _player_jwt(client, tid2, players2["Ana"])
        assert client.get(url, headers=foreign).status_code == 403
        assert client.get(url + "/teammates", headers=foreign).status_code == 403
        assert client.post(url + "/report", json={}, headers=foreign).status_code == 403
        assert _db_row(players2["Ana"]["player_id"]) is None

    def test_body_player_id_is_ignored(self, client, auth_headers):
        _rid, tid, players = _converted(client, auth_headers)
        ana = _player_jwt(client, tid, players["Ana"])
        bob_id = players["Bob"]["player_id"]
        r = self._report(client, tid, ana, player_id=bob_id, playerId=bob_id)
        assert r.status_code == 200
        assert _db_row(bob_id) is None
        assert _db_row(players["Ana"]["player_id"])["status"] == "reported"

    def test_no_fee_returns_null_and_report_400(self, client, auth_headers):
        _rid, tid, players = _converted(client, auth_headers, fee=False)
        ana = _player_jwt(client, tid, players["Ana"])
        r = self._get(client, tid, ana)
        assert r.status_code == 200 and r.json() is None
        assert self._report(client, tid, ana).status_code == 400

    def test_tournament_created_directly_with_fee(self, client, auth_headers):
        r = client.post(
            "/api/tournaments/mexicano",
            json={"player_names": list(NAMES4), "court_names": ["C1"], "num_rounds": 3},
            headers=auth_headers,
        )
        tid = r.json()["id"]
        assert (
            client.patch(f"/api/tournaments/{tid}/payment-settings", json=FEE, headers=auth_headers).status_code == 200
        )
        secrets = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
        pid, info = next(iter(secrets.items()))
        jwt = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": info["passphrase"]}).json()
        headers = {"Authorization": f"Bearer {jwt['access_token']}"}
        assert self._get(client, tid, headers).json()["status"] == "unpaid"
        assert self._report(client, tid, headers).json()["status"] == "reported"
        assert _db_row(pid)["tournament_id"] == tid

    def test_player_added_at_conversion_gets_lazy_row(self, client, auth_headers):
        rid = _lobby(client, auth_headers)
        _set_fee(client, rid, auth_headers)
        for n in NAMES4[:3]:
            _register(client, rid, n)
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "mexicano", "player_names": [*NAMES4[:3], "Newbie"]},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        tid = r.json()["tournament_id"]
        with db_mod.get_db() as conn:
            sec = conn.execute(
                "SELECT player_id, passphrase FROM player_secrets WHERE tournament_id = ? AND player_name = ?",
                (tid, "Newbie"),
            ).fetchone()
        pid, info = sec["player_id"], {"passphrase": sec["passphrase"]}
        jwt = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": info["passphrase"]}).json()
        headers = {"Authorization": f"Bearer {jwt['access_token']}"}
        assert self._get(client, tid, headers).json()["status"] == "unpaid"
        assert _db_row(pid) is None
        assert self._report(client, tid, headers).json()["status"] == "reported"
        assert _db_row(pid)["tournament_id"] == tid

    def test_withdrawn_player_keeps_paid_row(self, client, auth_headers):
        from types import SimpleNamespace  # noqa: PLC0415

        from backend.api import state as state_mod  # noqa: PLC0415

        rid, tid, players = _converted(client, auth_headers)
        ana_id, bob_id = players["Ana"]["player_id"], players["Bob"]["player_id"]
        _mark(client, auth_headers, f"/api/registrations/{rid}", ana_id, "paid")
        t = state_mod._tournaments[tid]["tournament"]
        t.withdrawals = {"k": SimpleNamespace(member_ids=[ana_id])}
        ana = _player_jwt(client, tid, players["Ana"])
        assert self._get(client, tid, ana).json()["status"] == "paid"
        assert _db_row(ana_id)["status"] == "paid"
        bob = _player_jwt(client, tid, players["Bob"])
        mates = client.get(f"/api/tournaments/{tid}/player/payment/teammates", headers=bob).json()
        assert ana_id not in {m["player_id"] for m in mates}
        assert self._report(client, tid, bob, also_for=[ana_id]).status_code == 400
        assert bob_id not in {m["player_id"] for m in mates}

    def test_hub_get_by_key_and_foreign_key(self, client, auth_headers):
        rid, tid, players = _converted(client, auth_headers)
        _mark(client, auth_headers, f"/api/registrations/{rid}", players["Ana"]["player_id"], "paid")
        hub = _hub_for(client, players["Ana"], "Ana")
        key = f"t:{tid}:{players['Ana']['player_id']}"
        r = client.get(f"/api/player-profile/payments/{key}", headers=hub)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "paid" and body["entity_id"] == tid
        assert "due_at" in body and "reference" in body
        # Settled rows are not part of the Hub listing.
        assert client.get("/api/player-profile/payments", headers=hub).json() == []
        foreign = f"t:{tid}:{players['Bob']['player_id']}"
        assert client.get(f"/api/player-profile/payments/{foreign}", headers=hub).status_code == 404
        assert client.get(f"/api/player-profile/payments/{key}").status_code == 401

    def test_hub_listing_includes_refund_due(self, client, auth_headers):
        rid = _lobby(client, auth_headers, name="Refunds")
        _set_fee(client, rid, auth_headers)
        ana = _register(client, rid, "Ana", email="ana@example.com")
        _register(client, rid, "Bob")
        hub = _hub_for(client, ana, "Ana")
        _mark(client, auth_headers, f"/api/registrations/{rid}", ana["player_id"], "refund_due")
        rows = client.get("/api/player-profile/payments", headers=hub).json()
        assert [r["status"] for r in rows] == ["refund_due"]

    def test_deleting_converted_lobby_keeps_tournament_rows(self, client, auth_headers):
        rid, tid, players = _converted(client, auth_headers)
        ana_id, bob_id = players["Ana"]["player_id"], players["Bob"]["player_id"]
        _mark(client, auth_headers, f"/api/registrations/{rid}", ana_id, "paid")
        _mark(client, auth_headers, f"/api/registrations/{rid}", bob_id, "unpaid")
        before = client.get(f"/api/tournaments/{tid}/payments", headers=auth_headers).json()["rows"]
        assert client.delete(f"/api/registrations/{rid}", headers=auth_headers).status_code == 200
        after = client.get(f"/api/tournaments/{tid}/payments", headers=auth_headers).json()["rows"]
        assert {(r["player_id"], r["status"]) for r in before} == {(r["player_id"], r["status"]) for r in after}
        assert _db_row(ana_id)["status"] == "paid" and _db_row(bob_id)["status"] == "unpaid"

    def test_second_tournament_from_same_lobby_shows_lobby_row(self, client, auth_headers):
        rid, tid1, players = _converted(client, auth_headers)
        ana_id, bob_id = players["Ana"]["player_id"], players["Bob"]["player_id"]
        _mark(client, auth_headers, f"/api/registrations/{rid}", ana_id, "paid")
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "mexicano", "player_names": list(NAMES4)},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        tid2 = r.json()["tournament_id"]
        ana = _player_jwt(client, tid2, players["Ana"])
        assert self._get(client, tid2, ana).json()["status"] == "paid"
        # An open payment is one fee: reporting in the second tournament updates the shared row.
        bob = _player_jwt(client, tid2, players["Bob"])
        assert self._get(client, tid2, bob).json()["status"] == "unpaid"
        assert self._report(client, tid2, bob).json()["status"] == "reported"
        assert _db_row(bob_id)["status"] == "reported"
        bob1 = _player_jwt(client, tid1, players["Bob"])
        assert self._get(client, tid1, bob1).json()["status"] == "reported"
        with db_mod.get_db() as conn:
            n = conn.execute("SELECT COUNT(*) FROM registrant_payments WHERE player_id = ?", (bob_id,)).fetchone()[0]
        assert n == 1

    def test_anonymous_payloads_carry_no_payment_fields(self, client, auth_headers):
        rid, tid, players = _converted(client, auth_headers)
        _mark(client, auth_headers, f"/api/registrations/{rid}", players["Ana"]["player_id"], "paid")
        for path in (f"/api/tournaments/{tid}/public", f"/api/tournaments/{tid}/mex/status"):
            r = client.get(path)
            if r.status_code == 200:
                assert "fee_cents" not in r.text and "refund_due" not in r.text and "payment" not in r.text.lower()


# ── One fee per lobby, several tournaments ──────────────────────────────────


def _convert_again(client: TestClient, headers: dict, rid: str, names=NAMES4) -> str:
    r = client.post(
        f"/api/registrations/{rid}/convert",
        json={"tournament_type": "mexicano", "player_names": list(names)},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["tournament_id"]


def _t_row(client: TestClient, headers: dict, tid: str, pid: str) -> dict:
    rows = client.get(f"/api/tournaments/{tid}/payments", headers=headers).json()["rows"]
    return next(r for r in rows if r["player_id"] == pid)


def _count_rows(pid: str) -> int:
    with db_mod.get_db() as conn:
        return conn.execute("SELECT COUNT(*) FROM registrant_payments WHERE player_id = ?", (pid,)).fetchone()[0]


class TestSharedLobbyFee:
    def test_source_lobby_is_stored_on_the_tournament(self, client, auth_headers):
        rid, tid1, _players = _converted(client, auth_headers)
        tid2 = _convert_again(client, auth_headers, rid)
        with db_mod.get_db() as conn:
            stored = {
                r["tournament_id"]: r["registration_id"]
                for r in conn.execute("SELECT * FROM tournament_payment_settings").fetchall()
            }
        assert stored[tid1] == rid and stored[tid2] == rid

    def test_migration_backfills_existing_tournaments(self, client, auth_headers):
        rid, tid1, _players = _converted(client, auth_headers)
        tid2 = _convert_again(client, auth_headers, rid)
        with db_mod.get_db() as conn:
            conn.execute("DROP TABLE tournament_payment_settings")
            conn.execute(
                "CREATE TABLE tournament_payment_settings (tournament_id TEXT PRIMARY KEY, settings TEXT NOT NULL)"
            )
            conn.execute("INSERT INTO tournament_payment_settings VALUES (?, '{\"fee_cents\": 700}')", (tid1,))
        db_mod.init_db()
        with db_mod.get_db() as conn:
            stored = {
                r["tournament_id"]: (r["registration_id"], r["settings"])
                for r in conn.execute("SELECT * FROM tournament_payment_settings").fetchall()
            }
        assert stored[tid1] == (rid, '{"fee_cents": 700}')  # existing settings are kept
        assert stored[tid2][0] == rid

    def test_organizer_listing_in_second_tournament_shows_paid_row(self, client, auth_headers):
        rid, tid1, players = _converted(client, auth_headers)
        ana_id = players["Ana"]["player_id"]
        _mark(client, auth_headers, f"/api/registrations/{rid}", ana_id, "paid")
        tid2 = _convert_again(client, auth_headers, rid)
        listing = client.get(f"/api/tournaments/{tid2}/payments", headers=auth_headers).json()
        row = next(r for r in listing["rows"] if r["player_id"] == ana_id)
        assert row["status"] == "paid" and row["synthesized"] is False
        assert listing["summary"]["paid"] == 1 and listing["summary"]["unpaid"] == 3
        assert _t_row(client, auth_headers, tid1, ana_id)["status"] == "paid"

    def test_remind_unpaid_in_second_tournament_skips_paid_player(self, client, auth_headers, monkeypatch):
        from types import SimpleNamespace  # noqa: PLC0415

        import backend.api.routes_payments as rp  # noqa: PLC0415

        delivered: list[str] = []

        class FakeDelivery:
            def __init__(self, tid, data, es):
                self.counts = SimpleNamespace(sent=0, pushed=0, failed=0)

            def reachable(self, player_id, email):
                return True

            async def deliver(self, player_id, email, **_kw):
                delivered.append(player_id)
                self.counts.sent += 1

        monkeypatch.setattr(rp, "any_channel_configured", lambda: True)
        monkeypatch.setattr(rp, "ensure_can_send", lambda es: None)
        monkeypatch.setattr(rp, "PlayerDelivery", FakeDelivery)

        rid, _tid1, players = _converted(client, auth_headers)
        ana_id = players["Ana"]["player_id"]
        _mark(client, auth_headers, f"/api/registrations/{rid}", ana_id, "paid")
        tid2 = _convert_again(client, auth_headers, rid)
        r = client.post(f"/api/tournaments/{tid2}/payments/remind-unpaid", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert ana_id not in delivered
        assert set(delivered) == {players[n]["player_id"] for n in ("Bob", "Cid", "Dan")}

    def test_organizer_mark_paid_in_second_tournament_updates_the_one_row(self, client, auth_headers):
        rid, tid1, players = _converted(client, auth_headers)
        bob_id = players["Bob"]["player_id"]
        tid2 = _convert_again(client, auth_headers, rid)
        _mark(client, auth_headers, f"/api/tournaments/{tid2}", bob_id, "paid")
        assert _count_rows(bob_id) == 1
        assert _db_row(bob_id)["status"] == "paid"
        assert _t_row(client, auth_headers, tid1, bob_id)["status"] == "paid"
        assert _row(client, rid, auth_headers, bob_id)["status"] == "paid"
        # A later change from the first tournament still hits the same row.
        _mark(client, auth_headers, f"/api/tournaments/{tid1}", bob_id, "unpaid")
        assert _count_rows(bob_id) == 1
        assert _t_row(client, auth_headers, tid2, bob_id)["status"] == "unpaid"

    def test_paid_survives_lobby_deletion_for_player_and_organizer(self, client, auth_headers):
        rid, tid1, players = _converted(client, auth_headers)
        ana_id = players["Ana"]["player_id"]
        _mark(client, auth_headers, f"/api/registrations/{rid}", ana_id, "paid")
        tid2 = _convert_again(client, auth_headers, rid)
        assert client.delete(f"/api/registrations/{rid}", headers=auth_headers).status_code == 200
        ana = _player_jwt(client, tid2, players["Ana"])
        assert client.get(f"/api/tournaments/{tid2}/player/payment", headers=ana).json()["status"] == "paid"
        assert _t_row(client, auth_headers, tid2, ana_id)["status"] == "paid"
        assert _t_row(client, auth_headers, tid1, ana_id)["status"] == "paid"
        # Organizer changes in tournament 2 still reuse the row.
        _mark(client, auth_headers, f"/api/tournaments/{tid2}", ana_id, "refund_due")
        assert _count_rows(ana_id) == 1
        assert _t_row(client, auth_headers, tid1, ana_id)["status"] == "refund_due"

    def test_hub_lists_a_shared_fee_once(self, client, auth_headers):
        rid, tid1, players = _converted(client, auth_headers)
        hub = _hub_for(client, players["Ana"], "Ana")
        tid2 = _convert_again(client, auth_headers, rid)
        ana_id = players["Ana"]["player_id"]
        rows = client.get("/api/player-profile/payments", headers=hub).json()
        assert len(rows) == 1
        # Earliest tournament wins the key; every entry that shows the fee is listed on the item.
        assert rows[0]["key"] == f"t:{tid1}:{ana_id}"
        assert set(rows[0]["entry_keys"]) == {f"t:{tid1}:{ana_id}", f"t:{tid2}:{ana_id}", f"r:{rid}:{ana_id}"}
        # A report (here through the second tournament's key) is still one row, one item.
        r = client.post(f"/api/player-profile/payments/t:{tid2}:{ana_id}/report", json={}, headers=hub)
        assert r.status_code == 200, r.text
        rows = client.get("/api/player-profile/payments", headers=hub).json()
        assert [(x["key"], x["status"]) for x in rows] == [(f"t:{tid1}:{ana_id}", "reported")]
        assert _count_rows(ana_id) == 1

    def test_report_route_is_not_limited_by_the_passphrase_limiter(self, client, auth_headers):
        _rid, tid, players = _converted(client, auth_headers)
        ana = _player_jwt(client, tid, players["Ana"])
        for _ in range(100):
            assert client.post(f"/api/tournaments/{tid}/player/payment/report", json={}, headers=ana).status_code == 200


class TestWithdrawnAndRemovedPlayers:
    def _setup(self, client, auth_headers, attr: str):
        from types import SimpleNamespace  # noqa: PLC0415

        from backend.api import state as state_mod  # noqa: PLC0415

        _rid, tid, players = _converted(client, auth_headers)
        gone = players["Cid"]["player_id"]
        t = state_mod._tournaments[tid]["tournament"]
        if attr == "withdrawals":
            t.withdrawals = {"k": SimpleNamespace(member_ids=[gone])}
        else:
            t._removed_players = [SimpleNamespace(id=gone, name="Cid")]
        return tid, players, gone

    def test_tournament_route_excludes_and_rejects(self, client, auth_headers):
        for attr in ("withdrawals", "_removed_players"):
            tid, players, gone = self._setup(client, auth_headers, attr)
            ana = _player_jwt(client, tid, players["Ana"])
            mates = client.get(f"/api/tournaments/{tid}/player/payment/teammates", headers=ana).json()
            assert {m["player_name"] for m in mates} == {"Bob", "Dan"}
            r = client.post(f"/api/tournaments/{tid}/player/payment/report", json={"also_for": [gone]}, headers=ana)
            assert r.status_code == 400
            assert _db_row(gone) is None

    def test_hub_route_excludes_and_rejects(self, client, auth_headers):
        for attr in ("withdrawals", "_removed_players"):
            tid, players, gone = self._setup(client, auth_headers, attr)
            hub = _hub_for(client, players["Ana"], f"Ana{attr[:2]}")
            key = f"t:{tid}:{players['Ana']['player_id']}"
            mates = client.get(f"/api/player-profile/payments/{key}/teammates", headers=hub).json()
            assert {m["player_name"] for m in mates} == {"Bob", "Dan"}
            r = client.post(f"/api/player-profile/payments/{key}/report", json={"also_for": [gone]}, headers=hub)
            assert r.status_code == 400
            assert _db_row(gone) is None
