from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


def test_index_renders_without_docker(flask_client, app_with_temp_paths, monkeypatch):
    monkeypatch.setattr(app_with_temp_paths, "client", None)
    response = flask_client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.content_type


def test_create_environment_success_workspace(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.client.containers.list.return_value = []
    module.client.containers.get.side_effect = module.docker.errors.NotFound("missing")
    module.client.images.get.return_value = object()
    created_container = SimpleNamespace(id="container123", name="devfarm-test-env")
    module.client.containers.run.return_value = created_container

    response = flask_client.post(
        "/create",
        json={"name": "Test Env", "project": "demo", "mode": "workspace"},
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["env_id"] == "test-env"
    registry = module.load_registry()
    assert "test-env" in registry
    env = registry["test-env"]
    assert env["container_id"] == "container123"
    assert env["project"] == "demo"
    assert env["children"] == []


def test_create_environment_detects_duplicate(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.save_registry({"test-env": {"port": module.BASE_PORT}})
    response = flask_client.post("/create", json={"name": "Test Env"})
    assert response.status_code == 400
    assert "already exists" in response.get_json()["error"]


def test_delete_environment_removes_registry(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.save_registry(
        {"test-env": {"container_id": "container123", "port": module.BASE_PORT}}
    )

    def get_container(name):
        if name == "container123":
            return SimpleNamespace(
                stop=MagicMock(), remove=MagicMock(), logs=MagicMock()
            )
        if name == "devfarm-test-env":
            raise module.docker.errors.NotFound("missing")
        raise AssertionError(f"Unexpected container {name}")

    module.client.containers.get.side_effect = get_container
    module.client.volumes.get.return_value = SimpleNamespace(remove=MagicMock())

    response = flask_client.post("/delete/test-env")
    assert response.status_code == 200
    assert response.get_json()["success"] is True
    assert module.load_registry() == {}


def test_start_stop_restart_environment(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    env_entry = {"container_id": "container123", "port": module.BASE_PORT}
    module.save_registry({"test-env": env_entry})
    container = SimpleNamespace(start=MagicMock(), stop=MagicMock(), restart=MagicMock())
    module.client.containers.get.return_value = container

    resp_start = flask_client.post("/start/test-env")
    assert resp_start.status_code == 200
    container.start.assert_called_once()

    resp_stop = flask_client.post("/stop/test-env")
    assert resp_stop.status_code == 200
    container.stop.assert_called_once()

    resp_restart = flask_client.post("/api/environments/test-env/restart")
    assert resp_restart.status_code == 200
    container.restart.assert_called_once()


def test_get_environment_status_reports_ready(flask_client, app_with_temp_paths, monkeypatch):
    module = app_with_temp_paths
    module.save_registry(
        {"test-env": {"container_id": "container123", "port": module.BASE_PORT}}
    )
    container = SimpleNamespace(
        status="running",
        stats=MagicMock(return_value={}),
        name="devfarm-test-env",
    )
    module.client.containers.get.return_value = container
    monkeypatch.setattr(module, "get_container_stats", lambda c: {"cpu": 10})
    monkeypatch.setattr(module, "is_env_ready", lambda name, port: True)

    response = flask_client.get("/api/environments/test-env/status")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["status"] == "running"
    assert payload["ready"] is True
    assert payload["stats"] == {"cpu": 10}


def test_list_images_returns_entries(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    image = SimpleNamespace(
        tags=["dev-farm/code-server:latest"],
        attrs={"Size": 1024, "Created": "now"},
    )
    module.client.images.list.return_value = [image]

    response = flask_client.get("/api/images")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["images"][0]["name"] == "dev-farm/code-server"
    assert payload["images"][0]["tag"] == "latest"


def test_build_image_rejects_invalid_type(flask_client):
    response = flask_client.post("/api/images/build", json={"image_type": "bad"})
    assert response.status_code == 400
    assert "Invalid image type" in response.get_json()["error"]


def test_build_image_dashboard_success(monkeypatch, flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    exec_result = SimpleNamespace(exit_code=0, output=b"")

    updater = SimpleNamespace(
        status="running",
        start=MagicMock(),
        exec_run=MagicMock(return_value=exec_result),
        client=SimpleNamespace(api=SimpleNamespace(exec_create=lambda *a, **k: {"Id": "123"}, exec_start=lambda *a, **k: None)),
    )

    module.client.containers.get.side_effect = lambda name: updater
    response = flask_client.post("/api/images/build", json={"image_type": "dashboard"})
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True


def test_get_orphans_identifies_untracked(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.save_registry(
        {"tracked": {"container_id": "known", "port": module.BASE_PORT}}
    )

    orphan_container = SimpleNamespace(
        id="orphan123456789",
        name="devfarm-orphan",
        status="running",
        attrs={"Created": "now", "NetworkSettings": {"Ports": {}}},
    )
    module.client.containers.list.return_value = [orphan_container]

    response = flask_client.get("/api/system/orphans")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["count"] == 1
    assert payload["orphans"][0]["id"] == "orphan123456"


def test_cleanup_orphans_stops_and_removes(flask_client, app_with_temp_paths):
    module = app_with_temp_paths

    orphan_container = SimpleNamespace(
        id="abcdef1234567890",
        name="devfarm-orphan",
        status="running",
        stop=MagicMock(),
        remove=MagicMock(),
    )

    module.client.containers.list.return_value = [orphan_container]
    module.save_registry({})

    response = flask_client.post("/api/system/cleanup-orphans", json={})
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    orphan_container.stop.assert_called_once()
    orphan_container.remove.assert_called_once()


def test_recover_registry_rebuilds_entries(flask_client, app_with_temp_paths):
    module = app_with_temp_paths

    container = SimpleNamespace(
        name="devfarm-test-env",
        attrs={
            "NetworkSettings": {
                "Ports": {
                    "8080/tcp": [{"HostPort": str(module.BASE_PORT)}],
                }
            }
        },
        status="running",
        id="container1234567890",
    )

    module.client.containers.list.return_value = [container]

    response = flask_client.post("/api/system/recover-registry")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["recovered"] == 1
    assert "test-env" in payload["environments"]


def test_system_update_start_sets_running(monkeypatch, flask_client, app_with_temp_paths):
    module = app_with_temp_paths

    started_threads = []

    class DummyThread:
        def __init__(self, *args, **kwargs):
            if "target" in kwargs:
                started_threads.append(kwargs["target"])
            elif args:
                started_threads.append(args[0])
            else:
                started_threads.append(None)

        def start(self):
            # Simulate immediate completion without running target
            return None

    monkeypatch.setattr(module.threading, "Thread", DummyThread)
    response = flask_client.post("/api/system/update/start")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["started"] is True
    assert module.UPDATE_PROGRESS["running"] is True
    assert started_threads  # Target captured


def test_system_update_start_conflicts_when_running(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.UPDATE_PROGRESS.update({"running": True})
    response = flask_client.post("/api/system/update/start")
    assert response.status_code == 409
    assert response.get_json()["started"] is False


def test_system_update_status_returns_snapshot(flask_client):
    response = flask_client.get("/api/system/update/status")
    payload = response.get_json()
    assert "running" in payload
    assert "stages" in payload


def test_create_environment_generates_default_name(flask_client, app_with_temp_paths):
    # When no name is provided, a default name is auto-generated
    module = app_with_temp_paths
    module.client.containers.list.return_value = []
    module.client.containers.get.side_effect = module.docker.errors.NotFound("missing")
    module.client.images.get.return_value = object()
    created_container = SimpleNamespace(id="container789", name="devfarm-env-123")
    module.client.containers.run.return_value = created_container

    response = flask_client.post("/create", json={})
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    # Name should be auto-generated with timestamp pattern
    assert "env-" in payload["env_id"]


def test_create_environment_git_mode(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.client.containers.list.return_value = []
    module.client.containers.get.side_effect = module.docker.errors.NotFound("missing")
    module.client.images.get.return_value = object()
    created_container = SimpleNamespace(id="container456", name="devfarm-git-env")
    module.client.containers.run.return_value = created_container

    response = flask_client.post(
        "/create",
        json={
            "name": "Git Env",
            "project": "test-project",
            "mode": "git",
            "git_url": "https://github.com/user/repo.git",
        },
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["env_id"] == "git-env"

    registry = module.load_registry()
    env = registry["git-env"]
    assert env["mode"] == "git"
    assert env["git_url"] == "https://github.com/user/repo.git"


def test_delete_environment_handles_missing_container(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.save_registry({"orphan-env": {"container_id": "missing123"}})

    # Container doesn't exist
    module.client.containers.get.side_effect = module.docker.errors.NotFound("missing")
    module.client.volumes.get.side_effect = module.docker.errors.NotFound("missing")

    response = flask_client.post("/delete/orphan-env")
    assert response.status_code == 200
    assert response.get_json()["success"] is True
    # Should still remove from registry
    assert module.load_registry() == {}


def test_start_environment_not_found(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    response = flask_client.post("/start/nonexistent")
    assert response.status_code == 404


def test_stop_environment_not_found(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    response = flask_client.post("/stop/nonexistent")
    assert response.status_code == 404


def test_restart_environment_not_found(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    response = flask_client.post("/api/environments/nonexistent/restart")
    assert response.status_code == 404


def test_get_environment_status_not_found(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    response = flask_client.get("/api/environments/nonexistent/status")
    assert response.status_code == 404


def test_list_images_handles_no_images(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.client.images.list.return_value = []
    response = flask_client.get("/api/images")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["images"] == []


def test_build_image_code_server_success(monkeypatch, flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    exec_result = SimpleNamespace(exit_code=0, output=b"Build successful")

    updater = SimpleNamespace(
        status="running",
        start=MagicMock(),
        exec_run=MagicMock(return_value=exec_result),
        client=SimpleNamespace(
            api=SimpleNamespace(
                exec_create=lambda *a, **k: {"Id": "123"}, 
                exec_start=lambda *a, **k: None
            )
        ),
    )

    module.client.containers.get.side_effect = lambda name: updater
    response = flask_client.post("/api/images/build", json={"image_type": "code-server"})
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True


def test_get_environment_logs_returns_logs(flask_client, app_with_temp_paths, monkeypatch):
    module = app_with_temp_paths
    module.save_registry({"test-env": {"container_id": "cid123", "port": 8100}})
    
    container = SimpleNamespace(
        status="running",
        name="devfarm-test-env",
        logs=MagicMock(return_value=b"Container log output\nAnother line\n"),
    )
    module.client.containers.get.return_value = container
    monkeypatch.setattr(module, "is_env_ready", lambda name, port: True)
    
    response = flask_client.get("/api/environments/test-env/logs")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert "Container log output" in payload["logs"]
    assert payload["status"] == "running"


def test_get_environment_logs_not_found(flask_client, app_with_temp_paths):
    response = flask_client.get("/api/environments/nonexistent/logs")
    assert response.status_code == 404


def test_get_environment_logs_container_deleted(flask_client, app_with_temp_paths):
    module = app_with_temp_paths
    module.save_registry({"test-env": {"container_id": "deleted123"}})
    module.client.containers.get.side_effect = module.docker.errors.NotFound("missing")
    
    response = flask_client.get("/api/environments/test-env/logs")
    assert response.status_code == 404
    assert "Container not found" in response.get_json()["error"]


def test_api_environments_empty_registry(flask_client, app_with_temp_paths, monkeypatch):
    module = app_with_temp_paths
    monkeypatch.setattr(module, "load_registry", lambda: {})
    monkeypatch.setattr(module, "sync_registry_with_containers", lambda: None)
    
    response = flask_client.get("/api/environments")
    payload = response.get_json()
    assert response.status_code == 200
    assert payload == []
