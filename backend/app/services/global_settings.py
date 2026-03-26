from pathlib import Path

from pydantic import BaseModel

from app.services import yaml_service


class GlobalSettings(BaseModel):
    docker_vols_base: str = "/var/docker_vols"


def _path(repo_path: str) -> Path:
    return Path(repo_path) / "settings.yml"


def get_global_settings(repo_path: str) -> GlobalSettings:
    data = yaml_service.read_yaml(_path(repo_path))
    return GlobalSettings(**data) if data else GlobalSettings()


def save_global_settings(repo_path: str, gs: GlobalSettings) -> None:
    yaml_service.write_yaml(_path(repo_path), gs.model_dump())
