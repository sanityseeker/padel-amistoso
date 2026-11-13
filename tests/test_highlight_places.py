"""Tests for the ``highlight_places`` TV setting: how many places each group's standings mark."""

from __future__ import annotations

from fastapi.testclient import TestClient

_GP_BODY = {
    "name": "Highlight Cup",
    "player_names": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"],
    "num_groups": 2,
    "top_per_group": 2,
    "num_courts": 2,
    "score_mode": "points",
}


def _gp(client: TestClient, headers: dict) -> str:
    r = client.post("/api/tournaments/group-playoff", json=_GP_BODY, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_defaults_to_three(client: TestClient, auth_headers: dict) -> None:
    tid = _gp(client, auth_headers)
    assert client.get(f"/api/tournaments/{tid}/tv-settings").json()["highlight_places"] == 3


def test_organizer_sets_value_and_public_reads_it(client: TestClient, auth_headers: dict) -> None:
    tid = _gp(client, auth_headers)
    r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"highlight_places": 5}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["highlight_places"] == 5
    # Other settings survive the partial update; anonymous viewers read the value.
    public = client.get(f"/api/tournaments/{tid}/tv-settings").json()
    assert public["highlight_places"] == 5
    assert public["show_standings"] is True


def test_zero_turns_marks_off(client: TestClient, auth_headers: dict) -> None:
    tid = _gp(client, auth_headers)
    r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"highlight_places": 0}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["highlight_places"] == 0


def test_rejects_out_of_range(client: TestClient, auth_headers: dict) -> None:
    tid = _gp(client, auth_headers)
    for bad in (-1, 33):
        r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"highlight_places": bad}, headers=auth_headers)
        assert r.status_code == 422, (bad, r.text)


def test_requires_editor(client: TestClient, auth_headers: dict) -> None:
    tid = _gp(client, auth_headers)
    r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"highlight_places": 4})
    assert r.status_code == 401


def _group_names(client: TestClient, tid: str, headers: dict) -> list[str]:
    return list(client.get(f"/api/tournaments/{tid}/gp/groups", headers=headers).json()["standings"])


def test_per_group_overrides_merge(client: TestClient, auth_headers: dict) -> None:
    tid = _gp(client, auth_headers)
    first, second = _group_names(client, tid, auth_headers)
    url = f"/api/tournaments/{tid}/tv-settings"
    assert client.patch(url, json={"highlight_places_by_group": {first: 2}}, headers=auth_headers).status_code == 200
    r = client.patch(url, json={"highlight_places_by_group": {second: 4}}, headers=auth_headers)
    assert r.status_code == 200, r.text
    # Saving one group keeps the other; the default is untouched.
    assert r.json()["highlight_places_by_group"] == {first: 2, second: 4}
    assert r.json()["highlight_places"] == 3
    assert client.get(url).json()["highlight_places_by_group"] == {first: 2, second: 4}


def test_per_group_rejects_unknown_group_and_bad_values(client: TestClient, auth_headers: dict) -> None:
    tid = _gp(client, auth_headers)
    (first, _) = _group_names(client, tid, auth_headers)
    url = f"/api/tournaments/{tid}/tv-settings"
    r = client.patch(url, json={"highlight_places_by_group": {"Nope": 2}}, headers=auth_headers)
    assert r.status_code == 400, r.text
    r = client.patch(url, json={"highlight_places_by_group": {first: 33}}, headers=auth_headers)
    assert r.status_code == 422, r.text
    assert client.get(url).json()["highlight_places_by_group"] == {}
