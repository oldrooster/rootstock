"""Integration-level tests for the apply orchestration router.

These tests mock the executor layer and verify that:
  - Scope routing dispatches correctly
  - Terraform snapshot is taken before apply
  - Rollback endpoints behave correctly
  - Invalid scopes are rejected
  - History is recorded per scope
"""

import json
import shutil
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def homelab_dir(tmp_path: Path) -> Path:
    """Minimal homelab repo structure expected by the apply router."""
    (tmp_path / "vms").mkdir()
    (tmp_path / "nodes").mkdir()
    (tmp_path / "containers").mkdir()
    (tmp_path / "templates").mkdir()
    (tmp_path / "images.yml").write_text("images: []\n")
    (tmp_path / "terraform").mkdir()
    (tmp_path / "ansible").mkdir()
    (tmp_path / "apply").mkdir()
    (tmp_path / "apply" / "state.yml").write_text("")
    return tmp_path


@pytest.fixture()
def app(homelab_dir: Path):
    """FastAPI app with homelab_repo_path pointing at the temp dir."""
    from app.config import settings
    from app.main import app as fastapi_app

    original = settings.homelab_repo_path
    settings.homelab_repo_path = str(homelab_dir)
    yield fastapi_app
    settings.homelab_repo_path = original


@pytest.fixture()
def client(app):
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Helper: async generator that yields a sequence of strings
# ---------------------------------------------------------------------------

async def _fake_stream(*lines: str):
    for line in lines:
        yield line


# ---------------------------------------------------------------------------
# Apply status
# ---------------------------------------------------------------------------


def test_apply_status_ok(client):
    with patch("app.routers.apply.get_dirty_areas", return_value={"terraform": False, "roles": False}):
        r = client.get("/api/apply/status")
    assert r.status_code == 200
    body = r.json()
    assert "dirty" in body
    assert "any_dirty" in body


def test_apply_preview_ok(client):
    with (
        patch("app.services.container_store.ContainerStore.list_all", return_value=[]),
        patch("app.services.vm_store.VMStore.list_all", return_value=[]),
    ):
        r = client.get("/api/apply/")
    assert r.status_code == 200
    body = r.json()
    assert body["total_services"] == 0
    assert body["total_vms"] == 0


# ---------------------------------------------------------------------------
# Terraform apply — snapshot is called
# ---------------------------------------------------------------------------


def test_terraform_apply_snapshots_state(client, homelab_dir):
    """snapshot_state() must be called before terraform apply runs."""
    state_file = homelab_dir / "terraform" / "terraform.tfstate"
    state_file.write_text('{"version": 4}')

    snapshot_calls: list = []

    def _fake_snapshot(tf_dir: Path) -> bool:
        snapshot_calls.append(tf_dir)
        return True

    async def _fake_run_tf(args, cwd):
        if args[0] == "init":
            yield "init ok\n"
        else:
            yield "Apply complete! Resources: 0 added\n"
            yield "\n✓ terraform apply completed successfully (exit code 0)\n"

    with (
        patch("app.routers.apply.prepare_workspace"),
        patch("app.routers.apply.snapshot_state", side_effect=_fake_snapshot),
        patch("app.routers.apply.run_terraform", side_effect=_fake_run_tf),
        patch("app.routers.apply.mark_applied"),
        patch("app.routers.apply.record_run"),
        patch("app.services.vm_store.VMStore.list_all", return_value=[]),
        patch("app.services.node_store.NodeStore.list_all", return_value=[]),
        patch("app.services.template_store.TemplateStore.list_all", return_value=[]),
        patch("app.services.image_store.ImageStore.list_all", return_value=[]),
    ):
        r = client.post("/api/apply/terraform/apply")

    assert r.status_code == 200
    assert len(snapshot_calls) == 1, "snapshot_state should be called exactly once"


# ---------------------------------------------------------------------------
# Rollback endpoints
# ---------------------------------------------------------------------------


def test_rollback_status_no_snapshot(client, homelab_dir):
    r = client.get("/api/apply/terraform/rollback-status")
    assert r.status_code == 200
    assert r.json() == {"available": False}


def test_rollback_status_with_snapshot(client, homelab_dir):
    rollback_file = homelab_dir / "terraform" / "terraform.tfstate.rollback"
    rollback_file.write_text('{"version": 4}')

    r = client.get("/api/apply/terraform/rollback-status")
    assert r.status_code == 200
    assert r.json() == {"available": True}


def test_rollback_restores_state(client, homelab_dir):
    tf_dir = homelab_dir / "terraform"
    rollback_file = tf_dir / "terraform.tfstate.rollback"
    state_file = tf_dir / "terraform.tfstate"
    rollback_file.write_text('{"version": 4, "serial": 1}')
    state_file.write_text('{"version": 4, "serial": 5}')

    r = client.post("/api/apply/terraform/rollback")
    assert r.status_code == 200
    assert r.json()["restored"] is True
    assert state_file.read_text() == '{"version": 4, "serial": 1}'


def test_rollback_fails_without_snapshot(client, homelab_dir):
    r = client.post("/api/apply/terraform/rollback")
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Ansible scope routing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("scope", ["roles", "containers", "dns", "ingress", "backups"])
def test_ansible_scope_routes_correctly(client, scope):
    """Each valid scope reaches prepare_ansible_workspace + run_ansible."""
    prepare_calls: list[str] = []

    def _fake_prepare(workspace_dir, scope_arg, *args, **kwargs):
        prepare_calls.append(scope_arg)

    async def _fake_run(*args, **kwargs):
        yield "ok\n"
        yield "\n✓ ansible-playbook completed successfully (exit code 0)\n"

    with (
        patch("app.routers.apply.prepare_ansible_workspace", side_effect=_fake_prepare),
        patch("app.routers.apply.run_ansible", side_effect=_fake_run),
        patch("app.routers.apply.mark_applied"),
        patch("app.routers.apply.record_run"),
        patch("app.services.vm_store.VMStore.list_all", return_value=[]),
        patch("app.services.node_store.NodeStore.list_all", return_value=[]),
        patch("app.services.container_store.ContainerStore.list_all", return_value=[]),
        patch("app.services.template_store.TemplateStore.list_all", return_value=[]),
    ):
        r = client.post(f"/api/apply/ansible/{scope}")

    assert r.status_code == 200
    assert scope in prepare_calls, f"scope '{scope}' not passed to prepare_ansible_workspace"


def test_invalid_ansible_scope_rejected(client):
    r = client.post("/api/apply/ansible/hacking")
    assert r.status_code in (400, 422), "Invalid scope should return 4xx"


# ---------------------------------------------------------------------------
# History endpoint
# ---------------------------------------------------------------------------


def test_history_returns_empty_when_no_history(client, homelab_dir):
    r = client.get("/api/apply/history")
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_history_scope_filter(client, homelab_dir):
    """?scope= filters to a single scope."""
    history_data = {"terraform": [{"timestamp": 1, "scope": "terraform", "exit_code": 0, "log": ""}]}
    with patch("app.routers.apply.load_history", return_value=history_data):
        r = client.get("/api/apply/history?scope=terraform")
    assert r.status_code == 200
    body = r.json()
    assert "terraform" in body
    assert "roles" not in body
