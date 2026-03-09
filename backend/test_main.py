"""Unit tests for main.py API endpoints."""
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

CONF_PAYLOAD = {
    "name": "CodeFest 2025",
    "city": "Новосибирск",
    "start_date": "2025-06-01",
    "end_date": "2025-06-02",
    "tracks": [{"name": "Backend", "slots": 10}],
}

HALL_PAYLOAD = {"name": "Зал А", "capacity": 200}


def create_conference(client, payload=None):
    r = client.post("/conferences", json=payload or CONF_PAYLOAD)
    assert r.status_code == 201
    return r.json()


def create_hall(client, conf_id, payload=None):
    r = client.post(f"/conferences/{conf_id}/halls", json=payload or HALL_PAYLOAD)
    assert r.status_code == 201
    return r.json()


def first_day_id(conf):
    return conf["days"][0]["id"]


# ---------------------------------------------------------------------------
# Conferences
# ---------------------------------------------------------------------------

class TestConferences:
    def test_create(self, client):
        conf = create_conference(client)
        assert conf["name"] == "CodeFest 2025"
        assert conf["city"] == "Новосибирск"
        assert len(conf["days"]) == 2
        assert len(conf["tracks"]) == 1

    def test_list(self, client):
        create_conference(client)
        create_conference(client, {**CONF_PAYLOAD, "name": "CodeFest 2026"})
        r = client.get("/conferences")
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_get(self, client):
        conf = create_conference(client)
        r = client.get(f"/conferences/{conf['id']}")
        assert r.status_code == 200
        assert r.json()["id"] == conf["id"]

    def test_get_not_found(self, client):
        r = client.get("/conferences/9999")
        assert r.status_code == 404

    def test_update(self, client):
        conf = create_conference(client)
        r = client.patch(f"/conferences/{conf['id']}", json={"name": "Updated"})
        assert r.status_code == 200
        assert r.json()["name"] == "Updated"

    def test_update_dates_syncs_days(self, client):
        conf = create_conference(client)
        r = client.patch(
            f"/conferences/{conf['id']}",
            json={"start_date": "2025-06-01", "end_date": "2025-06-03"},
        )
        assert len(r.json()["days"]) == 3

    def test_delete(self, client):
        conf = create_conference(client)
        r = client.delete(f"/conferences/{conf['id']}")
        assert r.status_code == 204
        assert client.get(f"/conferences/{conf['id']}").status_code == 404

    def test_invalid_dates(self, client):
        payload = {**CONF_PAYLOAD, "start_date": "2025-06-05", "end_date": "2025-06-01"}
        r = client.post("/conferences", json=payload)
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Halls
# ---------------------------------------------------------------------------

class TestHalls:
    def test_create(self, client):
        conf = create_conference(client)
        hall = create_hall(client, conf["id"])
        assert hall["name"] == "Зал А"
        assert hall["capacity"] == 200

    def test_create_unknown_conference(self, client):
        r = client.post("/conferences/9999/halls", json=HALL_PAYLOAD)
        assert r.status_code == 404

    def test_delete(self, client):
        conf = create_conference(client)
        hall = create_hall(client, conf["id"])
        r = client.delete(f"/halls/{hall['id']}")
        assert r.status_code == 204

    def test_delete_not_found(self, client):
        r = client.delete("/halls/9999")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Talks — assigned
# ---------------------------------------------------------------------------

