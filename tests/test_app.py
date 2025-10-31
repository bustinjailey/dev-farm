import json
import os
import pathlib
import subprocess
import sys
import time
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from dashboard import app as app_module


@pytest.fixture(autouse=True)
def reset_environment(tmp_path, monkeypatch):
    """Provide isolated filesystem paths and reset global state per test."""
    monkeypatch.setattr(app_module, "REGISTRY_FILE", str(tmp_path / "registry.json"))
    monkeypatch.setattr(app_module, "GITHUB_TOKEN_FILE", str(tmp_path / "github.token"))
    monkeypatch.setattr(app_module, "DEVICE_CODE_FILE", str(tmp_path / "device.json"))
    monkeypatch.setattr(app_module, "FARM_CONFIG_FILE", str(tmp_path / "farm.config"))
    monkeypatch.setattr(app_module, "REPO_PATH", str(tmp_path / "repo"))
    monkeypatch.setattr(app_module, "EXTERNAL_URL", "http://devfarm.test")

    # Reset in-memory state
    app_module.SSE_CLIENTS.clear()
    with app_module.UPDATE_LOCK:
        app_module.UPDATE_PROGRESS.clear()
        app_module.UPDATE_PROGRESS.update({
            'running': False,
            'success': None,
            'stages': [],
            'error': None
        })

    yield

    app_module.SSE_CLIENTS.clear()


def test_kebabify_normalizes_names():
    assert app_module.kebabify("My Cool Project") == "my-cool-project"
    assert app_module.kebabify("Test_Env 123") == "test-env-123"
    assert app_module.kebabify("---Already--kebab---") == "already-kebab"


def test_get_workspace_path_modes():
    assert app_module.get_workspace_path("git") == "/repo"
    assert app_module.get_workspace_path("workspace") == "/workspace"
    assert app_module.get_workspace_path("ssh") == "/remote"
    assert app_module.get_workspace_path("terminal") == "/workspace"
    assert app_module.get_workspace_path("unknown") == "/workspace"


def test_save_and_load_registry(monkeypatch):
    events = []
    monkeypatch.setattr(app_module, "broadcast_sse", lambda event, data: events.append((event, data)))

    registry = {"env1": {"port": 8100}}
    app_module.save_registry(registry)

    loaded = app_module.load_registry()
    assert loaded == registry
    assert events and events[0][0] == "registry-update"
    assert "timestamp" in events[0][1]


def test_save_and_load_farm_config():
    config_data = {"github": {"personal_access_token": "token"}}
    assert app_module.save_farm_config(config_data)

    loaded = app_module.load_farm_config()
    assert loaded == config_data
    assert oct(os.stat(app_module.FARM_CONFIG_FILE).st_mode & 0o777) == oct(0o600)


def test_load_github_token_prefers_farm_config():
    config_data = {"github": {"personal_access_token": "config-token"}}
    with open(app_module.FARM_CONFIG_FILE, "w") as f:
        json.dump(config_data, f)

    os.environ["GITHUB_TOKEN"] = "env-token"
    with open(app_module.GITHUB_TOKEN_FILE, "w") as f:
        f.write("file-token")

    assert app_module.load_github_token() == "config-token"


def test_load_github_token_falls_back_to_file(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "")
    with open(app_module.GITHUB_TOKEN_FILE, "w") as f:
        f.write("file-token")

    assert app_module.load_github_token() == "file-token"


