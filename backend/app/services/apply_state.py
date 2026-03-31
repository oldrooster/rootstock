"""Track dirty state for each apply area by comparing file modification times."""

import time
from pathlib import Path

from app.services import yaml_service

AREAS = ["terraform", "roles", "containers", "dns", "ingress", "backups"]


def _state_path(repo_path: str) -> Path:
    return Path(repo_path) / "apply" / "state.yml"


def _get_state(repo_path: str) -> dict:
    return yaml_service.read_yaml(_state_path(repo_path))


def _save_state(repo_path: str, state: dict) -> None:
    yaml_service.write_yaml(_state_path(repo_path), state)


def _area_dirs(repo_path: str) -> dict[str, list[Path]]:
    """Map each area to the directories that contribute to it."""
    base = Path(repo_path)
    return {
        "terraform": [base / "vms", base / "nodes", base / "templates", base / "images"],
        "roles": [base / "roles", base / "nodes", base / "vms"],
        "containers": [base / "containers", base / "services"],
        "dns": [base / "dns", base / "containers", base / "services"],
        "ingress": [base / "ingress", base / "containers", base / "services"],
        "backups": [base / "backups", base / "containers", base / "services"],
    }


def _latest_mtime(dirs: list[Path]) -> float:
    """Get the most recent file modification time across directories."""
    latest = 0.0
    for d in dirs:
        if not d.exists():
            continue
        for f in d.rglob("*"):
            if f.is_file() and f.suffix in (".yml", ".yaml", ".tf"):
                mtime = f.stat().st_mtime
                if mtime > latest:
                    latest = mtime
    return latest


def get_dirty_areas(repo_path: str) -> dict[str, bool]:
    """Return which areas have changes since last apply."""
    state = _get_state(repo_path)
    last_applied = state.get("last_applied", {})
    dirs = _area_dirs(repo_path)
    result = {}
    for area in AREAS:
        area_dirs = dirs.get(area, [])
        latest = _latest_mtime(area_dirs)
        last = last_applied.get(area, 0)
        result[area] = latest > last
    return result


def mark_applied(repo_path: str, area: str) -> None:
    """Mark an area as applied (update its timestamp)."""
    state = _get_state(repo_path)
    if "last_applied" not in state:
        state["last_applied"] = {}
    state["last_applied"][area] = time.time()
    _save_state(repo_path, state)


def mark_all_applied(repo_path: str) -> None:
    """Mark all areas as applied."""
    for area in AREAS:
        mark_applied(repo_path, area)