class TestTalks:
    def _setup(self, client):
        conf = create_conference(client)
        hall = create_hall(client, conf["id"])
        day_id = first_day_id(conf)
        return conf["id"], hall["id"], day_id

    def _talk_payload(self, hall_id):
        return {
            "title": "Доклад 1",
            "hall_id": hall_id,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
        }

    def test_create(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/talks",
                        json=self._talk_payload(hall_id))
        assert r.status_code == 201
        assert r.json()["title"] == "Доклад 1"

    def test_create_invalid_times(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        payload = {**self._talk_payload(hall_id), "start_time": "11:00:00", "end_time": "10:00:00"}
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/talks", json=payload)
        assert r.status_code == 422

    def test_create_hall_not_in_conference(self, client):
        conf_id, _, day_id = self._setup(client)
        payload = {**self._talk_payload(9999)}
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/talks", json=payload)
        assert r.status_code == 400

    def test_update(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        talk = client.post(f"/conferences/{conf_id}/days/{day_id}/talks",
                           json=self._talk_payload(hall_id)).json()
        r = client.patch(f"/talks/{talk['id']}", json={"title": "Новый заголовок"})
        assert r.status_code == 200
        assert r.json()["title"] == "Новый заголовок"

    def test_delete(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        talk = client.post(f"/conferences/{conf_id}/days/{day_id}/talks",
                           json=self._talk_payload(hall_id)).json()
        r = client.delete(f"/talks/{talk['id']}")
        assert r.status_code == 204

    def test_delete_not_found(self, client):
        assert client.delete("/talks/9999").status_code == 404

    def test_talk_overlaps_break(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        # Create a break first
        client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                    json={"hall_id": hall_id, "start_time": "10:30:00", "end_time": "11:00:00"})
        # Talk fully overlaps the break
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/talks",
                        json=self._talk_payload(hall_id))
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# Talks — unassigned
# ---------------------------------------------------------------------------

class TestUnassignedTalks:
    def test_create_unassigned(self, client):
        conf = create_conference(client)
        r = client.post(f"/conferences/{conf['id']}/talks", json={"title": "Без зала"})
        assert r.status_code == 201
        data = r.json()
        assert data["hall_id"] is None
        assert data["start_time"] is None

    def test_assign_hall_via_update(self, client):
        conf = create_conference(client)
        hall = create_hall(client, conf["id"])
        talk = client.post(f"/conferences/{conf['id']}/talks", json={"title": "Без зала"}).json()
        r = client.patch(f"/talks/{talk['id']}", json={
            "hall_id": hall["id"],
            "start_time": "10:00:00",
            "end_time": "11:00:00",
        })
        assert r.status_code == 200
        assert r.json()["hall_id"] == hall["id"]


# ---------------------------------------------------------------------------
# Breaks
# ---------------------------------------------------------------------------

class TestBreaks:
    def _setup(self, client):
        conf = create_conference(client)
        hall = create_hall(client, conf["id"])
        day_id = first_day_id(conf)
        return conf["id"], hall["id"], day_id

    def _break_payload(self, hall_id, start="12:00:00", end="12:30:00"):
        return {"hall_id": hall_id, "start_time": start, "end_time": end}

    def test_create(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                        json=self._break_payload(hall_id))
        assert r.status_code == 201

    def test_create_invalid_times(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                        json=self._break_payload(hall_id, start="13:00:00", end="12:00:00"))
        assert r.status_code == 422

    def test_break_overlaps_talk(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        # Create a talk first
        client.post(f"/conferences/{conf_id}/days/{day_id}/talks", json={
            "title": "Доклад", "hall_id": hall_id,
            "start_time": "12:00:00", "end_time": "13:00:00",
        })
        # Break fully inside the talk
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                        json=self._break_payload(hall_id, "12:00:00", "13:00:00"))
        assert r.status_code == 400

    def test_break_overlaps_break(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                    json=self._break_payload(hall_id))
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                        json=self._break_payload(hall_id))
        assert r.status_code == 400

    def test_update(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        br = client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                         json=self._break_payload(hall_id)).json()
        r = client.patch(f"/breaks/{br['id']}",
                         json={"start_time": "13:00:00", "end_time": "13:30:00"})
        assert r.status_code == 200
        assert r.json()["start_time"] == "13:00:00"

    def test_delete(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        br = client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                         json=self._break_payload(hall_id)).json()
        assert client.delete(f"/breaks/{br['id']}").status_code == 204

    def test_delete_not_found(self, client):
        assert client.delete("/breaks/9999").status_code == 404


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------

class TestLogs:
    def test_actions_are_logged(self, client):
        create_conference(client)
        r = client.get("/logs")
        assert r.status_code == 200
        logs = r.json()
        assert len(logs) >= 1
        assert "tester" in logs[0]["action"]

    def test_logs_ordered_desc(self, client):
        create_conference(client)
        create_conference(client, {**CONF_PAYLOAD, "name": "Вторая"})
        logs = client.get("/logs").json()
        assert logs[0]["id"] > logs[1]["id"]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class TestAuth:
    def test_login_success(self, client, test_user):
        # client fixture already logs in; test the login endpoint directly
        r = client.post("/auth/login", data={"username": "tester", "password": "password123"})
        assert r.status_code == 200
        assert r.json()["username"] == "tester"

    def test_login_wrong_password(self, client):
        r = client.post("/auth/login", data={"username": "tester", "password": "wrong"})
        assert r.status_code == 401

    def test_login_unknown_user(self, client):
        r = client.post("/auth/login", data={"username": "nobody", "password": "x"})
        assert r.status_code == 401

    def test_me(self, client):
        r = client.get("/auth/me")
        assert r.status_code == 200
        assert r.json()["username"] == "tester"

    def test_logout(self, client):
        r = client.post("/auth/logout")
        assert r.status_code == 200

    def test_change_password_success(self, client):
        r = client.patch("/auth/me/password", json={
            "current_password": "password123",
            "new_password": "newpassword456",
        })
        assert r.status_code == 200

    def test_change_password_wrong_current(self, client):
        r = client.patch("/auth/me/password", json={
            "current_password": "wrongpassword",
            "new_password": "newpassword456",
        })
        assert r.status_code == 400

    def test_change_password_too_short(self, client):
        r = client.patch("/auth/me/password", json={
            "current_password": "password123",
            "new_password": "short",
        })
        assert r.status_code == 400

    def test_protected_endpoint_without_auth(self):
        from fastapi.testclient import TestClient
        from main import app as _app
        # Fresh client with no auth override
        with TestClient(_app) as c:
            r = c.get("/conferences")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# Overlap edge cases
# ---------------------------------------------------------------------------

class TestOverlapEdgeCases:
    def _setup(self, client):
        conf = create_conference(client)
        hall = create_hall(client, conf["id"])
        day_id = first_day_id(conf)
        return conf["id"], hall["id"], day_id

    def test_talks_in_different_halls_do_not_conflict(self, client):
        conf_id, hall1_id, day_id = self._setup(client)
        hall2 = create_hall(client, conf_id, {"name": "Зал Б", "capacity": 100})

        # Break in hall1
        client.post(f"/conferences/{conf_id}/days/{day_id}/breaks", json={
            "hall_id": hall1_id, "start_time": "10:00:00", "end_time": "11:00:00"
        })
        # Talk at same time but in hall2 — should succeed
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/talks", json={
            "title": "Доклад", "hall_id": hall2["id"],
            "start_time": "10:00:00", "end_time": "11:00:00",
        })
        assert r.status_code == 201

    def test_small_overlap_within_tolerance_is_allowed(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        # Break 10:00–11:00
        client.post(f"/conferences/{conf_id}/days/{day_id}/breaks", json={
            "hall_id": hall_id, "start_time": "10:00:00", "end_time": "11:00:00"
        })
        # Talk 10:59:30–12:00 — overlaps by 30s which is within MAX_OVERLAP_SECONDS=60
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/talks", json={
            "title": "Короткий перехлёст", "hall_id": hall_id,
            "start_time": "10:59:30", "end_time": "12:00:00",
        })
        assert r.status_code == 201