def test_load_github_token_falls_back_to_env(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    assert app_module.load_github_token() is None

    monkeypatch.setenv("GITHUB_TOKEN", "env-token")
    assert app_module.load_github_token() == "env-token"


def test_save_github_token_sets_permissions_and_env(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    app_module.save_github_token("new-token")

    assert os.environ["GITHUB_TOKEN"] == "new-token"
    with open(app_module.GITHUB_TOKEN_FILE) as f:
        assert f.read() == "new-token"
    assert oct(os.stat(app_module.GITHUB_TOKEN_FILE).st_mode & 0o777) == oct(0o600)


def test_sync_registry_with_containers_updates_and_prunes(monkeypatch):
    initial = {
        "env1": {"container_id": "id1", "status": "exited"},
        "env2": {"container_id": "missing", "status": "running"}
    }

    monkeypatch.setattr(app_module, "load_registry", lambda: dict(initial))

    saved = []
    monkeypatch.setattr(app_module, "save_registry", lambda data: saved.append(data))

    class FakeContainer:
        def __init__(self, cid, status):
            self.id = cid
            self.status = status

    class FakeContainers:
        def list(self, all=True, filters=None):
            return [FakeContainer("id1", "running")]

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())

    app_module.sync_registry_with_containers()

    assert saved == [{"env1": {"container_id": "id1", "status": "running"}}]


def test_prune_dangling_images_handles_missing_client(monkeypatch):
    monkeypatch.setattr(app_module, "client", None)
    app_module.prune_dangling_images()  # Should no-op without raising

    pruned = {"called": False}

    class FakeImages:
        def prune(self, filters=None):
            pruned["called"] = True
            return {"SpaceReclaimed": 0}

    class FakeClient:
        def __init__(self):
            self.images = FakeImages()

    monkeypatch.setattr(app_module, "client", FakeClient())
    app_module.prune_dangling_images()
    assert pruned["called"]


def test_get_next_port_skips_used_ports(monkeypatch):
    monkeypatch.setattr(app_module, "load_registry", lambda: {
        "env1": {"port": 8100},
        "env2": {"port": 8102}
    })
    assert app_module.get_next_port() == 8101


def test_get_container_stats_calculates_percentages():
    class FakeContainer:
        def stats(self, stream=False):
            return {
                "cpu_stats": {"cpu_usage": {"total_usage": 400}, "system_cpu_usage": 1000},
                "precpu_stats": {"cpu_usage": {"total_usage": 200}, "system_cpu_usage": 800},
                "memory_stats": {"usage": 104857600, "limit": 209715200}  # 100 / 200 MB
            }

    stats = app_module.get_container_stats(FakeContainer())
    assert stats == {"cpu": 100.0, "memory": 50.0, "memory_mb": 100.0}


def test_is_env_ready_uses_health_status(monkeypatch):
    class FakeContainer:
        name = "devfarm-env"
        attrs = {"State": {"Health": {"Status": "healthy"}}}

    class FakeContainers:
        def get(self, name):
            return FakeContainer()

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())

    def fail_request(*args, **kwargs):
        raise AssertionError("HTTP probe should not run when healthcheck is healthy")

    monkeypatch.setattr(app_module.requests, "get", fail_request)

    assert app_module.is_env_ready("devfarm-env") is True


def test_is_env_ready_http_fallback(monkeypatch):
    class FakeContainers:
        def get(self, name):
            raise app_module.docker.errors.NotFound("no health")

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())

    calls = []

    class DummyResponse:
        def __init__(self, status_code):
            self.status_code = status_code

    def fake_get(url, timeout):
        calls.append(url)
        if url == "http://env:8080":
            return DummyResponse(200)
        if url == "http://localhost:8123":
            return DummyResponse(503)
        raise app_module.requests.exceptions.RequestException()

    monkeypatch.setattr(app_module.requests, "get", fake_get)

    assert app_module.is_env_ready("env", port=8123) is True
    assert "http://env:8080" in calls


def test_is_env_ready_returns_false_on_failures(monkeypatch):
    monkeypatch.setattr(app_module, "client", None)

    def always_fail(*args, **kwargs):
        raise app_module.requests.exceptions.RequestException()

    monkeypatch.setattr(app_module.requests, "get", always_fail)

    assert app_module.is_env_ready("nope", port=9000) is False


def test_index_renders_environments(monkeypatch):
    monkeypatch.setattr(app_module, "sync_registry_with_containers", lambda: None)

    registry = {
        "my-env": {
            "container_id": "cid123",
            "port": 8100,
            "status": "running",
            "display_name": "My Env",
            "mode": "workspace",
            "project": "general",
            "created": "2024-01-01T00:00:00"
        }
    }
    monkeypatch.setattr(app_module, "load_registry", lambda: registry)

    class FakeContainer:
        status = "running"
        name = "devfarm-my-env"
        attrs = {}

    class FakeContainers:
        def get(self, cid):
            assert cid == "cid123"
            return FakeContainer()

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())
    monkeypatch.setattr(app_module, "get_container_stats", lambda container: {"cpu": 10, "memory": 20, "memory_mb": 256})
    monkeypatch.setattr(app_module, "is_env_ready", lambda *args, **kwargs: True)

    resp = app_module.app.test_client().get("/")
    assert resp.status_code == 200
    assert "My Env" in resp.get_data(as_text=True)


