from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


def test_load_github_token_prefers_config(app_with_temp_paths, monkeypatch):
    module = app_with_temp_paths
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    config = {"github": {"personal_access_token": "ghp_12345"}}
    module.save_farm_config(config)
    assert module.load_github_token() == "ghp_12345"


def test_load_github_token_falls_back_to_file_and_env(app_with_temp_paths, monkeypatch):
    module = app_with_temp_paths
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)

    # No config PAT, so write token file
    Path(module.GITHUB_TOKEN_FILE).write_text("file_token", encoding="utf-8")
    assert module.load_github_token() == "file_token"

    # Remove file so env var is used
    Path(module.GITHUB_TOKEN_FILE).unlink()
    monkeypatch.setenv("GITHUB_TOKEN", "env_token")
    assert module.load_github_token() == "env_token"


def test_save_github_token_sets_permissions_and_env(app_with_temp_paths, monkeypatch):
    module = app_with_temp_paths
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)

    module.save_github_token("new_token")
    token_path = Path(module.GITHUB_TOKEN_FILE)
    assert token_path.read_text(encoding="utf-8") == "new_token"
    assert token_path.stat().st_mode & 0o777 == 0o600
    assert module.os.environ["GITHUB_TOKEN"] == "new_token"


def test_github_status_without_token(flask_client, app_with_temp_paths):
    response = flask_client.get("/api/github/status")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["authenticated"] is False
    assert "No GitHub token" in payload["message"]


def test_github_status_with_scopes(monkeypatch, flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.save_farm_config({"github": {"personal_access_token": ""}})
    Path(module.GITHUB_TOKEN_FILE).write_text("token123", encoding="utf-8")

    class FakeResponse:
        def __init__(self, status_code, json_data=None, headers=None, text=""):
            self.status_code = status_code
            self._json = json_data or {}
            self.headers = headers or {}
            self.text = text

        def json(self):
            return self._json

    def fake_get(url, headers=None, timeout=None, params=None):
        if url.endswith("/user"):
            return FakeResponse(
                200,
                json_data={"login": "coder"},
                headers={"X-OAuth-Scopes": "repo, gist"},
            )
        if "/repos/" in url:
            return FakeResponse(200)
        raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(module.requests, "get", fake_get)

    response = flask_client.get("/api/github/status")
    payload = response.get_json()
    assert payload["authenticated"] is True
    assert payload["username"] == "coder"
    assert payload["has_required_scopes"] is True
    assert payload["can_access_private_repos"] is True
    assert payload["using_pat"] is False


def test_manage_github_config_get_and_post(flask_client, app_with_temp_paths):
    config_before = flask_client.get("/api/config/github").get_json()
    assert config_before == {"has_pat": False, "username": "", "email": ""}

    response = flask_client.post(
        "/api/config/github",
        json={
            "personal_access_token": "ghp_validtoken1234567890",
            "username": "octo",
            "email": "octo@example.com",
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["success"] is True

    config_after = flask_client.get("/api/config/github").get_json()
    assert config_after["has_pat"] is True
    assert config_after["username"] == "octo"
    assert config_after["email"] == "octo@example.com"


def test_manage_github_config_rejects_invalid_token(flask_client):
    response = flask_client.post(
        "/api/config/github", json={"personal_access_token": "invalid"}
    )
    assert response.status_code == 400
    assert "Invalid token format" in response.get_json()["error"]


def test_github_disconnect_removes_credentials(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    Path(module.GITHUB_TOKEN_FILE).write_text("token123", encoding="utf-8")
    module.save_farm_config({"github": {"personal_access_token": "ghp_token"}})
    response = flask_client.post("/api/github/disconnect")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["success"] is True
    assert not Path(module.GITHUB_TOKEN_FILE).exists()
    assert module.load_farm_config()["github"]["personal_access_token"] == ""


def test_github_auth_start_success(monkeypatch, flask_client, app_with_temp_paths):
    module = app_with_temp_paths

    class FakeResponse:
        def __init__(self, status_code, json_data=None):
            self.status_code = status_code
            self._json = json_data or {}

        def json(self):
            return self._json

    def fake_post(url, headers=None, data=None, timeout=None):
        assert "client_id" in (data or {})
        return FakeResponse(
            200,
            json_data={
                "device_code": "device",
                "user_code": "CODE123",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 900,
                "interval": 5,
            },
        )

    monkeypatch.setattr(module.requests, "post", fake_post)
    response = flask_client.post("/api/github/auth/start")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["user_code"] == "CODE123"
    assert Path(module.DEVICE_CODE_FILE).exists()


def test_github_auth_poll_success(monkeypatch, flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    Path(module.DEVICE_CODE_FILE).write_text(
        module.json.dumps(
            {
                "device_code": "device",
                "user_code": "CODE",
                "verification_uri": "",
                "expires_in": 900,
                "interval": 5,
                "started_at": module.time.time(),
            }
        ),
        encoding="utf-8",
    )

    class FakeResponse:
        def __init__(self, status_code, json_data=None):
            self.status_code = status_code
            self._json = json_data or {}

        def json(self):
            return self._json

    def fake_post(url, headers=None, data=None, timeout=None):
        return FakeResponse(200, json_data={"access_token": "new_token"})

    def fake_get(url, headers=None):
        return FakeResponse(200, json_data={"login": "coder"})

    monkeypatch.setattr(module.requests, "post", fake_post)
    monkeypatch.setattr(module.requests, "get", fake_get)

    response = flask_client.post("/api/github/auth/poll")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["status"] == "success"
    assert payload["username"] == "coder"
    assert not Path(module.DEVICE_CODE_FILE).exists()
    assert Path(module.GITHUB_TOKEN_FILE).read_text(encoding="utf-8") == "new_token"


def test_github_auth_poll_pending(monkeypatch, flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    Path(module.DEVICE_CODE_FILE).write_text(
        module.json.dumps(
            {
                "device_code": "device",
                "user_code": "CODE",
                "verification_uri": "",
                "expires_in": 900,
                "interval": 5,
                "started_at": module.time.time(),
            }
        ),
        encoding="utf-8",
    )

    class PendingResponse:
        def __init__(self):
            self.status_code = 200

        def json(self):
            return {"error": "authorization_pending"}

    monkeypatch.setattr(module.requests, "post", lambda *args, **kwargs: PendingResponse())
    response = flask_client.post("/api/github/auth/poll")
    payload = response.get_json()
    assert payload["status"] == "pending"


def test_github_auth_logout_clears_token(monkeypatch, flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    Path(module.GITHUB_TOKEN_FILE).write_text("token", encoding="utf-8")
    response = flask_client.post("/api/github/auth/logout")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert not Path(module.GITHUB_TOKEN_FILE).exists()
