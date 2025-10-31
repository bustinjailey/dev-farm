import importlib
import os

import pytest


@pytest.fixture(scope="session")
def app_module(tmp_path_factory):
    """
    Import the dashboard app module once for the test session.
    Environment variables that influence module-level constants are set up
    before importing so they point into temporary, writable locations.
    """
    pytest.importorskip("flask")
    repo_root = tmp_path_factory.mktemp("repo")
    os.environ.setdefault("HOST_REPO_PATH", str(repo_root))
    module = importlib.import_module("dashboard.app")
    return module


@pytest.fixture
def app_with_temp_paths(app_module, tmp_path, monkeypatch):
    """
    Provide the dashboard module with per-test temporary paths so we can
    exercise filesystem interactions without touching the real host.
    """
    data_dir = tmp_path / "data"
    repo_dir = tmp_path / "repo"
    data_dir.mkdir(parents=True, exist_ok=True)
    repo_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(app_module, "REGISTRY_FILE", str(data_dir / "environments.json"))
    monkeypatch.setattr(app_module, "GITHUB_TOKEN_FILE", str(data_dir / ".github_token"))
    monkeypatch.setattr(app_module, "DEVICE_CODE_FILE", str(data_dir / ".device_code.json"))
    monkeypatch.setattr(app_module, "REPO_PATH", str(repo_dir))
    monkeypatch.setattr(app_module, "FARM_CONFIG_FILE", str(repo_dir / "farm.config"))

    # Ensure global state starts clean for every test
    os.environ.pop("GITHUB_TOKEN", None)

    app_module.SSE_CLIENTS.clear()
    app_module.UPDATE_PROGRESS.clear()
    app_module.UPDATE_PROGRESS.update(
        {
            "running": False,
            "success": None,
            "stages": [],
            "error": None,
            "stage": "idle",
            "status": "idle",
        }
    )
    app_module.LAST_KNOWN_STATUS.clear()
    app_module.USING_GEVENT = False

    return app_module


@pytest.fixture
def flask_client(app_with_temp_paths, monkeypatch):
    """
    Give tests an isolated Flask test client with a mocked Docker client.
    """
    from unittest.mock import MagicMock

    class DummyDockerClient:
        def __init__(self):
            self.containers = MagicMock()
            self.images = MagicMock()
            self.volumes = MagicMock()
            self.api = MagicMock()

    dummy_client = DummyDockerClient()
    monkeypatch.setattr(app_with_temp_paths, "client", dummy_client)

    app_with_temp_paths.app.config.update(
        {
            "TESTING": True,
            "LOGIN_DISABLED": True,
        }
    )
    return app_with_temp_paths.app.test_client()