def test_api_environments_returns_ready_status(monkeypatch):
    registry = {
        "env": {"container_id": "cid", "port": 8105, "display_name": "Env", "mode": "git"}
    }
    monkeypatch.setattr(app_module, "load_registry", lambda: registry)

    class FakeContainer:
        status = "running"
        name = "devfarm-env"
        attrs = {}

    class FakeContainers:
        def get(self, cid):
            assert cid == "cid"
            return FakeContainer()

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())
    monkeypatch.setattr(app_module, "is_env_ready", lambda *args, **kwargs: True)

    resp = app_module.app.test_client().get("/api/environments")
    data = resp.get_json()
    assert data == [{
        "name": "Env",
        "id": "env",
        "port": 8105,
        "status": "running",
        "ready": True,
        "url": "http://devfarm.test/env/env?folder=/repo"
    }]


def test_create_environment_success(monkeypatch):
    monkeypatch.setattr(app_module, "sync_registry_with_containers", lambda: None)
    monkeypatch.setattr(app_module, "load_github_token", lambda: "gh-token")
    monkeypatch.setattr(app_module, "load_farm_config", lambda: {"mcp": {"api_keys": {"brave_search": "brave-key"}}})

    class FakeContainer:
        def __init__(self, container_id):
            self.id = container_id

    class FakeContainers:
        def __init__(self):
            self.run_calls = []

        def get(self, name):
            raise app_module.docker.errors.NotFound("missing")

        def run(self, **kwargs):
            self.run_calls.append(kwargs)
            return FakeContainer("container-123")

    class FakeImages:
        def get(self, name):
            return SimpleNamespace(name=name)

    fake_containers = FakeContainers()
    class FakeClient:
        def __init__(self):
            self.containers = fake_containers
            self.images = FakeImages()

    monkeypatch.setattr(app_module, "client", FakeClient())

    resp = app_module.app.test_client().post("/create", json={
        "name": "Workspace Env",
        "project": "proj",
        "mode": "workspace"
    })

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["env_id"] == "workspace-env"
    assert payload["url"] == "http://devfarm.test/env/workspace-env?folder=/workspace"

    # Verify registry persisted
    registry = app_module.load_registry()
    env_entry = registry["workspace-env"]
    assert env_entry["display_name"] == "Workspace Env"
    assert env_entry["mode"] == "workspace"
    assert env_entry["children"] == []
    assert env_entry["project"] == "proj"

    run_kwargs = fake_containers.run_calls[0]
    assert run_kwargs["name"] == "devfarm-workspace-env"
    assert run_kwargs["ports"] == {"8080/tcp": 8100}
    assert run_kwargs["volumes"] == {"devfarm-workspace-env": {"bind": "/home/coder/workspace", "mode": "rw"}}
    env_vars = run_kwargs["environment"]
    assert env_vars["GITHUB_TOKEN"] == "gh-token"
    assert env_vars["WORKSPACE_NAME"] == "Workspace Env"
    assert env_vars["BRAVE_API_KEY"] == "brave-key"


def test_create_environment_duplicate_name(monkeypatch):
    monkeypatch.setattr(app_module, "sync_registry_with_containers", lambda: None)
    app_module.save_registry({"workspace-env": {"container_id": "cid"}})

    monkeypatch.setattr(app_module, "client", SimpleNamespace())

    resp = app_module.app.test_client().post("/create", json={"name": "Workspace Env"})
    assert resp.status_code == 400
    assert "already exists" in resp.get_json()["error"]


