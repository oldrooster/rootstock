import re
from pathlib import Path

from pydantic import BaseModel

from app.models.container import ContainerDefinition
from app.services import yaml_service


class ManualBackupPath(BaseModel):
    host: str
    path: str
    description: str = ""


def path_slug(path: str) -> str:
    """Convert a path like /var/docker_vols/unifi/config to a safe directory name."""
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", path.strip("/"))


def _paths_file(repo_path: str) -> Path:
    return Path(repo_path) / "backups" / "paths.yml"


def get_manual_paths(repo_path: str) -> list[ManualBackupPath]:
    data = yaml_service.read_yaml(_paths_file(repo_path))
    return [ManualBackupPath(**p) for p in data.get("manual_paths", [])]


def save_manual_paths(repo_path: str, paths: list[ManualBackupPath]) -> None:
    yaml_service.write_yaml(
        _paths_file(repo_path),
        {"manual_paths": [p.model_dump() for p in paths]},
    )


class BackupPath(BaseModel):
    host: str
    path: str
    source: str  # "container" | "manual"
    description: str = ""
    exclusions: list[str] = []


def get_all_backup_paths(
    containers: list[ContainerDefinition],
    repo_path: str,
    docker_vols_base: str = "/var/docker_vols",
) -> list[BackupPath]:
    """Merge derived backup paths from container volumes with manual paths."""
    paths: list[BackupPath] = []

    for ctr in containers:
        if not ctr.enabled:
            continue
        for vol in ctr.volumes:
            if not vol.backup:
                continue
            # Resolve ${DOCKER_VOLS} in the host_path
            resolved = vol.host_path.replace("${DOCKER_VOLS}", docker_vols_base)
            for host in ctr.hosts:
                paths.append(BackupPath(
                    host=host,
                    path=resolved,
                    source="container",
                    description=f"from container '{ctr.name}'",
                    exclusions=list(vol.backup_exclusions),
                ))

    for mp in get_manual_paths(repo_path):
        paths.append(BackupPath(
            host=mp.host,
            path=mp.path,
            source="manual",
            description=mp.description,
        ))

    return paths
