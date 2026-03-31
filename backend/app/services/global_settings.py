from pathlib import Path

from pydantic import BaseModel

from app.services import yaml_service


class S3SyncConfig(BaseModel):
    enabled: bool = False
    bucket: str = ""
    region: str = "us-east-1"
    access_key_secret: str = ""   # path in secret store, e.g. "aws/access_key"
    secret_key_secret: str = ""   # path in secret store, e.g. "aws/secret_key"
    sync_host: str = ""           # which host to run the s3 sync from
    schedule: str = ""            # cron expression for s3 sync (empty = same as backup)
    prefix: str = ""              # S3 key prefix, e.g. "backups/"


class GlobalSettings(BaseModel):
    docker_vols_base: str = "/var/docker_vols"
    backup_target: str = "/mnt/share/backups"
    backup_schedule: str = ""
    role_order: list[str] = []
    s3_sync: S3SyncConfig = S3SyncConfig()


def _path(repo_path: str) -> Path:
    return Path(repo_path) / "settings.yml"


def get_global_settings(repo_path: str) -> GlobalSettings:
    data = yaml_service.read_yaml(_path(repo_path))
    return GlobalSettings(**data) if data else GlobalSettings()


def save_global_settings(repo_path: str, gs: GlobalSettings) -> None:
    yaml_service.write_yaml(_path(repo_path), gs.model_dump())