def test_delete_environment_success(monkeypatch):
    registry = {
        "env": {"container_id": "cid123"}
    }
    monkeypatch.setattr(app_module, "load_registry", lambda: dict(registry))

    saved = []
    monkeypatch.setattr(app_module, "save_registry", lambda data: saved.append(data))

    class FakeContainer:
        def __init__(self):
            self.stopped = False
            self.removed = False

        def stop(self, timeout=10):
            self.stopped = True

        def remove(self, force=False):
            self.removed = True

    fake_container = FakeContainer()

    class FakeContainers:
        def get(self, ident):
            if ident == "cid123":
                return fake_container
            raise app_module.docker.errors.NotFound("no stale")

    class FakeVolume:
        def __init__(self):
            self.removed = False

        def remove(self, force=False):
            self.removed = True

    fake_volume = FakeVolume()

    class FakeVolumes:
        def get(self, name):
            assert name == "devfarm-env"
            return fake_volume

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()
            self.volumes = FakeVolumes()

    monkeypatch.setattr(app_module, "client", FakeClient())

    resp = app_module.app.test_client().post("/delete/env")
    assert resp.get_json()["success"] is True
    assert saved == [{}]
    assert fake_container.stopped and fake_container.removed
    assert fake_volume.removed


def test_delete_environment_not_found(monkeypatch):
    monkeypatch.setattr(app_module, "load_registry", lambda: {})
    monkeypatch.setattr(app_module, "client", SimpleNamespace())

    resp = app_module.app.test_client().post("/delete/missing")
    assert resp.status_code == 404


def test_start_stop_and_restart_environment(monkeypatch):
    registry = {"env": {"container_id": "cid"}}
    monkeypatch.setattr(app_module, "load_registry", lambda: registry)

    events = []
    monkeypatch.setattr(app_module, "broadcast_sse", lambda *args, **kwargs: events.append((args, kwargs)))

    class FakeContainer:
        def __init__(self):
            self.started = False
            self.stopped = False
            self.restarted = False

        def start(self):
            self.started = True

        def stop(self):
            self.stopped = True

        def restart(self):
            self.restarted = True

    fake_container = FakeContainer()

    class FakeContainers:
        def get(self, cid):
            assert cid == "cid"
            return fake_container

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())

    client = app_module.app.test_client()
    assert client.post("/start/env").get_json()["success"] is True
    assert client.post("/stop/env").get_json()["success"] is True
    assert client.post("/api/environments/env/restart").get_json()["success"] is True
    assert fake_container.started and fake_container.stopped and fake_container.restarted


def test_get_environment_status(monkeypatch):
    registry = {"env": {"container_id": "cid", "port": 8100}}
    monkeypatch.setattr(app_module, "load_registry", lambda: registry)

    class FakeContainer:
        status = "running"
        name = "devfarm-env"

    class FakeContainers:
        def get(self, cid):
            assert cid == "cid"
            return FakeContainer()

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())
    monkeypatch.setattr(app_module, "get_container_stats", lambda container: {"cpu": 1, "memory": 2, "memory_mb": 3})
    monkeypatch.setattr(app_module, "is_env_ready", lambda *args, **kwargs: True)

    resp = app_module.app.test_client().get("/api/environments/env/status")
    data = resp.get_json()
    assert data["status"] == "running"
    assert data["ready"] is True
    assert data["stats"]["cpu"] == 1


def test_list_images(monkeypatch):
    class FakeImage:
        def __init__(self):
            self.tags = ["dev-farm/image:latest", "dev-farm/image:1.0"]
            self.attrs = {"Size": 123, "Created": "today"}

    class FakeImages:
        def list(self, name=None):
            assert name == "dev-farm"
            return [FakeImage()]

    class FakeClient:
        def __init__(self):
            self.images = FakeImages()

    monkeypatch.setattr(app_module, "client", FakeClient())

    resp = app_module.app.test_client().get("/api/images")
    data = resp.get_json()
    assert len(data["images"]) == 2
    assert data["images"][0]["name"] == "dev-farm/image"


def test_build_image_invalid_type(monkeypatch):
    monkeypatch.setattr(app_module, "client", SimpleNamespace())
    resp = app_module.app.test_client().post("/api/images/build", json={"image_type": "bad"})
    assert resp.status_code == 400
    assert "Invalid image type" in resp.get_json()["error"]


