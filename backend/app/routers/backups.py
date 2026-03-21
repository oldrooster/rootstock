from fastapi import APIRouter, Depends

from app.config import settings
from app.models.backup import BackupEntry, BackupResult
from app.services.service_store import ServiceStore

router = APIRouter()


def get_store() -> ServiceStore:
    return ServiceStore(settings.homelab_repo_path)


@router.get("/")
async def list_backups(store: ServiceStore = Depends(get_store)) -> list[BackupEntry]:
    services = store.list_all()
    entries = []
    for svc in services:
        for vol in svc.volumes:
            if vol.backup:
                entries.append(BackupEntry(
                    service_name=svc.name,
                    host=svc.host,
                    volume_path=vol.host_path,
                ))
    return entries


@router.post("/{service_name}/backup")
async def trigger_backup(
    service_name: str,
    store: ServiceStore = Depends(get_store),
) -> BackupResult:
    svc = store.get(service_name)  # raises 404 if missing
    backup_vols = [v for v in svc.volumes if v.backup]
    vol_paths = ", ".join(v.host_path for v in backup_vols) if backup_vols else "none"
    return BackupResult(
        service_name=service_name,
        action="backup",
        detail=f"Simulated backup of {len(backup_vols)} volume(s): {vol_paths}",
    )


@router.post("/{service_name}/restore")
async def restore_backup(
    service_name: str,
    store: ServiceStore = Depends(get_store),
) -> BackupResult:
    svc = store.get(service_name)  # raises 404 if missing
    backup_vols = [v for v in svc.volumes if v.backup]
    vol_paths = ", ".join(v.host_path for v in backup_vols) if backup_vols else "none"
    return BackupResult(
        service_name=service_name,
        action="restore",
        detail=f"Simulated restore of {len(backup_vols)} volume(s): {vol_paths}",
    )
