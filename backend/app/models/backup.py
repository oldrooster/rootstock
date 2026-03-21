from pydantic import BaseModel


class BackupEntry(BaseModel):
    service_name: str
    host: str
    volume_path: str
    last_backup: str | None = None
    status: str = "ready"


class BackupResult(BaseModel):
    service_name: str
    action: str
    detail: str