def test_get_environment_hierarchy(monkeypatch):
    registry = {
        "root": {
            "container_id": "cid-root",
            "display_name": "Root",
            "children": ["child"]
        },
        "child": {
            "container_id": "cid-child",
            "display_name": "Child",
            "parent_env_id": "root",
            "children": []
        }
    }
    monkeypatch.setattr(app_module, "load_registry", lambda: registry)

    class FakeContainers:
        def get(self, cid):
            return SimpleNamespace(status="running")

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())

    resp = app_module.app.test_client().get("/api/environments/hierarchy")
    data = resp.get_json()
    tree = data["trees"][0]
    assert tree["name"] == "Root"
    assert tree["children"][0]["name"] == "Child"


def test_github_status_without_token(monkeypatch):
    monkeypatch.setattr(app_module, "load_github_token", lambda: None)
    monkeypatch.setattr(app_module, "load_farm_config", lambda: {})

    resp = app_module.app.test_client().get("/api/github/status")
    data = resp.get_json()
    assert data["authenticated"] is False
    assert "No GitHub token" in data["message"]


def test_github_status_missing_scopes(monkeypatch):
    monkeypatch.setattr(app_module, "load_github_token", lambda: "token")
    monkeypatch.setattr(app_module, "load_farm_config", lambda: {"github": {"personal_access_token": "token"}})

    calls = []

    class DummyResponse:
        def __init__(self, status_code=200, json_data=None, headers=None, text=""):
            self.status_code = status_code
            self._json = json_data or {}
            self.headers = headers or {}
            self.text = text

        def json(self):
            return self._json

    def fake_get(url, headers=None, timeout=None, params=None):
        calls.append(url)
        if url.endswith("/user"):
            return DummyResponse(
                status_code=200,
                json_data={"login": "alice"},
                headers={"X-OAuth-Scopes": "read:org"}
            )
        if "/repos/" in url:
            return DummyResponse(status_code=403)
        return DummyResponse(status_code=404)

    monkeypatch.setattr(app_module.requests, "get", fake_get)

    resp = app_module.app.test_client().get("/api/github/status")
    data = resp.get_json()
    assert data["authenticated"] is True
    assert data["has_required_scopes"] is False
    assert data["needs_reauth"] is True


def test_health_endpoint(monkeypatch):
    monkeypatch.setattr(app_module, "client", SimpleNamespace())
    monkeypatch.setattr(app_module, "load_registry", lambda: {"env": {}})

    resp = app_module.app.test_client().get("/health")
    data = resp.get_json()
    assert data["status"] == "healthy"
    assert data["docker_connected"] is True
    assert data["environments"] == 1


def test_github_repos_requires_token(monkeypatch):
    monkeypatch.setattr(app_module, "load_github_token", lambda: None)
    resp = app_module.app.test_client().get("/api/github/repos")
    assert resp.status_code == 401


def test_github_disconnect_cleans_up(monkeypatch):
    with open(app_module.GITHUB_TOKEN_FILE, "w") as f:
        f.write("token")

    with open(app_module.FARM_CONFIG_FILE, "w") as f:
        json.dump({"github": {"personal_access_token": "token"}}, f)

    with open(app_module.DEVICE_CODE_FILE, "w") as f:
        json.dump({"device_code": "abc"}, f)

    monkeypatch.setenv("GITHUB_TOKEN", "token", prepend=False)

    resp = app_module.app.test_client().post("/api/github/disconnect")
    assert resp.get_json()["success"] is True
    assert not os.path.exists(app_module.GITHUB_TOKEN_FILE)
    assert not os.path.exists(app_module.DEVICE_CODE_FILE)
    assert "GITHUB_TOKEN" not in os.environ

    config = app_module.load_farm_config()
    assert config["github"]["personal_access_token"] == ""


def test_manage_github_config_get_and_post(monkeypatch):
    app_module.save_farm_config({"github": {"personal_access_token": "ghp_token", "username": "user", "email": "user@example.com"}})

    client = app_module.app.test_client()
    get_data = client.get("/api/config/github").get_json()
    assert get_data["has_pat"] is True
    assert get_data["username"] == "user"

    post_resp = client.post("/api/config/github", json={
        "personal_access_token": "ghp_newtoken",
        "username": "newuser",
        "email": "new@example.com"
    })
    assert post_resp.get_json()["success"] is True
    config = app_module.load_farm_config()
    assert config["github"]["personal_access_token"] == "ghp_newtoken"
    assert config["github"]["username"] == "newuser"


