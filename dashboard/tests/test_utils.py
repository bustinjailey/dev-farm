from types import SimpleNamespace
from unittest.mock import MagicMock

import json
import pathlib

import pytest


def test_kebabify_various_cases(app_with_temp_paths):
    module = app_with_temp_paths
    assert module.kebabify("My Cool Project") == "my-cool-project"
    assert module.kebabify("Test_Env 123") == "test-env-123"
    assert module.kebabify("Already-kebab") == "already-kebab"
    assert module.kebabify("  Leading and Trailing  ") == "leading-and-trailing"


def test_save_and_load_registry_roundtrip(app_with_temp_paths, monkeypatch):
    module = app_with_temp_paths
    events = []

    def capture(event, data):
        events.append(event)

    monkeypatch.setattr(module, "broadcast_sse", capture)

    registry_data = {
        "env-one": {"port": 8100, "container_id": "abc"},
        "env-two": {"port": 8101, "container_id": "def"},
    }

    module.save_registry(registry_data)
    loaded = module.load_registry()
    assert loaded == registry_data
    assert events == ["registry-update"]


def test_get_workspace_path_modes(app_with_temp_paths):
    module = app_with_temp_paths
    assert module.get_workspace_path("git") == "/repo"
    assert module.get_workspace_path("workspace") == "/workspace"
    assert module.get_workspace_path("ssh") == "/remote"
    assert module.get_workspace_path("terminal") == "/workspace"
    assert module.get_workspace_path("unknown") == "/workspace"


def test_get_workspace_path_reads_aliases(app_with_temp_paths):
    module = app_with_temp_paths
    alias_config = pathlib.Path(module.PATH_ALIAS_CONFIG)
    alias_config.parent.mkdir(parents=True, exist_ok=True)
    alias_config.write_text(json.dumps({
        "workspace": "/alt/workspace",
        "remote": "/alt/remote",
        "repo": "/alt/repo"
    }))
    module.load_path_aliases.cache_clear()

    assert module.get_workspace_path("git") == "/alt/repo"
    assert module.get_workspace_path("ssh") == "/alt/remote"
    assert module.get_workspace_path("workspace") == "/alt/workspace"


def test_get_next_port_skips_used_ports(app_with_temp_paths, monkeypatch):
    module = app_with_temp_paths
    monkeypatch.setattr(
        module,
        "load_registry",
        lambda: {
            "env-a": {"port": module.BASE_PORT},
            "env-b": {"port": module.BASE_PORT + 1},
        },
    )
    assert module.get_next_port() == module.BASE_PORT + 2


def test_get_container_stats_computes_percentages(app_with_temp_paths):
    module = app_with_temp_paths
    stats_payload = {
        "cpu_stats": {"cpu_usage": {"total_usage": 300_000}, "system_cpu_usage": 2_000_000},
        "precpu_stats": {"cpu_usage": {"total_usage": 100_000}, "system_cpu_usage": 1_000_000},
        "memory_stats": {"usage": 524_288_000, "limit": 1_048_576_000},
    }
    container = SimpleNamespace(stats=lambda stream=False: stats_payload)

    stats = module.get_container_stats(container)
    assert stats["cpu"] == pytest.approx(20.0, abs=0.1)
    assert stats["memory"] == pytest.approx(50.0, abs=0.1)
    assert stats["memory_mb"] == pytest.approx(500.0, abs=0.1)


def test_get_container_stats_handles_errors(app_with_temp_paths):
    module = app_with_temp_paths

    class FailingContainer:
        def stats(self, stream=False):
            raise RuntimeError("boom")

    stats = module.get_container_stats(FailingContainer())
    assert stats == {"cpu": 0, "memory": 0, "memory_mb": 0}


def test_is_env_ready_uses_healthcheck(monkeypatch, app_with_temp_paths):
    module = app_with_temp_paths

    healthy_container = SimpleNamespace(
        attrs={"State": {"Health": {"Status": "healthy"}}}, name="env", status="running"
    )

    class DummyContainers:
        def get(self, name):
            assert name == "container-id"
            return healthy_container

    dummy_client = SimpleNamespace(containers=DummyContainers())
    monkeypatch.setattr(module, "client", dummy_client)
    assert module.is_env_ready("container-id", port=9999) is True


def test_is_env_ready_falls_back_to_http(monkeypatch, app_with_temp_paths):
    module = app_with_temp_paths

    no_health_container = SimpleNamespace(attrs={"State": {}}, name="env", status="running")

    class DummyContainers:
        def get(self, name):
            return no_health_container

    dummy_client = SimpleNamespace(containers=DummyContainers())
    monkeypatch.setattr(module, "client", dummy_client)

    responses = []

    def fake_get(url, timeout):
        responses.append(url)
        if "localhost" in url:
            return SimpleNamespace(status_code=200)
        raise requests.RequestException("unreachable")

    import requests

    monkeypatch.setattr(requests, "get", fake_get)
    assert module.is_env_ready("container-id", port=8123) is True
    assert responses == ["http://container-id:8080", "http://localhost:8123"]


def test_is_env_ready_handles_failures(monkeypatch, app_with_temp_paths):
    module = app_with_temp_paths
    monkeypatch.setattr(module, "client", SimpleNamespace(containers=MagicMock()))

    import requests

    monkeypatch.setattr(requests, "get", MagicMock(side_effect=requests.RequestException))
    assert module.is_env_ready("missing", port=8123) is False
