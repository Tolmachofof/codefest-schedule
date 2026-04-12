"""Integration tests for API endpoints."""
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
# Talks (unassigned — placement через TalkPlacement)
# ---------------------------------------------------------------------------

class TestTalks:
    def test_create_unassigned(self, client):
        conf = create_conference(client)
        r = client.post(f"/conferences/{conf['id']}/talks", json={"title": "Без зала"})
        assert r.status_code == 201
        data = r.json()
        assert data["title"] == "Без зала"
        # hall/time не возвращаются — они в TalkPlacement
        assert "hall_id" not in data or data.get("hall_id") is None

    def test_create_with_metadata(self, client):
        conf = create_conference(client)
        r = client.post(f"/conferences/{conf['id']}/talks", json={
            "title": "Доклад с метаданными",
            "speaker_name": "Иван Иванов",
            "speaker_level": "senior",
            "duration_minutes": 60,
        })
        assert r.status_code == 201
        data = r.json()
        assert data["speaker_name"] == "Иван Иванов"
        assert data["speaker_level"] == "senior"
        assert data["duration_minutes"] == 60

    def test_create_with_track(self, client):
        conf = create_conference(client)
        track_id = conf["tracks"][0]["id"]
        r = client.post(f"/conferences/{conf['id']}/talks", json={
            "title": "С треком",
            "primary_track_id": track_id,
        })
        assert r.status_code == 201
        assert r.json()["primary_track_id"] == track_id

    def test_update_title(self, client):
        conf = create_conference(client)
        talk = client.post(f"/conferences/{conf['id']}/talks", json={"title": "Старый"}).json()
        r = client.patch(f"/talks/{talk['id']}", json={"title": "Новый"})
        assert r.status_code == 200
        assert r.json()["title"] == "Новый"

    def test_update_metadata(self, client):
        conf = create_conference(client)
        talk = client.post(f"/conferences/{conf['id']}/talks", json={"title": "Доклад"}).json()
        r = client.patch(f"/talks/{talk['id']}", json={
            "speaker_name": "Петров",
            "relevance": 4,
        })
        assert r.status_code == 200
        assert r.json()["speaker_name"] == "Петров"
        assert r.json()["relevance"] == 4

    def test_delete(self, client):
        conf = create_conference(client)
        talk = client.post(f"/conferences/{conf['id']}/talks", json={"title": "Удалить"}).json()
        r = client.delete(f"/talks/{talk['id']}")
        assert r.status_code == 204

    def test_delete_not_found(self, client):
        assert client.delete("/talks/9999").status_code == 404

    def test_create_unknown_conference(self, client):
        r = client.post("/conferences/9999/talks", json={"title": "Нет"})
        assert r.status_code == 404


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

    def test_break_overlaps_break(self, client):
        conf_id, hall_id, day_id = self._setup(client)
        client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                    json=self._break_payload(hall_id))
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                        json=self._break_payload(hall_id))
        assert r.status_code == 400

    def test_breaks_in_different_halls_do_not_conflict(self, client):
        conf_id, hall1_id, day_id = self._setup(client)
        hall2 = create_hall(client, conf_id, {"name": "Зал Б", "capacity": 100})
        client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                    json=self._break_payload(hall1_id))
        r = client.post(f"/conferences/{conf_id}/days/{day_id}/breaks",
                        json=self._break_payload(hall2["id"]))
        assert r.status_code == 201

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
# Schedule versions
# ---------------------------------------------------------------------------

class TestScheduleVersions:
    def _setup(self, client):
        conf = create_conference(client)
        create_hall(client, conf["id"])
        return conf

    def test_create_manual_version(self, client):
        conf = self._setup(client)
        r = client.post(f"/conferences/{conf['id']}/schedule/versions/manual")
        assert r.status_code == 201
        data = r.json()
        assert data["is_active"] is False
        assert data["placements"] == []

    def test_list_versions(self, client):
        conf = self._setup(client)
        client.post(f"/conferences/{conf['id']}/schedule/versions/manual")
        client.post(f"/conferences/{conf['id']}/schedule/versions/manual")
        r = client.get(f"/conferences/{conf['id']}/schedule/versions")
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_activate_version(self, client):
        conf = self._setup(client)
        v1 = client.post(f"/conferences/{conf['id']}/schedule/versions/manual").json()
        v2 = client.post(f"/conferences/{conf['id']}/schedule/versions/manual").json()
        r = client.post(f"/conferences/{conf['id']}/schedule/versions/{v1['id']}/activate")
        assert r.status_code == 200
        assert r.json()["is_active"] is True
        # v2 должна стать неактивной
        versions = client.get(f"/conferences/{conf['id']}/schedule/versions").json()
        v2_updated = next(v for v in versions if v["id"] == v2["id"])
        assert v2_updated["is_active"] is False

    def test_delete_version(self, client):
        conf = self._setup(client)
        v = client.post(f"/conferences/{conf['id']}/schedule/versions/manual").json()
        r = client.delete(f"/conferences/{conf['id']}/schedule/versions/{v['id']}")
        assert r.status_code == 204
        versions = client.get(f"/conferences/{conf['id']}/schedule/versions").json()
        assert all(ver["id"] != v["id"] for ver in versions)

    def test_add_and_remove_placement(self, client):
        conf = self._setup(client)
        hall = create_hall(client, conf["id"])
        hall_id = hall["id"]
        day_id = first_day_id(conf)
        talk = client.post(f"/conferences/{conf['id']}/talks", json={"title": "Доклад"}).json()
        v = client.post(f"/conferences/{conf['id']}/schedule/versions/manual").json()

        # Добавляем размещение
        r = client.post(
            f"/conferences/{conf['id']}/schedule/versions/{v['id']}/talks",
            json={
                "talk_id": talk["id"],
                "hall_id": hall_id,
                "day_id": day_id,
                "start_time": "10:00:00",
                "end_time": "11:00:00",
            },
        )
        assert r.status_code == 201
        assert len(r.json()["placements"]) == 1

        # Удаляем размещение
        r = client.delete(
            f"/conferences/{conf['id']}/schedule/versions/{v['id']}/talks/{talk['id']}"
        )
        assert r.status_code == 204


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
        with TestClient(_app) as c:
            r = c.get("/conferences")
        assert r.status_code == 401