def test_github_auth_start(monkeypatch):
    class DummyResponse:
        status_code = 200

        def json(self):
            return {
                "device_code": "dev-code",
                "user_code": "user-code",
                "verification_uri": "https://verify",
                "expires_in": 600,
                "interval": 5
            }

    monkeypatch.setattr(app_module.requests, "post", lambda *args, **kwargs: DummyResponse())

    resp = app_module.app.test_client().post("/api/github/auth/start")
    data = resp.get_json()
    assert data["user_code"] == "user-code"
    assert os.path.exists(app_module.DEVICE_CODE_FILE)


def test_github_auth_poll_pending(monkeypatch):
    now = 1000
    monkeypatch.setattr(app_module.time, "time", lambda: now)
    with open(app_module.DEVICE_CODE_FILE, "w") as f:
        json.dump({
            "device_code": "dev-code",
            "user_code": "user",
            "verification_uri": "https://verify",
            "expires_in": 600,
            "interval": 5,
            "started_at": now - 10
        }, f)

    class DummyResponse:
        status_code = 200

        def json(self):
            return {"error": "authorization_pending"}

    monkeypatch.setattr(app_module.requests, "post", lambda *args, **kwargs: DummyResponse())

    resp = app_module.app.test_client().post("/api/github/auth/poll")
    assert resp.get_json()["status"] == "pending"


def test_github_auth_poll_success(monkeypatch):
    now = 2000
    monkeypatch.setattr(app_module.time, "time", lambda: now)
    with open(app_module.DEVICE_CODE_FILE, "w") as f:
        json.dump({
            "device_code": "dev-code",
            "user_code": "user",
            "verification_uri": "https://verify",
            "expires_in": 600,
            "interval": 5,
            "started_at": now - 10
        }, f)

    class TokenResponse:
        status_code = 200

        def json(self):
            return {"access_token": "new-token"}

    class UserResponse:
        status_code = 200

        def json(self):
            return {"login": "alice"}

    post_calls = []

    def fake_post(url, *args, **kwargs):
        post_calls.append(url)
        return TokenResponse()

    def fake_get(url, headers=None):
        assert url.endswith("/user")
        return UserResponse()

    saved = {}
    monkeypatch.setattr(app_module, "save_github_token", lambda token: saved.setdefault("token", token))
    monkeypatch.setattr(app_module.requests, "post", fake_post)
    monkeypatch.setattr(app_module.requests, "get", fake_get)

    resp = app_module.app.test_client().post("/api/github/auth/poll")
    data = resp.get_json()
    assert data["status"] == "success"
    assert saved["token"] == "new-token"
    assert not os.path.exists(app_module.DEVICE_CODE_FILE)


def test_github_auth_logout(monkeypatch):
    with open(app_module.GITHUB_TOKEN_FILE, "w") as f:
        f.write("token")
    monkeypatch.setenv("GITHUB_TOKEN", "token")

    resp = app_module.app.test_client().post("/api/github/auth/logout")
    assert resp.get_json()["success"] is True
    assert "GITHUB_TOKEN" not in os.environ
    assert not os.path.exists(app_module.GITHUB_TOKEN_FILE)


def test_github_auth_status_with_valid_token(monkeypatch):
    monkeypatch.setattr(app_module, "load_github_token", lambda: "token")

    class DummyResponse:
        status_code = 200

        def json(self):
            return {"login": "alice", "name": "Alice"}

    monkeypatch.setattr(app_module.requests, "get", lambda *args, **kwargs: DummyResponse())

    resp = app_module.app.test_client().get("/api/github/auth/status")
    data = resp.get_json()
    assert data["authenticated"] is True
    assert data["username"] == "alice"


def test_system_status_reports_updates(monkeypatch):
    monkeypatch.setattr(app_module, "client", SimpleNamespace())

    def fake_run(cmd, capture_output=True, text=True, cwd=None, check=False, timeout=None):
        command = tuple(cmd)
        if command == ("git", "rev-parse", "--short", "HEAD"):
            return SimpleNamespace(returncode=0, stdout="abc123\n")
        if command == ("git", "fetch", "origin", "main"):
            return SimpleNamespace(returncode=0, stdout="")
        if command == ("git", "rev-parse", "--short", "origin/main"):
            return SimpleNamespace(returncode=0, stdout="def456\n")
        if command == ("git", "rev-list", "--count", "HEAD..origin/main"):
            return SimpleNamespace(returncode=0, stdout="2\n")
        return SimpleNamespace(returncode=0, stdout="")

    monkeypatch.setattr(app_module.subprocess, "run", fake_run)

    resp = app_module.app.test_client().get("/api/system/status")
    data = resp.get_json()
    assert data["current_sha"] == "abc123"
    assert data["latest_sha"] == "def456"
    assert data["updates_available"] is True
    assert data["commits_behind"] == 2


def test_get_orphans(monkeypatch):
    registry = {"tracked": {"container_id": "tracked-id"}}
    monkeypatch.setattr(app_module, "load_registry", lambda: registry)

    class FakeContainer:
        def __init__(self, cid, name):
            self.id = cid
            self.name = name
            self.status = "exited"
            self.attrs = {"Created": "now", "NetworkSettings": {"Ports": {}}}

    class FakeContainers:
        def list(self, all=True, filters=None):
            return [FakeContainer("tracked-id", "devfarm-kept"), FakeContainer("orphan-id", "devfarm-orphan")]

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())

    resp = app_module.app.test_client().get("/api/system/orphans")
    data = resp.get_json()
    assert data["count"] == 1
    assert data["orphans"][0]["name"] == "devfarm-orphan"


def test_get_environment_logs(monkeypatch):
    registry = {"env": {"container_id": "cid", "port": 8100}}
    monkeypatch.setattr(app_module, "load_registry", lambda: registry)

    class FakeContainer:
        status = "running"
        name = "devfarm-env"

        def logs(self, tail=500, timestamps=True):
            return b"log line"

    class FakeContainers:
        def get(self, cid):
            assert cid == "cid"
            return FakeContainer()

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())
    monkeypatch.setattr(app_module, "is_env_ready", lambda *args, **kwargs: False)

    resp = app_module.app.test_client().get("/api/environments/env/logs")
    data = resp.get_json()
    assert data["logs"] == "log line"
    assert data["status"] == "starting"


def test_cleanup_orphans(monkeypatch):
    registry = {"tracked": {"container_id": "tracked-id"}}
    monkeypatch.setattr(app_module, "load_registry", lambda: registry)

    class FakeContainer:
        def __init__(self, cid):
            self.id = cid
            self.status = "running"
            self.name = f"devfarm-{cid}"
            self.stopped = False
            self.removed = False

        def stop(self, timeout=10):
            self.stopped = True

        def remove(self):
            self.removed = True

    tracked = FakeContainer("tracked-id")
    orphan = FakeContainer("orphan-id")

    class FakeContainers:
        def list(self, all=True, filters=None):
            return [tracked, orphan]

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())

    resp = app_module.app.test_client().post("/api/system/cleanup-orphans", json={"container_ids": ["orphan-id"]})
    data = resp.get_json()
    assert data["success"] is True
    assert data["cleaned"][0]["id"] == "orphan-id"
    assert orphan.stopped and orphan.removed
    assert not tracked.stopped


def test_recover_registry(monkeypatch):
    class FakeContainer:
        def __init__(self, name, cid, port):
            self.name = name
            self.id = cid
            self.attrs = {
                "NetworkSettings": {"Ports": {"8080/tcp": [{"HostPort": str(port)}]}},
                "State": {"Status": "running"}
            }
            self.status = "running"

    class FakeContainers:
        def list(self, all=True):
            return [
                FakeContainer("devfarm-dashboard", "dash", 5000),
                FakeContainer("devfarm-env", "cid", 8100)
            ]

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    monkeypatch.setattr(app_module, "client", FakeClient())

    resp = app_module.app.test_client().post("/api/system/recover-registry")
    data = resp.get_json()
    assert data["success"] is True
    assert data["recovered"] == 1
    registry = app_module.load_registry()
    assert "env" in registry
